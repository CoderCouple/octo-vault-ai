// AppHost for the extension popup. Two vault sources:
//   - "local": the extension's own IndexedDB (full read/write)
//   - "desktop": a read-only view of the Desktop app's vault via the
//                localhost bridge. Auto-selected when the desktop is
//                reachable, but the user can switch back any time.

import type { AppHost, VaultSource } from "@octovault/ui";
import {
  ask, deserializeAuthBlobV2, embed, extractFromText, fetchQaEngine,
  indexedDbAdapter, initializeVault, serializeAuthBlobV2, vaultCrypto,
  type ExtractionResult, type QaResult,
} from "@octovault/core";
import { bridgeReachable } from "./bridge";
import { bridgeReadOnlyAdapter } from "./storage/bridge-readonly-adapter";

async function bgSend<T>(msg: unknown): Promise<T> {
  const r = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; data?: T; error?: string };
  if (!r?.ok) throw new Error(r?.error ?? "Background message failed");
  return r.data as T;
}

const sources: VaultSource[] = [
  {
    id: "desktop",
    label: "Desktop vault",
    storage: bridgeReadOnlyAdapter,
    readOnly: true,
    isAvailable: bridgeReachable,
  },
  {
    id: "local",
    label: "Extension vault",
    storage: indexedDbAdapter,
    readOnly: false,
    isAvailable: async () => true,
  },
];

export const extensionHost: AppHost = {
  surface: "extension",
  storage: indexedDbAdapter,             // base for settings + auth blob
  sources,
  defaultSourceId: "desktop",            // auto-selected if reachable; else falls through to local
  async isOllamaReachable() {
    try {
      return (await bgSend<{ reachable: boolean }>({ type: "ollama.health" })).reachable;
    } catch { return false; }
  },
  async extractFromText(documentId, text): Promise<ExtractionResult> {
    const settings = await indexedDbAdapter.getSettings();
    return extractFromText(
      { url: settings.ollamaUrl, llmModel: settings.llmModel, embeddingModel: settings.embeddingModel },
      documentId,
      text
    );
  },
  async embed(text): Promise<number[]> {
    const s = await indexedDbAdapter.getSettings();
    return embed({ url: s.ollamaUrl, llmModel: s.llmModel, embeddingModel: s.embeddingModel }, text);
  },
  // --- Vault lifecycle (WebCrypto + IDB auth blob) ---
  async vaultExists(): Promise<boolean> {
    return (await indexedDbAdapter.getAuthBlob()) !== null;
  },
  async vaultInit(password: string): Promise<void> {
    const blob = await initializeVault(password);
    await indexedDbAdapter.setAuthBlob(serializeAuthBlobV2(blob));
    const ok = await vaultCrypto.unlock(password, blob);
    if (!ok) throw new Error("Vault self-check failed");
  },
  async vaultUnlock(password: string): Promise<boolean> {
    const raw = await indexedDbAdapter.getAuthBlob();
    if (!raw) return false;
    const blob = deserializeAuthBlobV2(raw);
    if (!blob) return false;
    return vaultCrypto.unlock(password, blob);
  },
  async vaultLock(): Promise<void> { vaultCrypto.lock(); },
  isVaultUnlocked(): boolean { return vaultCrypto.isUnlocked(); },

  async ask(question): Promise<QaResult> {
    const s = await indexedDbAdapter.getSettings();
    const [embeddings, entities, vault, documents] = await Promise.all([
      indexedDbAdapter.listEmbeddings(),
      indexedDbAdapter.listEntities(),
      indexedDbAdapter.getAllProfiles(),
      indexedDbAdapter.listDocuments(),
    ]);
    const engine = fetchQaEngine({ url: s.ollamaUrl, llmModel: s.llmModel, embeddingModel: s.embeddingModel });
    return ask(engine, question, embeddings, { entities, vault, documents });
  },
};
