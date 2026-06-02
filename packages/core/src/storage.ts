// Storage interface and a default in-memory implementation. Surface-
// specific adapters (IndexedDB for extension/web, SQLite for desktop)
// live in their own packages and implement this interface.

import type {
  DocType, Entity, FieldCandidate, FieldRecord, Profile, ProfileKey, Sensitivity, VaultProfile,
} from "./schema";
import { initialsFor, SELF_ENTITY_ID } from "./schema";
import { resolve } from "./resolver";

export interface StoredDocument {
  id: string;
  entityId: string;             // which entity this document is primarily about
  name: string;
  importedAt: number;
  bytes: number;                // file size in bytes (metadata only)
  text: string;                 // extracted text layer (for chat retrieval)
  pageCount: number;
  docType: DocType;
  ocrUsed: boolean;
  mimeType?: string;            // e.g., "application/pdf", "image/jpeg"
  // Original-file storage. Two ways to keep it, pick the cheapest:
  //   filePath:    absolute path to the file on disk (desktop only,
  //                no storage cost, but breaks if the user moves the file)
  //   fileDataUrl: base64 data URL embedded in the doc record
  //                (works everywhere, costs ~1.33x file size in storage)
  // The viewer prefers fileDataUrl, falls back to filePath. The user
  // can convert a path-only reference into permanent storage from the
  // viewer UI.
  filePath?: string;
  fileDataUrl?: string;
}

export interface Settings {
  ollamaUrl: string;
  llmModel: string;
  embeddingModel: string;
  autoFillPrompt: boolean;
  appLockMinutes: number;
  requireUnlockForSensitive: boolean;
  hasMasterPassword: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: "http://localhost:11434",
  llmModel: "qwen3:8b",
  embeddingModel: "nomic-embed-text",
  autoFillPrompt: true,
  appLockMinutes: 5,
  requireUnlockForSensitive: true,
  hasMasterPassword: false,
};

export interface StorageAdapter {
  // Entities
  listEntities(): Promise<Entity[]>;
  saveEntity(entity: Entity): Promise<void>;
  deleteEntity(id: string): Promise<void>;

  // Embeddings (Q&A)
  listEmbeddings(): Promise<import("./qa").EmbeddingRecord[]>;
  saveEmbeddings(records: import("./qa").EmbeddingRecord[]): Promise<void>;
  deleteEmbeddingsForDoc(documentId: string): Promise<void>;

  // Education + Experience records (repeated, per entity)
  listEducation(entityId: string): Promise<import("./schema").EducationRecord[]>;
  saveEducation(record: import("./schema").EducationRecord): Promise<void>;
  deleteEducation(id: string): Promise<void>;
  listExperience(entityId: string): Promise<import("./schema").ExperienceRecord[]>;
  saveExperience(record: import("./schema").ExperienceRecord): Promise<void>;
  deleteExperience(id: string): Promise<void>;
  deleteRecordsFromDoc(documentId: string): Promise<void>;

  // Documents
  saveDocument(doc: StoredDocument): Promise<void>;
  listDocuments(): Promise<StoredDocument[]>;
  getDocument(id: string): Promise<StoredDocument | undefined>;
  deleteDocument(id: string): Promise<void>;

  // Fields. Keys are (entityId, fieldKey).
  getRecord(entityId: string, key: ProfileKey): Promise<FieldRecord | undefined>;
  setRecord(entityId: string, record: FieldRecord): Promise<void>;
  getProfile(entityId: string): Promise<Profile>;
  getAllProfiles(): Promise<VaultProfile>;
  clearProfile(entityId: string): Promise<void>;
  deleteCandidatesFromDoc(documentId: string): Promise<void>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  // Master-password salt + verifier (opaque blob)
  getAuthBlob(): Promise<Uint8Array | null>;
  setAuthBlob(blob: Uint8Array): Promise<void>;
}

// Bootstrap helper: ensures a "self" entity exists. Run once per app open.
export async function ensureSelfEntity(storage: StorageAdapter): Promise<Entity> {
  const all = await storage.listEntities();
  const existing = all.find((e) => e.id === SELF_ENTITY_ID);
  if (existing) return existing;
  const self: Entity = {
    id: SELF_ENTITY_ID,
    name: "Self",
    relationship: "self",
    initials: "ME",
    createdAt: Date.now(),
  };
  await storage.saveEntity(self);
  return self;
}

