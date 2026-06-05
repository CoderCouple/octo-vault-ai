// Bridge that exposes typed RPCs to the renderer:
//   - ollama.*    LLM/embedding calls (avoids CORS from renderer origin)
//   - bridge.*    extension/desktop snapshot pump
//   - vault.*     SQLCipher lifecycle (init, unlock, lock, exists)
//   - store.*     StorageAdapter surface backed by SQLCipher

import { contextBridge, ipcRenderer, webUtils } from "electron";

interface OllamaCfg { url: string; llmModel: string; embeddingModel: string }

type EnsureRunningResult =
  | { status: "running" }
  | { status: "started" }
  | { status: "not_installed"; downloadUrl: string }
  | { status: "error"; message: string };

const ollama = {
  health: (cfg: OllamaCfg) =>
    ipcRenderer.invoke("ollama.health", cfg) as Promise<{ reachable: boolean }>,
  ensureRunning: (cfg: OllamaCfg) =>
    ipcRenderer.invoke("ollama.ensureRunning", cfg) as Promise<EnsureRunningResult>,
  listModels: (cfg: OllamaCfg) =>
    ipcRenderer.invoke("ollama.listModels", cfg) as Promise<string[]>,
  generate: (cfg: OllamaCfg, body: object) =>
    ipcRenderer.invoke("ollama.generate", cfg, body) as Promise<{ response: string }>,
  embed: (cfg: OllamaCfg, model: string, prompt: string) =>
    ipcRenderer.invoke("ollama.embed", cfg, model, prompt) as Promise<{ embedding: number[] }>,
};

const bridge = {
  publishSnapshot: (snapshot: { profile: unknown; documents: unknown; entities?: unknown }) =>
    ipcRenderer.send("bridge.publishSnapshot", snapshot),
};

const vault = {
  exists:     () => ipcRenderer.invoke("vault.exists")              as Promise<boolean>,
  isOpen:     () => ipcRenderer.invoke("vault.isOpen")              as Promise<boolean>,
  initialize: (password: string) => ipcRenderer.invoke("vault.initialize", password) as Promise<boolean>,
  unlock:     (password: string) => ipcRenderer.invoke("vault.unlock", password)     as Promise<boolean>,
  lock:       () => ipcRenderer.invoke("vault.lock")                as Promise<void>,
  reset:      () => ipcRenderer.invoke("vault.reset")               as Promise<void>,
};

const doc = {
  readBytes: (docId: string) =>
    ipcRenderer.invoke("doc.readBytes", docId) as Promise<{ bytes: Uint8Array; mimeType?: string } | null>,
  // Electron 32+ removed File.path on dropped/picked Files. webUtils
  // is the official replacement. Returns the absolute path or ""
  // for synthetic Files.
  pathFor: (file: File) => webUtils.getPathForFile(file),
};

