// Renderer-side StorageAdapter that proxies every call to the main
// process via the preload bridge. The actual storage is SQLCipher.
// Settings fall back to local defaults when the vault is locked so
// the unlock screen can still render with the right theme / etc.

import { DEFAULT_SETTINGS } from "@octovault/core";
import type {
  EducationRecord, Entity, Event, ExperienceRecord, FieldRecord,
  Profile, RelationshipEdge, Settings, StorageAdapter, StoredDocument, VaultProfile,
} from "@octovault/core";
import type { EmbeddingRecord } from "@octovault/core";

function s() {
  const o = window.octovault?.store;
  if (!o) throw new Error("Octovault bridge not available");
  return o;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export const ipcStorageAdapter: StorageAdapter = {
  async listEntities() { return safe(() => s().listEntities() as Promise<Entity[]>, []); },
  async saveEntity(e) { await s().saveEntity(e); },
  async deleteEntity(id) { await s().deleteEntity(id); },

  async saveDocument(doc) { await s().saveDocument(doc); },
  async listDocuments() { return safe(() => s().listDocuments() as Promise<StoredDocument[]>, []); },
  async getDocument(id) { return safe(() => s().getDocument(id) as Promise<StoredDocument | undefined>, undefined); },
  async deleteDocument(id) { await s().deleteDocument(id); },

  async getRecord(entityId, key) { return safe(() => s().getRecord(entityId, key) as Promise<FieldRecord | undefined>, undefined); },
  async setRecord(entityId, record) { await s().setRecord(entityId, record); },
  async deleteRecord(entityId, key) { await s().deleteRecord(entityId, key); },
  async getProfile(entityId) { return safe(() => s().getProfile(entityId) as Promise<Profile>, {}); },
  async getAllProfiles() { return safe(() => s().getAllProfiles() as Promise<VaultProfile>, {}); },
  async clearProfile(entityId) { await s().clearProfile(entityId); },
  async deleteCandidatesFromDoc(documentId) { await s().deleteCandidatesFromDoc(documentId); },

  async listEmbeddings() { return safe(() => s().listEmbeddings() as Promise<EmbeddingRecord[]>, []); },
  async saveEmbeddings(records) { await s().saveEmbeddings(records); },
  async deleteEmbeddingsForDoc(documentId) { await s().deleteEmbeddingsForDoc(documentId); },

  async listEducation(entityId) { return safe(() => s().listEducation(entityId) as Promise<EducationRecord[]>, []); },
  async saveEducation(record) { await s().saveEducation(record); },
  async deleteEducation(id) { await s().deleteEducation(id); },
  async listExperience(entityId) { return safe(() => s().listExperience(entityId) as Promise<ExperienceRecord[]>, []); },
  async saveExperience(record) { await s().saveExperience(record); },
  async deleteExperience(id) { await s().deleteExperience(id); },
  async deleteRecordsFromDoc(documentId) { await s().deleteRecordsFromDoc(documentId); },

  async listRelationships() { return safe(() => s().listRelationships() as Promise<RelationshipEdge[]>, []); },
  async saveRelationship(rel) { await s().saveRelationship(rel); },
  async deleteRelationship(id) { await s().deleteRelationship(id); },

  async listEvents() { return safe(() => s().listEvents() as Promise<Event[]>, []); },
  async saveEvent(event) { await s().saveEvent(event); },
  async deleteEvent(id) { await s().deleteEvent(id); },
  async deleteEventsFromDoc(documentId) { await s().deleteEventsFromDoc(documentId); },

  async getSettings() {
    // When the vault is locked, the IPC will throw and we return defaults
    // so the unlock screen still works.
    return safe(async () => {
      const partial = (await s().getSettings()) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...partial };
    }, { ...DEFAULT_SETTINGS });
  },
  async updateSettings(patch) {
    const next = await s().updateSettings(patch) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...next };
  },

  async getAuthBlob() {
    // Stored inside the encrypted DB; only readable after unlock.
    return safe(async () => (await s().getAuthBlob()) as Uint8Array | null, null);
  },
  async setAuthBlob(blob) { await s().setAuthBlob(blob); },
  async deleteAuthBlob() { await s().deleteAuthBlob(); },
};
