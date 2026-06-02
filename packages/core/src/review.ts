// Phase 2 of extraction sanitization: an LLM self-review pass.
//
// After Phase 1's deterministic cleanup, hand the model BOTH the
// original document text and the (sanitized) candidates it produced
// and ask it to flag anything that looks wrong: hallucinated values,
// wrong entity attribution, misread digits in IDs, confused
// first / last name, etc.
//
// One extra LLM call per import. Cheaper than asking the user to
// audit every fact by hand and catches semantic mistakes the
// deterministic pass cannot see.

import { generateJson, type OllamaConfig } from "./ollama";
import type { FieldCandidate } from "./schema";

interface ReviewEntry {
  id: string;
  fieldKey: string;
  value: string;
  excerpt?: string;
}

interface ReviewVerdict {
  id: string;
  action: "confirm" | "reject" | "correct";
  correctedValue?: string;
  reason?: string;
}

interface ReviewResponse {
  verdicts: ReviewVerdict[];
  entityNameOk?: boolean;
  suggestedEntityName?: string;
  entityReason?: string;
}

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          action: { type: "string", enum: ["confirm", "reject", "correct"] },
          correctedValue: { type: "string" },
          reason: { type: "string" },
        },
        required: ["id", "action"],
      },
    },
    entityNameOk: { type: "boolean" },
    suggestedEntityName: { type: "string" },
    entityReason: { type: "string" },
  },
  required: ["verdicts"],
};

export interface ReviewResult {
  kept: Omit<FieldCandidate, "entityId">[];
  rejected: Array<{ fieldKey: string; value: string; reason?: string }>;
  corrected: Array<{ fieldKey: string; from: string; to: string; reason?: string }>;
  entityName: string | null;
  entityNameChanged: boolean;
  entityReason?: string;
}

export async function reviewExtraction(
  cfg: OllamaConfig,
  text: string,
  candidates: Omit<FieldCandidate, "entityId">[],
  entityName: string | null,
): Promise<ReviewResult> {
  if (candidates.length === 0 && !entityName) {
    return { kept: [], rejected: [], corrected: [], entityName, entityNameChanged: false };
  }

  const truncated = text.slice(0, 12_000);
  const entries: ReviewEntry[] = candidates.map((c) => ({
    id: c.id,
    fieldKey: c.fieldKey,
    value: c.value,
    excerpt: c.source.excerpt,
  }));

  const prompt = `Here is the text of a personal document:
"""
${truncated}
"""

A first-pass extractor produced these field values${entityName ? ` and attributed the document to "${entityName}"` : ""}:

${JSON.stringify({ entityName, fields: entries }, null, 2)}

Review each entry against the source text. For each entry, return ONE verdict:
- "confirm": the value is correct and supported by the document.
- "reject": the value is wrong, fabricated, or refers to a different person — and cannot be salvaged.
- "correct": the value is close but needs a fix; include "correctedValue".

Also evaluate the entityName: set entityNameOk=true if the attribution is right. Otherwise set entityNameOk=false and suggestedEntityName to the correct person.

Be strict. Common failure modes to look for:
- ID numbers (passport, SSN) where a digit was misread by OCR.
- Names where country codes (USA, IND, GBR, etc.) or middle initials were glued to the surname.
- Fields belonging to a DIFFERENT person on the same page (e.g., the parent's name on a child's passport).
- Values copied verbatim from form labels rather than the user's actual data.

Return JSON only:
{
  "verdicts": [ { "id": "<entry id>", "action": "confirm"|"reject"|"correct", "correctedValue": "<only if correct>", "reason": "<short>" }, ... ],
  "entityNameOk": <bool>,
  "suggestedEntityName": "<only if not ok>",
  "entityReason": "<short, only if not ok>"
}`;

  let review: ReviewResponse;
  try {
    review = await generateJson<ReviewResponse>(cfg, {
      system: "You are an extraction-QA reviewer. Be strict and return JSON only.",
      prompt,
      format: REVIEW_SCHEMA,
    });
  } catch (e) {
    // Reviewer failed — keep originals, don't block the import.
    console.warn("[review] LLM review failed; keeping originals:", e);
    return { kept: candidates, rejected: [], corrected: [], entityName, entityNameChanged: false };
  }

  const verdictById = new Map(review.verdicts.map((v) => [v.id, v]));
  const kept: Omit<FieldCandidate, "entityId">[] = [];
  const rejected: ReviewResult["rejected"] = [];
  const corrected: ReviewResult["corrected"] = [];

  for (const c of candidates) {
    const v = verdictById.get(c.id);
    if (!v || v.action === "confirm") { kept.push(c); continue; }
    if (v.action === "reject") {
      rejected.push({ fieldKey: c.fieldKey, value: c.value, reason: v.reason });
      continue;
    }
    if (v.action === "correct" && v.correctedValue && v.correctedValue.trim() && v.correctedValue !== c.value) {
      corrected.push({ fieldKey: c.fieldKey, from: c.value, to: v.correctedValue, reason: v.reason });
      kept.push({
        ...c,
        value: v.correctedValue.trim(),
        normalizedValue: v.correctedValue.trim().toLowerCase(),
        // Corrected values lose any "high" confidence — the first
        // pass got them wrong, so the corrected version is at most
        // "medium".
        confidence: c.confidence === "high" ? "medium" : c.confidence,
      });
    } else {
      kept.push(c);
    }
  }

  const newEntityName =
    review.entityNameOk === false && review.suggestedEntityName?.trim()
      ? review.suggestedEntityName.trim()
      : entityName;

  return {
    kept, rejected, corrected,
    entityName: newEntityName,
    entityNameChanged: !!entityName && newEntityName !== entityName,
    entityReason: review.entityReason,
  };
}
