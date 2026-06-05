// IndexedDB-backed StorageAdapter. Every value is transparently
// encrypted via the module-level VaultCrypto once the vault is
// unlocked. Settings + auth blob stay plaintext so the unlock flow
// itself can run.

import { get, set, del, keys, createStore, type UseStore } from "idb-keyval";
import { DEFAULT_SETTINGS } from "../storage";
import type { Settings, StorageAdapter, StoredDocument } from "../storage";
import type {
  EducationRecord, Entity, Event, ExperienceRecord, FieldRecord,
  Profile, ProfileKey, RelationshipEdge, VaultProfile,
} from "../schema";
import type { EmbeddingRecord } from "../qa";
import { isEncrypted, vaultCrypto } from "../vault-crypto";

const docStore = createStore("octovault-docs", "documents");
const recordStore = createStore("octovault-records", "fields");
const entityStore = createStore("octovault-entities", "entities");
const embedStore = createStore("octovault-embeddings", "vectors");
const eduStore = createStore("octovault-education", "records");
const expStore = createStore("octovault-experience", "records");
const relStore = createStore("octovault-relationships", "edges");
const eventStore = createStore("octovault-events", "events");
const settingsStore = createStore("octovault-settings", "kv");
const authStore = createStore("octovault-auth", "kv");

function recordKey(entityId: string, fieldKey: ProfileKey): string {
  return `${entityId}|${fieldKey}`;
}

async function putValue(store: UseStore, key: string, value: unknown): Promise<void> {
  if (vaultCrypto.isUnlocked()) {
    const ct = await vaultCrypto.encryptString(JSON.stringify(value));
    await set(key, ct, store);
  } else {
    await set(key, value, store);
  }
}

async function getValue<T>(store: UseStore, key: string): Promise<T | undefined> {
  const raw = await get<unknown>(key, store);
  if (raw == null) return undefined;
  if (isEncrypted(raw)) {
    if (!vaultCrypto.isUnlocked()) throw new Error("Vault is locked");
    return JSON.parse(await vaultCrypto.decryptString(raw)) as T;
  }
  return raw as T;
}

