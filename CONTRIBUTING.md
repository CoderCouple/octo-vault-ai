# Contributing to OctoVault AI

Thanks for the interest. This is an early-stage repo; the structure and APIs are
still moving. The guide below should let you get a working dev environment in
under ten minutes.

## Layout

A single npm workspace with four packages:

```
packages/
├── core/          shared TypeScript — schema, resolver, storage, Ollama
│                  client, OCR/PDF, RAG, vault encryption
├── ui/            shared React + shadcn views
├── extension/     Chrome MV3 — popup + content script + service worker
└── desktop/       Electron + SQLCipher
```

Each package has its own `package.json` and `tsconfig.json`. There's no
package-level test suite yet — `npm run typecheck` is the contract.

## Prerequisites

- **Node 20+**, **npm 10+**
- **Ollama** (`brew install ollama`)
- Models: `ollama pull qwen3:8b && ollama pull nomic-embed-text`
- For desktop builds: Python 3 (for `node-gyp`) and the Xcode CLI tools

## First setup

```bash
npm install      # postinstall rebuilds SQLCipher for Electron's Node ABI
npm run typecheck
```

## Running

```bash
npm run dev:desktop      # Electron, hot-reload
npm run dev:extension    # Vite watcher; load packages/extension/dist in Chrome
npm run dev:landing      # static Vite preview at :5175
```

For the extension to talk to Ollama directly, set
`OLLAMA_ORIGINS="chrome-extension://*"` once
(`launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"` on macOS, then
restart Ollama). When the desktop app is running, the extension routes
LLM calls through its bridge proxy and the env var isn't needed.

## Where to make changes

- **Schema / data model** — `packages/core/src/schema.ts` + `storage.ts`
- **AI prompts** — `packages/core/src/extract.ts` (extraction),
  `match.ts` (form-fill), `qa.ts` (chat)
- **UI** — `packages/ui/src/views/*.tsx` and `components/`
- **Extension popup + content script** — `packages/extension/src/`
- **Desktop main + IPC** — `packages/desktop/src/main/`

## Code style

- TypeScript everywhere; `strict: true`.
- shadcn/ui primitives over hand-rolled CSS. Compose with `cn()` from
  `packages/ui/src/lib/utils.ts`.
- Strict monochrome — no accent colours. Status uses border style + icons,
  not colour.
- Use `tx.*` from `packages/ui/src/lib/brand.ts` for type styles. Don't
  hand-write `font-serif text-base` on a one-off.
- Pure functions in `core`; React state in `ui`/surface packages.
- No comments that just restate the code. Comments belong on *why*
  (non-obvious constraints, invariants, workarounds).

## Pull request checklist

- `npm run typecheck` passes
- `npm run build:extension && npm run build:desktop && npm run build:landing`
  all succeed
- New user-facing feature → updated README section or a note in the PR
- New on-disk data shape → migration logic added (or a clear note that
  existing users must wipe their vault)

## What's specifically off-limits

- **Cloud calls of any kind** in `extension` or `desktop` paths. The product's
  central promise is local-only — adding analytics, telemetry, error
  reporting, or remote feature flags will be rejected.
- **Per-user secrets in logs** — even `console.log`. Tail of a secret is OK
  (`...1234`); the whole value is not.
- **Reading files outside the chosen vault directory** — the desktop app
  should not list user files outside what it created.

## Reporting bugs

Open an issue with:
- The surface (desktop / extension / landing)
- Reproduction steps
- Background-console output when relevant (extension issues live in the
  service worker console, not the page console)
- Your Ollama version + model name

## Larger features

Open an issue first — `OCTOVAULT_STRATEGY.md` and `CLAUDE_DESIGN_PROMPT.md`
describe the product direction. Anything that would change those documents
should be discussed before code.
