// Turn a document's text into structured profile-field candidates and
// a document-type classification. One Ollama call returns the docType,
// the entity hint (whose document this is), and the field values.

import { generateJson, type OllamaConfig } from "./ollama";
import { normalizeValue } from "./resolver";
import { sanitizeCandidates, sanitizeEntityName, type SanitizationReport } from "./sanitize";
import { reviewExtraction } from "./review";
import {
  PROFILE_FIELDS,
  type DocType,
  type EducationRecord,
  type EventType,
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
  "passport", "drivers_license", "national_id", "ssn_card",
  "marriage_certificate", "marriage_license", "divorce_decree",
  "birth_certificate", "adoption_record", "death_certificate", "court_order",
  "i797_approval_notice", "visa_stamp", "green_card",
  "naturalization_certificate", "i94_record", "ead_card",
  "tax_form", "paystub", "voe_letter", "bank_statement",
  "utility_bill", "lease",
  "insurance_card", "vehicle_registration",
  "school_letter", "employment_letter", "medical_record",
  "unknown",
];

const RELATIONSHIPS: Relationship[] = ["self", "spouse", "partner", "child", "parent", "sibling", "dependent", "other"];

// Per-type extraction hints. When the document classifier picks one of
// these types, we append the matching hint to the prompt so the LLM
// knows what specific fields to look for. Without these, the LLM falls
// back to "extract any of the 50 known fields" — which misses
// type-specific things like I-797 validity dates or marriage dates.
const DOC_TYPE_HINTS: Partial<Record<DocType, string>> = {
  i797_approval_notice: `This is a USCIS I-797 Approval Notice. Capture every one of:
- visaType (H-1B, L-1, O-1, EB-1, etc.)
- visaReceiptNumber (3-letter prefix + 10 digits, e.g., EAC1234567890)
- visaBeneficiary (the person on the notice)
- visaPetitioner (the sponsoring employer)
- visaValidFrom and visaValidUntil (validity period — critical)
- employerName (often same as petitioner for H-1B)`,
  visa_stamp: `This is a visa stamp from a passport. Capture: visaType, visaValidFrom, visaValidUntil, visaPetitioner if shown.`,
  green_card: `This is a US Permanent Resident Card (Green Card). Capture: greenCardNumber (USCIS#), greenCardCategory (preference category), fullName, dateOfBirth, nationality.`,
  naturalization_certificate: `This is a US Certificate of Naturalization. Capture: fullName, dateOfBirth, naturalizationDate (date of citizenship), nationality (will be USA).`,
  i94_record: `This is an I-94 Arrival/Departure Record. Capture: i94Number, i94ExpiryDate (admit-until date), visaType (class of admission).`,
  ead_card: `This is a USCIS Employment Authorization Document. Capture: fullName, dateOfBirth, visaValidFrom, visaValidUntil.`,
  marriage_certificate: `This is a marriage certificate. Capture every one of:
- fullName (the person whose vault this is in, or the first-named spouse)
- spouseName (the other spouse's full name)
- spouseDateOfBirth (if shown)
- marriageDate (the wedding date)
- marriagePlace (city, state, country)
- marriageCertificateNumber`,
  marriage_license: `This is a marriage license (not the post-wedding certificate). Capture: fullName, spouseName, marriageDate, marriagePlace, marriageCertificateNumber.`,
  divorce_decree: `This is a divorce decree. Capture: fullName, spouseName, and any other identifying details.`,
  birth_certificate: `This is a birth certificate. Capture every one of:
- fullName (the person born)
- firstName, middleName, lastName
- dateOfBirth, placeOfBirth, gender
- fatherName (father's full name)
- motherName (mother's full name, often maiden name)`,
  adoption_record: `This is an adoption record. Capture: fullName (the adopted person), fatherName, motherName (adoptive parents), any dates.`,
  death_certificate: `This is a death certificate. Capture: fullName, dateOfBirth, and the date of death if shown.`,
  court_order: `This is a court order. Capture: fullName of any subjects, and any dates or case numbers.`,
  voe_letter: `This is a Verification of Employment letter. Capture: fullName (the employee), employerName, jobTitle, employmentStartDate, employmentEndDate (if shown), annualSalary.`,
};

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
      // Long-tail fields outside the typed schema. LLM proposes
      // {label, value, confidence, excerpt?} for anything useful it
      // finds whose key isn't in the known list — e.g., a pet's
      // microchip number, an HOA dues amount, a foreign-government
      // ID type we don't model yet.
      extras: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            excerpt: { type: "string" },
          },
          required: ["label", "value", "confidence"],
        },
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