// Resolve or create an entity by name. Used by the extractor when a
// document mentions a person. Matching is fuzzy: tokens are lowercased,
// punctuation dropped, and an entity matches if all of the shorter
// name's tokens appear in the longer name's tokens. This means:
//
//   "Sunil Tiwari" (Self) matches "Sunil Deviprasad Tiwari" (passport)
//   "Payal Tiwari" matches "Payal F Tiwari"
//   "Katha" matches "Katha Sunil Tiwari"
//
// Without matching, a new entity is created with the LLM's hint.
export async function resolveOrCreateEntity(
  storage: StorageAdapter,
  name: string,
  relationshipHint?: import("./schema").Relationship
): Promise<Entity> {
  const all = await storage.listEntities();
  const candidateTokens = tokenize(name);
  if (candidateTokens.length === 0) {
    // Falsy/empty name — never create a junk entity; default to self.
    const self = all.find((e) => e.id === SELF_ENTITY_ID);
    if (self) return self;
  }

  // Prefer exact match first.
  const exact = all.find((e) => normalize(e.name) === normalize(name));
  if (exact) return exact;

  // Fuzzy: best overlap above threshold.
  let best: { entity: Entity; score: number } | null = null;
  for (const e of all) {
    const eTokens = tokenize(e.name);
    if (eTokens.length === 0) continue;
    const score = tokenOverlapScore(candidateTokens, eTokens);
    if (score >= 0.66 && (!best || score > best.score)) best = { entity: e, score };
  }
  if (best) return best.entity;

  const entity: Entity = {
    id: crypto.randomUUID(),
    name: name.trim(),
    relationship: relationshipHint ?? "other",
    initials: initialsFor(name),
    createdAt: Date.now(),
  };
  await storage.saveEntity(entity);
  return entity;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(s: string): string[] {
  return normalize(s).split(" ").filter((t) => t.length >= 2);
}

// Ratio of shared tokens to the smaller token set. Reaches 1.0 when
// every token in the shorter name is present in the longer one.
function tokenOverlapScore(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  const min = Math.min(setA.size, setB.size);
  return min === 0 ? 0 : shared / min;
}

// Add candidates and re-resolve. All candidates in one call must share
// the same entityId.
export async function addCandidates(
  storage: StorageAdapter,
  candidates: FieldCandidate[]
): Promise<void> {
  if (candidates.length === 0) return;
  const entityId = candidates[0].entityId;
  const byKey = new Map<ProfileKey, FieldCandidate[]>();
  for (const c of candidates) {
    if (c.entityId !== entityId) throw new Error("addCandidates: mixed entity ids");
    const arr = byKey.get(c.fieldKey) ?? [];
    arr.push(c);
    byKey.set(c.fieldKey, arr);
  }

  for (const [key, newOnes] of byKey) {
    const existing = await storage.getRecord(entityId, key);
    const merged: FieldRecord = existing
      ? { ...existing, candidates: [...existing.candidates, ...newOnes] }
      : { key, candidates: newOnes, canonicalId: null, conflictState: "none" };
    await storage.setRecord(entityId, resolve(merged));
  }
}

export async function pinCandidate(
  storage: StorageAdapter,
  entityId: string,
  key: ProfileKey,
  candidateId: string
): Promise<void> {
  const record = await storage.getRecord(entityId, key);
  if (!record) return;
  const next: FieldRecord = {
    ...record,
    candidates: record.candidates.map((c) => ({ ...c, userPinned: c.id === candidateId })),
  };
  await storage.setRecord(entityId, resolve(next));
}

export async function dismissCandidate(
  storage: StorageAdapter,
  entityId: string,
  key: ProfileKey,
  candidateId: string
): Promise<void> {
  const record = await storage.getRecord(entityId, key);
  if (!record) return;
  const next: FieldRecord = {
    ...record,
    candidates: record.candidates.map((c) =>
      c.id === candidateId ? { ...c, dismissedAt: Date.now() } : c
    ),
  };
  await storage.setRecord(entityId, resolve(next));
}

export async function editCandidate(
  storage: StorageAdapter,
  entityId: string,
  key: ProfileKey,
  candidateId: string,
  newValue: string,
  normalize: (k: ProfileKey, v: string) => string
): Promise<void> {
  const record = await storage.getRecord(entityId, key);
  if (!record) return;
  const next: FieldRecord = {
    ...record,
    candidates: record.candidates.map((c) =>
      c.id === candidateId
        ? { ...c, value: newValue, normalizedValue: normalize(key, newValue), userEdited: true, dismissedAt: undefined }
        : c
    ),
  };
  await storage.setRecord(entityId, resolve(next));
}

export async function addUserCandidate(
  storage: StorageAdapter,
  entityId: string,
  key: ProfileKey,
  value: string,
  normalize: (k: ProfileKey, v: string) => string
): Promise<void> {
  const candidate: FieldCandidate = {
    id: crypto.randomUUID(),
    entityId,
    fieldKey: key,
    value: value.trim(),
    normalizedValue: normalize(key, value),
    confidence: "high",
    source: { documentId: "user-entered" },
    docType: "unknown",
    extractedAt: Date.now(),
    userEdited: true,
    userPinned: true,
  };
  await addCandidates(storage, [candidate]);
}

// Re-export Sensitivity for adapters/UI conveniences.
export type { Sensitivity };
