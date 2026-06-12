// Map web-page form fields to ProfileKeys using heuristics first, then
// LLM as a tiebreaker for unresolved ones. Reads from canonical values
// of records.

import { generateJson, type OllamaConfig } from "./ollama";
import { PROFILE_FIELDS, type Entity, type Profile, type ProfileKey, type Relationship, type VaultProfile } from "./schema";

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
  // Phase B: the labelled section the field sits inside — fieldset
  // legend, nearest preceding heading, or a labelled region's name.
  // Empty when the field has no section context. Used by the matcher
  // to disambiguate "Name" inside "Emergency Contact" from "Name"
  // inside the user's own profile section.
  section?: string;
  // True when the field exists but isn't currently visible (zero-
  // sized — typically because it's inside a collapsed accordion or
  // an inactive tab). Detection captures it anyway so multi-step
  // forms aren't silently dropped.
  hidden?: boolean;
}

export interface FieldMatch {
  fieldId: string;
  profileKey: ProfileKey | null;
  // Phase C: which entity's profile the value should come from. Most
  // fields go to "self"; section-routed fields (e.g. fields under a
  // "Spouse" fieldset) go to the matching entity. The content script
  // reads vault[entityId][profileKey] at fill time.
  entityId: string;
  confidence: "high" | "medium" | "low";
  source: "heuristic" | "llm";
  conflicted: boolean;
}

// Phase C: section-to-entity routing.
// When a field carries a `section` hint (from <fieldset><legend>, an
// aria-labelled region, or a preceding heading), check the label
// against these patterns to decide which entity's profile the field
// belongs to. The default for everything that doesn't match is "self".
// Each pattern is checked in order against the section text; the first
// hit wins. Requiring a hit *and* an actual matching entity in the
// vault means we never route to a non-existent entity.
interface SectionRoute {
  pattern: RegExp;
  // The relationship value of the entity to route to. The router will
  // find any entity in the vault with this relationship; ties go to
  // the entity whose name appears in the section text (if any).
  relationship: Relationship;
}
const SECTION_ROUTES: SectionRoute[] = [
  { pattern: /\b(spouse|wife|husband|partner)\b/i, relationship: "spouse" },
  { pattern: /\b(father|mother|parent|guardian)s?\b/i, relationship: "parent" },
  { pattern: /\b(child|son|daughter|kid|dependent)s?\b/i, relationship: "child" },
  { pattern: /\bsibling|brother|sister\b/i, relationship: "sibling" },
];

