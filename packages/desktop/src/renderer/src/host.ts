// AppHost for the desktop renderer. Uses the same IndexedDB adapter
// from core, and routes Ollama calls through the preload bridge to
// avoid CORS issues from the renderer origin.

import type { AppHost } from "@octovault/ui";
import {
  ask as askLocal,
  extractionSchema,
  normalizeValue, parseModelJson, PROFILE_FIELDS,
  type EducationRecord, type ExperienceRecord,
  type ExtractionResult, type FieldCandidate, type DocType, type ProfileKey, type QaEngine, type QaResult, type Relationship,
} from "@octovault/core";
import { ipcStorageAdapter } from "./storage/ipc-adapter";

declare global {
  interface Window {
    octovault?: {
      ollama: {
        health: (cfg: OllamaCfg) => Promise<{ reachable: boolean }>;
        listModels: (cfg: OllamaCfg) => Promise<string[]>;
        generate: (cfg: OllamaCfg, body: object) => Promise<{ response: string }>;
        embed: (cfg: OllamaCfg, model: string, prompt: string) => Promise<{ embedding: number[] }>;
      };
      bridge: {
        publishSnapshot: (snapshot: { profile: unknown; documents: unknown; entities?: unknown }) => void;
      };
      vault: {
        exists: () => Promise<boolean>;
        isOpen: () => Promise<boolean>;
        initialize: (password: string) => Promise<boolean>;
        unlock: (password: string) => Promise<boolean>;
        lock: () => Promise<void>;
        reset: () => Promise<void>;
      };
      store: Record<string, (...args: unknown[]) => Promise<unknown>>;
      overlay?: {
        hide: () => void;
        show: () => void;
        toggle: () => void;
      };
      shortcut?: {
        set: (accelerator: string) => void;
        move: (x: number, y: number) => void;
        snap: () => void;
        setEdge: (edge: "left" | "right") => void;
        hide: () => void;
        show: () => void;
        contextMenu: () => void;
      };
      launch?: {
        setOpenAtLogin: (on: boolean) => void;
      };
    };
  }
}

interface OllamaCfg { url: string; llmModel: string; embeddingModel: string }

async function cfg(): Promise<OllamaCfg> {
  const s = await ipcStorageAdapter.getSettings();
  return { url: s.ollamaUrl, llmModel: s.llmModel, embeddingModel: s.embeddingModel };
}

const DOC_TYPES: DocType[] = [
  "passport", "drivers_license", "national_id", "ssn_card", "tax_form", "paystub",
  "utility_bill", "bank_statement", "insurance_card", "lease", "vehicle_registration",
  "school_letter", "employment_letter", "medical_record", "unknown",
];
const RELATIONSHIPS: Relationship[] = ["self", "spouse", "partner", "child", "parent", "sibling", "dependent", "other"];