// Hybrid schema (Phase 2): LLM can also propose fields outside the
// hardcoded PROFILE_FIELDS list as "extras." Stored separately, indexed
// for retrieval, but not strongly typed and not in DOC_AUTHORITY. Lets
// us capture the long tail (HOA dues, pet records, foreign-government
// IDs, religious certificates, etc.) without losing the type safety
// on the ~50 core fields.
interface ExtractedExtra {
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  excerpt?: string;
}

export interface ExtraFact {
  id: string;
  label: string;
  value: string;
  confidence: "high" | "medium" | "low";
  source: { documentId: string; page?: number; excerpt?: string };
  extractedAt: number;
}

// Name-based relationship suggestion the extractor derives from a
// civil-status doc. The caller resolves `otherName` to an existing
// entity (or creates a new one) and then saves a RelationshipEdge.
// Why name-based: extract.ts doesn't have entity-id context. The
// caller (Documents.tsx) does have access to the storage adapter +
// resolveEntityFromName helper, so resolution + save happen there.
export interface InferredRelationship {
  // The other person's full name as it appears in the document.
  otherName: string;
  // Kind of edge to create. Spouse for marriages, parent for births /
  // adoptions, etc. Matches RelationshipKind in schema.ts.
  kind: "spouse" | "parent" | "child";
  // What doc the inference came from — preserved as the edge source.
  sourceDocId: string;
  // Short verbatim snippet for provenance.
  excerpt?: string;
}

// Name-based event suggestion. Same resolution pattern as
// InferredRelationship — Documents.tsx resolves participant names
// to entity ids before saving an Event row.
export interface InferredEventParticipant {
  name: string;
  role: "subject" | "spouse" | "parent" | "child" | "officiant" | "witness" | "other";
}
export interface InferredEvent {
  type: EventType;
  participants: InferredEventParticipant[];
  date?: string;
  endDate?: string;
  place?: string;
  attributes?: Record<string, string>;
  sourceDocId: string;
  excerpt?: string;
}

interface ExtractionResponse {
  docType: DocType;
  entityName: string | null;
  relationshipHint?: Relationship;
  fields: Partial<Record<ProfileKey, ExtractedEntry>>;
  extras?: ExtractedExtra[];
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
  // Long-tail fields the LLM proposed outside the typed schema.
  // Indexed for retrieval (via embeddings) but not part of the
  // canonical Profile until Phase 4 unifies them.
  extras: ExtraFact[];
  // Relationships the doc establishes — e.g., a marriage certificate
  // emits a spouse edge between the primary subject and the named
  // spouse. Name-based; caller resolves to entity ids and saves.
  inferredRelationships: InferredRelationship[];
  // First-class events the doc describes — marriages, births, deaths,
  // naturalizations, etc. Participants are name-based; the caller
  // resolves to entity ids and saves Event rows.
  inferredEvents: InferredEvent[];
  education: Omit<EducationRecord, "entityId">[];
  experience: Omit<ExperienceRecord, "entityId">[];
  // What sanitization did to the raw LLM output. Useful for the
  // import-progress UI and for debugging extraction quality.
  sanitization?: SanitizationReport;
  // What the LLM-review pass did (rejections, corrections, entity-name
  // re-attribution). Null if the review was skipped or failed.
  review?: {
    rejected: number;
    corrected: number;
    entityNameChanged: boolean;
    entityReason?: string;
  };
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

  // Compact per-type hint table — the LLM consults this AFTER it picks
  // its docType to know which specific fields are most important for
  // that type. Without these, generic extraction misses things like
  // I-797 validity dates or marriage dates.
  const hintsBlock = Object.entries(DOC_TYPE_HINTS)
    .map(([type, hint]) => `### If docType = "${type}":\n${hint}`)
    .join("\n\n");

