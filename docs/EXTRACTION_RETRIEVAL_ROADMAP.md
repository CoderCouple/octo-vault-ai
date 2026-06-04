# Extraction, Storage, Retrieval — Roadmap

Status: **DRAFT** · author: Sunil + Payal · last updated: 2026-06-04
Owner: jointly maintained. Update before starting work in any of the three
layers below.

---

## Why this document exists

Live user testing in June 2026 exposed three classes of failures in the
chat / Spotlight overlay:

1. **Marriage Certificate.pdf** imported as `unknown` and produced zero
   extracted facts. The schema doesn't know what a marriage certificate
   is, so the extraction prompt has nothing to ask for.
2. **"When does my I-797 expire?"** retrieved passport rows. Vector-only
   retrieval doesn't cluster form-code abbreviations with their
   spelled-out equivalents in the H-1B PDF that actually has the answer.
3. **"When does my passport expire?"** retrieved the right fact, then
   the LLM said it wasn't in the snippets. Fact-text format (`"Field:
   Value"`) is hostile to qwen3:8b's RAG-citation behavior.

The three problems are stacked. Extraction quality bounds storage
quality, storage shape bounds retrieval quality, retrieval quality
bounds chat quality. Fixing one without the others is whack-a-mole.

This roadmap commits to the target architecture and the phases to get
there. **All work stays local-only. All work keeps business logic out
of the UI package.**

---

## Non-negotiable principles

### 1. Local-only

No phase introduces a cloud dependency for the **product**. The only
cloud touch in the entire system is the landing-page waitlist row in
Supabase, which is unrelated to the product runtime. All extraction,
storage, retrieval, embedding, query rewriting, and answer generation
runs against the user's local Ollama instance on `localhost:11434`,
their on-device SQLCipher database (desktop) or WebCrypto + IndexedDB
vault (extension), and JS libraries bundled into the app.

This rules out:

- Hosted graph databases (Neo4j Aura, Memgraph Cloud, TigerGraph Cloud)
- Hosted vector databases (Pinecone, Weaviate Cloud, Qdrant Cloud)
- Hosted LLM APIs (OpenAI, Anthropic, Cohere) for any product runtime path
- Hosted embedding APIs (Cohere embed, OpenAI text-embedding-3)
- Hosted eval / tracing platforms (Langfuse, Braintrust, LangSmith) for
  user-data traces. Dev-only telemetry that never touches user data is
  acceptable, but we currently don't use any.

### 2. Business logic stays out of the UI package

Today, packages are organized as:

```
packages/
├── core/        Business logic, storage adapters, schemas, extraction,
│                Q&A pipeline, embedding, derivation. **No React.**
├── ui/          React components, views, hooks. **No business logic.**
├── desktop/    Electron-specific glue (main / preload / renderer wiring).
├── extension/  Chrome-specific glue.
└── landing/    Marketing site. Independent.
```

The principle: **the UI package is a thin renderer over `core`**. UI
components receive data and callbacks; they don't orchestrate. If we
catch ourselves writing `if (docType === 'passport') …` inside a UI
file, we've crossed a line — that logic belongs in `core`.

The new extraction-retrieval-storage work all lands in
`@octovault/core`. UI changes (when needed — e.g., the Conflicts view
gaining "Event" rendering) take only what `core` exports, never
re-derive it.

This is enforced socially during code review for now. We should add a
lint rule eventually that prohibits storage-shape or LLM-pipeline
imports from the `ui` package.

---

## Why not Memgraph / Neo4j / TigerGraph?

We've evaluated and rejected hosted **and** self-hosted graph
databases. The reasoning:

| Option | Why rejected |
|---|---|
| **Memgraph (Cloud or self-hosted)** | Requires a separate server process. Desktop app needs to bundle + supervise it. ~250 MB install. JVM-free is a recent addition; still tens of MB of native binaries per platform. Breaks "drag the .dmg, double-click, done." Already explicitly rejected in our north-star memory. |
| **Neo4j Community (embedded)** | JVM dependency (~150 MB). Cypher is great but the runtime is too heavy for an Electron consumer app. We'd be shipping more JVM than Electron. |
| **TigerGraph** | Server-only. Same problem as Memgraph. |
| **ArangoDB** | Bundles its own server. Same shape, same problem. |
| **DGraph** | Server-only. Same shape. |
| **Cozodb** | Embedded, Datalog-style queries, written in Rust. Acceptable fallback if SQL-over-SQLite ever becomes a perf bottleneck for graph traversal. Not needed at our scale (low tens of thousands of facts per user). |

