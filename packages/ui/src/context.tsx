// App-wide context. Each surface (extension popup, desktop renderer)
// implements AppHost — a small adapter that injects storage and an
// Ollama-call channel. Optionally a host can declare multiple "vault
// sources" the user can switch between (e.g., local + a read-only view
// of the Desktop vault from the extension popup).

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  addUserCandidate, ensureSelfEntity, normalizeValue, resolveOrCreateEntity, SELF_ENTITY_ID,
  type AskOptions, type Entity, type ExtractionResult, type QaResult,
  type ExtractedPdf, type PdfExtractOptions, type Settings, type StorageAdapter, type StoredDocument,
} from "@octovault/core";

export interface VaultSource {
  id: string;
  label: string;
  storage: StorageAdapter;
  readOnly: boolean;
  isAvailable?: () => Promise<boolean>;
}

export type OllamaEnsureRunningResult =
  | { status: "running" }
  | { status: "started" }
  | { status: "not_installed"; downloadUrl: string }
  | { status: "error"; message: string };

export interface AppHost {
  storage: StorageAdapter;
  surface: "extension" | "desktop";
  // Optional cfg lets callers (notably Onboarding) pin the check to a
  // specific URL from React state rather than letting the host re-read
  // settings from IPC. Without the override, the wizard's "the app talks
  // to Ollama at <url>" line and the underlying reachability probe can
  // drift apart when storage hasn't caught up to the latest input.
  isOllamaReachable(cfg?: Partial<import("@octovault/core").OllamaConfig>): Promise<boolean>;
  // Optional: only the desktop surface can attempt to start the local
  // Ollama process. The extension has no access to system binaries.
  ollamaEnsureRunning?(cfg?: Partial<import("@octovault/core").OllamaConfig>): Promise<OllamaEnsureRunningResult>;
  extractFromText(documentId: string, text: string): Promise<ExtractionResult>;
  embed(text: string): Promise<number[]>;
  ask(question: string, opts?: AskOptions): Promise<QaResult>;
  // Returns a VisionEngine adapter when a vision model is configured
  // + reachable. Used by the import flow as the primary OCR path;
  // null means "fall back to tesseract." Implementations may cache
  // a "model installed" check across calls.
  visionEngine?(): Promise<import("@octovault/core").VisionEngine | null>;
  // Optional desktop-only fast path. When absent or when it fails,
  // Documents falls back to core's browser-safe PDF.js/Tesseract path.
  parsePdfText?(file: File, opts?: PdfExtractOptions): Promise<ExtractedPdf>;
  // Vault lifecycle. Both surfaces support this — extension uses
  // WebCrypto + the IDB auth blob; desktop uses SQLCipher via IPC.
  vaultExists(): Promise<boolean>;
  vaultInit(password: string): Promise<void>;     // first-time setup
  vaultUnlock(password: string): Promise<boolean>;
  vaultLock(): Promise<void>;
  vaultReset(): Promise<void>;                    // destroys the vault, no prompt
  isVaultUnlocked(): boolean;
  // If provided, the popup header shows a clickable source pill.
  sources?: VaultSource[];
  defaultSourceId?: string;
}

interface Ctx {
  host: AppHost;
  storage: StorageAdapter;
  source: VaultSource | null;
  sources: VaultSource[];
  setSourceId: (id: string) => void;
  readOnly: boolean;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  documents: StoredDocument[];
  refreshDocuments: () => Promise<void>;
  entities: Entity[];
  activeEntityId: string;
  setActiveEntityId: (id: string) => void;
  refreshEntities: () => Promise<void>;
  resolveEntityFromName: (name: string, hint?: import("@octovault/core").Relationship) => Promise<Entity>;
  unlocked: boolean;
  unlock: () => void;
  lock: () => void;
}

const C = createContext<Ctx | null>(null);

export function useAppContext(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("useAppContext must be used inside AppProvider");
  return c;
}

const STORAGE_KEY = "octovault.vaultSourceId";

