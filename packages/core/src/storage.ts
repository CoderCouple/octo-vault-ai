// Storage interface and a default in-memory implementation. Surface-
// specific adapters (IndexedDB for extension/web, SQLite for desktop)
// live in their own packages and implement this interface.

import type {
  DocType, EducationRecord, Entity, Event, ExperienceRecord, FieldCandidate, FieldRecord,
  Profile, ProfileKey, RelationshipEdge, Sensitivity, VaultProfile,
} from "./schema";
import { initialsFor, SELF_ENTITY_ID } from "./schema";
import { canonicalValue, resolve } from "./resolver";
import type { EmbeddingRecord } from "./qa";

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

// A single saved chat thread. The renderer owns the message-shape
// schema; this layer treats the message list as opaque JSON so we
// can ship new chat features without a vault migration. Pinned to a
// version field so a future shape change can detect old rows.
export interface StoredConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  // The renderer's ChatMessage[]; kept untyped here to stay decoupled.
  messages: unknown[];
  schemaVersion?: number;
}

export interface Settings {
  ollamaUrl: string;
  llmModel: string;
  embeddingModel: string;
  // Vision-language model used as the primary OCR for scanned PDFs /
  // images. Empty string = "disabled; use tesseract." When set and the
  // model is installed in Ollama, every page that would have hit
  // tesseract is sent to this model instead — far higher quality on
  // decorative / non-US-formatted certificates. Tesseract remains
  // the fallback if the vision model is unreachable or not installed.
  visionModel: string;
  // PDF text parser. "pdfjs" is the browser-safe default used by both
  // desktop and extension. "liteparse" is desktop-only and routes PDF
  // parsing through a native local parser in Electron main.
  pdfParser: "pdfjs" | "liteparse";
  autoFillPrompt: boolean;
  appLockMinutes: number;
  requireUnlockForSensitive: boolean;
  hasMasterPassword: boolean;
  // Electron Accelerator string for the global hotkey that opens the
  // Spotlight overlay. Default: ⌘⌥O on macOS / Ctrl+Alt+O elsewhere.
  // Format reference: https://www.electronjs.org/docs/latest/api/accelerator
  globalShortcut: string;
  // Which screen edge the floating shortcut prefers. Drag-snap still
  // picks the nearer edge after a manual move; this is the explicit
  // preference toggled from Settings.
  shortcutEdge: "left" | "right";
  // Whether to show the floating shortcut at all. Users who only want
  // the keyboard hotkey can hide it here. Defaults true. Can also be
  // toggled OFF via the right-click "Hide for now" context menu on
  // the shortcut itself.
  showFloatingShortcut: boolean;
  // Whether to launch OctoVault automatically when the user logs in.
  // Defaults true so the floating shortcut + global hotkey are always
  // available. Maps to macOS's "Login Items" via Electron's
  // app.setLoginItemSettings.
  launchAtLogin: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: "http://localhost:11434",
  llmModel: "qwen3:8b",
  embeddingModel: "nomic-embed-text",
  visionModel: "qwen3-vl:8b",
  pdfParser: "liteparse",
  autoFillPrompt: true,
  appLockMinutes: 5,
  requireUnlockForSensitive: true,
  hasMasterPassword: false,
  globalShortcut: "CommandOrControl+Alt+O",
  shortcutEdge: "left",
  showFloatingShortcut: true,
  launchAtLogin: true,
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

  // Relationships (typed edges between entities)
  listRelationships(): Promise<import("./schema").RelationshipEdge[]>;
  saveRelationship(rel: import("./schema").RelationshipEdge): Promise<void>;
  deleteRelationship(id: string): Promise<void>;

  // Events (Phase 4b) — multi-entity, dated facts. Marriage, birth,
  // adoption, divorce, naturalization, etc. First-class so derive
  // closure rules can walk them.
  listEvents(): Promise<import("./schema").Event[]>;
  saveEvent(event: import("./schema").Event): Promise<void>;
  deleteEvent(id: string): Promise<void>;
  deleteEventsFromDoc(documentId: string): Promise<void>;

  // Documents
  saveDocument(doc: StoredDocument): Promise<void>;
  listDocuments(): Promise<StoredDocument[]>;
  getDocument(id: string): Promise<StoredDocument | undefined>;
  deleteDocument(id: string): Promise<void>;

  // Fields. Keys are (entityId, fieldKey).
  getRecord(entityId: string, key: ProfileKey): Promise<FieldRecord | undefined>;
  setRecord(entityId: string, record: FieldRecord): Promise<void>;
  // Wipe one FieldRecord wholesale — every candidate, canonical and all.
  // Used by Conflicts when every value for a field is bad and the user
  // wants to start over without re-importing.
  deleteRecord(entityId: string, key: ProfileKey): Promise<void>;
  getProfile(entityId: string): Promise<Profile>;
  getAllProfiles(): Promise<VaultProfile>;
  clearProfile(entityId: string): Promise<void>;
  deleteCandidatesFromDoc(documentId: string): Promise<void>;

