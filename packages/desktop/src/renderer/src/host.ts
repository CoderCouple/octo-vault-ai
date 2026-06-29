// AppHost for the desktop renderer. Uses the same IndexedDB adapter
// from core, and routes Ollama calls through the preload bridge to
// avoid CORS issues from the renderer origin.

import type { AppHost, OllamaEnsureRunningResult } from "@octovault/ui";
import {
  ask as askLocal,
  extractFromText as extractFromTextCore,
  hasModel,
  parseModelJson,
  VISION_OCR_PROMPT,
  type ExtractedPdf, type PdfExtractOptions,
  type ExtractionResult, type GenerateOptions, type QaEngine, type QaResult,
  type VisionEngine,
} from "@octovault/core";
import { ipcStorageAdapter } from "./storage/ipc-adapter";

declare global {
  interface Window {
    octovault?: {
      ollama: {
        health: (cfg: OllamaCfg) => Promise<{ reachable: boolean }>;
        ensureRunning: (cfg: OllamaCfg) => Promise<OllamaEnsureRunningResult>;
        listModels: (cfg: OllamaCfg) => Promise<string[]>;
        generate: (cfg: OllamaCfg, body: object) => Promise<{ response: string }>;
        embed: (cfg: OllamaCfg, model: string, prompt: string) => Promise<{ embedding: number[] }>;
        vision: (cfg: OllamaCfg, body: { model: string; prompt: string; images: string[]; system?: string; options?: object }) => Promise<{ response: string }>;
        generateStream: (cfg: OllamaCfg, body: { model: string; prompt: string; system?: string; options?: object }, onToken: (chunk: string) => void) => Promise<string>;
      };
      bridge: {
        publishSnapshot: (snapshot: { profile: unknown; documents: unknown; entities?: unknown }) => void;
      };
      vault: {
        exists: () => Promise<boolean>;
        isOpen: () => Promise<boolean>;
        initialize: (password: string) => Promise<boolean>;
        unlock: (password: string) => Promise<boolean>;
        lock: () => Promise<void>;
        reset: () => Promise<void>;
      };
      store: Record<string, (...args: unknown[]) => Promise<unknown>>;
      doc: {
        readBytes: (docId: string) => Promise<{ bytes: Uint8Array; mimeType?: string } | null>;
        pathFor: (file: File) => string;
        parsePdfLite: (input: { filePath?: string; bytes?: Uint8Array; ocrEnabled?: boolean }) => Promise<ExtractedPdf>;
      };
      overlay?: {
        hide: () => void;
        show: () => void;
        toggle: () => void;
      };
      shortcut?: {
        set: (accelerator: string) => void;
        move: (x: number, y: number) => void;
        snap: () => void;
        setEdge: (edge: "left" | "right") => void;
        hide: () => void;
        show: () => void;
        contextMenu: () => void;
      };
      launch?: {
        setOpenAtLogin: (on: boolean) => void;
      };
    };
  }
}

interface OllamaCfg { url: string; llmModel: string; embeddingModel: string; visionModel?: string }

async function cfg(): Promise<OllamaCfg> {
  const s = await ipcStorageAdapter.getSettings();
  return { url: s.ollamaUrl, llmModel: s.llmModel, embeddingModel: s.embeddingModel, visionModel: s.visionModel };
}

