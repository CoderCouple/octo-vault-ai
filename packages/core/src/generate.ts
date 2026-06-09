// AI-generated content for "open" form fields (Phase F2-F4).
//
// Profile-lookup matching (match.ts) only fills fields whose value
// is already in the user's vault. Real-world forms ask the user to
// write things — "Tell us why you want to visit", "Reason for
// renewal", "Describe your symptoms". Those need *generated* drafts
// the user reviews and approves.
//
// Inputs:
//   - cfg: Ollama config (qwen3:8b)
//   - openFields: fields the caller decided need generation; usually
//     textareas with no profile match, or radios whose option set the
//     LLM should pick from
//   - intent: a sentence or two the user provided describing what
//     they're filling out (e.g. "10-day family trip to Toronto in
//     May 2026"). Persisted per FormSession; passed in by the caller.
//   - profileSummary: the same key/value lookup matchFormFields uses,
//     so generated text can reference the user's name, DOB, etc. We
//     do NOT pass anything sensitive (SSN, etc.) — the caller is
//     responsible for filtering.
//
// Output: a draft string per field, plus a "confidence" hint and the
// reason (for the HUD). Drafts NEVER auto-fill; the content script
// shows them for approval.

import { generateJson, type OllamaConfig } from "./ollama";
import type { DetectedField } from "./match";

export interface OpenField {
  field: DetectedField;
  // Options visible to the user — populated for radio / select
  // fields so the LLM can pick one. Empty for free-text fields.
  options?: string[];
  // maxlength attribute if present — keeps drafts from overshooting.
  maxLength?: number;
}

export interface FieldDraft {
  fieldId: string;
  draft: string;
  reason: string;                  // human-readable explanation
  confidence: "high" | "medium" | "low";
}

// Heuristic — decide which fields look like generation candidates
// without involving the LLM. Called from the content script BEFORE
// the match step, so the matcher and generator each see only their
// own work.
//
// A field is open if any of:
//   - <textarea> with no profile match expected
//   - <input type="text"> whose label ends with "?" (question)
//   - radio / select where matching couldn't pick from the profile
//     because the answer depends on intent, not data
export function isLikelyOpenField(f: DetectedField, hasOptions: boolean): boolean {
  if (f.type === "textarea") return true;
  if (hasOptions && (f.type === "radio" || f.type === "select")) return true;
  if (f.type === "text") {
    const l = f.label?.trim() ?? "";
    if (l.endsWith("?")) return true;
    if (/\b(describe|explain|reason|details?|why|how|what|tell us)\b/i.test(l)) return true;
  }
  return false;
}

export async function generateFieldDrafts(
  cfg: OllamaConfig | null,
  openFields: OpenField[],
  intent: string,
  profileSummary: Record<string, string>,
): Promise<FieldDraft[]> {
  if (!cfg || openFields.length === 0) return [];

  // Compact profile — just key=value, no canonical metadata. Drop any
  // empty values so the LLM doesn't see them.
  const profileLines = Object.entries(profileSummary)
    .filter(([, v]) => v && v.length > 0)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

  const fieldBlocks = openFields.map((o) => {
    const f = o.field;
    const sec = f.section ? ` (section: "${f.section}")` : "";
    const max = o.maxLength ? ` (max ${o.maxLength} characters)` : "";
    const opts = o.options?.length ? `\n    options:\n${o.options.map((x) => `      - ${x}`).join("\n")}` : "";
    return `  - id="${f.id}" type="${f.type}" label="${f.label}"${sec}${max}${opts}`;
  }).join("\n");

  const prompt = `You are drafting answers to open-ended form fields on behalf of a user. Return JSON only.

USER INTENT (what they're filling this form out about):
${intent || "(none provided — keep drafts generic and clearly editable)"}

USER PROFILE (key → value — refer to where relevant):
${profileLines || "  (empty)"}

OPEN FIELDS NEEDING A DRAFT:
${fieldBlocks}

Rules:
- Free-text drafts (type="textarea" or "text"): write a first-person, concise, ready-to-submit paragraph. Use the intent + profile facts verbatim where they apply. Do NOT emit bracket placeholders like "[start date]", "[your name]", "[city]" — if a specific detail is unknown, write around it naturally ("I will be staying with family" not "I will be staying with [host]"). Stay within the character limit. Match the form's register (government form → formal; product feedback → casual).
- Choice drafts (type="radio" or "select"): pick exactly one of the supplied options that best fits the intent + profile. The draft string must equal one of the option strings character-for-character (whitespace-normalized).
- If the intent gives you no basis for the field, return an empty string and "confidence": "low" — the HUD will mark it for the user.
- Never include explanations, prefixes, quotes around the answer, or "Draft:" / "Answer:" labels. Output just the value.

Return JSON: { "drafts": [ { "id": "<field id>", "draft": "<text>", "reason": "<short note>", "confidence": "high"|"medium"|"low" } ] }`;

  try {
    const raw = await generateJson<{
      drafts?: { id: string; draft?: string; reason?: string; confidence?: "high" | "medium" | "low" }[];
    }>(cfg, { prompt });
    const out: FieldDraft[] = [];
    const fieldsById = new Map(openFields.map((o) => [o.field.id, o]));
    for (const d of raw?.drafts ?? []) {
      if (!d?.id || !fieldsById.has(d.id)) continue;
      const draft = (d.draft ?? "").trim();
      const reason = (d.reason ?? "drafted from intent + profile").trim();
      const confidence = d.confidence ?? (draft ? "medium" : "low");
      // Sanity: choice fields must match an option string. The matcher
      // upstream filters to exact-or-normalized matches; here we just
      // pass it through with the confidence the model gave.
      out.push({ fieldId: d.id, draft, reason, confidence });
    }
    return out;
  } catch (err) {
    console.warn("[OctoVault generate] draft generation failed:", err);
    return [];
  }
}
