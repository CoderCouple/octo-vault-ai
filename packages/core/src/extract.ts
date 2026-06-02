// Turn a document's text into structured profile-field candidates and
// a document-type classification. One Ollama call returns the docType,
// the entity hint (whose document this is), and the field values.

import { generateJson, type OllamaConfig } from "./ollama";
import { normalizeValue } from "./resolver";
import {
  PROFILE_FIELDS,
  type DocType,
  type EducationRecord,
  type ExperienceRecord,
  type FieldCandidate,
  type ProfileKey,
  type Relationship,
} from "./schema";

const SYSTEM = `You are an on-device assistant that classifies a personal document, identifies
whose document it is, and extracts identity fields from it. Return JSON only — no prose.
Use only what the document explicitly contains. Do not invent values. For confidence: "high"
if explicit and unambiguous, "medium" if implied or abbreviated, "low" if uncertain. Omit
fields you cannot support.`;

const DOC_TYPES: DocType[] = [
  "passport", "drivers_license", "national_id", "ssn_card", "tax_form", "paystub",
  "utility_bill", "bank_statement", "insurance_card", "lease", "vehicle_registration",
  "school_letter", "employment_letter", "medical_record", "unknown",
];

const RELATIONSHIPS: Relationship[] = ["self", "spouse", "partner", "child", "parent", "sibling", "dependent", "other"];

// JSON Schema passed to Ollama's `format` parameter. Constrains the
// model to a valid shape — far more reliable than asking nicely in the
// prompt. Requires Ollama 0.5+.
export function extractionSchema(): object {
  const fieldEntry = {
    type: "object",
    properties: {
      value: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      excerpt: { type: "string" },
    },
    required: ["value", "confidence"],
  };
  const fieldsProps: Record<string, object> = {};
  for (const f of PROFILE_FIELDS) fieldsProps[f.key] = fieldEntry;

  return {
    type: "object",
    properties: {
      docType: { type: "string", enum: DOC_TYPES },
      entityName: { type: ["string", "null"] },
      relationshipHint: { type: "string", enum: RELATIONSHIPS },
      fields: {
        type: "object",
        properties: fieldsProps,
        additionalProperties: false,
      },
      education: {
        type: "array",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            degree: { type: "string" },
            field: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            location: { type: "string" },
            gpa: { type: "string" },
            honors: { type: "string" },
            excerpt: { type: "string" },
          },
          required: ["institution"],
        },
      },
      experience: {
        type: "array",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            role: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            location: { type: "string" },
            description: { type: "string" },
            excerpt: { type: "string" },
          },
          required: ["company", "role"],
        },
      },
    },
    required: ["docType", "entityName", "fields"],
  };
}

interface ExtractedEntry {
  value: string;
  confidence: "high" | "medium" | "low";
  excerpt?: string;
  page?: number;
}

interface ExtractedEducation {
  institution: string;
  degree?: string;
  field?: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  gpa?: string;
  honors?: string;
  excerpt?: string;
}

interface ExtractedExperience {
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  description?: string;
  excerpt?: string;
}

interface ExtractionResponse {
  docType: DocType;
  entityName: string | null;
  relationshipHint?: Relationship;
  fields: Partial<Record<ProfileKey, ExtractedEntry>>;
  education?: ExtractedEducation[];
  experience?: ExtractedExperience[];
}

export interface ExtractionResult {
  docType: DocType;
  entityName: string | null;
  relationshipHint?: Relationship;
  // Candidates *without* entityId — the caller assigns it after
  // resolving the entity.
  candidates: Omit<FieldCandidate, "entityId">[];
  education: Omit<EducationRecord, "entityId">[];
  experience: Omit<ExperienceRecord, "entityId">[];
}