**Decision:** keep using SQLite (SQLCipher on desktop) and IndexedDB
(extension). Both have full schema flexibility — we can model the graph
as entities + facts + events + relationships with foreign keys, and
compute closure / derivation in TypeScript in memory. At OctoVault
scale, a single-user vault has thousands, not billions, of facts. Plain
relational queries are fine and avoid the multi-binary tax.

---

## Why not Graphiti / Zep / GraphRAG?

[Graphiti](https://github.com/getzep/graphiti) (from getzep) is the
closest open-source project to what we want — a temporal knowledge
graph built from documents, with LLM-driven extraction and entity
resolution. **Conceptually a near-perfect match.** Architecturally a
mismatch for OctoVault:

| Mismatch | Detail |
|---|---|
| Python runtime | Graphiti is a Python library. OctoVault is JS/TS in Electron. Embedding Python in Electron is technically possible but adds ~80 MB and a whole new install / supervision story. |
| Neo4j backend | Graphiti's storage layer is Neo4j. Same JVM problem as above. |
| OpenAI default | LLM calls are wired to OpenAI by default; switching to Ollama is custom work. |
| Async server shape | Graphiti is designed to run as a server next to an agent, not bundled inside a desktop app. |

**Decision: borrow the ideas, don't import the library.** Specifically,
Graphiti's design principles we should adopt:

1. **Bi-temporal facts.** Each fact has a "valid time" (when the fact
   was true in the world) AND an "observed time" (when we learned about
   it from a document). This solves supersession cleanly: a 2024 utility
   bill saying "address = X" with `valid_from = 2024-03` supersedes a
   2019 license saying "address = Y" with `valid_from = 2019-01` —
   *without* us having to special-case address-staleness.
2. **Events as first-class.** Marriage, birth, divorce, adoption are
   events that link multiple entities + have a date + may have an
   end date. Treating these as first-class rows (not derived from
   flat fields) gives clean derivation rules.
3. **Entity resolution as a separate pass.** Don't try to do entity
   linking inside the extraction prompt. Extract names as-mentioned;
   resolve to canonical entities in a separate step that can use
   fuzzy matching, prior context, and user confirmation.
4. **Communities / clusters.** Graphiti groups related entities into
   "communities." For OctoVault that maps to "your immediate family",
   "your extended family", "your employers" — useful for scoping
   queries.

The implementation is ours, in TypeScript, on our SQLite/IDB
substrate.

---

## What changes — per layer

### Extraction (`packages/core/src/extract.ts`, `schema.ts`, `review.ts`)

**Today:** single LLM call returns `{ docType, entityName, fields[],
education[], experience[] }`. DocType is a hardcoded enum of 15
non-civil-status types. Unknown types are a black hole.

**Target:**

1. **Soft doc-type system.** Hardcoded enum becomes a *preferred set*
   with full per-type schemas. LLM-suggested types outside the enum are
   accepted with a generic-but-typed extraction (not the current
   no-op).
2. **Add civil-status doc types** with full schemas: `marriage_certificate`,
   `birth_certificate`, `divorce_decree`, `adoption_record`,
   `naturalization_certificate`, `death_certificate`, `court_order`.
3. **Multi-entity output.** Extraction returns `subjects[]`, not a
   single `entityName`. Marriage cert returns two subjects + an event;
   birth cert returns three.
4. **Event emission.** Extraction can return an `event` object with
   type, participants, date, and source. Saved to the new `events`
   table.
5. **Relationship emission.** Marriage cert → emit `spouse`
   relationship; birth cert → `parent ↔ child`; adoption record →
   same plus `via: "adoption"`. This is the moment the graph becomes
   self-building.
6. **Confidence tiers expanded.** Add an `unsure_split` tier for
   candidates the LLM saw two of and stored both — surfaces to the
   user via the Conflicts view instead of silently picking.

### Storage (`packages/core/src/schema.ts`, `storage.ts`, adapters)

**Today:** flat fields per entity; relationships are a separate table;
embeddings carry both display and embed text in the same column;
candidates → canonical resolution exists per-field but isn't uniform.

**Target:**

1. **Claim model, uniform.** Every fact is a `Claim`: `{ entityId,
   fieldKey, value, source: { docId, page, excerpt }, validFrom?,
   validTo?, observedAt, confidence }`. Multiple claims per (entity,
   fieldKey) are normal. A canonical resolver picks the active claim
   based on recency, source authority, and explicit user pins.
2. **Event table.** New: `Event { id, type, participants[], date,
   endDate?, source, attributes }`. Event types: marriage, birth,
   divorce, adoption, naturalization, death, court_order, employment_start,
   employment_end. Closure rules run over events (in-law via marriage
   event, not just spouse-field).
3. **Alias table.** Static curated map: `{ fieldKey →
   [aliases...] }`. Used at embed time (each fact is embedded under
   every alias) and at query-rewrite time. Initially ~50 fields,
   ~5 aliases each.
4. **Decouple display text from embedding text.** Stored canonical
   claim is the source of truth. Multiple embedding-input strings are
   generated from it. Multiple prompt-display strings are also
   generated from it. The two views diverge: embeddings get noisy
   alias variants, the prompt gets clean natural sentences.

### Retrieval (`packages/core/src/qa.ts`)

**Today:** vector-only cosine over fact + chunk embeddings, top-K MMR
diversified, prompt instructs LLM to "cite snippet number."

**Target:**

1. **Hybrid retrieval.** Add BM25 keyword search via
   [`minisearch`](https://github.com/lucaong/minisearch) (~9 KB
   gzipped, JS-native, in-memory). Combine with cosine via reciprocal-
   rank fusion (RRF). BM25 catches abbreviations, exact strings,
   form codes; vector catches semantic matches.
2. **Query rewriting.** Before retrieval, a small local Ollama call
   rewrites the user's query into 1–3 retrieval variants. "When does
   my I797 expire" → ["I-797 expiration date", "H-1B approval notice
   expiration", "USCIS I-797 expires"]. Each variant runs through
   both retrievers; results unioned.
3. **Field-name boosting.** If a query contains a known field name or
   alias, boost facts of that field-key in ranking.
4. **Prompt format swap.** Sentences, not `Field: Value` pairs.
   `"Sunil's passport expires on 14/01/2035 (passport.pdf)"` instead
   of `"Passport Expiry Date: 14/01/2035"`. Loosen the system prompt
   from "cite verbatim from snippets" to "answer using the structured
   facts and document excerpts below; cite source numbers you used."

---

## Phases — what we build, in order

Each phase is shippable standalone. Each phase unblocks more of the
next. **No phase reaches for a cloud service.**

### Phase 1 — Prompt + sentence formatting (2 hours)

- New helper in `qa.ts`: `factToSentence(claim, entityName, docName)`
  returns `"Sunil's passport expires on 14/01/2035 (passport.pdf)"`.
- Use it when building the prompt context block.
- Loosen `SYSTEM` prompt: drop "cite snippet number verbatim" framing.
  New language: *"Answer using the facts and document excerpts below.
  Cite the source numbers you used in brackets, e.g. [1] or [1,3]."*
- **Test:** the three failing queries from June 2026 should pass with
  no other changes.

### Phase 2 — Doc-type schemas + relationship emission (1 day)

- `schema.ts`: extend `DocType` with the 7 civil-status types.
- `extract.ts`: add per-type field hints to the prompt
  (marriage_certificate asks for `marriedOn`, `placeOfMarriage`,
  `spouseA`, `spouseB`, etc.). Loosen the JSON-Schema enum to
  accept any LLM-proposed type; map unknown-but-typed to a generic
  extraction path.
- Extraction now returns `subjects[]` (not a single `entityName`).
- For `marriage_certificate` + `birth_certificate` + `adoption_record`:
  emit Relationship rows automatically.
- **Test:** marriage cert from June 2026 produces ≥4 facts and 1
  spouse-relationship row.

### Phase 3 — Hybrid retrieval + query rewriting (1–2 days)

- Add `minisearch` to `@octovault/core` (lightweight, JS-native, runs
  in renderer process — no native binaries).
- New `qa.ts` retrieval pipeline:
  1. Rewrite query via local Ollama → N variants
  2. Run each variant through cosine + BM25
  3. RRF-merge ranks across variants and retrievers
  4. MMR diversify final top-K
- **Test:** "I-797 expiry" finds the H-1B doc; "DOB" finds Date of Birth.

### Phase 4 — Claim / Event storage refactor (2–3 days)

- New `Claim` and `Event` types in `core/schema.ts`.
- Migration scripts in both SQLCipher (desktop) and IndexedDB
  (extension) adapters. Old `Field` rows are migrated to `Claim` rows
  preserving provenance + canonical state.
- New `events` table in both stores.
- `derive.ts` closure rules read from `events` for marriage / birth
  derivation in addition to direct `relationships`.
- UI: Conflicts view gets a new "Event" subtab; FactsGraph renders
  events as a third node-type alongside docs + facts.
- **Test:** a vault with a marriage cert + two passports correctly
  shows: 2 spouse-relationship rows (one direct, one derived), 1
  marriage event, and in-law closures if parent-relationships exist.

### Phase 5 — Alias table + alias-aware embedding & retrieval (1 day)

- New `aliases.ts` in `@octovault/core` with a curated map of
  `{ fieldKey → string[] }` for the ~50 most-common fields.
- At embed time: each fact is embedded under canonical *and* every
  alias variant. Stored as separate `EmbeddingRecord`s pointing at the
  same fact.
- At query-rewrite time: known aliases auto-expand the query.
- **Test:** "birthday", "born on", "DOB" all retrieve the same
  Date-of-Birth claim.

### Phase 6 — Golden test set + extraction-quality dashboards (1 day)

- `tests/qa/golden.yaml`: ~30 (question, expected entity + field +
  optional answer regex) pairs across the major doc types we support.
- `scripts/eval-qa.ts`: runs the golden set against a fixture vault.
  Reports pass/fail counts per doc type and per query type.
- Settings → Diagnostics gains a "Run extraction QA" button that runs
  the same suite against the user's own vault. Surfaces missing facts.
- **Test:** the script itself runs locally, no external network calls.

---

## Architecture diagram (target)

```
                       Documents (raw PDF/image)
                                │
                  OCR + PDF.js (local, in-renderer)
                                │
                                ▼
                  Extraction (local Ollama qwen3:8b)
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
        Subjects[]          Claims[]           Events[]      Relationships[]
        (entities)      (fact + provenance)   (multi-entity,   (auto-emitted
                                                  dated)        from events)
              │                 │                 │                 │
              └────────┬────────┴────────┬────────┴────────┬────────┘
                       ▼                 ▼                 ▼
                  SQLCipher (desktop) / IndexedDB (extension)
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
            Vector index               BM25 keyword index
            (alias-aware,              (minisearch, in-memory,
             nomic-embed-text)          aliases tokenized)
                  │                           │
                  └─────────────┬─────────────┘
                                ▼
                        RRF fusion
                                │
                                ▼
              Query rewriter (local qwen3:8b, ~200ms)
                                │
                                ▼
              Prompt assembly (natural sentences,
                  not Field:Value)
                                │
                                ▼
                  Local Ollama qwen3:8b → answer + [N] cites
                                │
                                ▼
                  Chat / Spotlight overlay / Side panel
```

Compare to current:

```
Documents → Extract (LLM) → flat fields → embed "Field: Value" →
            cosine top-K → "cite snippet [N]" prompt → LLM
```

The current arrow is fewer boxes but loses too much information at
every step. The target preserves provenance, multi-entity structure,
and search relevance.

---

## What we're *not* doing (anti-goals)

- **Not building a UI for managing claims, events, aliases.** Power
  features for v2. Today's UI (Documents, Conflicts, Facts graph,
  Chat, Settings) is sufficient — the new data model shows up there.
