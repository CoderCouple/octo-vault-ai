// Canonical identity profile schema. Drives extraction prompts, form-fill
// matching, and the conflict resolver.

export type Confidence = "high" | "medium" | "low";
export type Sensitivity = "public" | "personal" | "sensitive" | "highly_sensitive";

// --- Entities ---
// A vault holds many entities (Sunil, Payal, Katha…). Every fact and
// every document is tied to exactly one entity. There's always exactly
// one "self" entity per vault.

export type Relationship =
  | "self"
  | "spouse"
  | "partner"
  | "child"
  | "parent"
  | "sibling"
  | "dependent"
  | "other";

export interface Entity {
  id: string;
  name: string;
  email?: string;
  relationship: Relationship;
  // Optional relation target — e.g., "child of <parent entity id>".
  // Used by the entity-graph view to draw family links.
  relatedTo?: string;
  // Short two-letter avatar tag, e.g., "SP". Auto-generated from name.
  initials: string;
  createdAt: number;
}

export const SELF_ENTITY_ID = "self";

// What kind of document this is. The classifier picks one (or unknown).
export type DocType =
  | "passport"
  | "drivers_license"
  | "national_id"
  | "ssn_card"
  | "tax_form"
  | "paystub"
  | "utility_bill"
  | "bank_statement"
  | "insurance_card"
  | "lease"
  | "vehicle_registration"
  | "school_letter"
  | "employment_letter"
  | "medical_record"
  | "unknown";

export interface FieldSource {
  documentId: string;
  page?: number;
  excerpt?: string;
}

// One asserted value for one field, from one source. Many candidates can
// exist for the same key per entity — the resolver picks a canonical one.
export interface FieldCandidate {
  id: string;
  entityId: string;               // which person this fact is about
  fieldKey: ProfileKey;
  value: string;
  normalizedValue: string;        // for equivalence checks
  confidence: Confidence;
  source: FieldSource;
  docType: DocType;
  extractedAt: number;
  userEdited: boolean;
  userPinned?: boolean;           // user explicitly chose this as canonical
  dismissedAt?: number;           // user marked as wrong
}

export type ConflictState = "none" | "stale" | "conflict" | "red_flag";

export interface FieldRecord {
  key: ProfileKey;
  candidates: FieldCandidate[];
  canonicalId: string | null;
  conflictState: ConflictState;
  lastResolvedAt?: number;
}

// A Profile is one entity's set of records. The vault as a whole is a
// VaultProfile — a map of entityId → Profile.
export type Profile = Partial<Record<ProfileKey, FieldRecord>>;
export type VaultProfile = Record<string, Profile>;

// --- Repeated record types ---
// Unlike flat profile fields (one DOB, one passport number), these
// types are 1-to-many per entity: you may have several degrees and
// several jobs.

export interface EducationRecord {
  id: string;
  entityId: string;
  institution: string;
  degree?: string;           // "Bachelor's", "Master's", "PhD", "High School", etc.
  field?: string;            // major / discipline
  startDate?: string;
  endDate?: string;          // null/empty = current
  location?: string;
  gpa?: string;
  honors?: string;
  source: FieldSource;
  extractedAt: number;
  userEdited: boolean;
  userPinned?: boolean;
  dismissedAt?: number;
}

// --- Relationships ---
// First-class edges in the knowledge graph. Previously each Entity carried
// a single `relationship` field pointing implicitly at Self; now any two
// entities can be connected by any number of typed edges. Each edge
// tracks its origin (asserted by the user, derived by rules, or pulled
// from a document) so the user can audit the graph.

export type RelationshipKind =
  | "spouse" | "partner" | "child" | "parent" | "sibling" | "dependent"
  | "grandparent" | "grandchild" | "parent-in-law" | "sibling-in-law"
  | "step-parent" | "step-child" | "co-parent"
  | "colleague" | "lives-with" | "friend" | "other";

export interface RelationshipEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  kind: RelationshipKind;
  // Origin metadata.
  userPinned?: boolean;          // user explicitly created or confirmed
  derivedFrom?: string;          // derive-rule id if auto-created
  source?: { documentId?: string; excerpt?: string };
  // For symmetric kinds (spouse, sibling, colleague) the edge represents
  // both directions and we render it once.
  bidirectional?: boolean;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** Which kinds are symmetric by nature. */
export const SYMMETRIC_RELATIONSHIPS: RelationshipKind[] = [
  "spouse", "partner", "sibling", "sibling-in-law", "co-parent", "colleague",
  "lives-with", "friend", "other",
];