export const indexedDbAdapter: StorageAdapter = {
  // --- Entities ---
  async listEntities() {
    const ids = await keys(entityStore);
    const ents = await Promise.all(ids.map((k) => getValue<Entity>(entityStore, k as string)));
    return ents.filter((e): e is Entity => !!e).sort((a, b) => a.createdAt - b.createdAt);
  },
  async saveEntity(entity) { await putValue(entityStore, entity.id, entity); },

  // --- Embeddings ---
  async listEmbeddings() {
    const ids = await keys(embedStore);
    const recs = await Promise.all(ids.map((k) => getValue<EmbeddingRecord>(embedStore, k as string)));
    return recs.filter((r): r is EmbeddingRecord => !!r);
  },
  async saveEmbeddings(records) {
    for (const r of records) await putValue(embedStore, r.id, r);
  },
  async deleteEmbeddingsForDoc(documentId) {
    const ids = (await keys(embedStore)) as string[];
    for (const id of ids) {
      const r = await getValue<EmbeddingRecord>(embedStore, id);
      if (r?.documentId === documentId) await del(id, embedStore);
    }
  },

  // --- Education ---
  async listEducation(entityId) {
    const ids = (await keys(eduStore)) as string[];
    const recs = await Promise.all(ids.map((k) => getValue<EducationRecord>(eduStore, k)));
    return recs.filter((r): r is EducationRecord => !!r && r.entityId === entityId && !r.dismissedAt)
               .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
  },
  async saveEducation(record) { await putValue(eduStore, record.id, record); },
  async deleteEducation(id) { await del(id, eduStore); },

  // --- Experience ---
  async listExperience(entityId) {
    const ids = (await keys(expStore)) as string[];
    const recs = await Promise.all(ids.map((k) => getValue<ExperienceRecord>(expStore, k)));
    return recs.filter((r): r is ExperienceRecord => !!r && r.entityId === entityId && !r.dismissedAt)
               .sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"));
  },
  async saveExperience(record) { await putValue(expStore, record.id, record); },
  async deleteExperience(id) { await del(id, expStore); },

  async deleteRecordsFromDoc(documentId) {
    for (const store of [eduStore, expStore, relStore, eventStore]) {
      const ids = (await keys(store)) as string[];
      for (const id of ids) {
        const r = await getValue<{ source?: { documentId?: string } }>(store, id);
        if (r?.source?.documentId === documentId) await del(id, store);
      }
    }
  },

  // --- Relationships ---
  async listRelationships() {
    const ids = (await keys(relStore)) as string[];
    const recs = await Promise.all(ids.map((k) => getValue<RelationshipEdge>(relStore, k)));
    return recs.filter((r): r is RelationshipEdge => !!r);
  },
  async saveRelationship(rel) {
    await putValue(relStore, rel.id, { ...rel, updatedAt: Date.now() });
  },
  async deleteRelationship(id) {
    await del(id, relStore);
  },

  // --- Events ---
  async listEvents() {
    const ids = (await keys(eventStore)) as string[];
    const recs = await Promise.all(ids.map((k) => getValue<Event>(eventStore, k)));
    return recs.filter((r): r is Event => !!r);
  },
  async saveEvent(event) {
    await putValue(eventStore, event.id, { ...event, updatedAt: Date.now() });
  },
  async deleteEvent(id) {
    await del(id, eventStore);
  },
  async deleteEventsFromDoc(documentId: string) {
    const ids = (await keys(eventStore)) as string[];
    for (const id of ids) {
      const e = await getValue<Event>(eventStore, id);
      if (e?.source?.documentId === documentId) await del(id, eventStore);
    }
  },

  async deleteEntity(id) {
    await del(id, entityStore);
    const docIds = await keys(docStore);
    for (const k of docIds) {
      const d = await getValue<StoredDocument>(docStore, k as string);
      if (d?.entityId === id) await del(k as string, docStore);
    }
    const recKeys = await keys(recordStore);
    for (const k of recKeys) {
      if ((k as string).startsWith(`${id}|`)) await del(k as string, recordStore);
    }
    for (const store of [eduStore, expStore]) {
      const ids = (await keys(store)) as string[];
      for (const recId of ids) {
        const r = await getValue<{ entityId?: string }>(store, recId);
        if (r?.entityId === id) await del(recId, store);
      }
    }
    // Drop any relationship that points to or from this entity.
    const relIds = (await keys(relStore)) as string[];
    for (const relId of relIds) {
      const r = await getValue<RelationshipEdge>(relStore, relId);
      if (r && (r.fromEntityId === id || r.toEntityId === id)) {
        await del(relId, relStore);
      }
    }
  },

  // --- Documents ---
  async saveDocument(doc) { await putValue(docStore, doc.id, doc); },
  async listDocuments() {
    const ids = await keys(docStore);
    const docs = await Promise.all(ids.map((k) => getValue<StoredDocument>(docStore, k as string)));
    return docs.filter((d): d is StoredDocument => !!d).sort((a, b) => b.importedAt - a.importedAt);
  },
  async getDocument(id) { return getValue<StoredDocument>(docStore, id); },
  async deleteDocument(id) { await del(id, docStore); },

  // --- Records ---
  async getRecord(entityId, key) { return getValue<FieldRecord>(recordStore, recordKey(entityId, key)); },
  async setRecord(entityId, record) { await putValue(recordStore, recordKey(entityId, record.key), record); },
  async deleteRecord(entityId, key) { await del(recordKey(entityId, key), recordStore); },

  async getProfile(entityId) {
    const ks = (await keys(recordStore)) as string[];
    const out: Profile = {};
    for (const k of ks) {
      if (!k.startsWith(`${entityId}|`)) continue;
      const r = await getValue<FieldRecord>(recordStore, k);
      if (r) out[r.key] = r;
    }
    return out;
  },

  async getAllProfiles() {
    const ks = (await keys(recordStore)) as string[];
    const out: VaultProfile = {};
    for (const k of ks) {
      const sep = k.indexOf("|");
      if (sep < 0) continue;
      const entityId = k.slice(0, sep);
      const r = await getValue<FieldRecord>(recordStore, k);
      if (!r) continue;
      (out[entityId] ??= {})[r.key] = r;
    }
    return out;
  },

  async clearProfile(entityId) {
    const ks = await keys(recordStore);
    for (const k of ks) {
      if ((k as string).startsWith(`${entityId}|`)) await del(k as string, recordStore);
    }
  },

  async deleteCandidatesFromDoc(documentId) {
    const ks = (await keys(recordStore)) as string[];
    for (const k of ks) {
      const r = await getValue<FieldRecord>(recordStore, k);
      if (!r) continue;
      const filtered = r.candidates.filter((c) => c.source.documentId !== documentId);
      if (filtered.length === 0) await del(k, recordStore);
      else if (filtered.length !== r.candidates.length) {
        await putValue(recordStore, k, { ...r, candidates: filtered, canonicalId: null });
      }
    }
  },

  // --- Settings (plain — needed before unlock) ---
  async getSettings() {
    const stored = (await get<Partial<Settings>>("settings", settingsStore)) ?? {};
    return { ...DEFAULT_SETTINGS, ...stored };
  },
  async updateSettings(patch) {
    const next = { ...(await this.getSettings()), ...patch };
    await set("settings", next, settingsStore);
    return next;
  },

  // --- Auth blob (plain by definition — it's the unlock credential) ---
  async getAuthBlob() { return (await get<Uint8Array>("blob", authStore)) ?? null; },
  async setAuthBlob(blob) { await set("blob", blob, authStore); },
  /** Used by the "Reset vault" flow — wipes the auth credential entirely
      so getAuthBlob() returns null afterwards. */
  async deleteAuthBlob() { await del("blob", authStore); },
};