  const prompt = `Document text:
"""
${truncated}
"""

1) Classify the document into one of: ${DOC_TYPES.join(", ")}.
2) Identify the person this document is primarily about. Return their full name as it
   appears in the document (e.g., "Payal Tiwari", "Katha Tiwari", "Sunil Tiwari"). If no
   person is identifiable, return null.
3) Optionally, suggest a relationship hint from: ${RELATIONSHIPS.join(", ")}.
4) Extract every applicable field below from the document. Use a fieldKey ONLY from
   the list. If you classified the doc as one of the types in the hints block at the
   bottom, make sure you capture all the fields named in the matching hint.

Known fields (use these keys exactly):
${fieldList}

5) For any genuinely useful fact the document contains that doesn't fit a known
   fieldKey above (e.g., HOA dues, pet microchip number, foreign-government ID
   types we don't model, religious-record identifiers), add it to "extras" with a
   short human-readable label and the value. Don't dump boilerplate into extras —
   only structured facts a person might later search for.

6) If the document mentions education (degrees, schools, transcripts) or work
   experience (jobs, roles, employers), extract those as repeating records.

Return JSON of this exact shape:
{
  "docType": "<one of the document types>",
  "entityName": "<full name of the person> or null",
  "relationshipHint": "<one of the relationships> (optional)",
  "fields": {
    "<fieldKey>": { "value": "<string>", "confidence": "high"|"medium"|"low", "excerpt": "<short verbatim snippet>", "page": <page number if known> }
  },
  "extras": [
    { "label": "<human label>", "value": "<string>", "confidence": "high"|"medium"|"low", "excerpt": "<short snippet>" }
  ],
  "education": [
    { "institution": "...", "degree": "Bachelor's|Master's|PhD|Diploma|...", "field": "...", "startDate": "YYYY-MM or YYYY", "endDate": "YYYY-MM or YYYY", "location": "...", "gpa": "...", "honors": "...", "excerpt": "..." }
  ],
  "experience": [
    { "company": "...", "role": "...", "startDate": "YYYY-MM or YYYY", "endDate": "YYYY-MM or YYYY or empty for current", "location": "...", "description": "...", "excerpt": "..." }
  ]
}

Per-type extraction priorities (use the one matching your classification):

${hintsBlock}

Rules:
- For "fields": use a fieldKey only from the known list. Never invent keys here.
- For "extras": labels are free-form; use them for facts that don't fit a known key.
- Always include the source excerpt; the user must be able to verify it.
- Prefer omitting a field over guessing.
- Education/experience/extras arrays are optional — omit if not mentioned.`;

  const raw = await generateJson<ExtractionResponse>(cfg, {
    system: SYSTEM, prompt,
    format: extractionSchema(),  // Ollama 0.5+ structured outputs
  });
  const docType: DocType = DOC_TYPES.includes(raw.docType) ? raw.docType : "unknown";
  const entityName = sanitizeEntityName((raw.entityName ?? "").trim() || null);
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

  const { kept, report } = sanitizeCandidates(candidates);

  // Phase 2: LLM self-review. Runs only if there's anything worth
  // reviewing. Failure is non-fatal — we keep the sanitized output.
  let finalCandidates = kept;
  let finalEntityName = entityName;
  let reviewSummary: ExtractionResult["review"] | undefined;
  if (kept.length > 0 || entityName) {
    const reviewed = await reviewExtraction(cfg, truncated, kept, entityName);
    finalCandidates = reviewed.kept;
    finalEntityName = reviewed.entityName;
    reviewSummary = {
      rejected: reviewed.rejected.length,
      corrected: reviewed.corrected.length,
      entityNameChanged: reviewed.entityNameChanged,
      entityReason: reviewed.entityReason,
    };
  }

  // Build the extras array — long-tail fields the LLM proposed outside
  // the known fieldKey list. Stored separately, indexed for retrieval,
  // not part of canonical Profile (yet — Phase 4 unifies under Claim).
  const extras: ExtraFact[] = [];
  for (const e of raw.extras ?? []) {
    const label = String(e.label ?? "").trim();
    const value = String(e.value ?? "").trim();
    if (!label || !value) continue;
    extras.push({
      id: crypto.randomUUID(),
      label,
      value,
      confidence: e.confidence,
      source: { documentId, excerpt: e.excerpt },
      extractedAt: now,
    });
  }

