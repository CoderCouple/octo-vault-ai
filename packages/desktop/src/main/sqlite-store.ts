// SQLCipher-backed vault store for the desktop main process.
// The whole DB file is encrypted with the user's master password
// (via PRAGMA key). Each table holds opaque JSON payloads in a `data`
// column plus a few indexed metadata columns for cheap filtering.
//
// IPC bridges this surface to the renderer via packages/desktop/src/main/index.ts.

import Database from "better-sqlite3-multiple-ciphers";
import { app } from "electron";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

type DB = ReturnType<typeof Database>;

let db: DB | null = null;
let dbPath = "";

function getDbPath(): string {
  if (dbPath) return dbPath;
  const dir = join(app.getPath("userData"), "vault");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  dbPath = join(dir, "vault.db");
  return dbPath;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id           TEXT PRIMARY KEY,
  data         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  entity_id    TEXT NOT NULL,
  data         TEXT NOT NULL,
  imported_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_entity ON documents(entity_id);

CREATE TABLE IF NOT EXISTS field_records (
  key          TEXT PRIMARY KEY,
  entity_id    TEXT NOT NULL,
  field_key    TEXT NOT NULL,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_entity ON field_records(entity_id);

CREATE TABLE IF NOT EXISTS embeddings (
  id           TEXT PRIMARY KEY,
  document_id  TEXT,
  entity_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS embed_doc ON embeddings(document_id);

CREATE TABLE IF NOT EXISTS education_records (
  id           TEXT PRIMARY KEY,
  entity_id    TEXT NOT NULL,
  document_id  TEXT,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS edu_entity ON education_records(entity_id);

CREATE TABLE IF NOT EXISTS experience_records (
  id           TEXT PRIMARY KEY,
  entity_id    TEXT NOT NULL,
  document_id  TEXT,
  data         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS exp_entity ON experience_records(entity_id);

CREATE TABLE IF NOT EXISTS relationships (
  id            TEXT PRIMARY KEY,
  from_entity   TEXT NOT NULL,
  to_entity     TEXT NOT NULL,
  kind          TEXT NOT NULL,
  document_id   TEXT,
  data          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rel_from ON relationships(from_entity);
CREATE INDEX IF NOT EXISTS rel_to   ON relationships(to_entity);

-- Phase 4b: events — multi-entity dated facts. Participant entity IDs
-- live inside the JSON data blob; we still index by document_id for
-- doc-deletion cleanup. Searching by participant requires JSON queries
-- which is fine for the low row counts in a personal vault.
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  date        TEXT,
  end_date    TEXT,
  document_id TEXT,
  data        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_doc  ON events(document_id);
CREATE INDEX IF NOT EXISTS events_type ON events(type);

CREATE TABLE IF NOT EXISTS settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth (
  key          TEXT PRIMARY KEY,
  blob         BLOB NOT NULL
);
`;

function applyKey(d: DB, password: string) {
  // Quote a string for the SQLCipher PRAGMA. better-sqlite3-multiple-ciphers
  // accepts the password verbatim in `PRAGMA key = '...'`. We single-quote
  // and escape single quotes by doubling them.
  const quoted = password.replace(/'/g, "''");
  d.pragma(`key = '${quoted}'`);
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
}

// Verifies the DB can be read with the supplied key. If the cipher key
// is wrong, the first query throws — caller treats that as "wrong password".
function probe(d: DB): boolean {
  try { d.prepare("SELECT count(*) AS n FROM sqlite_master").get(); return true; }
  catch { return false; }
}

export function vaultExists(): boolean {
  return existsSync(getDbPath());
}

export function isOpen(): boolean { return db !== null; }

export function close(): void {
  if (db) { db.close(); db = null; }
}

/**
 * First-time setup: create the DB encrypted with this password.
 * If a stale vault file exists (from an abandoned previous onboarding),
 * delete it cleanly before creating fresh. The renderer-side guard in
 * VaultGate is responsible for *not* calling initialize when an
 * already-set-up vault exists — that path should go through unlock().
 */
export function initialize(password: string): void {
  if (db) close();
  const path = getDbPath();
  if (existsSync(path)) {
    // Wipe partial / abandoned vault files. Also the WAL + SHM sidecars.
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      try { unlinkSync(path + suffix); } catch { /* ignore */ }
    }
  }
  db = new Database(path);
  applyKey(db, password);
  db.exec(SCHEMA);
}

/**
 * Destroy the vault entirely. Closes any open DB, deletes the SQLCipher
 * file plus its WAL/SHM sidecars. Caller (UnlockScreen "Reset vault")
 * is responsible for the confirmation dialog — this method does NOT
 * prompt or check; it just wipes. Re-launching the app afterwards
 * sees `vaultExists() === false` and drops into Onboarding for a
 * fresh password setup.
 */
export function reset(): void {
  if (db) close();
  const path = getDbPath();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    try { unlinkSync(path + suffix); } catch { /* missing files are fine */ }
  }
}

/** Open an existing DB; returns false on wrong password. */
export function unlock(password: string): boolean {
  if (!vaultExists()) return false;
  if (db) close();
  db = new Database(getDbPath());
  applyKey(db, password);
  if (!probe(db)) { close(); return false; }
  db.exec(SCHEMA); // idempotent — ensures schema is current
  return true;
}

function requireDb(): DB {
  if (!db) throw new Error("Vault is locked");
  return db;
}

// --- Storage API surface (mirrors the IDB adapter) ---

export const store = {
  // Entities
  listEntities() {
    return requireDb().prepare("SELECT data FROM entities ORDER BY created_at").all().map((r) => JSON.parse((r as { data: string }).data));
  },
  saveEntity(entity: { id: string; createdAt: number }) {
    const d = requireDb();
    const json = JSON.stringify(entity);
    d.prepare("INSERT INTO entities(id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(entity.id, json, entity.createdAt);
  },
  deleteEntity(id: string) {
    const d = requireDb();
    const tx = d.transaction((eid: string) => {
      d.prepare("DELETE FROM entities WHERE id = ?").run(eid);
      d.prepare("DELETE FROM documents WHERE entity_id = ?").run(eid);
      d.prepare("DELETE FROM field_records WHERE entity_id = ?").run(eid);
      d.prepare("DELETE FROM education_records WHERE entity_id = ?").run(eid);
      d.prepare("DELETE FROM experience_records WHERE entity_id = ?").run(eid);
      d.prepare("DELETE FROM relationships WHERE from_entity = ? OR to_entity = ?").run(eid, eid);
    });
    tx(id);
  },

  // Documents
  saveDocument(doc: { id: string; entityId: string; importedAt: number }) {
    requireDb().prepare("INSERT INTO documents(id, entity_id, data, imported_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, entity_id = excluded.entity_id")
      .run(doc.id, doc.entityId, JSON.stringify(doc), doc.importedAt);
  },
  listDocuments() {
    return requireDb().prepare("SELECT data FROM documents ORDER BY imported_at DESC").all()
      .map((r) => JSON.parse((r as { data: string }).data));
  },
  getDocument(id: string) {
    const r = requireDb().prepare("SELECT data FROM documents WHERE id = ?").get(id) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  },
  deleteDocument(id: string) {
    requireDb().prepare("DELETE FROM documents WHERE id = ?").run(id);
  },

  // Field records
  getRecord(entityId: string, fieldKey: string) {
    const r = requireDb().prepare("SELECT data FROM field_records WHERE key = ?").get(`${entityId}|${fieldKey}`) as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  },
  setRecord(entityId: string, record: { key: string }) {
    const key = `${entityId}|${record.key}`;
    requireDb().prepare("INSERT INTO field_records(key, entity_id, field_key, data) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data")
      .run(key, entityId, record.key, JSON.stringify(record));
  },
  deleteRecord(entityId: string, fieldKey: string) {
    requireDb().prepare("DELETE FROM field_records WHERE key = ?").run(`${entityId}|${fieldKey}`);
  },
  getProfile(entityId: string) {
    const rows = requireDb().prepare("SELECT field_key, data FROM field_records WHERE entity_id = ?").all(entityId) as { field_key: string; data: string }[];
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.field_key] = JSON.parse(r.data);
    return out;
  },
  getAllProfiles() {
    const rows = requireDb().prepare("SELECT entity_id, field_key, data FROM field_records").all() as { entity_id: string; field_key: string; data: string }[];
    const out: Record<string, Record<string, unknown>> = {};
    for (const r of rows) (out[r.entity_id] ??= {})[r.field_key] = JSON.parse(r.data);
    return out;
  },
  clearProfile(entityId: string) {
    requireDb().prepare("DELETE FROM field_records WHERE entity_id = ?").run(entityId);
  },
  deleteCandidatesFromDoc(documentId: string) {
    const d = requireDb();
    const rows = d.prepare("SELECT key, data FROM field_records").all() as { key: string; data: string }[];
    const upd = d.prepare("UPDATE field_records SET data = ? WHERE key = ?");
    const dropRow = d.prepare("DELETE FROM field_records WHERE key = ?");
    for (const row of rows) {
      const r = JSON.parse(row.data) as { candidates: { source: { documentId?: string } }[]; canonicalId: string | null };
      const filtered = r.candidates.filter((c) => c.source.documentId !== documentId);
      if (filtered.length === 0) dropRow.run(row.key);
      else if (filtered.length !== r.candidates.length) {
        upd.run(JSON.stringify({ ...r, candidates: filtered, canonicalId: null }), row.key);
      }
    }
  },

  // Embeddings
  listEmbeddings() {
    return requireDb().prepare("SELECT data FROM embeddings").all()
      .map((r) => JSON.parse((r as { data: string }).data));
  },
  saveEmbeddings(records: { id: string; documentId?: string; entityId: string; kind: string }[]) {
    const d = requireDb();
    const stmt = d.prepare(
      "INSERT INTO embeddings(id, document_id, entity_id, kind, data) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET document_id = excluded.document_id, entity_id = excluded.entity_id, " +
      "kind = excluded.kind, data = excluded.data"
    );
    const tx = d.transaction((rs: typeof records) => {
      for (const r of rs) stmt.run(r.id, r.documentId ?? null, r.entityId, r.kind, JSON.stringify(r));
    });
    tx(records);
  },
  deleteEmbeddingsForDoc(documentId: string) {
    requireDb().prepare("DELETE FROM embeddings WHERE document_id = ?").run(documentId);
  },

  // Education
  listEducation(entityId: string) {
    return requireDb().prepare("SELECT data FROM education_records WHERE entity_id = ?").all(entityId)
      .map((r) => JSON.parse((r as { data: string }).data))
      .filter((r: { dismissedAt?: number }) => !r.dismissedAt)
      .sort((a: { endDate?: string }, b: { endDate?: string }) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));
  },
  saveEducation(record: { id: string; entityId: string; source?: { documentId?: string } }) {
    requireDb().prepare("INSERT INTO education_records(id, entity_id, document_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(record.id, record.entityId, record.source?.documentId ?? null, JSON.stringify(record));
  },
  deleteEducation(id: string) {
    requireDb().prepare("DELETE FROM education_records WHERE id = ?").run(id);
  },

  // Experience
  listExperience(entityId: string) {
    return requireDb().prepare("SELECT data FROM experience_records WHERE entity_id = ?").all(entityId)
      .map((r) => JSON.parse((r as { data: string }).data))
      .filter((r: { dismissedAt?: number }) => !r.dismissedAt)
      .sort((a: { endDate?: string }, b: { endDate?: string }) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"));
  },
  saveExperience(record: { id: string; entityId: string; source?: { documentId?: string } }) {
    requireDb().prepare("INSERT INTO experience_records(id, entity_id, document_id, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(record.id, record.entityId, record.source?.documentId ?? null, JSON.stringify(record));
  },
  deleteExperience(id: string) {
    requireDb().prepare("DELETE FROM experience_records WHERE id = ?").run(id);
  },
  deleteRecordsFromDoc(documentId: string) {
    const d = requireDb();
    d.prepare("DELETE FROM education_records WHERE document_id = ?").run(documentId);
    d.prepare("DELETE FROM experience_records WHERE document_id = ?").run(documentId);
    d.prepare("DELETE FROM relationships WHERE document_id = ?").run(documentId);
    d.prepare("DELETE FROM events WHERE document_id = ?").run(documentId);
  },

  // Relationships
  listRelationships() {
    return requireDb().prepare("SELECT data FROM relationships").all()
      .map((r) => JSON.parse((r as { data: string }).data));
  },
  saveRelationship(rel: {
    id: string; fromEntityId: string; toEntityId: string; kind: string;
    source?: { documentId?: string };
  }) {
    const json = JSON.stringify({ ...rel, updatedAt: Date.now() });
    requireDb().prepare(
      "INSERT INTO relationships(id, from_entity, to_entity, kind, document_id, data) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET from_entity = excluded.from_entity, to_entity = excluded.to_entity, " +
      "kind = excluded.kind, document_id = excluded.document_id, data = excluded.data"
    ).run(rel.id, rel.fromEntityId, rel.toEntityId, rel.kind, rel.source?.documentId ?? null, json);
  },
  deleteRelationship(id: string) {
    requireDb().prepare("DELETE FROM relationships WHERE id = ?").run(id);
  },

  // Events (Phase 4b)
  listEvents() {
    return requireDb().prepare("SELECT data FROM events").all()
      .map((r) => JSON.parse((r as { data: string }).data));
  },
  saveEvent(event: {
    id: string; type: string; date?: string; endDate?: string;
    source?: { documentId?: string };
  }) {
    const json = JSON.stringify({ ...event, updatedAt: Date.now() });
    requireDb().prepare(
      "INSERT INTO events(id, type, date, end_date, document_id, data) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET type = excluded.type, date = excluded.date, " +
      "end_date = excluded.end_date, document_id = excluded.document_id, data = excluded.data"
    ).run(event.id, event.type, event.date ?? null, event.endDate ?? null, event.source?.documentId ?? null, json);
  },
  deleteEvent(id: string) {
    requireDb().prepare("DELETE FROM events WHERE id = ?").run(id);
  },
  deleteEventsFromDoc(documentId: string) {
    requireDb().prepare("DELETE FROM events WHERE document_id = ?").run(documentId);
  },

  // Settings (stored under a fixed "settings" key)
  getSettings() {
    const r = requireDb().prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value: string } | undefined;
    return r ? JSON.parse(r.value) : {};
  },
  updateSettings(patch: Record<string, unknown>) {
    const d = requireDb();
    const current = this.getSettings();
    const next = { ...current, ...patch };
    d.prepare("INSERT INTO settings(key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(next));
    return next;
  },

  // Auth — kept in the encrypted DB itself; SQLCipher already protects it.
  getAuthBlob() {
    const r = requireDb().prepare("SELECT blob FROM auth WHERE key = 'blob'").get() as { blob: Buffer } | undefined;
    return r ? new Uint8Array(r.blob) : null;
  },
  setAuthBlob(blob: Uint8Array) {
    requireDb().prepare("INSERT INTO auth(key, blob) VALUES ('blob', ?) ON CONFLICT(key) DO UPDATE SET blob = excluded.blob")
      .run(Buffer.from(blob));
  },
  deleteAuthBlob() {
    requireDb().prepare("DELETE FROM auth WHERE key = 'blob'").run();
  },
};
