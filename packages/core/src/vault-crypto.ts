// Vault-wide encryption. Master password derives a Key-Encryption-Key
// (KEK) via PBKDF2-SHA256 with high iterations. The KEK unwraps a
// random Data-Encryption-Key (DEK), which actually encrypts every
// stored value via AES-GCM.
//
// This indirection means a password change only re-wraps the DEK
// (cheap), not every record (expensive). It also means the DEK can be
// kept short-lived in memory and zeroed on lock.
//
// Layout of the on-disk auth blob (`octovault-auth` IDB store):
//   version (1 byte) = 2
//   salt-len (1)
//   salt (16)
//   verifier-len (1)
//   verifier (32)            HMAC-SHA256 of "octovault-verify" with KEK
//   wrap-nonce-len (1)
//   wrap-nonce (12)
//   wrapped-dek (32)         AES-GCM encrypted DEK + 16-byte tag
//
// Encrypted IDB values are stored as a single Uint8Array:
//   marker (4)               magic "OVE1" (lets us detect ciphertext vs plain)
//   nonce (12)               unique per write
//   ciphertext (...)         AES-GCM, last 16 bytes are the auth tag

const TEXT = new TextEncoder();
const TEXT_DEC = new TextDecoder();
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const VERIFIER_BYTES = 32;
const VERIFY_INPUT = TEXT.encode("octovault-verify");
const MAGIC = TEXT.encode("OVE1"); // OctoVault Encrypted v1

export interface AuthBlobV2 {
  version: 2;
  salt: Uint8Array;
  verifier: Uint8Array;
  wrapNonce: Uint8Array;
  wrappedDek: Uint8Array;
}

async function deriveKek(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    TEXT.encode(password) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"]
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacVerify(kek: CryptoKey): Promise<Uint8Array> {
  // Re-use the KEK material for an HMAC-style verifier. We can't HMAC
  // directly with an AES key, so we encrypt the deterministic constant
  // input with a fixed nonce and use the first VERIFIER_BYTES bytes of
  // the ciphertext as the verifier.
  const fixed = new Uint8Array(NONCE_BYTES); // all zeros — fixed-nonce OK here because input is constant
  const out = await crypto.subtle.encrypt({ name: "AES-GCM", iv: fixed as BufferSource }, kek, VERIFY_INPUT as BufferSource);
  return new Uint8Array(out).slice(0, VERIFIER_BYTES);
}

export async function initializeVault(password: string): Promise<AuthBlobV2> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const kek = await deriveKek(password, salt);
  const verifier = await hmacVerify(kek);

  // Generate a fresh DEK.
  const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const dekRaw = new Uint8Array(await crypto.subtle.exportKey("raw", dek));

  // Wrap the DEK with the KEK.
  const wrapNonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapNonce as BufferSource }, kek, dekRaw as BufferSource)
  );

  return { version: 2, salt, verifier, wrapNonce, wrappedDek: wrapped };
}

export function serializeAuthBlobV2(b: AuthBlobV2): Uint8Array {
  const out = new Uint8Array(1 + 1 + b.salt.length + 1 + b.verifier.length + 1 + b.wrapNonce.length + b.wrappedDek.length);
  let o = 0;
  out[o++] = b.version;
  out[o++] = b.salt.length;       out.set(b.salt, o); o += b.salt.length;
  out[o++] = b.verifier.length;   out.set(b.verifier, o); o += b.verifier.length;
  out[o++] = b.wrapNonce.length;  out.set(b.wrapNonce, o); o += b.wrapNonce.length;
  out.set(b.wrappedDek, o);
  return out;
}

export function deserializeAuthBlobV2(bytes: Uint8Array): AuthBlobV2 | null {
  if (bytes[0] !== 2) return null;
  let o = 1;
  const saltLen = bytes[o++]; const salt = bytes.slice(o, o + saltLen); o += saltLen;
  const verLen = bytes[o++]; const verifier = bytes.slice(o, o + verLen); o += verLen;
  const wrapLen = bytes[o++]; const wrapNonce = bytes.slice(o, o + wrapLen); o += wrapLen;
  const wrappedDek = bytes.slice(o);
  return { version: 2, salt, verifier, wrapNonce, wrappedDek };
}

export class VaultCrypto {
  private dek: CryptoKey | null = null;

  isUnlocked(): boolean { return this.dek !== null; }

  async unlock(password: string, blob: AuthBlobV2): Promise<boolean> {
    const kek = await deriveKek(password, blob.salt);
    const verifier = await hmacVerify(kek);
    if (!constantTimeEqual(verifier, blob.verifier)) return false;
    try {
      const dekRaw = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: blob.wrapNonce as BufferSource },
        kek,
        blob.wrappedDek as BufferSource,
      );
      this.dek = await crypto.subtle.importKey(
        "raw", dekRaw as ArrayBuffer,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
      return true;
    } catch { return false; }
  }

  lock(): void { this.dek = null; }

  async encryptString(plaintext: string): Promise<Uint8Array> {
    if (!this.dek) throw new Error("Vault is locked");
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, this.dek, TEXT.encode(plaintext) as BufferSource)
    );
    const out = new Uint8Array(MAGIC.length + NONCE_BYTES + ct.length);
    out.set(MAGIC, 0);
    out.set(nonce, MAGIC.length);
    out.set(ct, MAGIC.length + NONCE_BYTES);
    return out;
  }

  async decryptString(blob: Uint8Array): Promise<string> {
    if (!this.dek) throw new Error("Vault is locked");
    if (!isEncrypted(blob)) throw new Error("Not an OctoVault ciphertext");
    const nonce = blob.slice(MAGIC.length, MAGIC.length + NONCE_BYTES);
    const ct = blob.slice(MAGIC.length + NONCE_BYTES);
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce as BufferSource }, this.dek, ct as BufferSource,
    );
    return TEXT_DEC.decode(pt);
  }
}

/** Cheap header-only sniff so plaintext-from-old-installs still reads. */
export function isEncrypted(v: unknown): v is Uint8Array {
  if (!(v instanceof Uint8Array)) return false;
  if (v.length < MAGIC.length + NONCE_BYTES) return false;
  for (let i = 0; i < MAGIC.length; i++) if (v[i] !== MAGIC[i]) return false;
  return true;
}

// Module-level instance — there's exactly one vault per surface.
export const vaultCrypto = new VaultCrypto();
