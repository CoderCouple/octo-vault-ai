// Local Q&A with source citations. Embeddings of facts + document
// chunks live in IndexedDB / SQLCipher. Retrieval is hybrid:
//   1. Rewrite the question into 1–N retrieval variants (LLM call,
//      cached per-session) that expand abbreviations and synonyms —
//      "I797" → "I-797", "H-1B approval notice", etc.
//   2. For each variant, run BOTH cosine (vector) and BM25 (keyword)
//      retrieval.
//   3. Reciprocal Rank Fusion (RRF) merges all per-variant rankings
//      from both retrievers into one fused score.
//   4. rerank() applies MMR + recency + authority boosts and trims
//      to topK.
// Hybrid retrieval catches abbreviation queries (vector can't match
// "I797" semantically because the embeddings model treats it as
// random tokens) and exact-string queries that vector retrieval
// misses.

import MiniSearch from "minisearch";
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

// --- Hybrid retrieval helpers (Phase 3) ---

// Per-process cache for LLM query expansions. Cleared on app restart,
// not on vault lock — query strings are not secret. Keyed by raw
// question text.
const QUERY_EXPANSION_CACHE = new Map<string, string[]>();
const MAX_QUERY_VARIANTS = 3;

// Ask the local LLM for alternative phrasings of a query that expand
// abbreviations, form codes, and common synonyms. Returns the original
// question plus up to N expansions. Cached per-session.
async function expandQueryVariants(engine: QaEngine, question: string): Promise<string[]> {
  const trimmed = question.trim();
  if (!trimmed) return [trimmed];
  const cached = QUERY_EXPANSION_CACHE.get(trimmed);
  if (cached) return cached;

  const prompt = `Rewrite this question into up to ${MAX_QUERY_VARIANTS} alternative phrasings that expand abbreviations, form codes (like I-797, I-94, EAD, H-1B), and common synonyms (like DOB / date of birth / birthday). One phrasing per line, no numbering, no preamble.

Question: ${trimmed}

Alternative phrasings:`;

  try {
    const raw = await engine.generate(prompt);
    const lines = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
      .split("\n")
      .map((s) => s.trim())
      .map((s) => s.replace(/^[-*•\d]+\.?\s*/, "")) // strip bullet/number prefixes
      .filter((s) => s && s.length > 2 && s.length < 200 && s !== trimmed)
      .slice(0, MAX_QUERY_VARIANTS);
    // Always include the original; dedupe.
    const variants = Array.from(new Set([trimmed, ...lines]));
    QUERY_EXPANSION_CACHE.set(trimmed, variants);
    return variants;
  } catch {
    // Expansion is best-effort — fall back to the original question
    // alone rather than failing the whole retrieval.
    return [trimmed];
  }
}

// Phase 5 — alias-aware BM25.
// We index two fields per record:
//   - text   : the original sentence/snippet (full weight)
//   - aliases: the curated synonyms for that record's fieldKey, plus
//              the human label. Lower weight so direct hits still win.
// Why: "I-797 expiry" → user types "h1b end date" → vector hits the
// passport doc instead. Aliases close that gap deterministically
// without needing the LLM to rewrite the query.
const ALIAS_INDEX: Map<string, string> = new Map(
  PROFILE_FIELDS.map((f) => [f.key, [f.label, ...f.aliases].join(" ")]),
);

interface IndexedRecord extends EmbeddingRecord { aliases: string; }

function buildBm25(pool: EmbeddingRecord[]): MiniSearch<IndexedRecord> {
  const ms = new MiniSearch<IndexedRecord>({
    fields: ["text", "aliases"],
    storeFields: ["id"],
    idField: "id",
    searchOptions: {
      boost: { text: 1, aliases: 0.6 },
      fuzzy: 0.2,        // small fuzziness handles typos + plural forms
      prefix: true,      // "expir" matches "expiration"
    },
  });
  const enriched: IndexedRecord[] = pool.map((r) => ({
    ...r,
    aliases: r.fieldKey ? (ALIAS_INDEX.get(r.fieldKey) ?? "") : "",
  }));
  ms.addAll(enriched);
  return ms;
}

// Reciprocal Rank Fusion. Each ranking is a list of EmbeddingRecord
// ids ordered best-first. Returns a Map<id, fused-score>. Standard
// k = 60 from the original RRF paper (Cormack et al., 2009).
function rrf(rankings: string[][], k = 60): Map<string, number> {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const id = ranking[rank]!;
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank));
    }
  }
  return fused;
}