export const desktopHost: AppHost = {
  surface: "desktop",
  storage: ipcStorageAdapter,

  async isOllamaReachable() {
    try {
      const r = await window.octovault!.ollama.health(await cfg());
      return r.reachable;
    } catch { return false; }
  },

  async extractFromText(documentId, text): Promise<ExtractionResult> {
    const c = await cfg();
    const truncated = text.slice(0, 14_000);
    const fieldList = PROFILE_FIELDS
      .map((f) => `- ${f.key}: ${f.label} (a.k.a. ${f.aliases.join(", ")})`)
      .join("\n");

    const SYSTEM = `You are an on-device assistant that classifies a personal document, identifies
whose document it is, and extracts identity fields. Return JSON only. Use only what the
document explicitly contains. Do not invent values.`;
    const prompt = `Document text:
"""
${truncated}
"""

1) Classify into one of: ${DOC_TYPES.join(", ")}.
2) Identify the person this document is primarily about. Return their full name as it
   appears in the document, or null if not identifiable.
3) Optionally suggest a relationship hint from: ${RELATIONSHIPS.join(", ")}.
4) Extract a subset of these fields supported by evidence:
${fieldList}
5) If the document mentions education (degrees, schools, transcripts) or work
   experience (jobs, employers), extract them as repeating records.

Return JSON:
{
  "docType": "<one of the listed types>",
  "entityName": "<full name> or null",
  "relationshipHint": "<one of the relationships> (optional)",
  "fields": {
    "<fieldKey>": { "value": "<string>", "confidence": "high"|"medium"|"low", "excerpt": "<verbatim snippet>" }
  },
  "education": [
    { "institution": "...", "degree": "Bachelor's|Master's|PhD|...", "field": "...", "startDate": "YYYY-MM or YYYY", "endDate": "YYYY-MM or YYYY", "location": "...", "gpa": "...", "honors": "...", "excerpt": "..." }
  ],
  "experience": [
    { "company": "...", "role": "...", "startDate": "YYYY-MM or YYYY", "endDate": "YYYY-MM or YYYY or empty for current", "location": "...", "description": "...", "excerpt": "..." }
  ]
}`;

    const resp = await window.octovault!.ollama.generate(c, {
      model: c.llmModel,
      prompt,
      system: SYSTEM,
      stream: false,
      format: extractionSchema(),
      options: { temperature: 0.1 },
    });

    const parsed = parseModelJson<{
      docType: DocType;
      entityName: string | null;
      relationshipHint?: Relationship;
      fields: Record<string, { value: string; confidence: "high" | "medium" | "low"; excerpt?: string }>;
      education?: Array<{ institution: string; degree?: string; field?: string; startDate?: string; endDate?: string; location?: string; gpa?: string; honors?: string; excerpt?: string }>;
      experience?: Array<{ company: string; role: string; startDate?: string; endDate?: string; location?: string; description?: string; excerpt?: string }>;
    }>(resp.response);

    const docType = DOC_TYPES.includes(parsed.docType) ? parsed.docType : "unknown";
    const entityName = (parsed.entityName ?? "").trim() || null;
    const relationshipHint = parsed.relationshipHint && RELATIONSHIPS.includes(parsed.relationshipHint)
      ? parsed.relationshipHint : undefined;

    const now = Date.now();
    const candidates: Omit<FieldCandidate, "entityId">[] = [];
    for (const f of PROFILE_FIELDS) {
      const entry = parsed.fields?.[f.key];
      if (!entry?.value) continue;
      const value = String(entry.value).trim();
      if (!value) continue;
      candidates.push({
        id: crypto.randomUUID(),
        fieldKey: f.key as ProfileKey,
        value,
        normalizedValue: normalizeValue(f.key as ProfileKey, value),
        confidence: entry.confidence ?? "medium",
        source: { documentId, excerpt: entry.excerpt },
        docType,
        extractedAt: now,
        userEdited: false,
      });
    }
    const education: Omit<EducationRecord, "entityId">[] = (parsed.education ?? [])
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

    const experience: Omit<ExperienceRecord, "entityId">[] = (parsed.experience ?? [])
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
  },
  async embed(text): Promise<number[]> {
    const c = await cfg();
    const r = await window.octovault!.ollama.embed(c, c.embeddingModel, text);
    return r.embedding;
  },
  async ask(question, opts): Promise<QaResult> {
    const c = await cfg();
    const [embeddings, entities, vault, documents] = await Promise.all([
      ipcStorageAdapter.listEmbeddings(),
      ipcStorageAdapter.listEntities(),
      ipcStorageAdapter.getAllProfiles(),
      ipcStorageAdapter.listDocuments(),
    ]);
    const engine: QaEngine = {
      embed: async (text) => (await window.octovault!.ollama.embed(c, c.embeddingModel, text)).embedding,
      generate: async (prompt, system) => {
        const r = await window.octovault!.ollama.generate(c, {
          model: c.llmModel, prompt, system, stream: false,
          options: { temperature: 0.1 },
        });
        return r.response;
      },
    };
    return askLocal(engine, question, embeddings, { entities, vault, documents }, opts);
  },

  // --- Vault lifecycle (SQLCipher via main process) ---
  async vaultExists(): Promise<boolean> {
    return (await window.octovault!.vault.exists()) === true;
  },
  async vaultInit(password: string): Promise<void> {
    const ok = await window.octovault!.vault.initialize(password);
    if (!ok) throw new Error("Vault initialization failed");
  },
  async vaultUnlock(password: string): Promise<boolean> {
    return window.octovault!.vault.unlock(password);
  },
  async vaultLock(): Promise<void> { await window.octovault!.vault.lock(); },
  async vaultReset(): Promise<void> { await window.octovault!.vault.reset(); },
  isVaultUnlocked(): boolean {
    // SQLCipher state lives in main; we can't synchronously query it.
    // Track it locally based on the most recent unlock/init call.
    return _unlockedFlag;
  },
};

let _unlockedFlag = false;

// Wrap lifecycle ops to maintain the local flag (since isVaultUnlocked
// is synchronous and AppHost requires a sync method).
const origInit = desktopHost.vaultInit;
const origUnlock = desktopHost.vaultUnlock;
const origLock = desktopHost.vaultLock;
desktopHost.vaultInit = async (pw: string) => { await origInit(pw); _unlockedFlag = true; };
desktopHost.vaultUnlock = async (pw: string) => {
  const ok = await origUnlock(pw);
  _unlockedFlag = ok;
  return ok;
};
desktopHost.vaultLock = async () => { await origLock(); _unlockedFlag = false; };
const origReset = desktopHost.vaultReset;
desktopHost.vaultReset = async () => { await origReset(); _unlockedFlag = false; };

// Push the current vault state to the main process at boot and on a 4s
// poll. The HTTP server in main always returns the latest snapshot for
// the extension to read.
export async function startSnapshotPump(): Promise<void> {
  const publish = async () => {
    try {
      const [profile, documents, entities] = await Promise.all([
        ipcStorageAdapter.getAllProfiles(),
        ipcStorageAdapter.listDocuments(),
        ipcStorageAdapter.listEntities(),
      ]);
      window.octovault?.bridge.publishSnapshot({ profile, documents, entities });
    } catch (err) {
      console.warn("[bridge] publish failed", err);
    }
  };
  await publish();
  setInterval(() => void publish(), 4000);
}