export function AppProvider({ host, children }: { host: AppHost; children: ReactNode }) {
  const sources = host.sources ?? [];
  const [sourceId, setSourceIdState] = useState<string | null>(() => {
    const remembered = localStorage.getItem(STORAGE_KEY);
    if (sources.length && remembered && sources.some((s) => s.id === remembered)) return remembered;
    if (sources.length) return host.defaultSourceId ?? sources[0].id;
    return null;
  });

  const source = sources.find((s) => s.id === sourceId) ?? null;
  const storage: StorageAdapter = source?.storage ?? host.storage;
  const readOnly = source?.readOnly ?? false;

  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [activeEntityId, setActiveEntityIdState] = useState<string>(SELF_ENTITY_ID);
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    void (async () => {
      // Settings always come from the host's primary storage (local).
      setSettingsState(await host.storage.getSettings());
      if (source?.readOnly) return;

      // Ensure a "self" entity exists.
      await ensureSelfEntity(host.storage);

      // One-shot migration: for every entity that has name/email on the
      // entity object but no matching FieldRecord, seed them so form-fill
      // works on day one. Older onboarding flows didn't do this — this
      // makes the fix retroactive.
      try {
        const all = await host.storage.listEntities();
        for (const ent of all) {
          const profile = await host.storage.getProfile(ent.id);
          const trimmedName = ent.name.trim();
          if (trimmedName && trimmedName.toLowerCase() !== "self" && !profile.fullName) {
            const parts = trimmedName.split(/\s+/).filter(Boolean);
            const first = parts[0] ?? "";
            const last = parts.length > 1 ? parts[parts.length - 1] : "";
            const middle = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
            await addUserCandidate(host.storage, ent.id, "fullName", trimmedName, normalizeValue);
            if (first) await addUserCandidate(host.storage, ent.id, "firstName", first, normalizeValue);
            if (middle) await addUserCandidate(host.storage, ent.id, "middleName", middle, normalizeValue);
            if (last) await addUserCandidate(host.storage, ent.id, "lastName", last, normalizeValue);
          }
          if (ent.email && !profile.email) {
            await addUserCandidate(host.storage, ent.id, "email", ent.email.trim(), normalizeValue);
          }
        }

        // Backfill explicit Relationship records from the legacy
        // Entity.relationship field. Every non-self entity whose
        // relationship isn't "other" gets a Self→Entity edge if one
        // doesn't already exist. Once written, the entity-graph view
        // and any future graph reasoning have a real edge to work with.
        const existing = await host.storage.listRelationships();
        const seen = new Set(existing.map((r) => `${r.fromEntityId}|${r.toEntityId}|${r.kind}`));
        for (const ent of all) {
          if (ent.id === SELF_ENTITY_ID || ent.relationship === "self" || ent.relationship === "other") continue;
          const key = `${SELF_ENTITY_ID}|${ent.id}|${ent.relationship}`;
          if (seen.has(key)) continue;
          await host.storage.saveRelationship({
            id: crypto.randomUUID(),
            fromEntityId: SELF_ENTITY_ID,
            toEntityId: ent.id,
            kind: ent.relationship as never,
            userPinned: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      } catch (e) {
        console.warn("[context] entity-seed migration skipped:", e);
      }
    })();
  }, [host, source?.readOnly]);

  const refreshDocuments = useCallback(async () => {
    setDocuments(await storage.listDocuments());
  }, [storage]);

  const refreshEntities = useCallback(async () => {
    setEntities(await storage.listEntities());
  }, [storage]);

  useEffect(() => { void refreshDocuments(); }, [refreshDocuments]);
  useEffect(() => { void refreshEntities(); }, [refreshEntities]);

  const setActiveEntityId = (id: string) => {
    setActiveEntityIdState(id);
    localStorage.setItem("octovault.activeEntityId", id);
  };

  useEffect(() => {
    const saved = localStorage.getItem("octovault.activeEntityId");
    if (saved && entities.some((e) => e.id === saved)) setActiveEntityIdState(saved);
    else if (entities.length && !entities.some((e) => e.id === activeEntityId)) {
      setActiveEntityIdState(entities[0].id);
    }
  }, [entities, activeEntityId]);

  const resolveEntityFromName = useCallback(
    async (name: string, hint?: import("@octovault/core").Relationship) => {
      const e = await resolveOrCreateEntity(host.storage, name, hint);
      await refreshEntities();
      return e;
    },
    [host, refreshEntities]
  );

  // Auto-pick a source on boot: if a source declares isAvailable and
  // it returns true, prefer it. Runs once.
  useEffect(() => {
    if (!sources.length || sourceId) return;
    void (async () => {
      for (const s of sources) {
        if (!s.isAvailable || (await s.isAvailable())) {
          setSourceIdState(s.id);
          return;
        }
      }
      setSourceIdState(sources[0].id);
    })();
  }, [sources, sourceId]);

  function setSourceId(id: string) {
    setSourceIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }

  async function setSettings(patch: Partial<Settings>) {
    const next = await host.storage.updateSettings(patch);
    setSettingsState(next);
  }

  if (!settings) return null;

  const value: Ctx = {
    host,
    storage,
    source,
    sources,
    setSourceId,
    readOnly,
    settings,
    setSettings,
    documents,
    refreshDocuments,
    entities,
    activeEntityId,
    setActiveEntityId,
    refreshEntities,
    resolveEntityFromName,
    unlocked,
    unlock: () => setUnlocked(true),
    lock: () => setUnlocked(false),
  };

  return <C.Provider value={value}>{children}</C.Provider>;
}
