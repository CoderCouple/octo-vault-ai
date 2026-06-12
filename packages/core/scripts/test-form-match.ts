import { matchFormFields, type DetectedField } from "../src/match";
import type { Entity, FieldCandidate, ProfileKey, VaultProfile } from "../src/schema";

const now = Date.now();

function candidate(entityId: string, fieldKey: ProfileKey, value: string): FieldCandidate {
  return {
    id: `${entityId}-${fieldKey}`,
    entityId,
    fieldKey,
    value,
    normalizedValue: value.toLowerCase(),
    confidence: "high",
    source: { documentId: "fixture" },
    docType: "unknown",
    extractedAt: now,
    userEdited: false,
  };
}

function profile(entityId: string, fields: Partial<Record<ProfileKey, string>>) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      const c = candidate(entityId, key as ProfileKey, value);
      return [key, { key, candidates: [c], canonicalId: c.id, conflictState: "none" }];
    }),
  );
}

const entities: Entity[] = [
  { id: "self", name: "Sunil Tiwari", relationship: "self", initials: "ST", createdAt: now },
  { id: "payal", name: "Payal Tiwari", relationship: "spouse", initials: "PT", createdAt: now },
  { id: "katha", name: "Katha Tiwari", relationship: "child", initials: "KT", createdAt: now },
];

const vault: VaultProfile = {
  self: profile("self", {
    fullName: "Sunil Tiwari",
    firstName: "Sunil",
    lastName: "Tiwari",
    email: "sunil@example.com",
    phone: "+1 555 123 4567",
    linkedinProfile: "https://www.linkedin.com/in/suniltiwari",
    personalWebsite: "https://suniltiwari.dev",
    githubProfile: "https://github.com/suniltiwari",
    publicationsUrl: "https://scholar.google.com/citations?user=sunil",
    dateOfBirth: "1984-01-02",
    addressLine1: "123 Market Street",
    city: "San Francisco",
    state: "CA",
    postalCode: "94105",
    country: "United States",
    passportNumber: "Z1234567",
    passportExpiryDate: "2030-12-31",
    uciNumber: "1234-5678",
    employerName: "Acme Inc",
    jobTitle: "Software Engineer",
  }),
  payal: profile("payal", {
    fullName: "Payal Tiwari",
    dateOfBirth: "1986-03-04",
    passportNumber: "P7654321",
  }),
  katha: profile("katha", {
    fullName: "Katha Tiwari",
    dateOfBirth: "2020-05-06",
  }),
};

interface Case {
  name: string;
  fields: DetectedField[];
  expects: Array<{ id: string; entityId: string; key: ProfileKey | null }>;
}