export const desktopHost: AppHost = {
  surface: "desktop",
  storage: ipcStorageAdapter,

  async isOllamaReachable(override) {
    try {
      const base = await cfg();
      const effective = { ...base, ...(override ?? {}) };
      const r = await window.octovault!.ollama.health(effective);
      return r.reachable;
    } catch { return false; }
  },

  async ollamaEnsureRunning(override): Promise<OllamaEnsureRunningResult> {
    const base = await cfg();
    const effective = { ...base, ...(override ?? {}) };
    return window.octovault!.ollama.ensureRunning(effective);
  },

  async extractFromText(documentId, text): Promise<ExtractionResult> {
    const c = await cfg();
    const generateJson = async <T,>(opts: GenerateOptions): Promise<T> => {
      const resp = await window.octovault!.ollama.generate(c, {
        model: c.llmModel,
        prompt: opts.prompt,
        system: opts.system,
        stream: false,
        format: opts.format,
        options: { temperature: opts.temperature ?? 0.1 },
      });
      return parseModelJson<T>(resp.response);
    };
    return extractFromTextCore(c, documentId, text, { generateJson });
  },
  async embed(text): Promise<number[]> {
    const c = await cfg();
    const r = await window.octovault!.ollama.embed(c, c.embeddingModel, text);
    return r.embedding;
  },

  // Returns a vision-OCR engine if Ollama is reachable AND the
  // configured visionModel is actually installed. Otherwise null,
  // so callers transparently fall back to tesseract. The "model
  // installed" check is one extra ListModels call per import batch
  // — cheap and avoids per-page failures when the user hasn't run
  // `ollama pull qwen2.5vl:7b` yet.
  async visionEngine(): Promise<VisionEngine | null> {
    const c = await cfg();
    if (!c.visionModel) return null;
    try {
      const installed = await window.octovault!.ollama.listModels(c);
      if (!hasModel(installed, c.visionModel)) return null;
      return {
        recognize: async (imageBase64: string) => {
          const r = await window.octovault!.ollama.vision(c, {
            model: c.visionModel!,
            prompt: VISION_OCR_PROMPT,
            images: [imageBase64],
            options: { temperature: 0.1 },
          });
          return r.response;
        },
      };
    } catch {
      return null;
    }
  },
  // Builds a vision engine for an explicitly-chosen model, bypassing
  // the global Settings → visionModel default. Used by the per-doc
  // "Re-extract with vision OCR" action.
  async visionEngineForModel(modelName: string): Promise<VisionEngine | null> {
    const c = await cfg();
    try {
      const installed = await window.octovault!.ollama.listModels(c);
      if (!hasModel(installed, modelName)) return null;
      return {
        recognize: async (imageBase64: string) => {
          const r = await window.octovault!.ollama.vision(c, {
            model: modelName,
            prompt: VISION_OCR_PROMPT,
            images: [imageBase64],
            options: { temperature: 0.1 },
          });
          return r.response;
        },
      };
    } catch {
      return null;
    }
  },
  async listOllamaModels(): Promise<string[]> {
    const c = await cfg();
    return window.octovault!.ollama.listModels(c);
  },
  async readDocumentBytes(docId: string): Promise<{ bytes: Uint8Array; mimeType?: string } | null> {
    return window.octovault!.doc.readBytes(docId);
  },
  async parsePdfText(file: File, _opts?: PdfExtractOptions): Promise<ExtractedPdf> {
    const filePath = window.octovault?.doc.pathFor(file);
    if (filePath) {
      return window.octovault!.doc.parsePdfLite({ filePath, ocrEnabled: true });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return window.octovault!.doc.parsePdfLite({ bytes, ocrEnabled: true });
  },
  async ask(question, opts): Promise<QaResult> {
    const c = await cfg();
    const [embeddings, entities, vault, documents] = await Promise.all([
      ipcStorageAdapter.listEmbeddings(),
      ipcStorageAdapter.listEntities(),
      ipcStorageAdapter.getAllProfiles(),
      ipcStorageAdapter.listDocuments(),
    ]);
    const engine: QaEngine = {
      embed: async (text) => (await window.octovault!.ollama.embed(c, c.embeddingModel, text)).embedding,
      generate: async (prompt, system) => {
        const r = await window.octovault!.ollama.generate(c, {
          model: c.llmModel, prompt, system, stream: false,
          options: { temperature: 0.1 },
        });
        return r.response;
      },
      generateStream: async (prompt, system, onToken) => {
        return window.octovault!.ollama.generateStream(
          c,
          { model: c.llmModel, prompt, system, options: { temperature: 0.1 } },
          onToken,
        );
      },
    };
    return askLocal(engine, question, embeddings, { entities, vault, documents }, opts);
  },

  // --- Vault lifecycle (SQLCipher via main process) ---
  async vaultExists(): Promise<boolean> {
    return (await window.octovault!.vault.exists()) === true;
  },
  async vaultInit(password: string): Promise<void> {
    const ok = await window.octovault!.vault.initialize(password);
    if (!ok) throw new Error("Vault initialization failed");
  },
  async vaultUnlock(password: string): Promise<boolean> {
    return window.octovault!.vault.unlock(password);
  },
  async vaultLock(): Promise<void> { await window.octovault!.vault.lock(); },
  async vaultReset(): Promise<void> { await window.octovault!.vault.reset(); },
  isVaultUnlocked(): boolean {
    // SQLCipher state lives in main; we can't synchronously query it.
    // Track it locally based on the most recent unlock/init call.
    return _unlockedFlag;
  },
};

let _unlockedFlag = false;

// Wrap lifecycle ops to maintain the local flag (since isVaultUnlocked
// is synchronous and AppHost requires a sync method).
const origInit = desktopHost.vaultInit;
const origUnlock = desktopHost.vaultUnlock;
const origLock = desktopHost.vaultLock;
desktopHost.vaultInit = async (pw: string) => { await origInit(pw); _unlockedFlag = true; };
desktopHost.vaultUnlock = async (pw: string) => {
  const ok = await origUnlock(pw);
  _unlockedFlag = ok;
  return ok;
};
desktopHost.vaultLock = async () => { await origLock(); _unlockedFlag = false; };
const origReset = desktopHost.vaultReset;
desktopHost.vaultReset = async () => { await origReset(); _unlockedFlag = false; };

// Push the current vault state to the main process at boot and on a 4s
// poll. The HTTP server in main always returns the latest snapshot for
// the extension to read.
export async function startSnapshotPump(): Promise<void> {
  const publish = async () => {
    try {
      const [profile, documents, entities] = await Promise.all([
        ipcStorageAdapter.getAllProfiles(),
        ipcStorageAdapter.listDocuments(),
        ipcStorageAdapter.listEntities(),
      ]);
      window.octovault?.bridge.publishSnapshot({ profile, documents, entities });
    } catch (err) {
      console.warn("[bridge] publish failed", err);
    }
  };
  await publish();
  setInterval(() => void publish(), 4000);
}
