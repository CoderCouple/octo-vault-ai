// Service worker. Single channel for Ollama calls (avoids CORS from
// popup/content). Also handles form-field matching requests from the
// content script.

import {
  enrichDetection,
  generate, generateFieldDrafts, generateJson, isReachable, indexedDbAdapter,
  isLikelyOpenField, matchFormFields,
  type DetectedField, type Entity, type FieldDraft, type OllamaConfig,
  type OpenField, type SuspiciousCandidate, type VaultProfile,
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
  // listEntities throws "Vault is locked" when the extension's own
  // crypto isn't loaded. Treat as empty rather than bubbling — the
  // form-fill UI surfaces 'no profile data' more usefully than a
  // raw locked-vault error.
  try { return await indexedDbAdapter.listEntities(); }
  catch (e) {
    if (e instanceof Error && e.message.includes("Vault is locked")) return [];
    throw e;
  }
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
      // Local IDB fallback throws "Vault is locked" when the extension's
      // own vault isn't unlocked. Catch that — we still want to attempt
      // a fill using whatever the desktop bridge can give us, and even
      // when both are empty an empty vault is better than a thrown error
      // surfacing as "Error: Vault is locked" in the launcher toast.
      let vault: VaultProfile = remote ?? {};
      if (!remote || Object.keys(remote).length === 0) {
        try { vault = await indexedDbAdapter.getAllProfiles(); }
        catch (e) {
          if (e instanceof Error && e.message.includes("Vault is locked")) {
            console.warn("[OctoVault] local vault locked; using bridge-only data");
            vault = remote ?? {};
          } else throw e;
        }
      }
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

      // Phase F2-F4: AI-generated drafts for "open" fields. A field is
      // open when isLikelyOpenField() says so AND the matcher returned
      // no profileKey for it. We collect those, ask the generator for
      // drafts, return them as a sibling list. The content script
      // surfaces drafts in the HUD as editable values; the user must
      // explicitly approve before filling.
      const intent = (msg.intent as string | undefined) ?? "";
      const fieldsById = new Map(fields.map((f) => [f.id, f]));
      const openFields: OpenField[] = [];
      const fieldOptions = (msg.fieldOptions as Record<string, string[]> | undefined) ?? {};
      const fieldMaxLengths = (msg.fieldMaxLengths as Record<string, number> | undefined) ?? {};
      for (const m of matches) {
        if (m.profileKey) continue;          // matched to a profile, no need to generate
        const f = fieldsById.get(m.fieldId);
        if (!f) continue;
        const opts = fieldOptions[f.id];
        if (!isLikelyOpenField(f, !!opts?.length)) continue;
        openFields.push({
          field: f,
          options: opts,
          maxLength: fieldMaxLengths[f.id],
        });
      }

      // Compact profile summary for the generator. We pull from the
      // routed entity per match — most open fields are self-related.
      // For simplicity (v1) we use self only.
      const selfProfile = vault["self"] ?? {};
      const profileSummary: Record<string, string> = {};
      for (const [k, rec] of Object.entries(selfProfile)) {
        const cid = rec?.canonicalId;
        const value = rec?.candidates.find((c) => c.id === cid)?.value;
        // Drop sensitive keys before sending to generator.
        if (["ssn", "passportNumber", "driversLicenseNumber", "nationalIdNumber", "taxIdNumber"].includes(k)) continue;
        if (value) profileSummary[k] = value;
      }

      let drafts: FieldDraft[] = [];
      if (openFields.length > 0) {
        drafts = await generateFieldDrafts(llm, openFields, intent, profileSummary);
      }

      return { matches, vault, entities, source, fields, enrichment, drafts };
    }

    case "bridge.health":
      return { reachable: await bridgeReachable() };

    default:
      throw new Error(`Unknown message: ${msg.type}`);
  }
}