export async function extractFromText(
  cfg: OllamaConfig,
  documentId: string,
  text: string
): Promise<ExtractionResult> {
  const truncated = text.slice(0, 14_000);

  const fieldList = PROFILE_FIELDS
    .map((f) => `- ${f.key}: ${f.label} (a.k.a. ${f.aliases.join(", ")})`)
    .join("\n");

  const prompt = `Document text:
"""
${truncated}
"""

1) Classify the document into one of: ${DOC_TYPES.join(", ")}.
2) Identify the person this document is primarily about. Return their full name as it
   appears in the document (e.g., "Payal Tiwari", "Katha Tiwari", "Sunil Tiwari"). If no
   person is identifiable, return null.
3) Optionally, suggest a relationship hint from: ${RELATIONSHIPS.join(", ")}. This is
   only your guess based on the document type and content; the user will confirm.
4) Extract a subset of the following fields, supported by evidence in the text.

Fields:
${fieldList}

5) If the document mentions education (degrees, schools, transcripts) or work
   experience (jobs, roles, employers), extract those as repeating records.

Return JSON of this exact shape:
{
  "docType": "<one of the document types>",
  "entityName": "<full name of the person> or null",
  "relationshipHint": "<one of the relationships> (optional)",
  "fields": {
    "<fieldKey>": { "value": "<string>", "confidence": "high"|"medium"|"low", "excerpt": "<short verbatim snippet>", "page": <page number if known> }
  },
  "education": [
    { "institution": "...", "degree": "Bachelor's|Master's|PhD|Diploma|...", "field": "...", "startDate": "YYYY-MM or YYYY", "endDate": "YYYY-MM or YYYY", "location": "...", "gpa": "...", "honors": "...", "excerpt": "..." }
  ],
  "experience": [
    { "company": "...", "role": "...", "startDate": "YYYY-MM or YYYY", "endDate": "YYYY-MM or YYYY or empty for current", "location": "...", "description": "...", "excerpt": "..." }
  ]
}

Rules:
- Use a field key only from the list above. Never invent keys.
- Always include the source excerpt; the user must be able to verify it.
- Prefer omitting a field over guessing.
- Education/experience arrays are optional — omit if not mentioned.`;

  const raw = await generateJson<ExtractionResponse>(cfg, {
    system: SYSTEM, prompt,
    format: extractionSchema(),  // Ollama 0.5+ structured outputs
  });
  const docType: DocType = DOC_TYPES.includes(raw.docType) ? raw.docType : "unknown";
  const entityName = (raw.entityName ?? "").trim() || null;
  const relationshipHint = raw.relationshipHint && RELATIONSHIPS.includes(raw.relationshipHint)
    ? raw.relationshipHint : undefined;

  const now = Date.now();
  const candidates: Omit<FieldCandidate, "entityId">[] = [];

  for (const f of PROFILE_FIELDS) {
    const entry = raw.fields?.[f.key];
    if (!entry?.value) continue;
    const value = String(entry.value).trim();
    if (!value) continue;
    candidates.push({
      id: crypto.randomUUID(),
      fieldKey: f.key,
      value,
      normalizedValue: normalizeValue(f.key, value),
      confidence: entry.confidence ?? "medium",
      source: { documentId, excerpt: entry.excerpt, page: entry.page },
      docType,
      extractedAt: now,
      userEdited: false,
    });
  }

  const education: Omit<EducationRecord, "entityId">[] = (raw.education ?? [])
    .filter((e) => e?.institution?.trim())
    .map((e) => ({
      id: crypto.randomUUID(),
      institution: e.institution.trim(),
      degree: e.degree?.trim(),
      field: e.field?.trim(),
      startDate: e.startDate?.trim(),
      endDate: e.endDate?.trim(),
      location: e.location?.trim(),
      gpa: e.gpa?.trim(),
      honors: e.honors?.trim(),
      source: { documentId, excerpt: e.excerpt },
      extractedAt: now,
      userEdited: false,
    }));

  const experience: Omit<ExperienceRecord, "entityId">[] = (raw.experience ?? [])
    .filter((e) => e?.company?.trim() && e?.role?.trim())
    .map((e) => ({
      id: crypto.randomUUID(),
      company: e.company.trim(),
      role: e.role.trim(),
      startDate: e.startDate?.trim(),
      endDate: e.endDate?.trim(),
      location: e.location?.trim(),
      description: e.description?.trim(),
      source: { documentId, excerpt: e.excerpt },
      extractedAt: now,
      userEdited: false,
    }));

  return { docType, entityName, relationshipHint, candidates, education, experience };
}
