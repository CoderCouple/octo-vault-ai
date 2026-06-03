// Local Q&A with source citations. Embeddings of facts + document
// chunks live in IndexedDB. On a question: embed query, cosine top-k,
// stuff into a prompt, ask the local LLM, return answer + citations.

import { embed, generate, type OllamaConfig } from "./ollama";
import { canonicalValue } from "./resolver";
import { authorityFor, fieldByKey, PROFILE_FIELDS } from "./schema";
import type { Entity, FieldRecord, Profile, ProfileKey, VaultProfile } from "./schema";
import type { StoredDocument } from "./storage";

// QaEngine abstracts the LLM transport so callers can route through
// either direct fetch (extension service worker) or IPC (Electron
// renderer → main). The renderer can't fetch localhost:11434 directly
// due to CORS, so it implements this interface against window.octovault.
export interface QaEngine {
  embed(text: string): Promise<number[]>;
  generate(prompt: string, system?: string): Promise<string>;
}

/** Build a QaEngine from an OllamaConfig — uses direct fetch. */
export function fetchQaEngine(cfg: OllamaConfig): QaEngine {
  return {
    embed: (text) => embed(cfg, text),
    generate: (prompt, system) => generate(cfg, { prompt, system, temperature: 0.1 }),
  };
}

// --- Scope ---
// Optional filter passed by the UI to narrow retrieval. The Chat input
// parses @mentions and produces this.
export interface QaScope {
  entityIds?: string[];     // restrict to these entities; empty/omitted = all
}

// --- Chat history (for query rewriting) ---
// One short past turn from the conversation, used to expand the current
// question into a standalone retrieval query (handles follow-ups like
// "and when did she graduate?").
export interface QaTurn {
  role: "user" | "assistant";
  text: string;
}

// --- Embedding records ---
export interface EmbeddingRecord {
  id: string;
  kind: "fact" | "chunk";
  entityId: string;
  documentId?: string;
  fieldKey?: ProfileKey;
  page?: number;
  text: string;
  vector: number[];
}

export interface QaCitation {
  documentId?: string;
  documentName?: string;
  entityId: string;
  fieldKey?: ProfileKey;
  fieldLabel?: string;
  excerpt: string;
  page?: number;
  score: number;
}

export interface QaResult {
  answer: string;
  citations: QaCitation[];
  retrieved: EmbeddingRecord[];
}

// --- Chunking ---
const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 100;

export function chunkText(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= CHUNK_SIZE) return cleaned ? [cleaned] : [];
  const out: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    out.push(cleaned.slice(i, i + CHUNK_SIZE));
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return out;
}

// --- Math ---
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// --- Rerank ---
// Cosine-top-K alone over-picks near-duplicate chunks from the same
// page and ignores everything we already know about the data. The
// rerank pass blends in three deterministic signals — no extra LLM
// call, no extra round-trip:
//
//   • factBoost      — facts (label: value) are denser than chunks.
//   • recency        — newer documents win on a 1-year half-life.
//   • authority      — for facts, multiply by DOC_AUTHORITY (a passport
//                      is more authoritative for passportNumber than a
//                      paystub is).
//
// Then MMR diversifies the final cut so we don't return five chunks
// from the same paragraph.
const FACT_BOOST = 0.05;
const RECENCY_WEIGHT = 0.1;
const RECENCY_HALF_LIFE_DAYS = 365;
const AUTHORITY_WEIGHT = 0.1;
const MMR_LAMBDA = 0.7;
const INITIAL_POOL_MULTIPLIER = 3;
const MIN_INITIAL_POOL = 12;

interface Scored { e: EmbeddingRecord; score: number; }

function recencyBoost(e: EmbeddingRecord, lookup: ProfileLookup, now: number): number {
  const doc = lookup.documents.find((d) => d.id === e.documentId);
  if (!doc) return 0;
  const ageDays = (now - doc.importedAt) / (1000 * 60 * 60 * 24);
  return Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
}

