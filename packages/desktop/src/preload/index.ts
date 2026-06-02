// Bridge that exposes typed RPCs to the renderer:
//   - ollama.*    LLM/embedding calls (avoids CORS from renderer origin)
//   - bridge.*    extension/desktop snapshot pump
//   - vault.*     SQLCipher lifecycle (init, unlock, lock, exists)
//   - store.*     StorageAdapter surface backed by SQLCipher

import { contextBridge, ipcRenderer } from "electron";

interface OllamaCfg { url: string; llmModel: string; embeddingModel: string }

const ollama = {
  health: (cfg: OllamaCfg) =>
    ipcRenderer.invoke("ollama.health", cfg) as Promise<{ reachable: boolean }>,
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
};

const doc = {
  readBytes: (docId: string) =>
    ipcRenderer.invoke("doc.readBytes", docId) as Promise<{ bytes: Uint8Array; mimeType?: string } | null>,
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
  getSettings:             ()                       => ipcRenderer.invoke("store.getSettings"),
  updateSettings:          (patch: unknown)         => ipcRenderer.invoke("store.updateSettings", patch),
  getAuthBlob:             ()                       => ipcRenderer.invoke("store.getAuthBlob") as Promise<Uint8Array | null>,
  setAuthBlob:             (blob: Uint8Array)       => ipcRenderer.invoke("store.setAuthBlob", blob),
};

contextBridge.exposeInMainWorld("octovault", { ollama, bridge, vault, store, doc });

export type OctovaultBridge = {
  ollama: typeof ollama;
  bridge: typeof bridge;
  vault: typeof vault;
  store: typeof store;
  doc: typeof doc;
};