export function isSymmetricRelationship(kind: RelationshipKind): boolean {
  return SYMMETRIC_RELATIONSHIPS.includes(kind);
}

export interface ExperienceRecord {
  id: string;
  entityId: string;
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;          // null/empty = current
  location?: string;
  description?: string;
  source: FieldSource;
  extractedAt: number;
  userEdited: boolean;
  userPinned?: boolean;
  dismissedAt?: number;
}

// Generate a 2-letter avatar tag from a name.
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// What kind of value this field holds — drives resolver rules.
export type FieldKind =
  | "name"
  | "date_static"     // DOB, place of birth: should never change
  | "date_monotonic"  // expiry dates: newer issuance wins, older becomes stale
  | "id_unique"       // SSN, national ID: should never differ
  | "id_versioned"    // passport number: changes when book is renewed
  | "address"         // slow-changing; history matters
  | "contact"         // email/phone: latest wins, others kept
  | "text";           // free-form

export interface ProfileField {
  key: string;            // populated as ProfileKey at the call site
  label: string;
  aliases: string[];
  sensitivity: Sensitivity;
  kind: FieldKind;
  category: "personal" | "contact" | "government_id" | "employment" | "emergency";
}

export const PROFILE_FIELDS = [
  // Personal
  { key: "fullName",     label: "Full Legal Name",  aliases: ["full name", "legal name", "name"],          sensitivity: "personal", kind: "name", category: "personal" },
  { key: "firstName",    label: "First Name",       aliases: ["given name", "first", "forename"],          sensitivity: "personal", kind: "name", category: "personal" },
  { key: "middleName",   label: "Middle Name",      aliases: ["middle", "middle initial"],                 sensitivity: "personal", kind: "name", category: "personal" },
  { key: "lastName",     label: "Last Name",        aliases: ["family name", "surname", "last"],           sensitivity: "personal", kind: "name", category: "personal" },
  { key: "dateOfBirth",  label: "Date of Birth",    aliases: ["dob", "birth date", "birthday"],            sensitivity: "personal", kind: "date_static", category: "personal" },
  { key: "placeOfBirth", label: "Place of Birth",   aliases: ["birth place", "city of birth"],             sensitivity: "personal", kind: "date_static", category: "personal" },
  { key: "gender",       label: "Gender",           aliases: ["sex"],                                       sensitivity: "personal", kind: "text", category: "personal" },
  { key: "nationality",  label: "Nationality",      aliases: ["citizenship"],                              sensitivity: "personal", kind: "text", category: "personal" },

  // Contact
  { key: "email",        label: "Email",            aliases: ["e-mail", "email address"],                   sensitivity: "personal", kind: "contact", category: "contact" },
  { key: "phone",        label: "Phone",            aliases: ["mobile", "cell", "telephone"],               sensitivity: "personal", kind: "contact", category: "contact" },
  { key: "addressLine1", label: "Address Line 1",   aliases: ["street", "street address", "address"],      sensitivity: "personal", kind: "address", category: "contact" },
  { key: "addressLine2", label: "Address Line 2",   aliases: ["apt", "unit", "suite"],                      sensitivity: "personal", kind: "address", category: "contact" },
  { key: "city",         label: "City",             aliases: ["town"],                                      sensitivity: "personal", kind: "address", category: "contact" },
  { key: "state",        label: "State / Province", aliases: ["province", "region"],                        sensitivity: "personal", kind: "address", category: "contact" },
  { key: "postalCode",   label: "Postal Code",      aliases: ["zip", "zip code", "postcode"],               sensitivity: "personal", kind: "address", category: "contact" },
  { key: "country",      label: "Country",          aliases: ["country of residence"],                      sensitivity: "personal", kind: "address", category: "contact" },

  // Government IDs
  { key: "passportNumber",       label: "Passport Number",  aliases: ["passport no", "passport #"],         sensitivity: "highly_sensitive", kind: "id_versioned", category: "government_id" },
  { key: "passportIssuer",       label: "Passport Issuing Country", aliases: ["issuing country"],           sensitivity: "personal",         kind: "text",         category: "government_id" },
  { key: "passportIssueDate",    label: "Passport Issue Date",      aliases: ["date of issue"],             sensitivity: "personal",         kind: "date_monotonic", category: "government_id" },
  { key: "passportExpiryDate",   label: "Passport Expiry Date",     aliases: ["expires", "date of expiry"], sensitivity: "personal",         kind: "date_monotonic", category: "government_id" },
  { key: "driversLicenseNumber", label: "Driver's License Number",  aliases: ["license number", "dl no"],   sensitivity: "highly_sensitive", kind: "id_versioned", category: "government_id" },
  { key: "nationalIdNumber",     label: "National ID Number",       aliases: ["national id", "id number"],  sensitivity: "highly_sensitive", kind: "id_unique",    category: "government_id" },
  { key: "ssn",                  label: "Social Security Number",   aliases: ["ssn", "social security"],    sensitivity: "highly_sensitive", kind: "id_unique",    category: "government_id" },
  { key: "taxIdNumber",          label: "Tax ID",                   aliases: ["tin", "itin", "tax id"],     sensitivity: "highly_sensitive", kind: "id_unique",    category: "government_id" },

  // Employment
  { key: "employerName",         label: "Employer",           aliases: ["company", "current employer"],    sensitivity: "personal", kind: "text",         category: "employment" },
  { key: "jobTitle",             label: "Job Title",          aliases: ["position", "role", "occupation"], sensitivity: "personal", kind: "text",         category: "employment" },
  { key: "employmentStartDate",  label: "Employment Start Date", aliases: ["start date", "date hired"],   sensitivity: "personal", kind: "date_monotonic", category: "employment" },

  // Emergency
  { key: "emergencyContactName",  label: "Emergency Contact Name",  aliases: ["emergency contact"],       sensitivity: "personal", kind: "text",    category: "emergency" },
  { key: "emergencyContactPhone", label: "Emergency Contact Phone", aliases: ["emergency phone"],         sensitivity: "personal", kind: "contact", category: "emergency" },
] as const;

