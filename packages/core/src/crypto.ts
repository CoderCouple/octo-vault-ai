// Master-password helpers using WebCrypto (available in browser,
// extension, and Electron renderer). For desktop disk encryption,
// wrap field-level secrets with the derived key; for extension/web,
// we use this to gate access to highly-sensitive field reveals.

const TEXT = new TextEncoder();
const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const VERIFIER_BYTES = 32;

export interface AuthBlob {
  version: 1;
  salt: Uint8Array;
  verifier: Uint8Array;          // HMAC of "octovault-verify" with derived key
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    TEXT.encode(password) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"]
  );
}

export async function createAuthBlob(password: string): Promise<AuthBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(password, salt);
  const sig = await crypto.subtle.sign("HMAC", key, TEXT.encode("octovault-verify") as BufferSource);
  const verifier = new Uint8Array(sig).slice(0, VERIFIER_BYTES);
  return { version: 1, salt, verifier };
}

export async function verifyPassword(password: string, blob: AuthBlob): Promise<boolean> {
  const key = await deriveKey(password, blob.salt);
  const sig = await crypto.subtle.sign("HMAC", key, TEXT.encode("octovault-verify") as BufferSource);
  const expected = new Uint8Array(sig).slice(0, VERIFIER_BYTES);
  return constantTimeEqual(expected, blob.verifier);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function serializeAuthBlob(b: AuthBlob): Uint8Array {
  // version (1) | salt-length (1) | salt | verifier
  const out = new Uint8Array(2 + b.salt.length + b.verifier.length);
  out[0] = b.version;
  out[1] = b.salt.length;
  out.set(b.salt, 2);
  out.set(b.verifier, 2 + b.salt.length);
  return out;
}

export function deserializeAuthBlob(bytes: Uint8Array): AuthBlob {
  const version = bytes[0] as 1;
  const saltLen = bytes[1];
  const salt = bytes.slice(2, 2 + saltLen);
  const verifier = bytes.slice(2 + saltLen);
  return { version, salt, verifier };
}
