// Map web-page form fields to ProfileKeys using heuristics first, then
// LLM as a tiebreaker for unresolved ones. Reads from canonical values
// of records.

import { generateJson, type OllamaConfig } from "./ollama";
import { PROFILE_FIELDS, type Profile, type ProfileKey, type VaultProfile } from "./schema";

// Pick one entity's profile to fill a form with. For now: "self" if it
// exists, otherwise the first profile with the most data. Multi-entity
// form fill (one form for spouse, one for kid) is a future UI flow.
export function chooseFillProfile(vault: VaultProfile): { entityId: string; profile: Profile } | null {
  const entries = Object.entries(vault);
  if (entries.length === 0) return null;
  const self = entries.find(([id]) => id === "self");
  if (self) return { entityId: self[0], profile: self[1] };
  const sorted = entries.sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length);
  return { entityId: sorted[0][0], profile: sorted[0][1] };
}

export interface DetectedField {
  id: string;
  label: string;
  name: string;
  type: string;
  placeholder: string;
  autocomplete: string;
}

export interface FieldMatch {
  fieldId: string;
  profileKey: ProfileKey | null;
  confidence: "high" | "medium" | "low";
  source: "heuristic" | "llm";
  conflicted: boolean;          // canonical value comes from a conflicted record
}

const AUTOCOMPLETE_MAP: Record<string, ProfileKey> = {
  "given-name": "firstName",
  "additional-name": "middleName",
  "family-name": "lastName",
  "name": "fullName",
  "email": "email",
  "tel": "phone",
  "tel-national": "phone",
  "street-address": "addressLine1",
  "address-line1": "addressLine1",
  "address-line2": "addressLine2",
  "address-level1": "state",
  "address-level2": "city",
  "postal-code": "postalCode",
  "country": "country",
  "country-name": "country",
  "bday": "dateOfBirth",
  "sex": "gender",
  "organization": "employerName",
  "organization-title": "jobTitle",
};