export type ProfileKey = typeof PROFILE_FIELDS[number]["key"];

export function fieldByKey(k: ProfileKey): ProfileField {
  return PROFILE_FIELDS.find((f) => f.key === k)! as unknown as ProfileField;
}

// Doc-type authority: which docs are most trustworthy for which fields.
// Score 1.0 = primary source; 0.5 = secondary; 0.1 = incidental.
export const DOC_AUTHORITY: Partial<Record<DocType, Partial<Record<ProfileKey, number>>>> = {
  passport: {
    fullName: 1.0, firstName: 1.0, middleName: 1.0, lastName: 1.0,
    dateOfBirth: 1.0, placeOfBirth: 1.0, gender: 0.9, nationality: 1.0,
    passportNumber: 1.0, passportIssuer: 1.0, passportIssueDate: 1.0, passportExpiryDate: 1.0,
  },
  drivers_license: {
    fullName: 0.9, firstName: 0.9, middleName: 0.8, lastName: 0.9,
    dateOfBirth: 0.95, gender: 0.9,
    addressLine1: 0.9, city: 0.9, state: 0.95, postalCode: 0.9,
    driversLicenseNumber: 1.0,
  },
  national_id: {
    fullName: 0.95, firstName: 0.95, lastName: 0.95,
    dateOfBirth: 0.95, nationalIdNumber: 1.0,
  },
  ssn_card: { ssn: 1.0, fullName: 0.8 },
  tax_form: {
    fullName: 0.9, ssn: 0.95, taxIdNumber: 0.95,
    addressLine1: 0.8, city: 0.8, state: 0.8, postalCode: 0.8,
    employerName: 0.9,
  },
  paystub: { fullName: 0.7, employerName: 1.0, jobTitle: 0.9, addressLine1: 0.6 },
  utility_bill: { fullName: 0.6, addressLine1: 1.0, city: 1.0, state: 1.0, postalCode: 1.0 },
  bank_statement: { fullName: 0.7, addressLine1: 0.7, city: 0.7, state: 0.7, postalCode: 0.7 },
  insurance_card: { fullName: 0.7, dateOfBirth: 0.7 },
  lease: { fullName: 0.7, addressLine1: 0.95, city: 0.95, state: 0.95, postalCode: 0.95 },
  vehicle_registration: { fullName: 0.7, addressLine1: 0.7 },
  school_letter: { fullName: 0.7 },
  employment_letter: { fullName: 0.7, employerName: 1.0, jobTitle: 0.95, employmentStartDate: 0.9 },
  medical_record: { fullName: 0.6, dateOfBirth: 0.7 },
};

export function authorityFor(doc: DocType, key: ProfileKey): number {
  return DOC_AUTHORITY[doc]?.[key] ?? 0.3;
}