// Every method maps 1:1 onto a method in the renderer's IPC adapter.
const store = {
  listEntities:            ()                       => ipcRenderer.invoke("store.listEntities"),
  saveEntity:              (entity: unknown)        => ipcRenderer.invoke("store.saveEntity", entity),
  deleteEntity:            (id: string)             => ipcRenderer.invoke("store.deleteEntity", id),
  saveDocument:            (doc: unknown)           => ipcRenderer.invoke("store.saveDocument", doc),
  listDocuments:           ()                       => ipcRenderer.invoke("store.listDocuments"),
  getDocument:             (id: string)             => ipcRenderer.invoke("store.getDocument", id),
  deleteDocument:          (id: string)             => ipcRenderer.invoke("store.deleteDocument", id),
  getRecord:               (entityId: string, key: string) => ipcRenderer.invoke("store.getRecord", entityId, key),
  setRecord:               (entityId: string, record: unknown) => ipcRenderer.invoke("store.setRecord", entityId, record),
  deleteRecord:            (entityId: string, key: string)     => ipcRenderer.invoke("store.deleteRecord", entityId, key),
  getProfile:              (entityId: string)       => ipcRenderer.invoke("store.getProfile", entityId),
  getAllProfiles:          ()                       => ipcRenderer.invoke("store.getAllProfiles"),
  clearProfile:            (entityId: string)       => ipcRenderer.invoke("store.clearProfile", entityId),
  deleteCandidatesFromDoc: (documentId: string)     => ipcRenderer.invoke("store.deleteCandidatesFromDoc", documentId),
  listEmbeddings:          ()                       => ipcRenderer.invoke("store.listEmbeddings"),
  saveEmbeddings:          (records: unknown)       => ipcRenderer.invoke("store.saveEmbeddings", records),
  deleteEmbeddingsForDoc:  (documentId: string)     => ipcRenderer.invoke("store.deleteEmbeddingsForDoc", documentId),
  listEducation:           (entityId: string)       => ipcRenderer.invoke("store.listEducation", entityId),
  saveEducation:           (record: unknown)        => ipcRenderer.invoke("store.saveEducation", record),
  deleteEducation:         (id: string)             => ipcRenderer.invoke("store.deleteEducation", id),
  listExperience:          (entityId: string)       => ipcRenderer.invoke("store.listExperience", entityId),
  saveExperience:          (record: unknown)        => ipcRenderer.invoke("store.saveExperience", record),
  deleteExperience:        (id: string)             => ipcRenderer.invoke("store.deleteExperience", id),
  deleteRecordsFromDoc:    (documentId: string)     => ipcRenderer.invoke("store.deleteRecordsFromDoc", documentId),
  listRelationships:       ()                       => ipcRenderer.invoke("store.listRelationships"),
  saveRelationship:        (rel: unknown)           => ipcRenderer.invoke("store.saveRelationship", rel),
  deleteRelationship:      (id: string)             => ipcRenderer.invoke("store.deleteRelationship", id),
  listEvents:              ()                       => ipcRenderer.invoke("store.listEvents"),
  saveEvent:               (event: unknown)         => ipcRenderer.invoke("store.saveEvent", event),
  deleteEvent:             (id: string)             => ipcRenderer.invoke("store.deleteEvent", id),
  deleteEventsFromDoc:     (documentId: string)     => ipcRenderer.invoke("store.deleteEventsFromDoc", documentId),
  getSettings:             ()                       => ipcRenderer.invoke("store.getSettings"),
  updateSettings:          (patch: unknown)         => ipcRenderer.invoke("store.updateSettings", patch),
  getAuthBlob:             ()                       => ipcRenderer.invoke("store.getAuthBlob") as Promise<Uint8Array | null>,
  setAuthBlob:             (blob: Uint8Array)       => ipcRenderer.invoke("store.setAuthBlob", blob),
  deleteAuthBlob:          ()                       => ipcRenderer.invoke("store.deleteAuthBlob"),
};

// Spotlight overlay window controls (no-op in main window, routed
// through the main process which targets the dedicated overlay window).
const overlay = {
  hide: () => ipcRenderer.send("overlay.hide"),
  show: () => ipcRenderer.send("overlay.show"),
  toggle: () => ipcRenderer.send("overlay.toggle"),
};

// User-configurable global shortcut. Settings UI calls .set() after the
// user changes the accelerator string; main process unregisters the
// previous binding and registers the new one.
const shortcut = {
  set:         (accelerator: string)        => ipcRenderer.send("shortcut.set", accelerator),
  move:        (x: number, y: number)       => ipcRenderer.send("shortcut.move", x, y),
  snap:        ()                            => ipcRenderer.send("shortcut.snap"),
  setEdge:     (edge: "left" | "right")      => ipcRenderer.send("shortcut.setEdge", edge),
  hide:        ()                            => ipcRenderer.send("shortcut.hide"),
  show:        ()                            => ipcRenderer.send("shortcut.show"),
  contextMenu: ()                            => ipcRenderer.send("shortcut.contextMenu"),
};

const launch = {
  setOpenAtLogin: (on: boolean) => ipcRenderer.send("launch.setOpenAtLogin", on),
};

contextBridge.exposeInMainWorld("octovault", { ollama, bridge, vault, store, doc, overlay, shortcut, launch });

export type OctovaultBridge = {
  ollama: typeof ollama;
  bridge: typeof bridge;
  vault: typeof vault;
  store: typeof store;
  doc: typeof doc;
  overlay: typeof overlay;
  shortcut: typeof shortcut;
  launch: typeof launch;
};
