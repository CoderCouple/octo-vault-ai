// Read-only StorageAdapter backed by the Desktop app's localhost bridge.
// Writes throw ReadOnlyError so the UI shows a "switch to local vault to
// edit" hint instead of failing silently.

import {
  DEFAULT_SETTINGS,
  type FieldRecord, type Settings, type StorageAdapter, type StoredDocument,
} from "@octovault/core";
import type {
  EducationRecord, Entity, ExperienceRecord, Profile, ProfileKey, VaultProfile,
} from "@octovault/core";

const BRIDGE = "http://127.0.0.1:53117";

export class ReadOnlyError extends Error {
  constructor() {
    super("Desktop vault is read-only. Switch to the local vault to edit.");
    this.name = "ReadOnlyError";
  }
}

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(`${BRIDGE}${path}`);
    if (!r.ok) return fallback;
    return (await r.json()) as T;
  } catch { return fallback; }
}

export const bridgeReadOnlyAdapter: StorageAdapter = {
  // Entities (read-only)
  async listEntities() { return get<Entity[]>("/entities", []); },
  async saveEntity(_e) { throw new ReadOnlyError(); },
  async deleteEntity(_id) { throw new ReadOnlyError(); },

  // Embeddings — bridge doesn't serve them; popup chat falls back to local IDB.
  async listEmbeddings() { return []; },
  async saveEmbeddings(_records) { throw new ReadOnlyError(); },
  async deleteEmbeddingsForDoc(_id) { throw new ReadOnlyError(); },

  // Education + Experience records — pulled from desktop bridge.
  async listEducation(entityId) {
    const all = await get<EducationRecord[]>(`/education?entityId=${entityId}`, []);
    return all.filter((r) => r.entityId === entityId);
  },
  async saveEducation(_r) { throw new ReadOnlyError(); },
  async deleteEducation(_id) { throw new ReadOnlyError(); },
  async listExperience(entityId) {
    const all = await get<ExperienceRecord[]>(`/experience?entityId=${entityId}`, []);
    return all.filter((r) => r.entityId === entityId);
  },
  async saveExperience(_r) { throw new ReadOnlyError(); },
  async deleteExperience(_id) { throw new ReadOnlyError(); },
  async deleteRecordsFromDoc(_id) { throw new ReadOnlyError(); },

  // Documents
  async listDocuments() { return get<StoredDocument[]>("/documents", []); },
  async getDocument(id) {
    const all = await get<StoredDocument[]>("/documents", []);
    return all.find((d) => d.id === id);
  },
  async saveDocument(_doc) { throw new ReadOnlyError(); },
  async deleteDocument(_id) { throw new ReadOnlyError(); },

  // Records
  async getRecord(entityId, key) {
    const vault = await get<VaultProfile>("/profile", {});
    return vault[entityId]?.[key] as FieldRecord | undefined;
  },
  async getProfile(entityId) {
    const vault = await get<VaultProfile>("/profile", {});
    return (vault[entityId] ?? {}) as Profile;
  },
  async getAllProfiles() { return get<VaultProfile>("/profile", {}); },
  async setRecord(_e, _r) { throw new ReadOnlyError(); },
  async clearProfile(_e) { throw new ReadOnlyError(); },
  async deleteCandidatesFromDoc(_id) { throw new ReadOnlyError(); },

  // Settings: read from local defaults; writes ignored (kept local in popup).
  async getSettings() { return { ...DEFAULT_SETTINGS } satisfies Settings; },
  async updateSettings(patch) { return { ...DEFAULT_SETTINGS, ...patch }; },

  async getAuthBlob() { return null; },
  async setAuthBlob(_blob) { throw new ReadOnlyError(); },
};

// Type re-exports the file uses internally.
export type { ProfileKey };