  // Derive inferred relationships from the typed civil-status fields.
  // This is what makes the knowledge graph self-building: a marriage
  // certificate doesn't just store a `spouseName` field — it also
  // emits a Relationship row between the primary subject and the
  // named spouse. The caller (Documents.tsx) handles entity
  // resolution + the actual save.
  //
  // Why we read from finalCandidates (post-review) rather than the
  // raw response: review may have rejected a low-confidence
  // spouseName as a hallucination, and we don't want to emit a
  // spouse edge from a value we already rejected.
  const inferredRelationships: InferredRelationship[] = [];
  function fieldValue(key: ProfileKey): string | undefined {
    return finalCandidates.find((c) => c.fieldKey === key)?.value;
  }
  function pushRel(key: ProfileKey, kind: InferredRelationship["kind"]) {
    const v = fieldValue(key)?.trim();
    if (!v) return;
    const cand = finalCandidates.find((c) => c.fieldKey === key);
    inferredRelationships.push({
      otherName: v,
      kind,
      sourceDocId: documentId,
      excerpt: cand?.source.excerpt,
    });
  }
  if (docType === "marriage_certificate" || docType === "marriage_license") {
    pushRel("spouseName", "spouse");
  }
  if (docType === "divorce_decree") {
    // Still capture the (former) spouse so the user can see who the
    // doc references; the user can downgrade or delete the edge.
    pushRel("spouseName", "spouse");
  }
  if (docType === "birth_certificate" || docType === "adoption_record") {
    pushRel("fatherName", "parent");
    pushRel("motherName", "parent");
  }

  // Phase 4b — emit first-class Event nodes for civil-status / status-
  // change documents. Same pattern as inferredRelationships: name-based,
  // resolved + saved by the caller.
  const inferredEvents: InferredEvent[] = [];
  function pushEvent(_type: EventType, build: () => InferredEvent | null) {
    const e = build();
    if (e) inferredEvents.push(e);
  }
  const subjectName = finalEntityName?.trim();
  const spouseN = fieldValue("spouseName")?.trim();
  const fatherN = fieldValue("fatherName")?.trim();
  const motherN = fieldValue("motherName")?.trim();
  const marriageDate = fieldValue("marriageDate")?.trim();
  const marriagePlace = fieldValue("marriagePlace")?.trim();
  const dateOfBirth = fieldValue("dateOfBirth")?.trim();
  const placeOfBirth = fieldValue("placeOfBirth")?.trim();
  const naturalizationDate = fieldValue("naturalizationDate")?.trim();

  if (docType === "marriage_certificate" || docType === "marriage_license") {
    pushEvent("marriage", () => {
      if (!subjectName) return null;
      const participants: InferredEventParticipant[] = [{ name: subjectName, role: "subject" }];
      if (spouseN) participants.push({ name: spouseN, role: "spouse" });
      return {
        type: "marriage",
        participants,
        date: marriageDate,
        place: marriagePlace,
        sourceDocId: documentId,
      };
    });
  }
  if (docType === "divorce_decree") {
    pushEvent("divorce", () => {
      if (!subjectName) return null;
      const participants: InferredEventParticipant[] = [{ name: subjectName, role: "subject" }];
      if (spouseN) participants.push({ name: spouseN, role: "spouse" });
      return {
        type: "divorce",
        participants,
        sourceDocId: documentId,
      };
    });
  }
  if (docType === "birth_certificate") {
    pushEvent("birth", () => {
      if (!subjectName) return null;
      const participants: InferredEventParticipant[] = [{ name: subjectName, role: "subject" }];
      if (fatherN) participants.push({ name: fatherN, role: "parent" });
      if (motherN) participants.push({ name: motherN, role: "parent" });
      return {
        type: "birth",
        participants,
        date: dateOfBirth,
        place: placeOfBirth,
        sourceDocId: documentId,
      };
    });
  }
  if (docType === "adoption_record") {
    pushEvent("adoption", () => {
      if (!subjectName) return null;
      const participants: InferredEventParticipant[] = [{ name: subjectName, role: "subject" }];
      if (fatherN) participants.push({ name: fatherN, role: "parent" });
      if (motherN) participants.push({ name: motherN, role: "parent" });
      return {
        type: "adoption",
        participants,
        sourceDocId: documentId,
      };
    });
  }
  if (docType === "death_certificate") {
    pushEvent("death", () => {
      if (!subjectName) return null;
      return {
        type: "death",
        participants: [{ name: subjectName, role: "subject" }],
        sourceDocId: documentId,
      };
    });
  }
  if (docType === "naturalization_certificate") {
    pushEvent("naturalization", () => {
      if (!subjectName) return null;
      return {
        type: "naturalization",
        participants: [{ name: subjectName, role: "subject" }],
        date: naturalizationDate,
        sourceDocId: documentId,
      };
    });
  }

  return {
    docType,
    entityName: finalEntityName,
    relationshipHint,
    candidates: finalCandidates,
    extras,
    inferredRelationships,
    inferredEvents,
    education, experience,
    sanitization: report,
    review: reviewSummary,
  };
}