export async function matchFormFields(
  cfg: OllamaConfig | null,
  fields: DetectedField[],
  profile: Profile
): Promise<FieldMatch[]> {
  const matches: FieldMatch[] = [];
  const unresolved: DetectedField[] = [];

  // Only the most reliable signals bypass the LLM:
  //   1. HTML autocomplete attribute (gold standard)
  //   2. input type="email" or type="tel"
  // Everything else — including keyword guesses — defers to the LLM,
  // which sees the full profile and can match semantically.
  for (const f of fields) {
    const ac = f.autocomplete?.toLowerCase().trim();
    if (ac && AUTOCOMPLETE_MAP[ac] && profile[AUTOCOMPLETE_MAP[ac]]) {
      const key = AUTOCOMPLETE_MAP[ac];
      matches.push({
        fieldId: f.id, profileKey: key, confidence: "high", source: "heuristic",
        conflicted: profile[key]!.conflictState !== "none",
      });
      continue;
    }
    if (f.type === "email" && profile["email"]) {
      matches.push({
        fieldId: f.id, profileKey: "email" as ProfileKey, confidence: "high", source: "heuristic",
        conflicted: profile["email"]!.conflictState !== "none",
      });
      continue;
    }
    if (f.type === "tel" && profile["phone"]) {
      matches.push({
        fieldId: f.id, profileKey: "phone" as ProfileKey, confidence: "high", source: "heuristic",
        conflicted: profile["phone"]!.conflictState !== "none",
      });
      continue;
    }
    unresolved.push(f);
  }

  if (unresolved.length === 0 || !cfg) {
    for (const f of unresolved) {
      matches.push({ fieldId: f.id, profileKey: null, confidence: "low", source: "heuristic", conflicted: false });
    }
    return matches;
  }

  const available = Object.keys(profile) as ProfileKey[];
  if (available.length === 0) {
    for (const f of unresolved) {
      matches.push({ fieldId: f.id, profileKey: null, confidence: "low", source: "llm", conflicted: false });
    }
    return matches;
  }

  // Build a lookup the model can semantically match against: profile key
  // + its human label + an example value (the canonical). This is far
  // more useful than the bare key list — qwen3 can now see that
  // "fullName" actually holds "Sunil Tiwari" and decide accordingly.
  const profileLines = available.map((k) => {
    const record = profile[k];
    const canonicalId = record?.canonicalId;
    const value = record?.candidates.find((c) => c.id === canonicalId)?.value ?? "";
    const label = PROFILE_FIELDS.find((f) => f.key === k)?.label ?? k;
    return `- ${k} (${label}): "${value}"`;
  }).join("\n");

  const fieldLines = unresolved.map((f) =>
    `- id="${f.id}"  label="${f.label}"  name="${f.name}"  type="${f.type}"  placeholder="${f.placeholder}"`
  ).join("\n");

  const prompt = `You are mapping web form fields to a user's profile. Return JSON only — no prose.

USER PROFILE (key → label : current value):
${profileLines}

FORM FIELDS TO MATCH:
${fieldLines}

For each form field, output an entry: { "id": "<field id>", "key": "<profile key>" or null, "confidence": "high"|"medium"|"low" }.

Matching rules:
- Be aggressive when the field clearly asks for a known profile value, but
  respect the input type:
  - type="time"  only matches time-of-day (HH:MM), NOT calendar dates
  - type="date"  only matches calendar dates
  - type="email" only matches email-shaped values
  - type="tel"   only matches phone numbers
  - type="number" / "range" only matches numeric values
- If no profile key has a value with the right shape for the input type,
  return null even if the label sounds related.
- Examples:
  - "Customer name" / "Full name" / "Your name" → fullName
  - "Telephone" / "Phone number" / "Mobile" → phone
  - "E-mail address" / "Email" / "Contact email" → email
  - "ZIP" / "Postal" / "PIN code" → postalCode
  - "Street" / "Address line 1" / "Residential address" → addressLine1
  - "DOB" / "Date of birth" / "Birthday" → dateOfBirth
- Use null for fields that genuinely don't map (radio choices, pizza
  toppings, terms checkboxes, free-form notes/comments).
- Never invent profile keys outside the list above.

Return: { "matches": [...] }`;

  try {
    console.log("[OctoVault matcher] LLM prompt:\n", prompt);
    const raw = await generateJson<{ matches: { id: string; key: string | null; confidence: "high" | "medium" | "low" }[] }>(cfg, { prompt });
    console.log("[OctoVault matcher] LLM raw response:", raw);
    if (!raw?.matches || !Array.isArray(raw.matches)) {
      console.warn("[OctoVault matcher] LLM returned no matches array");
      for (const f of unresolved) {
        matches.push({ fieldId: f.id, profileKey: null, confidence: "low", source: "llm", conflicted: false });
      }
      return matches;
    }
    for (const m of raw.matches) {
      const key = m.key && (available as string[]).includes(m.key) ? (m.key as ProfileKey) : null;
      if (m.key && !key) {
        console.warn(`[OctoVault matcher] LLM returned unknown key "${m.key}" for field ${m.id}`);
      }
      matches.push({
        fieldId: m.id,
        profileKey: key,
        confidence: m.confidence ?? "low",
        source: "llm",
        conflicted: key ? profile[key]!.conflictState !== "none" : false,
      });
    }
    // Fill in any unresolved field the LLM omitted.
    for (const f of unresolved) {
      if (!matches.some((m) => m.fieldId === f.id)) {
        matches.push({ fieldId: f.id, profileKey: null, confidence: "low", source: "llm", conflicted: false });
      }
    }
  } catch (err) {
    console.error("[OctoVault matcher] LLM call failed:", err);
    for (const f of unresolved) {
      matches.push({ fieldId: f.id, profileKey: null, confidence: "low", source: "llm", conflicted: false });
    }
  }
  return matches;
}
