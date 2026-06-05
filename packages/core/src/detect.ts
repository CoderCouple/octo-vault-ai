// LLM-text augmentation for form-field detection (Phase E1).
//
// DOM detection (content/index.ts) gives us a list of fields with
// best-effort labels + section context. Modern forms break that:
// labels live in adjacent text nodes, custom-styled divs do the
// work of inputs, ARIA is incomplete. This module sends the DOM's
// detected fields *and* a list of suspicious candidates (form-like
// elements DOM detection wasn't sure about) to the local LLM and
// asks it to (a) correct or fill missing labels, (b) flag any
// candidate that's really a field.
//
// One call per fill click, only when at least one suspicious
// candidate exists *or* at least one detected field has no label.
// Cost: ~1-2s on warm qwen3:8b. Skipped entirely otherwise.

import { generateJson, type OllamaConfig } from "./ollama";
import type { DetectedField } from "./match";

// A DOM element the content script suspects might be a field but
// didn't include in `fields`. Typical sources: clickable divs with
// labelled text content, labelled containers that contain no input,
// span/button elements styled like form controls.
export interface SuspiciousCandidate {
  // Stable id the content script assigns and tracks (same scheme as
  // detected fields, e.g. "ov-cand-7").
  id: string;
  // Short tag + class hint so the LLM has a sense of what it is.
  tag: string;
  // Visible text content nearby (truncated).
  text: string;
  // Section / fieldset legend context, if any.
  section?: string;
  // The reason the content script flagged it. Useful for the LLM's
  // judgement — "labelled container, no input" is a strong signal;
  // "div with placeholder-like text" is weaker.
  reason: string;
}

export interface DetectionEnrichment {
  // For each detected field, either {} (unchanged) or { label }
  // when the LLM proposes a better label. The content script
  // overwrites field.label when present.
  corrections: Record<string, { label?: string }>;
  // Suspicious candidate ids the LLM thinks are real fields. The
  // content script treats them as additional fields.
  promotions: { id: string; label: string; type: string; section?: string }[];
}

export async function enrichDetection(
  cfg: OllamaConfig | null,
  fields: DetectedField[],
  candidates: SuspiciousCandidate[],
): Promise<DetectionEnrichment> {
  // Skip the LLM call entirely when there's nothing for it to do:
  // every detected field already has a label and no suspicious
  // candidates exist. This is the common case on well-marked-up
  // forms and we don't want to pay the round-trip there.
  const fieldsNeedingLabels = fields.filter((f) => !f.label || f.label.length < 2);
  if (fieldsNeedingLabels.length === 0 && candidates.length === 0) {
    return { corrections: {}, promotions: [] };
  }
  if (!cfg) return { corrections: {}, promotions: [] };

  // Build a compact prompt. Truncate text aggressively — the LLM
  // doesn't need full content, just enough to decide.
  const fieldLines = fieldsNeedingLabels.map((f) =>
    `  - id="${f.id}" type="${f.type}" name="${f.name}" placeholder="${f.placeholder}" section="${f.section ?? ""}"`,
  ).join("\n");

  const candidateLines = candidates.map((c) =>
    `  - id="${c.id}" tag="${c.tag}" reason="${c.reason}" section="${c.section ?? ""}" text="${c.text.slice(0, 80)}"`,
  ).join("\n");

  const prompt = `You help identify form fields on a web page that the DOM parser was uncertain about. Return JSON only.

DETECTED FIELDS WITH WEAK OR MISSING LABELS (suggest a better label using the type / name / placeholder / section if you can):
${fieldLines || "  (none)"}

SUSPICIOUS CANDIDATES (DOM elements that look form-like but weren't first-class inputs — decide if each is really a field; if yes, give it a label + a sensible HTML input type):
${candidateLines || "  (none)"}

Rules:
- Labels should be short noun-phrases ("Email address", "Date of birth", "Street").
- Types should be one of: text, email, tel, number, date, textarea, select, checkbox, radio.
- A candidate is a field only if a human filling the form would type a value into it. Decorative spans, action buttons, and structural containers are NOT fields.
- If you're not sure, leave the candidate out of promotions. Better to under-promote than to add noise.
- Never invent ids; reuse the exact ids shown above.

Return JSON of this shape:
{
  "corrections": [ { "id": "<field id>", "label": "<better label>" } ],
  "promotions":  [ { "id": "<candidate id>", "label": "<label>", "type": "<input type>" } ]
}`;

  try {
    const raw = await generateJson<{
      corrections?: { id: string; label?: string }[];
      promotions?: { id: string; label: string; type: string; section?: string }[];
    }>(cfg, { prompt });

    const corrections: DetectionEnrichment["corrections"] = {};
    for (const c of raw?.corrections ?? []) {
      if (!c?.id) continue;
      // Only apply corrections to ids we actually sent.
      if (!fields.some((f) => f.id === c.id)) continue;
      if (c.label && c.label.trim().length >= 2) {
        corrections[c.id] = { label: c.label.trim() };
      }
    }

    const candidateIds = new Set(candidates.map((c) => c.id));
    const promotions: DetectionEnrichment["promotions"] = [];
    for (const p of raw?.promotions ?? []) {
      if (!p?.id || !candidateIds.has(p.id)) continue;
      if (!p.label || !p.type) continue;
      promotions.push({
        id: p.id,
        label: p.label.trim(),
        type: p.type.trim(),
        section: candidates.find((c) => c.id === p.id)?.section,
      });
    }
    return { corrections, promotions };
  } catch (err) {
    console.warn("[OctoVault detect] enrichment failed; falling back to DOM-only:", err);
    return { corrections: {}, promotions: [] };
  }
}
