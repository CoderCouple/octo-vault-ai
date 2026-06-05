// Electron main process. Creates the window, brokers Ollama calls
// over IPC so the renderer doesn't have to fight CORS, and applies
// strict default security settings.

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, shell } from "electron";
import http from "node:http";
import { promises as fs, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
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

// --- Spotlight overlay window ---
// Frameless, transparent, always-on-top. Single search bar that calls
// host.ask() via IPC. Toggled by Cmd+Option+O (global shortcut) and,
// later, by clicking the floating shortcut. Lazy-created on first show
// so app startup stays light.
let overlayWindow: BrowserWindow | null = null;

function showOverlay() {
  if (!overlayWindow) {
    overlayWindow = new BrowserWindow({
      width: 640,
      height: 540,           // generous max; with transparent bg the empty area is invisible
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,      // card has its own shadow; window shadow would box the transparent area
      webPreferences: {
        preload: join(__dirname, "../preload/index.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    // Centered horizontally, ~22% from the top of the screen — same
    // resting position as Spotlight.
    const display = screen.getPrimaryDisplay();
    const { width: sw, height: sh, x: dx, y: dy } = display.workArea;
    overlayWindow.setPosition(
      dx + Math.floor((sw - 640) / 2),
      dy + Math.floor(sh * 0.22),
    );

    const searchSuffix = "?mode=overlay";
    if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
      void overlayWindow.loadURL(process.env["ELECTRON_RENDERER_URL"] + searchSuffix);
    } else {
      void overlayWindow.loadFile(join(__dirname, "../renderer/index.html"), { search: searchSuffix });
    }

    // Click-outside / focus-elsewhere dismiss.
    overlayWindow.on("blur", () => overlayWindow?.hide());
    overlayWindow.on("closed", () => { overlayWindow = null; });
  }
  overlayWindow.show();
  overlayWindow.focus();
}

function hideOverlay() { overlayWindow?.hide(); }
function toggleOverlay() {
  if (overlayWindow?.isVisible()) hideOverlay();
  else showOverlay();
}

ipcMain.on("overlay.show",   () => showOverlay());
ipcMain.on("overlay.hide",   () => hideOverlay());
ipcMain.on("overlay.toggle", () => toggleOverlay());

// --- Global shortcut (configurable via Settings.globalShortcut) ---
// Stored in the encrypted settings table, so before the vault is
// unlocked we use the hardcoded default. After unlock/init we re-read
// and re-register. Settings UI also pushes updates via "shortcut.set"
// to swap the binding live.
const DEFAULT_SHORTCUT = "CommandOrControl+Alt+O";
let registeredShortcut: string | null = null;

function currentShortcutFromSettings(): string {
  if (!vault.isOpen()) return DEFAULT_SHORTCUT;
  try {
    const s = vault.store.getSettings() as { globalShortcut?: string };
    return s.globalShortcut?.trim() || DEFAULT_SHORTCUT;
  } catch { return DEFAULT_SHORTCUT; }
}

function reregisterShortcut(accelerator: string) {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut);
    registeredShortcut = null;
  }
  if (!accelerator) return;
  try {
    if (globalShortcut.register(accelerator, toggleOverlay)) {
      registeredShortcut = accelerator;
    } else {
      console.warn(`[main] failed to register global shortcut "${accelerator}" — likely in use by another app`);
    }
  } catch (e) {
    console.warn(`[main] invalid global shortcut "${accelerator}":`, e);
  }
}

ipcMain.on("shortcut.set", (_e, accelerator: string) => {
  reregisterShortcut(accelerator);
});

// Renderer-driven drag for the floating shortcut. The CSS
// `-webkit-app-region: drag` approach can't coexist with onClick on
// the same element, and the click target covers the whole window —
// so we do drag in JS: renderer tracks mousedown→mousemove deltas
// and sends absolute screen coords; main calls setPosition.
ipcMain.on("shortcut.move", (_e, x: number, y: number) => {
  shortcutWindow?.setPosition(Math.round(x), Math.round(y));
});
ipcMain.on("shortcut.snap",     () => snapShortcutToEdge());
ipcMain.on("shortcut.setEdge",  (_e, edge: "left" | "right") => setShortcutEdge(edge));
ipcMain.on("shortcut.hide",     () => shortcutWindow?.hide());
ipcMain.on("shortcut.show",     () => { if (!shortcutWindow) createShortcutWindow(); shortcutWindow?.show(); });

// --- Launch at login ---
// Wraps app.setLoginItemSettings so the renderer can toggle it from
// Settings without juggling Electron APIs. macOS / Windows only —
// Linux uses XDG autostart files separately (TODO if we ship Linux).
function applyLoginItem(openAtLogin: boolean) {
  app.setLoginItemSettings({ openAtLogin, openAsHidden: false });
}
ipcMain.on("launch.setOpenAtLogin", (_e, on: boolean) => applyLoginItem(on));

function currentLaunchAtLoginFromSettings(): boolean {
  if (!vault.isOpen()) return true; // default ON until vault loads
  try {
    const s = vault.store.getSettings() as { launchAtLogin?: boolean };
    return s.launchAtLogin !== false;
  } catch { return true; }
}

function currentShowFloatingShortcutFromSettings(): boolean {
  if (!vault.isOpen()) return true; // default ON until vault loads
  try {
    const s = vault.store.getSettings() as { showFloatingShortcut?: boolean };
    return s.showFloatingShortcut !== false;
  } catch { return true; }
}

// Native context menu on the floating shortcut. Right-click on the
// shortcut button → renderer fires this → we pop a small native menu.
ipcMain.on("shortcut.contextMenu", () => {
  if (!shortcutWindow) return;
  const menu = Menu.buildFromTemplate([
    { label: "Open OctoVault", click: () => {
      const all = BrowserWindow.getAllWindows();
      const main = all.find((w) => w !== shortcutWindow && w !== overlayWindow);
      if (main) { main.show(); main.focus(); }
    }},
    { label: "Open quick search…", accelerator: "CommandOrControl+Alt+O",
      click: () => toggleOverlay() },
    { type: "separator" },
    { label: "Snap to left edge",  click: () => setShortcutEdge("left")  },
    { label: "Snap to right edge", click: () => setShortcutEdge("right") },
    { type: "separator" },
    // The "Hide for now" path hides the window for this session only.
    // To hide PERSISTENTLY across launches, users flip the toggle in
    // Settings → "Show floating shortcut" — that updates the vault
    // setting and pushes shortcut.hide via the renderer.
    { label: "Hide for now",       click: () => shortcutWindow?.hide() },
    { type: "separator" },
    { label: "Quit OctoVault",     role: "quit" },
  ]);
  menu.popup({ window: shortcutWindow });
});

// --- Floating shortcut window ---
// Tiny always-on-top capsule with the OctoMark. Drag to reposition;
// on drop the window snaps to the nearer left/right screen edge and
// the position is persisted to a plain JSON file in userData (no vault
// needed — the shortcut should be visible before unlock).
// Window dimensions match the OctoMark badge size exactly (h-12 w-12
// = 48px in Tailwind). Anything bigger leaves a visible window frame
// around the rounded badge — on macOS that shows up as a faint white
// halo because transparent BrowserWindows are slightly opaque under
// certain configurations.
const SHORTCUT_W = 48;
const SHORTCUT_H = 48;
const SHORTCUT_EDGE_MARGIN = 12;
let shortcutWindow: BrowserWindow | null = null;
let shortcutSnapTimer: NodeJS.Timeout | null = null;

function shortcutPosFile(): string { return join(app.getPath("userData"), "shortcut-position.json"); }
function loadShortcutPos(): { x: number; y: number } | null {
  try { return JSON.parse(readFileSync(shortcutPosFile(), "utf8")); }
  catch { return null; }
}
function saveShortcutPos(x: number, y: number) {
  try { writeFileSync(shortcutPosFile(), JSON.stringify({ x, y })); }
  catch (e) { console.warn("[shortcut] save position failed:", e); }
}

function defaultShortcutPos(): { x: number; y: number } {
  // Left edge, vertically centred on the primary display's work area.
  // User can change the preferred edge in Settings → Floating shortcut
  // edge; that pushes a `shortcut.setEdge` IPC which moves the window.
  const { x: dx, y: dy, height: dh } = screen.getPrimaryDisplay().workArea;
  return {
    x: dx + SHORTCUT_EDGE_MARGIN,
    y: dy + Math.floor((dh - SHORTCUT_H) / 2),
  };
}

// Snap to a specific edge (left or right), preserving the current
// vertical position. Used when the user changes the edge preference
// from Settings — different from snapShortcutToEdge() which picks the
// nearer edge based on where the user dragged to.
function setShortcutEdge(edge: "left" | "right") {
  if (!shortcutWindow) return;
  const [wx, wy] = shortcutWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: wx, y: wy });
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const targetX = edge === "right"
    ? dx + dw - SHORTCUT_W - SHORTCUT_EDGE_MARGIN
    : dx + SHORTCUT_EDGE_MARGIN;
  const targetY = Math.max(dy + SHORTCUT_EDGE_MARGIN,
                   Math.min(wy, dy + dh - SHORTCUT_H - SHORTCUT_EDGE_MARGIN));
  shortcutWindow.setPosition(Math.round(targetX), Math.round(targetY), true);
  saveShortcutPos(targetX, targetY);
}