- **Not migrating the existing vault data destructively.** Phase 4
  migrations are forward-compatible. Old vaults open and read fine.
- **Not abandoning vector retrieval.** Hybrid means vector + BM25
  together, not BM25 alone.
- **Not adding a second LLM provider.** Single dependency on local
  Ollama. Multi-provider is platform thinking, not consumer product
  thinking.
- **Not building auto-fine-tuning.** If accuracy plateaus in Phase 6,
  Unsloth-on-Apple-Silicon is a Phase 7 we can take. Not before.

---

## Resolved decisions

Locked in 2026-06-04. Update this section (don't edit phases) if any
decision flips later.

1. **Events: first-class rows.** New `events` table in both adapters.
   Closure rules read events (marriage → in-laws via wife's parents)
   in addition to `relationships`. FactsGraph gets a third node type
   alongside docs + facts.
2. **Canonical resolution: keep single-canonical + pinnable** (current
   model). Phase 4 migration is forward-compatible. Conflicts UI
   doesn't need rework.
3. **BM25 library: `minisearch`** (~9 KB gzipped, JS-native, in-memory).
   If the golden test set in Phase 6 shows recall issues we revisit;
   default stays small.
4. **Query rewriting: always rewrite, cache per session.** Every
   user-typed query goes through a 1-call qwen3:8b rewrite that
   expands abbreviations + synonyms. Cache by exact query string for
   the duration of the unlock session; clears on lock/quit. ~200 ms
   first time, instant on repeat.
5. **Alias map: curated for v1.** Hand-write the ~50 most-common
   personal-data fields × ~5 aliases each. ~30 min of writing.
   Learned-from-query-history is a Phase 7+ automation.

---

## Where each piece of code lives

| New code | Package | File |
|---|---|---|
| `factToSentence(claim, entity, doc)` | core | `qa.ts` |
| Per-type extraction schema for marriage_certificate, etc. | core | `extract.ts`, `schema.ts` |
| `Claim`, `Event` types | core | `schema.ts` |
| Event-based derivation | core | `derive.ts` |
| Alias table | core | `aliases.ts` (new) |
| BM25 index | core | `bm25.ts` (new), uses `minisearch` |
| RRF + query rewriting | core | `qa.ts` (extended) |
| Golden test runner | scripts | `scripts/eval-qa.ts` (new) |
| Settings → Diagnostics UI | ui | `views/Settings.tsx` — thin wrapper that calls a `core` function |

**Nothing in `packages/ui` orchestrates extraction, storage, or
retrieval.** UI calls `core` exports; everything else stays in `core`.

---

## Acceptance criteria (when is this "done"?)

Phase 1–6 are done when:

- The three June 2026 failing queries pass.
- Marriage Certificate.pdf yields ≥4 facts + a spouse relationship.
- The golden set has ≥85% pass rate across all supported doc types.
- Settings → Diagnostics shows per-doc-type extraction stats from the
  user's own vault.
- All of this runs with the user's Wi-Fi turned off (Ollama local,
  SQLCipher local, BM25 in-memory, no cloud calls anywhere).
- `@octovault/ui` does not import `extract.ts`, `qa.ts`, `derive.ts`,
  `aliases.ts`, or `bm25.ts`. Only `@octovault/core` does.

---

## References we explicitly considered

- [Graphiti (Zep)](https://github.com/getzep/graphiti) — design ideas
  we borrow (bi-temporal, events as first-class, separate entity
  resolution). Stack mismatch; we don't import it.
- [Memgraph](https://memgraph.com/) — rejected, server-only.
- [Neo4j Community](https://neo4j.com/) — rejected, JVM-heavy.
- [Cozodb](https://github.com/cozodb/cozo) — fallback if SQL-over-
  SQLite ever becomes a perf bottleneck for graph traversal.
- [minisearch](https://github.com/lucaong/minisearch) — preferred
  BM25 lib (~9 KB, JS-native, in-memory).
- [Andrej Karpathy's LLM Knowledge Base](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
  — same north-star (local + private personal knowledge over LLMs).
- [DAIR.AI's analysis of Karpathy's pattern](https://academy.dair.ai/blog/llm-knowledge-bases-karpathy)
  — vector-RAG-on-cloud vs local-compiled-corpus framing.

---

## How we'll work

- This doc is the source of truth. Update it before changing direction.
- Each phase gets a PR with the doc updated to reflect what shipped.
- Open design questions get resolved inline (delete or edit the
  question + add the decision).
- Anything not in this doc, we don't build (unless we add it here
  first).