function authorityBoost(e: EmbeddingRecord, lookup: ProfileLookup): number {
  if (e.kind !== "fact" || !e.fieldKey) return 0;
  const doc = lookup.documents.find((d) => d.id === e.documentId);
  if (!doc) return 0;
  return authorityFor(doc.docType, e.fieldKey);
}

export function rerank(
  scored: Scored[],
  lookup: ProfileLookup,
  topK: number,
  now: number = Date.now(),
): Scored[] {
  const blended = scored.map(({ e, score }) => ({
    e,
    score:
      score
      + (e.kind === "fact" ? FACT_BOOST : 0)
      + RECENCY_WEIGHT * recencyBoost(e, lookup, now)
      + AUTHORITY_WEIGHT * authorityBoost(e, lookup),
  })).sort((a, b) => b.score - a.score);

  // MMR: greedily pick the next item that maximizes
  //   λ · relevance − (1 − λ) · maxSimilarityToAlreadyPicked
  const picked: Scored[] = [];
  const remaining = [...blended];
  while (picked.length < topK && remaining.length > 0) {
    if (picked.length === 0) {
      picked.push(remaining.shift()!);
      continue;
    }
    let bestIdx = 0;
    let bestMmr = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      let maxSim = 0;
      for (const p of picked) {
        const sim = cosine(r.e.vector, p.e.vector);
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = MMR_LAMBDA * r.score - (1 - MMR_LAMBDA) * maxSim;
      if (mmr > bestMmr) { bestMmr = mmr; bestIdx = i; }
    }
    picked.push(remaining.splice(bestIdx, 1)[0]);
  }
  return picked;
}

// --- Build embedding rows from a single freshly-imported document ---
export async function buildEmbeddingsForDocument(
  engine: QaEngine,
  doc: StoredDocument,
  candidates: { fieldKey: ProfileKey; value: string; entityId: string; page?: number }[],
): Promise<EmbeddingRecord[]> {
  const out: EmbeddingRecord[] = [];

  // Embed each fact (small, fast).
  for (const c of candidates) {
    const label = fieldByKey(c.fieldKey).label;
    const text = `${label}: ${c.value}`;
    const vector = await engine.embed(text);
    out.push({
      id: crypto.randomUUID(),
      kind: "fact",
      entityId: c.entityId,
      documentId: doc.id,
      fieldKey: c.fieldKey,
      page: c.page,
      text,
      vector,
    });
  }

  // Embed each text chunk of the doc.
  const chunks = chunkText(doc.text);
  for (const text of chunks) {
    const vector = await engine.embed(text);
    out.push({
      id: crypto.randomUUID(),
      kind: "chunk",
      entityId: doc.entityId,
      documentId: doc.id,
      text,
      vector,
    });
  }

  return out;
}

// --- Query ---
const SYSTEM = `You are an on-device assistant answering personal questions about the user
and their family using only the snippets provided. Cite sources inline like [1], [2]. If the
snippets don't contain the answer, say so plainly — never invent. Keep answers short.`;

interface ProfileLookup {
  entities: Entity[];
  vault: VaultProfile;
  documents: StoredDocument[];
}

export interface AskOptions {
  scope?: QaScope;
  history?: QaTurn[];
  topK?: number;
}