function snapShortcutToEdge() {
  if (!shortcutWindow) return;
  const [wx, wy] = shortcutWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: wx, y: wy });
  const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
  const centerX = wx + SHORTCUT_W / 2;
  const onRight = centerX > dx + dw / 2;
  const targetX = onRight
    ? dx + dw - SHORTCUT_W - SHORTCUT_EDGE_MARGIN
    : dx + SHORTCUT_EDGE_MARGIN;
  const targetY = Math.max(dy + SHORTCUT_EDGE_MARGIN,
                  Math.min(wy, dy + dh - SHORTCUT_H - SHORTCUT_EDGE_MARGIN));
  shortcutWindow.setPosition(Math.round(targetX), Math.round(targetY), true);
  saveShortcutPos(targetX, targetY);
}

function createShortcutWindow() {
  if (shortcutWindow) return;
  if (!currentShowFloatingShortcutFromSettings()) return; // user opted out
  const pos = loadShortcutPos() ?? defaultShortcutPos();
  shortcutWindow = new BrowserWindow({
    width: SHORTCUT_W,
    height: SHORTCUT_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Visible across every macOS Space, including fullscreen apps — the
  // whole point of "always available" is that it's actually always there.
  if (process.platform === "darwin") {
    shortcutWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  shortcutWindow.setAlwaysOnTop(true, "floating");

  const searchSuffix = "?mode=shortcut";
  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    void shortcutWindow.loadURL(process.env["ELECTRON_RENDERER_URL"] + searchSuffix);
  } else {
    void shortcutWindow.loadFile(join(__dirname, "../renderer/index.html"), { search: searchSuffix });
  }

  // Debounced edge snap: after the user stops moving for 250ms, snap
  // to the nearest left/right edge and persist.
  shortcutWindow.on("move", () => {
    if (shortcutSnapTimer) clearTimeout(shortcutSnapTimer);
    shortcutSnapTimer = setTimeout(snapShortcutToEdge, 250);
  });
  shortcutWindow.on("closed", () => { shortcutWindow = null; });
}

// IPC: Ollama proxy. Renderer asks; main fetches; no CORS.
ipcMain.handle("ollama.health", async (_e, cfg: OllamaCfg) => {
  try {
    const r = await fetch(`${cfg.url}/api/tags`);
    return { reachable: r.ok };
  } catch { return { reachable: false }; }
});

type EnsureRunningResult =
  | { status: "running" }
  | { status: "started" }
  | { status: "not_installed"; downloadUrl: string }
  | { status: "error"; message: string };

async function checkOllamaReachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/api/tags`);
    return r.ok;
  } catch { return false; }
}

ipcMain.handle("ollama.ensureRunning", async (_e, cfg: OllamaCfg): Promise<EnsureRunningResult> => {
  try {
    if (await checkOllamaReachable(cfg.url)) return { status: "running" };

    let binaryExists = false;
    try {
      execSync("which ollama", { stdio: "ignore" });
      binaryExists = true;
    } catch { /* not on PATH */ }

    if (!binaryExists) {
      return { status: "not_installed", downloadUrl: "https://ollama.com/download" };
    }

    // Binary exists but server isn't up — launch the menu-bar app so
    // it starts its built-in server. On macOS this is the standard path;
    // the .app bundles `ollama serve` internally.
    execSync("open -a Ollama", { stdio: "ignore" });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (await checkOllamaReachable(cfg.url)) return { status: "started" };

    // Menu-bar app didn't start the server — try the CLI directly.
    // `ollama serve` is a long-running process; spawn detached and unref
    // so it outlives the IPC call without blocking the main process.
    const { spawn } = await import("node:child_process");
    const child = spawn("ollama", ["serve"], { detached: true, stdio: "ignore" });
    child.unref();

    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (await checkOllamaReachable(cfg.url)) return { status: "started" };

    return { status: "error", message: "Ollama binary found but server did not start. Try running `ollama serve` in a terminal." };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle("ollama.listModels", async (_e, cfg: OllamaCfg) => {
  try {
    const r = await fetch(`${cfg.url}/api/tags`);
    if (!r.ok) return [];
    const data = (await r.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch { return []; }
});

// Default keep_alive applied to every generate / generateStream call.
// Ollama's default is 5 minutes; we extend to 30 so the chat model
// doesn't get evicted by an idle gap or by a vision OCR pass loading
// qwen3-vl (which can be 30 GB) in the meantime. Callers can still
// override by passing their own keep_alive in `body`.
const KEEP_ALIVE = "30m";

ipcMain.handle("ollama.generate", async (_e, cfg: OllamaCfg, body: object) => {
  // think:false disables qwen3's chain-of-thought "thinking" tokens
  // which can take 5–20s of internal reasoning before the model
  // emits a single answer token. Big TTFT win; small quality cost.
  const r = await fetch(`${cfg.url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keep_alive: KEEP_ALIVE, think: false, ...body }),
  });
  if (!r.ok) throw new Error(`Ollama generate failed: ${r.status}`);
  return r.json();
});