  // Conversations (chat history). Stored encrypted in SQLCipher /
  // IndexedDB so the user's questions and the cited answers never live
  // outside the vault. The renderer used to keep these in localStorage,
  // which (a) survived a vault lock and (b) sat plaintext in Chromium's
  // user-data folder — both broken against the on-device privacy claim.
  listConversations(): Promise<StoredConversation[]>;
  saveConversation(c: StoredConversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  // Master-password salt + verifier (opaque blob)
  getAuthBlob(): Promise<Uint8Array | null>;
  setAuthBlob(blob: Uint8Array): Promise<void>;
  // Wipes the unlock credential entirely. Used by the "Reset vault"
  // flow in UnlockScreen — paired with deleting the vault data itself.
  deleteAuthBlob(): Promise<void>;
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

export async function addDocumentSourceToField(
  storage: StorageAdapter,
  entityId: string,
  key: ProfileKey,
  documentId: string,
): Promise<void> {
  const [record, doc] = await Promise.all([
    storage.getRecord(entityId, key),
    storage.getDocument(documentId),
  ]);
  if (!record || !doc) return;
  const canonical = canonicalValue(record);
  if (!canonical) return;
  if (record.candidates.some((c) => !c.dismissedAt && c.source.documentId === documentId)) return;

  const candidate: FieldCandidate = {
    id: crypto.randomUUID(),
    entityId,
    fieldKey: key,
    value: canonical.value,
    normalizedValue: canonical.normalizedValue,
    confidence: "medium",
    source: { documentId },
    docType: doc.docType,
    extractedAt: Date.now(),
    userEdited: true,
  };
  await addCandidates(storage, [candidate]);
}

export async function mergeEntities(
  storage: StorageAdapter,
  sourceEntityId: string,
  targetEntityId: string,
): Promise<void> {
  if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) return;
  if (sourceEntityId === SELF_ENTITY_ID) throw new Error("Cannot merge Self into another entity");

  const sourceProfile = await storage.getProfile(sourceEntityId);
  for (const record of Object.values(sourceProfile)) {
    if (!record) continue;
    const moved: FieldCandidate[] = record.candidates.map((c) => ({ ...c, entityId: targetEntityId }));
    await addCandidates(storage, moved);
    await storage.deleteRecord(sourceEntityId, record.key);
  }

  for (const doc of await storage.listDocuments()) {
    if (doc.entityId === sourceEntityId) {
      await storage.saveDocument({ ...doc, entityId: targetEntityId });
    }
  }

  for (const record of await storage.listEducation(sourceEntityId)) {
    await storage.deleteEducation(record.id);
    await storage.saveEducation({ ...record, entityId: targetEntityId } as EducationRecord);
  }
  for (const record of await storage.listExperience(sourceEntityId)) {
    await storage.deleteExperience(record.id);
    await storage.saveExperience({ ...record, entityId: targetEntityId } as ExperienceRecord);
  }

  const embeddings = await storage.listEmbeddings();
  const movedEmbeddings: EmbeddingRecord[] = embeddings
    .filter((e) => e.entityId === sourceEntityId)
    .map((e) => ({ ...e, entityId: targetEntityId }));
  if (movedEmbeddings.length) await storage.saveEmbeddings(movedEmbeddings);

  for (const rel of await storage.listRelationships()) {
    if (rel.fromEntityId !== sourceEntityId && rel.toEntityId !== sourceEntityId) continue;
    const next: RelationshipEdge = {
      ...rel,
      fromEntityId: rel.fromEntityId === sourceEntityId ? targetEntityId : rel.fromEntityId,
      toEntityId: rel.toEntityId === sourceEntityId ? targetEntityId : rel.toEntityId,
      updatedAt: Date.now(),
    };
    if (next.fromEntityId === next.toEntityId) await storage.deleteRelationship(rel.id);
    else await storage.saveRelationship(next);
  }

  for (const event of await storage.listEvents()) {
    if (!event.participants.some((p) => p.entityId === sourceEntityId)) continue;
    const participants = event.participants.map((p) => ({
      ...p,
      entityId: p.entityId === sourceEntityId ? targetEntityId : p.entityId,
    }));
    const deduped = participants.filter((p, i) =>
      participants.findIndex((q) => q.entityId === p.entityId && q.role === p.role) === i,
    );
    await storage.saveEvent({ ...event, participants: deduped, updatedAt: Date.now() } as Event);
  }

  await storage.deleteEntity(sourceEntityId);
}

// Re-export Sensitivity for adapters/UI conveniences.
export type { Sensitivity };
