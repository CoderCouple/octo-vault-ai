// Service worker. Single channel for Ollama calls (avoids CORS from
// popup/content). Also handles form-field matching requests from the
// content script.

import {
  enrichDetection,
  generate, generateJson, isReachable, indexedDbAdapter,
  matchFormFields,
  type DetectedField, type Entity, type OllamaConfig, type SuspiciousCandidate, type VaultProfile,
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
      // Multi-entity matching (Phase C) + LLM-text augmentation (Phase E1).
      // Order: enrich → merge → match.
      const remote = await fetchProfileFromBridge() as VaultProfile | null;
      const vault: VaultProfile = remote && Object.keys(remote).length > 0
        ? remote
        : await indexedDbAdapter.getAllProfiles();
      const entities = await fetchEntities();
      const source = remote ? "desktop" : "extension";
      const llm = await cfg();

      const rawFields = (msg.fields as DetectedField[] | undefined) ?? [];
      const candidates = (msg.candidates as SuspiciousCandidate[] | undefined) ?? [];

      // Phase E1: ask the LLM to correct weak labels and decide which
      // suspicious candidates are real fields. Skipped (cheaply, in
      // the helper) when nothing needs correcting.
      const enrichment = await enrichDetection(llm, rawFields, candidates);

      // Merge: apply label corrections, then append promoted candidates
      // as full DetectedField rows. Promoted fields get an empty name /
      // autocomplete since DOM detection didn't reach them — the LLM's
      // label + chosen type are all we have, and that's enough for
      // matching.
      const fields: DetectedField[] = rawFields.map((f) => {
        const c = enrichment.corrections[f.id];
        return c?.label ? { ...f, label: c.label } : f;
      });
      for (const p of enrichment.promotions) {
        fields.push({
          id: p.id,
          label: p.label,
          name: "",
          type: p.type,
          placeholder: "",
          autocomplete: "",
          section: p.section,
        });
      }

      const matches = await matchFormFields(llm, fields, vault, entities);
      // Return the *final* fields so the content script can show the
      // enriched labels in the HUD and so it knows which ids were
      // promoted (anything not in rawFields' id set is a promotion).
      return { matches, vault, entities, source, fields, enrichment };
    }

    case "bridge.health":
      return { reachable: await bridgeReachable() };

    default:
      throw new Error(`Unknown message: ${msg.type}`);
  }
}
