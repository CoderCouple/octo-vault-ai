# OctoVault — context for AI assistants

This file is the entry point for any Claude session working in this
repo. Read this first. The longer docs it points at are the source
of truth for architecture and roadmap.

## What this is

OctoVault is a local-first personal knowledge graph for personal
documents (passports, marriage certs, I-797s, leases, paystubs…).
Every byte stays on-device — SQLCipher for the desktop vault,
WebCrypto + IndexedDB for the browser extension. Inference runs
through a local Ollama (`qwen3:8b` for chat/extraction,
`nomic-embed-text` for embeddings).

The product goal is the **knowledge graph itself**, not the chat or
the form-fill. Chat is a query surface; form-fill is a demo. Every
new feature should be evaluated against "does this make the graph
richer, more correct, or more trustworthy?"

## Where to read more

- `ARCHITECTURE.md` — the full system design, including the Karpathy
  "LLM personal-knowledge OS" lineage.
- `docs/EXTRACTION_RETRIEVAL_ROADMAP.md` — six-phase plan for the
  extraction/retrieval/storage overhaul. Phases 1–6 are shipped.
- Recent `git log` — the commit messages are the canonical "why."

## Repo layout

Monorepo via npm workspaces. **All business logic lives in `core`.**
Other packages are thin shells.

```
packages/
  core/        Schema, storage adapters, extraction, QA pipeline,
               derivation rules. Pure TS, no DOM, no Electron. The
               only place to put new logic.
  ui/          React views + components. Imports everything from
               core. No fetch calls, no Ollama calls — uses an
               injected `AppHost` for IO. Keep it dumb.
  desktop/     Electron shell. main/ owns SQLCipher + the IPC
               bridge; preload/ exposes it; renderer/ wires the
               UI to it via host.ts.
  extension/   Chrome MV3 extension. Read-only against the desktop
               vault via a localhost HTTP bridge; falls back to
               an encrypted IndexedDB vault when desktop is offline.
  landing/    Marketing site. Static Vite build deployed to Vercel.
```

## Run / build

```sh
# Dev (Electron, hot-reloads renderer)
npm run dev:desktop

# Type-check (all packages)
npm run typecheck
npx tsc -p packages/core    --noEmit   # per-package, faster
npx tsc -p packages/desktop --noEmit
npx tsc -p packages/ui      --noEmit
npx tsc -p packages/extension --noEmit

# Production build
npm run build                    # all packages
npm run build:desktop            # just desktop
npm run package:mac-arm          # signed + notarized DMG

# Smoke tests (no test runner — these are tsx scripts)
npx tsx packages/core/scripts/test-rerank.ts
npx tsx packages/core/scripts/eval-qa.ts --dry-run
```

There is **no formal test suite.** The smoke scripts above are the
regression bar. Add to `golden.yaml` when fixing retrieval bugs.

## Design rules that matter

1. **Local-only.** No cloud dependencies in product runtime. Ollama
   is local. SQLCipher is local. Embeddings are local. The landing
   site uses Supabase + PostHog — that's marketing, not product.
2. **Business logic in `core`.** If you're adding a method to a
   storage adapter, hand-rolling extraction logic, or computing
   derived facts in the renderer — stop and move it to `core`.
3. **Hybrid schema.** ~50 high-value fields are typed in
   `schema.ts` (`PROFILE_FIELDS`); long-tail fields go into the
   `extras` channel and are indexed for retrieval but not part of
   the canonical Profile.
4. **No new abstractions on a hunch.** Three similar lines is fine.
   Don't introduce a transport interface, a factory, or a feature
   flag without a concrete second caller.
5. **Closure rules over assertions.** `derive.ts` computes inferred
   facts (in-laws, co-parents, ages, shared events) from the asserted
   ones. Don't persist derived facts; recompute them on read.
6. **Events are first-class.** Marriages, births, deaths, naturalizations
   are `Event` rows with participants + date, not just fields on a
   Profile. `derive.ts` reads them for closure.

## Current state (as of the last commit on `main`)

- Phases 1–6 of the QA pipeline are shipped (sentence-format snippets,
  per-type extraction hints + extras, hybrid BM25+vector retrieval
  with RRF and LLM query rewriting, civil-status auto-edges, Event
  graph, alias-aware BM25, golden eval scaffold).
- Code-signing + notarization wired for macOS via electron-builder.
  Distribution from a non-managed Mac is required for notarization
  stapling (MDM can intercept Apple's stapler).
- Floating shortcut + Spotlight overlay + global hotkey all live in
  `desktop/main/index.ts`; configurable from Settings.

## Known traps

- **`desktop/src/renderer/src/host.ts` had a duplicated extractor**
  with its own `DOC_TYPES` list that silently dropped civil-status
  and immigration types. As of `d8fcec7` it imports the canonical
  list from `core/extract.ts` and applies `classifyByKeywords` on
  the unknown path. **Don't reintroduce a private DOC_TYPES list.**
  The TODO at the bottom of `extractFromText` is to collapse the
  duplicate entirely onto core's implementation behind a transport
  interface, like `ask()` already does.
- **Ollama tag normalization.** `/api/tags` always returns
  `nomic-embed-text:latest`; configs typically store the untagged
  form. Use `hasModel(installed, configured)` from `core/ollama.ts`
  for comparisons, never `===`.
- **Renderer → main IPC for storage writes.** The renderer is not
  allowed to touch SQLCipher directly. Every write goes through the
  `store.*` IPC channels declared in `desktop/main/index.ts` and
  exposed in `desktop/preload/index.ts`. Adding a new storage method
  requires touching: `core/storage.ts` (interface), the adapters
  in `core/adapters/` and `desktop/main/sqlite-store.ts`, the IPC
  handler in `desktop/main/index.ts`, the preload bridge, the
  renderer's `ipc-adapter.ts`, and (for parity) the extension's
  `bridge-readonly-adapter.ts`.
- **Extension is read-only against the desktop vault.** Writes throw
  `ReadOnlyError`. Treat the extension as a viewer + form-filler,
  not an editor.
- **PDF/OCR text quality.** Decorative scanned documents (Indian
  marriage certs, foreign birth certs) defeat tesseract. The
  extractor + keyword fallback are tuned to do something sensible
  on garbled OCR text, but field extraction may still need a manual
  edit. Don't add heuristics that silently fabricate values.

## Conventions

- Comments explain *why*, not *what*. Default to no comments.
  Never write file paths or "added for issue X" — those rot.
- No emojis in code or commit messages.
- Commits use the `type(scope): message` shape. Bodies are
  multi-paragraph when the diff is non-trivial. Always include
  the `Co-Authored-By: Claude…` trailer.
- TypeScript strict; no `any` unless interfacing with untyped
  Electron / IndexedDB APIs.
- Tailwind for styling, lucide-react for icons, shadcn-style
  primitives in `ui/components/`.