// Resolve a section label to an entity id. Returns "self" when nothing
// fits — the safest default. When multiple entities share the routed
// relationship (e.g. two children), prefer the one whose name appears
// in the section text.
export function routeSectionToEntity(section: string | undefined, entities: Entity[]): string {
  if (!section) return "self";
  const trimmed = section.trim();
  if (!trimmed) return "self";
  for (const route of SECTION_ROUTES) {
    if (!route.pattern.test(trimmed)) continue;
    const candidates = entities.filter((e) => e.relationship === route.relationship);
    if (candidates.length === 0) return "self";
    const named = candidates.find((e) => e.name && trimmed.toLowerCase().includes(e.name.toLowerCase()));
    return (named ?? candidates[0]).id;
  }
  return "self";
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

const FIELD_TEXT_HINTS: Partial<Record<ProfileKey, RegExp[]>> = {
  fullName: [/\b(full|legal|applicant|customer|employee|beneficiary)\s+name\b/i, /\bname\s+as\s+.*passport\b/i],
  firstName: [/\b(first|given|forename)\s+name\b/i, /\bgiven\b/i],
  middleName: [/\bmiddle\s+(name|initial)\b/i],
  lastName: [/\b(last|family|sur|surname)\s+name\b/i, /\bsurname\b/i],
  dateOfBirth: [/\b(date\s+of\s+birth|birth\s+date|dob|birthday)\b/i],
  placeOfBirth: [/\b(place|city|country)\s+of\s+birth\b/i, /\bbirth\s+(place|city|country)\b/i],
  gender: [/\b(gender|sex)\b/i],
  nationality: [/\b(nationality|citizenship)\b/i],
  email: [/\b(e-?mail|email\s+address)\b/i],
  phone: [/\b(phone|mobile|cell|telephone|contact\s+number)\b/i],
  linkedinProfile: [/\blinked\s*in\b/i, /\blinkedin\s+(profile|url)\b/i],
  personalWebsite: [/\b(personal\s+)?website\b/i, /\bportfolio\b/i],
  githubProfile: [/\bgithub\b/i],
  publicationsUrl: [/\bpublications?\b/i, /\bgoogle\s+scholar\b/i, /\bscholar\s+url\b/i],
  addressLine1: [/\b(address\s+line\s*1|street\s+address|address)\b/i],
  addressLine2: [/\b(address\s+line\s*2|apt|apartment|unit|suite)\b/i],
  city: [/\b(city|town)\b/i, /\blocation\s*\(\s*city\s*\)\b/i],
  state: [/\b(state|province|region)\b/i],
  postalCode: [/\b(zip|postal|postcode|pin\s*code)\b/i],
  country: [/\b(country|country\s+of\s+residence|residence\s+country)\b/i],
  passportNumber: [/\bpassport\s+(number|no\.?|#)\b/i],
  passportIssuer: [/\b(passport\s+)?(issuing|issuer)\s+country\b/i],
  passportIssueDate: [/\bpassport\s+(issue|issued)\s+date\b/i, /\bdate\s+of\s+issue\b/i],
  passportExpiryDate: [/\bpassport\s+(expir(y|ation)|expires?)\b/i, /\bdate\s+of\s+expiry\b/i],
  driversLicenseNumber: [/\b(driver'?s?\s+license|dl)\s+(number|no\.?|#)\b/i],
  nationalIdNumber: [/\bnational\s+id\s+(number|no\.?|#)\b/i],
  ssn: [/\b(ssn|social\s+security)\b/i],
  taxIdNumber: [/\b(tax\s+id|tin|itin)\b/i],
  employerName: [/\b(employer|company|organization)\b/i],
  jobTitle: [/\b(job\s+title|position|role|occupation)\b/i],
  employmentStartDate: [/\b(employment|job|work).*\b(start|from|begin)\b/i, /\bdate\s+hired\b/i],
  employmentEndDate: [/\b(employment|job|work).*\b(end|until|to|last\s+day)\b/i],
  annualSalary: [/\b(salary|annual\s+income|base\s+pay|compensation)\b/i],
  visaType: [/\b(visa|status).*\b(type|class|classification|category)\b/i],
  uciNumber: [/\buci\b/i, /\bunique\s+client\s+identifier\b/i, /\bclient\s+id(entifier)?\b/i],
  visaReceiptNumber: [/\b(receipt|case|petition)\s+(number|no\.?|#)\b/i],
  visaValidFrom: [/\b(visa|petition).*\b(valid\s+from|start)\b/i],
  visaValidUntil: [/\b(visa|petition|status).*\b(valid\s+until|expires?|expiry|end)\b/i],
  visaPetitioner: [/\b(petitioner|sponsor)\b/i],
  visaBeneficiary: [/\bbeneficiary\b/i],
  i94Number: [/\bi-?94.*\b(number|no\.?|#)\b/i],
  i94ExpiryDate: [/\bi-?94.*\b(expir(y|ation)|admit\s+until|authorized\s+stay)\b/i],
  greenCardNumber: [/\b(green\s+card|permanent\s+resident).*\b(number|no\.?|#)\b/i],
  greenCardCategory: [/\bgreen\s+card.*\b(category|class)\b/i],
  naturalizationDate: [/\b(naturalization|citizenship).*\bdate\b/i],
  spouseName: [/\b(spouse|wife|husband|partner).*\bname\b/i],
  spouseDateOfBirth: [/\b(spouse|wife|husband|partner).*\b(dob|birth)\b/i],
  marriageDate: [/\b(marriage|wedding).*\bdate\b/i],
  marriagePlace: [/\b(marriage|wedding).*\b(place|city|location)\b/i],
  marriageCertificateNumber: [/\bmarriage.*\b(certificate|license).*\b(number|no\.?|#)\b/i],
  fatherName: [/\b(father|dad|parent\s*1).*\bname\b/i, /\bfather\b/i],
  motherName: [/\b(mother|mom|parent\s*2|maiden).*\bname\b/i, /\bmother\b/i],
  emergencyContactName: [/\bemergency\s+contact.*\bname\b/i],
  emergencyContactPhone: [/\bemergency\s+contact.*\b(phone|mobile|telephone|number)\b/i],
};

function fieldText(f: DetectedField): string {
  return [f.section, f.label, f.name, f.placeholder, f.autocomplete, f.type]
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ");
}

function typeCompatible(type: string, key: ProfileKey): boolean {
  const field = PROFILE_FIELDS.find((f) => f.key === key);
  if (!field) return false;
  const t = type.toLowerCase();
  if (t === "checkbox" || t === "radio") return false;
  if (t === "email") return key === "email";
  if (t === "tel") return key === "phone" || key === "emergencyContactPhone";
  if (t === "date" || t === "month" || t === "week") return field.kind === "date_static" || field.kind === "date_monotonic";
  if (t === "number" || t === "range") return !["name", "address", "text"].includes(field.kind);
  if (t === "textarea") return false;
  return true;
}

function heuristicKeyForField(f: DetectedField, vault: VaultProfile, routedEntityId: string, entityWithKey: (key: string) => string | null): { key: ProfileKey; entityId: string } | null {
  const text = fieldText(f);
  if (isProtectedChoiceField(text)) return null;
  let best: { key: ProfileKey; score: number } | null = null;
  for (const field of PROFILE_FIELDS) {
    const key = field.key as ProfileKey;
    if (!typeCompatible(f.type, key)) continue;
    const eid = vault[routedEntityId]?.[key] ? routedEntityId : entityWithKey(key);
    if (!eid) continue;

    let score = 0;
    for (const re of FIELD_TEXT_HINTS[key] ?? []) {
      if (re.test(text)) score += 6;
    }
    const label = field.label.toLowerCase();
    if (text.includes(label)) score += 5;
    for (const alias of field.aliases) {
      if (text.includes(alias.toLowerCase())) score += 3;
    }
    if (field.category === "emergency" && /\bemergency\b/i.test(text)) score += 4;
    if (field.category === "immigration" && /\b(visa|uscis|i-?94|petition|immigration)\b/i.test(text)) score += 2;
    if (score > 0 && (!best || score > best.score)) best = { key, score };
  }
  if (!best || best.score < 3) return null;
  const entityId = vault[routedEntityId]?.[best.key] ? routedEntityId : entityWithKey(best.key);
  return entityId ? { key: best.key, entityId } : null;
}

function isProtectedChoiceField(text: string): boolean {
  if (/\b(eeoc|self[-\s]?id|self[-\s]?identification|race|ethnicity|hispanic|latino|latinx|veteran|disability|sexual\s+orientation|transgender)\b/i.test(text)) return true;
  if (/\bgender\b/i.test(text) && !/\b(passport|identity|personal\s+details?|biographical|demographic)\b/i.test(text)) return true;
  return false;
}

function isReviewOnlyChoiceField(text: string): boolean {
  if (isProtectedChoiceField(text)) return true;
  return /\b(work\s+authorization|legally\s+authorized|employment\s+eligibility|immigration\s+sponsorship|require\s+sponsorship|privacy\s+acknowledgement|sms|whatsapp)\b/i.test(text);
}

// Internal helper — read canonical value for an entity's profile key.
function canonicalOf(vault: VaultProfile, entityId: string, key: ProfileKey): string {
  const record = vault[entityId]?.[key];
  const canonicalId = record?.canonicalId;
  return record?.candidates.find((c) => c.id === canonicalId)?.value ?? "";
}

function conflictedOf(vault: VaultProfile, entityId: string, key: ProfileKey): boolean {
  const record = vault[entityId]?.[key];
  return !!record && record.conflictState !== "none";
}

// Phase C: section-aware, multi-entity matcher.
// Each field carries an `entityId` in the resulting FieldMatch so the
// content script can read vault[entityId][key] at fill time. Default
// route is "self"; sections like "Spouse" or "Emergency Contact" are
// routed to the matching entity (or stay on self when no such entity
// exists in the vault).
export async function matchFormFields(
  cfg: OllamaConfig | null,
  fields: DetectedField[],
  vault: VaultProfile,
  entities: Entity[] = [],
): Promise<FieldMatch[]> {
  const matches: FieldMatch[] = [];
  const unresolved: { field: DetectedField; entityId: string }[] = [];

  // Find any entity in the vault that has the given key. Used as a
  // fallback when the routed entity (usually "self") doesn't carry
  // the requested field — e.g. user imported their passport against
  // a different entity, so vault["self"] is empty but
  // vault["ent-xyz"] has email/phone/name. Prefer self when ties.
  function entityWithKey(key: string): string | null {
    if (vault["self"]?.[key as ProfileKey]) return "self";
    for (const eid of Object.keys(vault)) {
      if (vault[eid]?.[key as ProfileKey]) return eid;
    }
    return null;
  }

  // Pre-route every field to a target entity using its section hint.
  // Heuristic matches first check the routed entity; if it lacks the
  // key, fall back to any entity that has it. Avoids the "Email field
  // skipped because self profile is empty even though I have email in
  // the vault" footgun.
  for (const f of fields) {
    const routedEntityId = routeSectionToEntity(f.section, entities);
    if (isReviewOnlyChoiceField(fieldText(f))) {
      matches.push({ fieldId: f.id, profileKey: null, entityId: routedEntityId, confidence: "low", source: "heuristic", conflicted: false });
      continue;
    }

    const ac = f.autocomplete?.toLowerCase().trim();
    if (ac && AUTOCOMPLETE_MAP[ac]) {
      const key = AUTOCOMPLETE_MAP[ac];
      const eid = vault[routedEntityId]?.[key] ? routedEntityId : entityWithKey(key);
      if (eid) {
        matches.push({
          fieldId: f.id, profileKey: key, entityId: eid,
          confidence: "high", source: "heuristic",
          conflicted: conflictedOf(vault, eid, key),
        });
        continue;
      }
    }
    if (f.type === "email") {
      const eid = vault[routedEntityId]?.["email"] ? routedEntityId : entityWithKey("email");
      if (eid) {
        matches.push({
          fieldId: f.id, profileKey: "email", entityId: eid,
          confidence: "high", source: "heuristic",
          conflicted: conflictedOf(vault, eid, "email"),
        });
        continue;
      }
    }
    if (f.type === "tel") {
      const eid = vault[routedEntityId]?.["phone"] ? routedEntityId : entityWithKey("phone");
      if (eid) {
        matches.push({
          fieldId: f.id, profileKey: "phone", entityId: eid,
          confidence: "high", source: "heuristic",
          conflicted: conflictedOf(vault, eid, "phone"),
        });
        continue;
      }
    }
    const direct = heuristicKeyForField(f, vault, routedEntityId, entityWithKey);
    if (direct) {
      matches.push({
        fieldId: f.id, profileKey: direct.key, entityId: direct.entityId,
        confidence: "medium", source: "heuristic",
        conflicted: conflictedOf(vault, direct.entityId, direct.key),
      });
      continue;
    }
    unresolved.push({ field: f, entityId: routedEntityId });
  }

  // Same fallback for LLM-bound fields: if a field was routed to an
  // empty entity, re-route to the most populated entity so the LLM
  // actually has profile context. Self-empty + spouse-has-data is
  // the common case for users who imported their docs against a
  // different entity.
  const populated = Object.entries(vault)
    .map(([eid, p]) => ({ eid, count: Object.keys(p).length }))
    .sort((a, b) => b.count - a.count);
  const richest = populated.find((p) => p.count > 0)?.eid;
  if (richest) {
    for (const u of unresolved) {
      if (Object.keys(vault[u.entityId] ?? {}).length === 0) u.entityId = richest;
    }
  }

  if (unresolved.length === 0 || !cfg) {
    for (const u of unresolved) {
      matches.push({ fieldId: u.field.id, profileKey: null, entityId: u.entityId, confidence: "low", source: "heuristic", conflicted: false });
    }
    return matches;
  }

  // Group unresolved by routed entityId so the LLM sees structure.
  // For each entity group we emit a "PROFILE:" block (the available
  // keys + canonical values) and a "FIELDS:" block (the unresolved
  // fields routed there, grouped by section label).
  const byEntity = new Map<string, { field: DetectedField; entityId: string }[]>();
  for (const u of unresolved) {
    const list = byEntity.get(u.entityId) ?? [];
    list.push(u);
    byEntity.set(u.entityId, list);
  }

  const entityLabel = (eid: string): string => {
    const ent = entities.find((e) => e.id === eid);
    if (!ent) return eid === "self" ? "Self" : eid;
    return `${ent.name}${ent.relationship !== "self" ? ` (${ent.relationship})` : ""}`;
  };

  const blocks: string[] = [];
  for (const [eid, list] of byEntity) {
    const profile = vault[eid] ?? {};
    const available = Object.keys(profile) as ProfileKey[];
    if (available.length === 0) continue; // nothing to match against
    const profileLines = available.map((k) => {
      const label = PROFILE_FIELDS.find((f) => f.key === k)?.label ?? k;
      return `  - ${k} (${label}): "${canonicalOf(vault, eid, k)}"`;
    }).join("\n");

    // Sub-group fields by section within the entity for readability.
    const bySection = new Map<string, DetectedField[]>();
    for (const u of list) {
      const sec = u.field.section || "";
      const arr = bySection.get(sec) ?? [];
      arr.push(u.field);
      bySection.set(sec, arr);
    }
    const sectionBlocks: string[] = [];
    for (const [sec, arr] of bySection) {
      const header = sec ? `  SECTION: "${sec}"` : "  SECTION: (no section)";
      const lines = arr.map((f) =>
        `    - id="${f.id}"  label="${f.label}"  name="${f.name}"  type="${f.type}"  placeholder="${f.placeholder}"`
      ).join("\n");
      sectionBlocks.push(`${header}\n${lines}`);
    }

    blocks.push(
      `ENTITY: ${entityLabel(eid)} [id=${eid}]\n` +
      `  PROFILE (key → label : value):\n${profileLines}\n` +
      `  FIELDS TO MATCH (grouped by section):\n${sectionBlocks.join("\n")}`,
    );
  }

  // Fields whose routed entity has an empty profile can't be matched
  // by the LLM — just emit null matches for them now.
  for (const u of unresolved) {
    const profile = vault[u.entityId] ?? {};
    if (Object.keys(profile).length === 0) {
      matches.push({ fieldId: u.field.id, profileKey: null, entityId: u.entityId, confidence: "low", source: "llm", conflicted: false });
    }
  }

  if (blocks.length === 0) return matches;

  const prompt = `You are mapping web form fields to a user's profile data. Return JSON only — no prose.

Each ENTITY block below is one person in the vault. Within an entity, fields are grouped by SECTION (a fieldset legend or heading from the page) — that section context is your strongest hint for what each field is asking for.

${blocks.join("\n\n")}

For each form field, output { "id": "<field id>", "key": "<profile key>" or null, "confidence": "high"|"medium"|"low" }.

Matching rules:
- Match aggressively when the field clearly asks for a known profile value.
  Respect the input type:
    type="time"   → only time-of-day (HH:MM), NOT calendar dates
    type="date"   → only calendar dates
    type="email"  → only email-shaped values
    type="tel"    → only phone numbers
    type="number" / "range" → only numeric values
- If no profile key has a value with the right shape for the type, return null.
- Use the SECTION label to disambiguate. For example:
  - SECTION "Personal" → name fields map to fullName / firstName / lastName
  - SECTION "Emergency Contact" → name field → emergencyContactName, phone → emergencyContactPhone
  - SECTION "Spouse" → name → fullName *of the spouse entity*, dob → dateOfBirth *of the spouse entity*
- Common shortcuts:
  - "Customer name" / "Full name" → fullName
  - "Telephone" / "Phone number" / "Mobile" → phone
  - "E-mail address" → email
  - "ZIP" / "Postal" / "PIN code" → postalCode
  - "Street" / "Address line 1" → addressLine1
  - "DOB" / "Date of birth" / "Birthday" → dateOfBirth
- Use null for fields that genuinely don't map (radio choices, terms
  checkboxes, free-form notes, captcha tokens).
- Never invent profile keys outside the per-entity PROFILE lists above.

Return: { "matches": [ ... ] }`;

  try {
    console.log("[OctoVault matcher] LLM prompt:\n", prompt);
    const raw = await generateJson<{ matches: { id: string; key: string | null; confidence: "high" | "medium" | "low" }[] }>(cfg, { prompt });
    console.log("[OctoVault matcher] LLM raw response:", raw);
    const allowedByEntity = new Map<string, Set<string>>();
    for (const u of unresolved) {
      const keys = new Set(Object.keys(vault[u.entityId] ?? {}));
      allowedByEntity.set(u.entityId, keys);
    }
    if (!raw?.matches || !Array.isArray(raw.matches)) {
      console.warn("[OctoVault matcher] LLM returned no matches array");
      for (const u of unresolved) {
        matches.push({ fieldId: u.field.id, profileKey: null, entityId: u.entityId, confidence: "low", source: "llm", conflicted: false });
      }
      return matches;
    }
    for (const m of raw.matches) {
      // Find the field's pre-routed entity (the LLM doesn't echo
      // entityId back; we know it from the original field).
      const u = unresolved.find((u) => u.field.id === m.id);
      if (!u) continue;
      const allowed = allowedByEntity.get(u.entityId) ?? new Set();
      const key = m.key && allowed.has(m.key) ? (m.key as ProfileKey) : null;
      if (m.key && !key) {
        console.warn(`[OctoVault matcher] LLM returned unknown key "${m.key}" for field ${m.id} (entity ${u.entityId})`);
      }
      matches.push({
        fieldId: m.id,
        profileKey: key,
        entityId: u.entityId,
        confidence: m.confidence ?? "low",
        source: "llm",
        conflicted: key ? conflictedOf(vault, u.entityId, key) : false,
      });
    }
    // Fill in any unresolved field the LLM omitted.
    for (const u of unresolved) {
      if (!matches.some((m) => m.fieldId === u.field.id)) {
        matches.push({ fieldId: u.field.id, profileKey: null, entityId: u.entityId, confidence: "low", source: "llm", conflicted: false });
      }
    }
  } catch (err) {
    console.error("[OctoVault matcher] LLM call failed:", err);
    for (const u of unresolved) {
      matches.push({ fieldId: u.field.id, profileKey: null, entityId: u.entityId, confidence: "low", source: "llm", conflicted: false });
    }
  }
  return matches;
}
