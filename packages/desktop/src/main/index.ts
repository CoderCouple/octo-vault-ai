// Electron main process. Creates the window, brokers Ollama calls
// over IPC so the renderer doesn't have to fight CORS, and applies
// strict default security settings.

import { app, BrowserWindow, ipcMain, shell } from "electron";
import http from "node:http";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as vault from "./sqlite-store";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const isDev = !app.isPackaged;

interface OllamaCfg { url: string; llmModel: string; embeddingModel: string }

// --- Bridge: a localhost HTTP server the extension can query for the
// vault contents. The renderer is the source of truth (IndexedDB lives
// there); main caches the latest snapshot pushed via IPC.
const BRIDGE_PORT = 53117;
let cachedProfile: unknown = {};
let cachedProfileAt = 0;
let cachedDocs: unknown = [];
let cachedEntities: unknown = [];

ipcMain.on("bridge.publishSnapshot", (_e, snap: { profile: unknown; documents: unknown; entities?: unknown }) => {
  cachedProfile = snap.profile;
  cachedDocs = snap.documents;
  if (snap.entities) cachedEntities = snap.entities;
  cachedProfileAt = Date.now();
});

function corsHeaders(req: http.IncomingMessage): Record<string, string> {
  const origin = req.headers.origin ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

function send(res: http.ServerResponse, req: http.IncomingMessage, status: number, body: unknown) {
  res.writeHead(status, corsHeaders(req));
  res.end(JSON.stringify(body));
}

// Proxy POSTs to /ollama/api/* through to the real Ollama at the URL
// in settings. Lets the browser extension call us instead of Ollama
// directly — sidesteps OLLAMA_ORIGINS / CORS entirely.
async function proxyOllama(req: http.IncomingMessage, res: http.ServerResponse, suffix: string) {
  const settings = vault.isOpen() ? (vault.store.getSettings() as { ollamaUrl?: string }) : {};
  const ollamaUrl = settings.ollamaUrl ?? "http://localhost:11434";
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(`${ollamaUrl}${suffix}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, { ...corsHeaders(req), "Content-Type": "application/json" });
    res.end(text);
  } catch (err) {
    console.error("[bridge] ollama proxy error:", err);
    if (!res.headersSent) {
      res.writeHead(502, corsHeaders(req));
      res.end(JSON.stringify({ error: String(err) }));
    }
  }
}

const bridge = http.createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, corsHeaders(req)); res.end(); return; }
      const url = (req.url ?? "/").split("?")[0];

      // Ollama proxy paths — extension hits these instead of localhost:11434.
      if (url === "/ollama/api/generate" && req.method === "POST")   return proxyOllama(req, res, "/api/generate");
      if (url === "/ollama/api/embeddings" && req.method === "POST") return proxyOllama(req, res, "/api/embeddings");
      if (url === "/ollama/api/tags" && req.method === "GET") {
        // Forward GET to /api/tags for model-list checks.
        const settings = vault.isOpen() ? (vault.store.getSettings() as { ollamaUrl?: string }) : {};
        const ollamaUrl = settings.ollamaUrl ?? "http://localhost:11434";
        try {
          const r = await fetch(`${ollamaUrl}/api/tags`);
          const text = await r.text();
          res.writeHead(r.status, { ...corsHeaders(req), "Content-Type": "application/json" });
          res.end(text);
        } catch (err) {
          res.writeHead(502, corsHeaders(req));
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      switch (url) {
        case "/health":    return send(res, req, 200, { ok: true, snapshotAt: cachedProfileAt });
        case "/profile":   return send(res, req, 200, cachedProfile);
        case "/documents": return send(res, req, 200, cachedDocs);
        case "/entities":  return send(res, req, 200, cachedEntities);
        default:           return send(res, req, 404, { error: "not found" });
      }
    } catch (err) {
      console.error("[bridge] request error:", err);
      if (!res.headersSent) {
        try { res.writeHead(500, corsHeaders(req)); res.end("{}"); } catch { /* ignore */ }
      }
    }
  })();
});
bridge.on("error", (err) => console.error("[bridge] server error:", err));
bridge.on("clientError", (err) => console.error("[bridge] client error:", err));
bridge.listen(BRIDGE_PORT, "127.0.0.1", () => console.log(`[bridge] :${BRIDGE_PORT}`));

// Top-level safety net so a stray throw doesn't trigger the Electron
// "JavaScript error occurred in the main process" dialog.
process.on("uncaughtException", (err) => console.error("[main] uncaught:", err));
process.on("unhandledRejection", (err) => console.error("[main] unhandled:", err));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0a0a0a",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // External links go to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// IPC: Ollama proxy. Renderer asks; main fetches; no CORS.
ipcMain.handle("ollama.health", async (_e, cfg: OllamaCfg) => {
  try {
    const r = await fetch(`${cfg.url}/api/tags`);
    return { reachable: r.ok };
  } catch { return { reachable: false }; }
});

ipcMain.handle("ollama.listModels", async (_e, cfg: OllamaCfg) => {
  try {
    const r = await fetch(`${cfg.url}/api/tags`);
    if (!r.ok) return [];
    const data = (await r.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch { return []; }
});

ipcMain.handle("ollama.generate", async (_e, cfg: OllamaCfg, body: object) => {
  const r = await fetch(`${cfg.url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Ollama generate failed: ${r.status}`);
  return r.json();
});

// --- Vault lifecycle ---
ipcMain.handle("vault.exists", () => vault.vaultExists());
ipcMain.handle("vault.isOpen", () => vault.isOpen());
ipcMain.handle("vault.initialize", (_e, password: string) => {
  vault.initialize(password);
  return true;
});
ipcMain.handle("vault.unlock", (_e, password: string) => vault.unlock(password));
ipcMain.handle("vault.lock", () => { vault.close(); });

// --- Storage RPC: one IPC method per StorageAdapter method ---
// All wrapped: when the DB isn't open yet (pre-unlock), reads return
// an empty default and writes are ignored. This keeps the renderer's
// boot path silent — no IPC errors, no console spam — until the user
// supplies a password.
function whenOpen<T>(fn: () => T, fallback: T): T {
  if (!vault.isOpen()) return fallback;
  try { return fn(); } catch { return fallback; }
}

ipcMain.handle("store.listEntities",            () => whenOpen(() => vault.store.listEntities(), [] as unknown[]));
ipcMain.handle("store.saveEntity",              (_e, entity) => whenOpen(() => vault.store.saveEntity(entity), null));
ipcMain.handle("store.deleteEntity",            (_e, id) => whenOpen(() => vault.store.deleteEntity(id), null));
ipcMain.handle("store.saveDocument",            (_e, doc) => whenOpen(() => vault.store.saveDocument(doc), null));
ipcMain.handle("store.listDocuments",           () => whenOpen(() => vault.store.listDocuments(), [] as unknown[]));
ipcMain.handle("store.getDocument",             (_e, id) => whenOpen(() => vault.store.getDocument(id), null));
ipcMain.handle("store.deleteDocument",          (_e, id) => whenOpen(() => vault.store.deleteDocument(id), null));
ipcMain.handle("store.getRecord",               (_e, entityId, key) => whenOpen(() => vault.store.getRecord(entityId, key), null));
ipcMain.handle("store.setRecord",               (_e, entityId, record) => whenOpen(() => vault.store.setRecord(entityId, record), null));
ipcMain.handle("store.deleteRecord",            (_e, entityId, key) => whenOpen(() => vault.store.deleteRecord(entityId, key), null));
ipcMain.handle("store.getProfile",              (_e, entityId) => whenOpen(() => vault.store.getProfile(entityId), {}));
ipcMain.handle("store.getAllProfiles",          () => whenOpen(() => vault.store.getAllProfiles(), {}));
ipcMain.handle("store.clearProfile",            (_e, entityId) => whenOpen(() => vault.store.clearProfile(entityId), null));
ipcMain.handle("store.deleteCandidatesFromDoc", (_e, documentId) => whenOpen(() => vault.store.deleteCandidatesFromDoc(documentId), null));
ipcMain.handle("store.listEmbeddings",          () => whenOpen(() => vault.store.listEmbeddings(), [] as unknown[]));
ipcMain.handle("store.saveEmbeddings",          (_e, records) => whenOpen(() => vault.store.saveEmbeddings(records), null));
ipcMain.handle("store.deleteEmbeddingsForDoc",  (_e, documentId) => whenOpen(() => vault.store.deleteEmbeddingsForDoc(documentId), null));
ipcMain.handle("store.listEducation",           (_e, entityId) => whenOpen(() => vault.store.listEducation(entityId), [] as unknown[]));
ipcMain.handle("store.saveEducation",           (_e, record) => whenOpen(() => vault.store.saveEducation(record), null));
ipcMain.handle("store.deleteEducation",         (_e, id) => whenOpen(() => vault.store.deleteEducation(id), null));
ipcMain.handle("store.listExperience",          (_e, entityId) => whenOpen(() => vault.store.listExperience(entityId), [] as unknown[]));
ipcMain.handle("store.saveExperience",          (_e, record) => whenOpen(() => vault.store.saveExperience(record), null));
ipcMain.handle("store.deleteExperience",        (_e, id) => whenOpen(() => vault.store.deleteExperience(id), null));
ipcMain.handle("store.deleteRecordsFromDoc",    (_e, documentId) => whenOpen(() => vault.store.deleteRecordsFromDoc(documentId), null));
ipcMain.handle("store.listRelationships",       () => whenOpen(() => vault.store.listRelationships(), [] as unknown[]));
ipcMain.handle("store.saveRelationship",        (_e, rel) => whenOpen(() => vault.store.saveRelationship(rel), null));
ipcMain.handle("store.deleteRelationship",      (_e, id) => whenOpen(() => vault.store.deleteRelationship(id), null));
ipcMain.handle("store.getSettings",             () => whenOpen(() => vault.store.getSettings(), {}));
ipcMain.handle("store.updateSettings",          (_e, patch) => whenOpen(() => vault.store.updateSettings(patch), patch ?? {}));
ipcMain.handle("store.getAuthBlob",             () => whenOpen(() => vault.store.getAuthBlob(), null));
ipcMain.handle("store.setAuthBlob",             (_e, blob) => whenOpen(() => vault.store.setAuthBlob(blob), null));

// Read a document's referenced file from disk by ID. Security: only
// the file path stored on the document record is read — the renderer
// can't pass arbitrary paths. Returns { bytes, mimeType } or null on
// missing/inaccessible files.
ipcMain.handle("doc.readBytes", async (_e, docId: string) => {
  if (!vault.isOpen()) return null;
  const doc = vault.store.getDocument(docId) as { filePath?: string; mimeType?: string } | undefined;
  if (!doc?.filePath) return null;
  try {
    const buf = await fs.readFile(doc.filePath);
    return { bytes: new Uint8Array(buf), mimeType: doc.mimeType };
  } catch (err) {
    console.warn("[doc.readBytes] read failed:", err);
    return null;
  }
});

ipcMain.handle("ollama.embed", async (_e, cfg: OllamaCfg, model: string, prompt: string) => {
  const r = await fetch(`${cfg.url}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt }),
  });
  if (!r.ok) throw new Error(`Ollama embed failed: ${r.status}`);
  return r.json();
});

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