const cases: Case[] = [
  {
    name: "Job application basics",
    fields: [
      field("name", "Applicant full name", "text"),
      field("email", "Email address", "email"),
      field("phone", "Mobile phone", "tel"),
      field("employer", "Current employer", "text"),
      field("title", "Job title", "text"),
    ],
    expects: [
      { id: "name", entityId: "self", key: "fullName" },
      { id: "email", entityId: "self", key: "email" },
      { id: "phone", entityId: "self", key: "phone" },
      { id: "employer", entityId: "self", key: "employerName" },
      { id: "title", entityId: "self", key: "jobTitle" },
    ],
  },
  {
    name: "Ashby job application",
    fields: [
      field("_systemfield_name", "Name", "text", "Autofill from resume"),
      field("_systemfield_email", "Email", "email", "Autofill from resume"),
      field("phone-guid", "Phone Number", "tel", "Autofill from resume"),
      field("linkedin-guid", "LinkedIn Profile", "text", "Autofill from resume"),
      field("website-guid", "Website / Portfolio", "text", "Autofill from resume"),
      field("eeoc-gender", "Gender", "radio", "Voluntary Self-Identification"),
    ],
    expects: [
      { id: "_systemfield_name", entityId: "self", key: "fullName" },
      { id: "_systemfield_email", entityId: "self", key: "email" },
      { id: "phone-guid", entityId: "self", key: "phone" },
      { id: "linkedin-guid", entityId: "self", key: "linkedinProfile" },
      { id: "website-guid", entityId: "self", key: "personalWebsite" },
      { id: "eeoc-gender", entityId: "self", key: null },
    ],
  },
  {
    name: "Greenhouse job application",
    fields: [
      field("first_name", "First Name", "text"),
      field("last_name", "Last Name", "text"),
      field("email", "Email", "text", "", "email"),
      field("phone", "Phone", "tel"),
      field("question_website", "Website", "text"),
      field("question_linkedin", "LinkedIn Profile", "text"),
      field("question_publications", "Publications (e.g. Google Scholar) URL", "text"),
      field("question_github", "GitHub URL", "text"),
      field("gender", "Gender", "text"),
      field("veteran_status", "Veteran Status", "text"),
      field("disability_status", "Disability Status", "text"),
    ],
    expects: [
      { id: "first_name", entityId: "self", key: "firstName" },
      { id: "last_name", entityId: "self", key: "lastName" },
      { id: "email", entityId: "self", key: "email" },
      { id: "phone", entityId: "self", key: "phone" },
      { id: "question_website", entityId: "self", key: "personalWebsite" },
      { id: "question_linkedin", entityId: "self", key: "linkedinProfile" },
      { id: "question_publications", entityId: "self", key: "publicationsUrl" },
      { id: "question_github", entityId: "self", key: "githubProfile" },
      { id: "gender", entityId: "self", key: null },
      { id: "veteran_status", entityId: "self", key: null },
      { id: "disability_status", entityId: "self", key: null },
    ],
  },
  {
    name: "DoorDash Greenhouse application",
    fields: [
      field("first_name", "First Name", "text"),
      field("last_name", "Last Name", "text"),
      field("email", "Email", "text", "", "email"),
      field("phone", "Phone", "tel"),
      field("candidate-location", "Location (City)", "text"),
      field("linkedin", "LinkedIn Profile", "text"),
      field("authorized", "Are you legally authorized to work in the United States?", "text"),
      field("sponsorship", "Will you now require immigration sponsorship by our company?", "text"),
      field("privacy", "Applicant Privacy Acknowledgement", "text"),
      field("survey-gender", "Gender", "text", "USA - Self-Identification Survey"),
      field("survey-latinx", "Are you Hispanic or Latinx?", "text", "USA - Self-Identification Survey"),
      field("survey-disability", "Disability Status", "text", "USA - Self-Identification Survey"),
    ],
    expects: [
      { id: "first_name", entityId: "self", key: "firstName" },
      { id: "last_name", entityId: "self", key: "lastName" },
      { id: "email", entityId: "self", key: "email" },
      { id: "phone", entityId: "self", key: "phone" },
      { id: "candidate-location", entityId: "self", key: "city" },
      { id: "linkedin", entityId: "self", key: "linkedinProfile" },
      { id: "authorized", entityId: "self", key: null },
      { id: "sponsorship", entityId: "self", key: null },
      { id: "privacy", entityId: "self", key: null },
      { id: "survey-gender", entityId: "self", key: null },
      { id: "survey-latinx", entityId: "self", key: null },
      { id: "survey-disability", entityId: "self", key: null },
    ],
  },
  {
    name: "Meta careers application",
    fields: [
      field("meta-first", "First name", "text"),
      field("meta-last", "Last name", "text"),
      field("meta-email", "Email", "text"),
      field("meta-phone", "Phone number", "text"),
      field("meta-website", "Website (Examples: Linkedin, Github, portfolio)", "text"),
      field("meta-gender", "Indicate your gender:", "radio", "Self ID"),
      field("meta-race", "Indicate your race and ethnicity:", "radio", "Self ID"),
      field("meta-veteran", "Protected veteran status", "radio", "Self ID"),
    ],
    expects: [
      { id: "meta-first", entityId: "self", key: "firstName" },
      { id: "meta-last", entityId: "self", key: "lastName" },
      { id: "meta-email", entityId: "self", key: "email" },
      { id: "meta-phone", entityId: "self", key: "phone" },
      { id: "meta-website", entityId: "self", key: "personalWebsite" },
      { id: "meta-gender", entityId: "self", key: null },
      { id: "meta-race", entityId: "self", key: null },
      { id: "meta-veteran", entityId: "self", key: null },
    ],
  },
  {
    name: "Netflix application",
    fields: [
      field("Contact_Information_email", "Email", "input", "Contact Information", "email"),
      field("Contact_Information_firstname", "First name", "input", "Contact Information", "given-name"),
      field("Contact_Information_lastname", "Last name", "input", "Contact Information", "family-name"),
      field("Contact_Information_phone", "Phone", "text", "Contact Information"),
      field("input-country", "Country", "text", "Contact Information"),
      field("Contact_Information_city", "City", "input", "Contact Information"),
      field("Additional_Documents_candidate_portfolio_url", "URL (LinkedIn, Github, Portfolio):", "input", "Additional Documents"),
      field("gender-identity", "Which gender identities do you most identify with? Please select all that apply.", "checkbox", "Self-ID Questions"),
      field("sexual-orientation", "Which sexual orientations do you most identify with? Please select all that apply.", "checkbox", "Self-ID Questions"),
      field("transgender", "Are you a person of transgender experience?", "text", "Self-ID Questions"),
      field("disability", "Would you consider yourself to be a person with a disability?", "text", "Self-ID Questions"),
    ],
    expects: [
      { id: "Contact_Information_email", entityId: "self", key: "email" },
      { id: "Contact_Information_firstname", entityId: "self", key: "firstName" },
      { id: "Contact_Information_lastname", entityId: "self", key: "lastName" },
      { id: "Contact_Information_phone", entityId: "self", key: "phone" },
      { id: "input-country", entityId: "self", key: "country" },
      { id: "Contact_Information_city", entityId: "self", key: "city" },
      { id: "Additional_Documents_candidate_portfolio_url", entityId: "self", key: "personalWebsite" },
      { id: "gender-identity", entityId: "self", key: null },
      { id: "sexual-orientation", entityId: "self", key: null },
      { id: "transgender", entityId: "self", key: null },
      { id: "disability", entityId: "self", key: null },
    ],
  },
  {
    name: "Travel visa identity",
    fields: [
      field("passport", "Passport No.", "text"),
      field("expiry", "Date of expiry", "date"),
      field("uciNumber_input", "", "text"),
      field("country", "Country of residence", "select"),
      field("dob", "Date of birth", "date"),
    ],
    expects: [
      { id: "passport", entityId: "self", key: "passportNumber" },
      { id: "expiry", entityId: "self", key: "passportExpiryDate" },
      { id: "uciNumber_input", entityId: "self", key: "uciNumber" },
      { id: "country", entityId: "self", key: "country" },
      { id: "dob", entityId: "self", key: "dateOfBirth" },
    ],
  },
  {
    name: "Spouse section routing",
    fields: [
      field("spouse-name", "Full name", "text", "Spouse information"),
      field("spouse-dob", "Date of birth", "date", "Spouse information"),
    ],
    expects: [
      { id: "spouse-name", entityId: "payal", key: "fullName" },
      { id: "spouse-dob", entityId: "payal", key: "dateOfBirth" },
    ],
  },
  {
    name: "Child/dependent section routing",
    fields: [
      field("child-name", "Dependent name", "text", "Child details"),
      field("child-dob", "DOB", "date", "Child details"),
    ],
    expects: [
      { id: "child-name", entityId: "katha", key: "fullName" },
      { id: "child-dob", entityId: "katha", key: "dateOfBirth" },
    ],
  },
  {
    name: "Address form",
    fields: [
      field("street", "Street address", "text"),
      field("city", "City", "text"),
      field("state", "State / Province", "text"),
      field("zip", "ZIP / Postal code", "text"),
      field("country", "Country", "select"),
    ],
    expects: [
      { id: "street", entityId: "self", key: "addressLine1" },
      { id: "city", entityId: "self", key: "city" },
      { id: "state", entityId: "self", key: "state" },
      { id: "zip", entityId: "self", key: "postalCode" },
      { id: "country", entityId: "self", key: "country" },
    ],
  },
];

function field(id: string, label: string, type: string, section = "", autocomplete = ""): DetectedField {
  return { id, label, type, section, name: id, placeholder: "", autocomplete };
}

let failed = 0;
for (const c of cases) {
  const matches = await matchFormFields(null, c.fields, vault, entities);
  console.log(`\n[${c.name}]`);
  for (const expected of c.expects) {
    const actual = matches.find((m) => m.fieldId === expected.id);
    const ok = actual?.entityId === expected.entityId && actual.profileKey === expected.key;
    if (!ok) failed++;
    console.log(`${ok ? "✓" : "✗"} ${expected.id}: expected ${expected.entityId}.${expected.key}, got ${actual?.entityId ?? "?"}.${actual?.profileKey ?? "null"}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll form-match examples passed.");