export async function ask(
  engine: QaEngine,
  question: string,
  embeddings: EmbeddingRecord[],
  lookup: ProfileLookup,
  opts: AskOptions = {},
): Promise<QaResult> {
  const { scope, history = [], topK = 6 } = opts;

  if (embeddings.length === 0) {
    return { answer: "I don't have any indexed documents yet. Import a document first.", citations: [], retrieved: [] };
  }

  // Optional scope filter: limit retrieval to specific entities.
  const pool = scope?.entityIds?.length
    ? embeddings.filter((e) => scope.entityIds!.includes(e.entityId))
    : embeddings;
  if (pool.length === 0) {
    return {
      answer: "No indexed data for the scoped entities. Try removing the @mention or importing a document for them.",
      citations: [], retrieved: [],
    };
  }

  // Query rewriting: if there's prior conversation context, ask the
  // model to expand the current question into a standalone retrieval
  // query that name-checks any people referenced. Cheap, big quality win.
  const retrievalQuery = history.length > 0
    ? await rewriteQuery(engine, question, history, lookup)
    : question;

  // Embed the (possibly rewritten) query and rank.
  // Two-stage: cosine narrows down to a wider initial pool, then
  // rerank() blends in fact/recency/authority signals and MMR-
  // diversifies to topK. The wider initial pool gives MMR room to
  // swap a near-duplicate for a more diverse result.
  const qVec = await engine.embed(retrievalQuery);
  const initialPoolSize = Math.max(topK * INITIAL_POOL_MULTIPLIER, MIN_INITIAL_POOL);
  const initial = pool.map((e) => ({ e, score: cosine(qVec, e.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, initialPoolSize);
  const scored = rerank(initial, lookup, topK);

  const retrieved = scored.map((s) => s.e);

  // Build citations.
  const citations: QaCitation[] = retrieved.map((r, i) => {
    const doc = lookup.documents.find((d) => d.id === r.documentId);
    const fieldLabel = r.fieldKey ? fieldByKey(r.fieldKey).label : undefined;
    return {
      documentId: r.documentId,
      documentName: doc?.name,
      entityId: r.entityId,
      fieldKey: r.fieldKey,
      fieldLabel,
      excerpt: r.text.slice(0, 200),
      page: r.page,
      score: scored[i].score,
    };
  });

  // Compose context block.
  const ctxLines = retrieved.map((r, i) => {
    const entity = lookup.entities.find((e) => e.id === r.entityId)?.name ?? "Unknown";
    const doc = lookup.documents.find((d) => d.id === r.documentId)?.name ?? "user-entered";
    return `[${i + 1}] (${entity} · ${doc}${r.page ? ` p.${r.page}` : ""}) ${r.text}`;
  }).join("\n\n");

  // Add canonical-profile summary for direct fact lookups.
  const summary = summarizeProfiles(lookup);

  const prompt = `Question: ${question}

Profile summary:
${summary}

Snippets:
${ctxLines}

Answer the question using only the information above. Cite the snippet number(s) you used like [1] or [1,3].`;

  const raw = await engine.generate(prompt, SYSTEM);

  // Strip thinking tags if the model used them.
  const answer = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();

  return { answer, citations, retrieved };
}

// Expand a follow-up question into a standalone retrieval query.
// "and when did she graduate?" → "When did <name from prior turn> graduate?"
async function rewriteQuery(
  engine: QaEngine,
  question: string,
  history: QaTurn[],
  lookup: ProfileLookup,
): Promise<string> {
  const entityNames = lookup.entities.map((e) => e.name).filter(Boolean).join(", ");
  const recent = history.slice(-6)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text.slice(0, 300)}`)
    .join("\n");

  const prompt = `Rewrite the user's latest question into a self-contained search query for
a local document retrieval system. Resolve all pronouns ("she", "they", "it",
"my husband") to concrete names. Use the conversation context and the list
of known entities. Output the rewritten query ONLY — no commentary.

Known entities: ${entityNames || "(none)"}

Recent conversation:
${recent}

User: ${question}

Rewritten query:`;

  try {
    const raw = await engine.generate(prompt);
    const cleaned = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "");
    // If the model returned nothing useful, fall back to the original.
    return cleaned.length >= 4 && cleaned.length < 500 ? cleaned : question;
  } catch {
    return question;
  }
}

function summarizeProfiles(lookup: ProfileLookup): string {
  const lines: string[] = [];
  for (const entity of lookup.entities) {
    const profile = lookup.vault[entity.id];
    if (!profile) continue;
    const facts: string[] = [];
    for (const f of PROFILE_FIELDS) {
      const record: FieldRecord | undefined = profile[f.key];
      const v = record ? canonicalValue(record) : null;
      if (v?.value) facts.push(`${f.label}: ${v.value}`);
    }
    if (facts.length) lines.push(`${entity.name} (${entity.relationship}) — ${facts.join("; ")}`);
  }
  return lines.join("\n") || "(no extracted facts yet)";
}

// Force tree-shake-friendly type re-export so callers can import these
// alongside ask().
export type { Profile };