// Streaming generate. The renderer passes a requestId; we relay each
// chunk back as `ollama.generateStream.chunk:<requestId>` events so
// the renderer can show tokens as they arrive. One final
// `ollama.generateStream.done:<requestId>` event closes the stream.
// Returning the full text from the handler too, so callers that don't
// subscribe still get a normal Promise<string>.
ipcMain.handle("ollama.generateStream", async (e, cfg: OllamaCfg, body: { model: string; prompt: string; system?: string; options?: object }, requestId: string) => {
  const chunkChannel = `ollama.generateStream.chunk:${requestId}`;
  const doneChannel  = `ollama.generateStream.done:${requestId}`;
  try {
    const r = await fetch(`${cfg.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep_alive: KEEP_ALIVE, think: false, ...body, stream: true }),
    });
    if (!r.ok || !r.body) throw new Error(`Ollama generateStream failed: ${r.status}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          // qwen3 splits its output across `response` (visible answer)
          // and `thinking` (chain-of-thought). think:false above should
          // suppress thinking entirely, but on Ollama builds that don't
          // honor the flag we forward thinking tokens too so the UI
          // doesn't look frozen during the reasoning phase.
          const obj = JSON.parse(line) as { response?: string; thinking?: string; done?: boolean };
          const piece = obj.response ?? obj.thinking ?? "";
          if (piece) {
            full += piece;
            e.sender.send(chunkChannel, piece);
          }
        } catch { /* ignore partial NDJSON */ }
      }
    }
    e.sender.send(doneChannel);
    return { response: full };
  } catch (err) {
    e.sender.send(doneChannel, String(err));
    throw err;
  }
});

