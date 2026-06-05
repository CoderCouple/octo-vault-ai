// Service worker. Single channel for Ollama calls (avoids CORS from
// popup/content). Also handles form-field matching requests from the
// content script.

import {
  generate, generateJson, isReachable, indexedDbAdapter,
  matchFormFields,
  type Entity, type OllamaConfig, type VaultProfile,
} from "@octovault/core";
import { bridgeReachable, fetchProfileFromBridge } from "../bridge";

// Read entities from desktop bridge when available, else local IDB.
async function fetchEntities(): Promise<Entity[]> {
  try {
    const r = await fetch("http://127.0.0.1:53117/entities");
    if (r.ok) {
      const data = await r.json() as Entity[];
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch { /* fall through to local */ }
  return indexedDbAdapter.listEntities();
}

const DESKTOP_OLLAMA_PROXY = "http://127.0.0.1:53117/ollama";

chrome.runtime.onInstalled.addListener(() => console.log("[OctoVault] installed"));

// Open the side panel when the toolbar icon is clicked. Set once at
// startup; Chrome remembers the behaviour for the lifetime of the
// extension. Without this the action click is a no-op (we removed
// default_popup in the manifest).
void chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err: unknown) => console.warn("[OctoVault] sidePanel setup failed:", err));

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  return true;
});

async function cfg(): Promise<OllamaConfig> {
  const s = await indexedDbAdapter.getSettings();
  // If the desktop app is running, route through its bridge — Node-side
  // fetch has no CORS, so this avoids the OLLAMA_ORIGINS setup hurdle.
  // Falls back to direct fetch when desktop isn't reachable.
  const useBridge = await bridgeReachable();
  return {
    url: useBridge ? DESKTOP_OLLAMA_PROXY : s.ollamaUrl,
    llmModel: s.llmModel,
    embeddingModel: s.embeddingModel,
  };
}

async function handle(msg: { type: string } & Record<string, unknown>): Promise<unknown> {
  switch (msg.type) {
    case "ping": return "pong";

    case "ollama.health":
      return { reachable: await isReachable(await cfg()) };

    case "ollama.generate":
      return msg.json
        ? generateJson(await cfg(), { prompt: msg.prompt as string, system: msg.system as string | undefined })
        : generate(await cfg(), { prompt: msg.prompt as string, system: msg.system as string | undefined });

    case "form.match": {
      // Multi-entity matching (Phase C). We pass the full vault +
      // entities to the matcher so fields under a "Spouse" or
      // "Emergency Contact" section route to the right entity.
      // Response includes the vault so the content script can resolve
      // value = vault[match.entityId][match.profileKey] at fill time.
      const remote = await fetchProfileFromBridge() as VaultProfile | null;
      const vault: VaultProfile = remote && Object.keys(remote).length > 0
        ? remote
        : await indexedDbAdapter.getAllProfiles();
      const entities = await fetchEntities();
      const source = remote ? "desktop" : "extension";
      const matches = await matchFormFields(await cfg(), msg.fields as never, vault, entities);
      return { matches, vault, entities, source };
    }

    case "bridge.health":
      return { reachable: await bridgeReachable() };

    default:
      throw new Error(`Unknown message: ${msg.type}`);
  }
}