// --- Query ---
// Why the prompt is shaped this way:
// 1. Snippets are presented as natural sentences ("Sunil's passport
//    expires on 14/01/2035 …") rather than "Field: Value" pairs.
//    qwen3:8b reliably extracts facts from prose but treats structured
//    "Field: Value" lines as database metadata it shouldn't cite from
//    — which led to the June-2026 bug where the answer was right there
//    and the model said "not in the snippets."
// 2. The system prompt accepts BOTH the snippet block (chunks of doc
//    text) AND structured facts as citable. Citation numbers come from
//    the same numbered list regardless of source kind.
// 3. We loosen "use only the snippets" to "use the facts and excerpts
//    below" — same intent (no hallucination), better posture (the
//    model knows facts ARE allowed answers).
const SYSTEM = `You are an on-device assistant answering personal questions about
the user and their family. Use the facts and document excerpts provided below.
Each is numbered — cite the ones you used inline like [1] or [1,3]. If the
provided information doesn't answer the question, say so plainly and don't
invent details. Keep answers short and direct.`;

// Render a retrieved fact-embedding as a natural sentence the LLM
// will cite from cleanly. Falls back to the raw text for chunk-kind
// records (which are already prose).
function factToSentence(
  r: EmbeddingRecord,
  entityName: string,
  docName: string,
): string {
  if (r.kind === "chunk") {
    return `${r.text} (from ${docName}${r.page ? ` p.${r.page}` : ""})`;
  }
  // Fact: pull the structured "Label: Value" apart and reassemble as
  // possessive prose. "Date of Birth: 1987-08-28" → "Sunil's Date of
  // Birth is 1987-08-28."
  const colonIdx = r.text.indexOf(":");
  if (colonIdx < 0) {
    return `${entityName}: ${r.text} (from ${docName})`;
  }
  const label = r.text.slice(0, colonIdx).trim();
  const value = r.text.slice(colonIdx + 1).trim();
  return `${entityName}'s ${label} is ${value} (from ${docName}${r.page ? ` p.${r.page}` : ""}).`;
}

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

  // Query rewriting (history-aware): if there's prior conversation
  // context, rewrite "she" / "their" / "the one I mentioned" into the
  // standalone names. Separate from variant expansion below.
  const baseQuery = history.length > 0
    ? await rewriteQuery(engine, question, history, lookup)
    : question;

  // --- Hybrid retrieval (Phase 3) ---
  // Step 1: expand into multiple retrieval variants that cover
  // abbreviation / synonym gaps the embedding model misses.
  // Step 2: for each variant, run both cosine and BM25.
  // Step 3: RRF-fuse all per-variant per-retriever rankings into one
  // ordered list.
  // Step 4: take the top initialPoolSize for the existing
  // rerank() (which handles MMR + recency + authority).
  const variants = await expandQueryVariants(engine, baseQuery);
  const bm25 = buildBm25(pool);
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const initialPoolSize = Math.max(topK * INITIAL_POOL_MULTIPLIER, MIN_INITIAL_POOL);

  const rankings: string[][] = [];
  for (const v of variants) {
    // Vector ranking: full-pool cosine sort.
    const qVec = await engine.embed(v);
    const vecOrdered = pool
      .map((e) => ({ id: e.id, score: cosine(qVec, e.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, initialPoolSize)
      .map((x) => x.id);
    rankings.push(vecOrdered);

    // BM25 ranking: keyword + fuzzy + prefix over the same pool.
    const bm25Results = bm25.search(v).slice(0, initialPoolSize).map((r) => String(r.id));
    if (bm25Results.length > 0) rankings.push(bm25Results);
  }

  // Fuse + take top initialPoolSize for the existing rerank() to chew on.
  const fused = rrf(rankings);
  const fusedOrdered = Array.from(fused.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, initialPoolSize)
    .map(([id, score]) => ({ e: poolById.get(id)!, score }))
    .filter((x) => x.e);
  const scored = rerank(fusedOrdered, lookup, topK);

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

  // Compose context block. Each retrieved record renders as a single
  // numbered natural-language sentence — see factToSentence(). This is
  // the key fix for the June-2026 bug where structured "Label: Value"
  // snippets were retrieved but the LLM refused to cite them.
  const ctxLines = retrieved.map((r, i) => {
    const entityName = lookup.entities.find((e) => e.id === r.entityId)?.name ?? "The user";
    const docName = lookup.documents.find((d) => d.id === r.documentId)?.name ?? "user-entered";
    return `[${i + 1}] ${factToSentence(r, entityName, docName)}`;
  }).join("\n");

  // Add canonical-profile summary for direct fact lookups.
  const summary = summarizeProfiles(lookup);

  const prompt = `Question: ${question}

Profile summary:
${summary}

Facts and excerpts (numbered for citation):
${ctxLines}

Answer using the facts and excerpts above. Cite the numbers you used like [1] or [1,3].`;

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