// Vision OCR. Same /api/generate endpoint as text but with an `images`
// array (base64 strings). Kept as its own handler so the preload + UI
// can type it correctly and so we can add per-image timeout later.
ipcMain.handle("ollama.vision", async (_e, cfg: OllamaCfg, body: { model: string; prompt: string; images: string[]; system?: string; options?: object }) => {
  // Short keep_alive so the (often huge — 30 GB for qwen3-vl) vision
  // model unloads quickly after the import batch. Otherwise it sits
  // in VRAM and evicts qwen3:8b on the next chat, costing a reload.
  // 1m is long enough to keep it loaded across pages of one document.
  const r = await fetch(`${cfg.url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keep_alive: "1m", ...body, stream: false }),
  });
  if (!r.ok) throw new Error(`Ollama vision failed: ${r.status}`);
  return r.json();
});

// --- Vault lifecycle ---
ipcMain.handle("vault.exists", () => vault.vaultExists());
ipcMain.handle("vault.isOpen", () => vault.isOpen());
ipcMain.handle("vault.initialize", (_e, password: string) => {
  vault.initialize(password);
  reregisterShortcut(currentShortcutFromSettings());
  return true;
});
ipcMain.handle("vault.unlock", (_e, password: string) => {
  const ok = vault.unlock(password);
  if (ok) {
    reregisterShortcut(currentShortcutFromSettings());
    applyLoginItem(currentLaunchAtLoginFromSettings());
    // If the user previously toggled the shortcut off, ensure it's
    // hidden even though we created the window at boot.
    if (!currentShowFloatingShortcutFromSettings()) shortcutWindow?.hide();
    else if (!shortcutWindow) createShortcutWindow();
    // Fire-and-forget warm-up so the first chat doesn't pay the
    // model-load cost. Won't block unlock; failures are logged only.
    void warmChatModel().catch((e) => console.warn("[warmup] chat model warm failed:", e));
  }
  return ok;
});

// Sends a 1-token generate to qwen3:8b (or whatever the user's
// llmModel is) to pull it into memory. Uses keep_alive so the model
// stays resident for the rest of the session.
async function warmChatModel(): Promise<void> {
  const settings = vault.store.getSettings() as { llmModel?: string; ollamaUrl?: string };
  const url = settings.ollamaUrl ?? "http://localhost:11434";
  const model = settings.llmModel ?? "qwen3:8b";
  const body = {
    model,
    prompt: "ok",
    stream: false,
    keep_alive: KEEP_ALIVE,
    options: { num_predict: 1, temperature: 0 },
  };
  await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
ipcMain.handle("vault.lock", () => { vault.close(); });
ipcMain.handle("vault.reset", () => { vault.reset(); });

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
ipcMain.handle("store.listEvents",              () => whenOpen(() => vault.store.listEvents(), [] as unknown[]));
ipcMain.handle("store.saveEvent",               (_e, event) => whenOpen(() => vault.store.saveEvent(event), null));
ipcMain.handle("store.deleteEvent",             (_e, id) => whenOpen(() => vault.store.deleteEvent(id), null));
ipcMain.handle("store.deleteEventsFromDoc",     (_e, documentId) => whenOpen(() => vault.store.deleteEventsFromDoc(documentId), null));
ipcMain.handle("store.getSettings",             () => whenOpen(() => vault.store.getSettings(), {}));
ipcMain.handle("store.updateSettings",          (_e, patch) => whenOpen(() => vault.store.updateSettings(patch), patch ?? {}));
ipcMain.handle("store.getAuthBlob",             () => whenOpen(() => vault.store.getAuthBlob(), null));
ipcMain.handle("store.setAuthBlob",             (_e, blob) => whenOpen(() => vault.store.setAuthBlob(blob), null));
ipcMain.handle("store.deleteAuthBlob",          () => whenOpen(() => vault.store.deleteAuthBlob(), null));

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
  // Default to launching at login. The user can flip this off in
  // Settings — that pushes launch.setOpenAtLogin via IPC.
  applyLoginItem(true);
  createWindow();
  createShortcutWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    if (!shortcutWindow) createShortcutWindow();
  });

  // Global hotkey at boot — uses the persisted setting if a vault
  // happens to already be open (rare; usually vault is locked at this
  // point), else falls back to the DEFAULT_SHORTCUT. After unlock/init
  // we re-read settings and re-register.
  reregisterShortcut(currentShortcutFromSettings());
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
