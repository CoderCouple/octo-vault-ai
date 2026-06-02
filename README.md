# OctoVault AI

> Private. Local. Yours. — your local AI vault for personal paperwork.

OctoVault AI is a local-only personal vault that scans, understands, and
securely stores personal documents — and uses them to fill web forms in
your browser, answer questions about your data, and resolve conflicts
between sources. No cloud. No servers. No data harvesting. The AI runs
on your device via [Ollama](https://ollama.com).

This repository is the working monorepo. It ships:

- A **Chrome / Edge / Brave / Arc extension** that detects forms on any page and fills them.
- A **macOS desktop app** (Electron) with the full vault UI, conflict resolution, and the Facts graph.
- A **landing site** for marketing.

It's an honest WIP. Read [`OCTOVAULT_STRATEGY.md`](./OCTOVAULT_STRATEGY.md) for
the full product strategy. This file is the engineering README.

---

## Table of contents

1. [Quick start](#quick-start)
2. [Repository layout](#repository-layout)
3. [Architecture](#architecture)
4. [Data model](#data-model)
5. [Conflict resolution](#conflict-resolution)
6. [AI integration](#ai-integration)
7. [OCR pipeline](#ocr-pipeline)
8. [UI & theme](#ui--theme)
9. [Security model](#security-model)
10. [Development](#development)
11. [Building and packaging](#building-and-packaging)
12. [Known gaps and roadmap](#known-gaps-and-roadmap)

---

## Quick start

Prerequisites: **Node 20+**, **npm 10+**, **Ollama** running locally.

```bash
# 1. install deps (postinstall rebuilds the native SQLCipher module
#    for Electron's Node ABI — first install takes ~30s extra)
npm install

# 2. install + start Ollama (one time)
brew install ollama
brew services start ollama

# 3. pull the default models
ollama pull qwen3:8b           # LLM for extraction, matching, chat
ollama pull nomic-embed-text   # embeddings for chat retrieval

# 4. allow the extension to talk to Ollama (CORS)
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
brew services restart ollama

# 5. launch the desktop app
npm run dev:desktop
```

The desktop app opens to a mandatory onboarding wizard:
**Welcome → Ollama check → Models check → Master password → About you → Done.**
The master password encrypts everything via SQLCipher.

For the browser extension, see [Development → Extension](#extension).

### Loading the Chrome extension

```bash
npm run build:extension
```

Then in `chrome://extensions`: **Developer mode → Load unpacked →
`packages/extension/dist/`**. Pin the OctoVault AI icon. The popup
auto-detects the desktop app and reads its vault when reachable.

---

## Repository layout

```
octo-vault-ai/
├── packages/
│   ├── core/                      # shared TypeScript: schema, resolver, storage,
│   │                              # Ollama client, OCR, PDF, extract, match,
│   │                              # crypto, IndexedDB adapter
│   ├── ui/                        # shared React UI: shadcn primitives, views,
│   │                              # theme provider — used by every surface
│   ├── extension/                 # Chrome MV3 (popup + content script + service worker)
│   ├── desktop/                   # Electron (main + preload + renderer)
│   └── landing/                   # static Vite + React marketing site
├── OCTOVAULT_STRATEGY.md          # full product strategy doc
├── CLAUDE_DESIGN_PROMPT.md        # ready-to-paste design brief
└── README.md                      # you are here
```

Each package has its own `package.json`, `tsconfig.json`, and build config.
The root `package.json` declares an npm workspace and exposes the convenience
scripts (`npm run dev:desktop`, `npm run build`, etc.).

---

## Architecture

### Three surfaces, one core

```
                   ┌─────────────────────────────────┐
                   │       @octovault/core           │
                   │  schema · resolver · storage    │
                   │  ollama · extract · match · ocr │
                   │  pdf   · crypto   · adapters    │
                   └─────────────────────────────────┘
                                  ▲
                                  │ imports
                                  │
                   ┌──────────────┴──────────────────┐
                   │        @octovault/ui            │
                   │  shadcn primitives · views      │
                   │  context · theme provider       │
                   └─────────────────────────────────┘
                            ▲                ▲
                    ┌───────┘                └────────┐
                    │                                  │
        ┌───────────┴──────────┐         ┌────────────┴──────────┐
        │ @octovault/extension │         │  @octovault/desktop   │
        │  popup (layout=popup)│         │  renderer (layout=full)│
        │  content script      │         │  main + preload       │
        │  service worker      │         │  IPC → Ollama         │
        └──────────────────────┘         └───────────────────────┘
                    │                                  │
                    └──────────────► Ollama ◄──────────┘
                             (localhost:11434)
```

### Why this split

- **`core`** is pure TypeScript, no DOM dependencies in most files (PDF/OCR do
  touch DOM but only in surfaces that bundle them). Adapter interfaces let
  storage swap per surface.
- **`ui`** is the only place React lives in shared code. Every surface mounts
  the same `<App />` with a different `layout` and `AppHost`.
- **`extension`** is a Chrome MV3 extension. Service worker handles Ollama calls
  (no CORS); content script handles in-page form detection and filling.
- **`desktop`** is Electron with `contextIsolation: true`. The renderer never
  has direct Node access; Ollama calls go over an IPC bridge exposed via the
  preload script.

### AppHost — the surface contract

Every surface implements this small interface from `@octovault/ui`:

```ts
interface AppHost {
  surface: "extension" | "desktop";
  storage: StorageAdapter;
  isOllamaReachable(): Promise<boolean>;
  extractFromText(documentId, text): Promise<ExtractionResult>;
}
```

That's the entire integration surface. Add a new platform by writing one
`AppHost` and mounting `<App />`.

### Storage adapters

Storage is an interface, not a class.

| Adapter | Surface | Where data lives |
|---|---|---|
| `indexedDbAdapter` | extension popup, desktop renderer | Browser-style IndexedDB (per-extension or per-user-data-dir) |
| `bridgeReadOnlyAdapter` | extension popup | HTTP proxy to the Desktop app's bridge at `localhost:53117` |
| `sqliteAdapter` *(future)* | desktop, v0.2 | `better-sqlite3` SQLCipher-encrypted file in app's userData dir |

### Persistence layout

Every surface that runs in a browser-like context (extension popup, desktop
renderer) writes to IndexedDB via [`idb-keyval`](https://github.com/jakearchibald/idb-keyval).
Each conceptual collection is its own IndexedDB database with a single
object store.

| Database | Key | Value | Purpose |
|---|---|---|---|
| `octovault-entities` | entity id | `Entity` | People in the vault (Self + family + others) |
| `octovault-docs` | doc id | `StoredDocument` | Imported PDFs/images with extracted text |
| `octovault-records` | `${entityId}\|${fieldKey}` | `FieldRecord` | All candidates per (entity, field) + canonical |
| `octovault-embeddings` | embedding id | `EmbeddingRecord` | Vectors for chat RAG (fact + chunk) |
| `octovault-education` | record id | `EducationRecord` | Repeating education records per entity |
| `octovault-experience` | record id | `ExperienceRecord` | Repeating work records per entity |
| `octovault-settings` | `"settings"` | `Settings` | Ollama URL, model choices, app prefs |
| `octovault-auth` | `"blob"` | `Uint8Array` | PBKDF2 verifier for the master password |

On macOS, the Electron renderer's IndexedDB lives under
`~/Library/Application Support/@octovault/desktop/IndexedDB/`. The Chrome
extension's IndexedDB is sandboxed per-extension-origin under Chrome's
profile directory.

### Encryption — current state vs. roadmap

| Concern | Today | Planned |
|---|---|---|
| Disk encryption | OS-level only (FileVault, BitLocker) | Same plus SQLCipher / WebCrypto-wrapped IDB blobs |
| Auth blob | PBKDF2-SHA256 verifier (salt + verifier hash) | Same |
| Master password | Used to gate highly-sensitive field reveals | Plus wrap data-encryption keys |
| Per-field encryption | None | SSN, passport, license, ID, Tax ID encrypted at rest |
| Vector embeddings | Plain JS arrays in IDB | Encrypted at rest |
| Backup | Out of scope | Encrypted `.octovault` single-file export |

### Why not a graph database (Memgraph, Neo4j, etc.)?

The Facts view *looks* like a graph, but a graph DB is the wrong shape
for OctoVault:

1. **Scale.** A typical user has hundreds — at most low thousands — of
   facts and edges. Building the graph in-memory from the existing
   records takes <50ms.
2. **Operating model.** A graph DB is a separate process (even when
   "embedded," Memgraph runs a server). That breaks the "no servers"
   promise that is core to the brand.
3. **Surface area.** Another process means another binary to sign,
   notarize, audit, update. We don't need it.
4. **Future workloads.** If we ever need true graph workloads at scale
   (traversal-heavy queries across millions of entities), an embedded
   library like `cozodb` (Rust, embedded, datalog-style) is a better
   fit than a server.

For now: the "graph" is just a derived view over `EntityNode →
DocumentNode → FactRecord` relationships materialized on demand from
IndexedDB. Same model on the wire to the extension via the bridge.

The adapter contract handles documents, field records (candidates per key),
settings, and the auth blob (master-password verifier).

---

## Data model

### Fields, candidates, records

The shape OctoVault stores is **not** "one value per field." It's:

```ts
interface FieldCandidate {
  id: string;
  fieldKey: ProfileKey;
  value: string;
  normalizedValue: string;       // for equivalence checks across sources
  confidence: "high" | "medium" | "low";
  source: { documentId, page?, excerpt? };
  docType: DocType;              // passport, drivers_license, utility_bill, ...
  extractedAt: number;
  userEdited: boolean;
  userPinned?: boolean;
  dismissedAt?: number;
}

interface FieldRecord {
  key: ProfileKey;
  candidates: FieldCandidate[];
  canonicalId: string | null;    // which candidate wins
  conflictState: "none" | "stale" | "conflict" | "red_flag";
}

type Profile = Partial<Record<ProfileKey, FieldRecord>>;
```

Every fact OctoVault knows about is a candidate. Many candidates may exist for
the same field, from different documents. The resolver picks a canonical one
and tells the UI whether there's a conflict.

### Document types and authority

`schema.ts` declares `DOC_AUTHORITY` — a per-doc-type × per-field-key score
indicating how trustworthy each kind of document is for each kind of fact. A
passport is 1.0 for `passportNumber`, a paystub is 0.7 for `fullName`, etc.
The resolver multiplies authority into the candidate score.

---

## Conflict resolution

The resolver in `packages/core/src/resolver.ts` does three things:

1. **Score every candidate** by `authority + confidenceBoost + recencyBoost + userBoost`.
2. **Pick a canonical** — highest score wins, unless the user pinned a value.
3. **Classify the conflict state** based on the field's *kind*:

| Kind | Example | Behavior on disagreement |
|---|---|---|
| `date_static` | DOB, place of birth | `red_flag` — should never differ. UI surfaces prominently. |
| `id_unique` | SSN, national ID | `red_flag` — same. |
| `date_monotonic` | Passport expiry | `stale` — older value isn't wrong, just superseded. |
| `id_versioned` | Passport number | `stale` — new book = new number. |
| `address`, `contact` | Address, phone | `stale` — older just becomes history. |
| `name`, `text` | Job title, employer | `conflict` — could be a nickname or formatting; user picks. |

The **Conflicts** view shows the user every record with a non-`none` state, with
each candidate's source document, excerpt, and confidence. The user can pin or
dismiss any candidate; the resolver re-runs immediately.

The **Facts** view (desktop only) visualizes the same data as a graph — see
[UI & theme](#ui--theme).

---

## AI integration

OctoVault calls Ollama at `http://localhost:11434` for two operations:

### 1. Field extraction

When a document is imported, its text is sent to the local LLM with a prompt
that asks for:
- A `docType` classification (one of ~15 known types)
- A `fields` object whose keys are a subset of the canonical profile schema,
  each with a `value`, `confidence`, and a verbatim `excerpt` for citation.

The response uses Ollama's `format: "json"` mode. See
`packages/core/src/extract.ts`.

### 2. Form-field matching

When the user clicks the extension's `⬛ Fill` button:
1. Content script detects all visible inputs/selects/textareas.
2. Background service worker runs a hybrid matcher (`packages/core/src/match.ts`):
   - **Heuristic first:** HTML `autocomplete` attributes, then label/name/placeholder
     keyword matching against the canonical schema's aliases.
   - **LLM tiebreaker:** unresolved fields are batched and sent to Ollama
     with strict instructions to return JSON mapping form-field IDs to profile
     keys, or `null` if no good match.
3. Each matched value is written to the input with proper `input`/`change`
   events so React/Vue/Angular forms register the change.

### Why route Ollama through the background / main process

The extension popup and desktop renderer both have origins that aren't on
Ollama's CORS allowlist. Rather than ask users to set `OLLAMA_ORIGINS`, both
surfaces route through their privileged context (MV3 service worker /
Electron main process) which isn't subject to CORS.

---

## OCR pipeline

`packages/core/src/pdf.ts` runs a hybrid pipeline per document:

1. Parse the PDF with `pdf.js`.
2. For each page, extract the text layer.
3. If a page has fewer than ~80 characters (almost always means the PDF is a
   scanned image), render the page to a canvas at 2× scale.
4. Pass the canvas to **Tesseract.js (WASM)** via `packages/core/src/ocr.ts`.

Image files (JPG, PNG, WebP) skip the PDF step and go straight to Tesseract.

The worker is shared and re-used across pages to avoid re-initialising for
every call. The OCR engine runs entirely in the renderer / extension process
— no native binaries, no network.

> Native OS engines (Apple Vision, ML Kit, Windows OCR) are out of MVP scope
> but are the planned upgrade — better accuracy, faster, free on platforms
> that ship them.

---

## UI & theme

### shadcn / Radix

All UI primitives in `packages/ui/src/components/ui/` are
[shadcn/ui](https://ui.shadcn.com) — Button, Dialog, AlertDialog, Tabs, Input,
Label, Badge, Card, Separator, Switch, ScrollArea. Stock copies, not modified.

### Strict monochrome

Both light and dark variants are pure black-and-white-and-gray. **No accent
color anywhere.** Status semantics (confidence, conflict, focus) are encoded
exclusively via:

- **Icons** (Lucide) — `AlertTriangle`, `Pin`, `Check`, `Eye`, etc.
- **Border style** — solid, dashed, double, weight 1 vs 2 (`status-stale`,
  `status-conflict`, `status-redflag`).
- **Typography** — uppercase labels, mono for values, serif for AI-spoken text.

### Theme modes

`useTheme()` in `packages/ui/src/components/theme.tsx` exposes three modes:
- `system` — follows the OS via `prefers-color-scheme` (default)
- `light` — forces light
- `dark` — forces dark

Persists to `localStorage` per surface. Settings tab has a 3-option picker.

### Facts view (desktop only)

A real node-and-edge graph built on `@xyflow/react`:
- Documents and facts are nodes; both are draggable.
- Edges go from doc → fact with style based on confidence:
  - solid 1.5px = `high`
  - solid 1px = `medium`/`low`
  - dashed = non-canonical candidate of a conflicted record
- Click any node to dim everything except its direct neighbours.
- Pan, zoom, and fit-to-view controls.

The popup layout hides this tab — there's no useful version of a graph in
400px. See it via `npm run dev:desktop`.

---

## Security model

OctoVault is built on a single promise: **nothing leaves the device**.

### What's enforced today

- Storage is per-origin sandboxed IndexedDB. Documents and extracted facts
  never touch the network.
- Ollama is `localhost`-only. The extension's host_permissions list it
  explicitly; no other network host is in the allowlist.
- Electron's renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
  and a strict CSP (`default-src 'self'`).
- The only IPC the renderer can call is the Ollama bridge — no `fs`, no
  `child_process`, no `shell.openExternal`-with-arbitrary-args.
- Master-password derivation: PBKDF2-SHA256, 250 000 iterations, 16-byte salt.
  Verifier is HMAC-SHA256 of a static string.
- Highly-sensitive fields (SSN, passport, license, national ID, tax ID) are
  masked by default. Revealing them requires the master password — set once,
  cached for the session, locked when the app idles past
  `appLockMinutes` (Settings).

### What's planned but not yet shipped

- **At-rest encryption of IndexedDB blobs** with a key wrapped by the master
  password. Today the OS disk encryption (FileVault, BitLocker) is the only
  layer.
- **SQLCipher backing store** on desktop.
- **OS-level Secure Enclave / TPM / StrongBox** integration for biometric
  unlock and wrap-key custody.
- **Tamper-evident audit log** (hash-chained).
- **Independent security audit** before v1.0.

### Verifying the local-only claim yourself

```bash
# macOS
sudo lsof -i -P | grep -i octovault
# should show only connections to 127.0.0.1:11434
```

Or use Little Snitch, Wireshark, or Windows Defender Firewall to confirm
zero outbound flows.

---

## Development

### Initial install

```bash
npm install
```

This installs every workspace's deps via npm workspaces. Hoisted to root
`node_modules/`.

### Extension

```bash
npm run dev:extension
```

Then in Chrome / Edge / Brave / Arc:
1. `chrome://extensions` → **Developer mode** on
2. **Load unpacked** → select `packages/extension/dist`
3. Reload the extension whenever you change anything (it auto-rebuilds via
   Vite HMR but Chrome needs the manual reload to pick up content-script
   changes).

The popup is at `popup/index.html`; the content script injects on any page
with a form; the background service worker handles Ollama RPC.

### Desktop

```bash
npm run dev:desktop
```

`electron-vite` builds `main`, `preload`, and `renderer`, then launches an
Electron window. DevTools open in detached mode automatically.

The renderer is the same React `<App />` as the extension popup, but mounted
with `layout="full"` so the **Facts** tab is visible. All Ollama calls go
through `window.octovault.ollama.*` (the preload bridge).

### Landing site

```bash
npm run dev:landing
```

Static Vite + React + Tailwind. Hosted at `http://localhost:5175`.

### Type-checking the whole repo

```bash
npm run typecheck
```

### File-level conventions

- `core` exposes everything through `src/index.ts`. Surfaces always import from
  `@octovault/core`, never a deep path.
- `ui` exposes views and the shared `<App />` through `src/index.ts`.
- shadcn components live in `packages/ui/src/components/ui/` as plain files —
  copy-pasted, lightly themed, and not exported through the package index.
  They're imported by the views directly.
- Anything UI-only (theme, sensitivity gate, dialogs) lives in
  `packages/ui/src/components/`.

---

## Building and packaging

### Per-surface builds

```bash
npm run build:extension     # → packages/extension/dist/   (unpacked MV3)
npm run build:desktop       # → packages/desktop/out/      (electron-vite output)
npm run build:landing       # → packages/landing/dist/     (static site)
npm run build               # all three
```

### macOS DMG packaging

```bash
npm run package:mac-arm     # → packages/desktop/dist/OctoVault-X.Y.Z-arm64.dmg
npm run package:mac         # both arm64 and x64 DMGs
```

Output lives in `packages/desktop/dist/`.

The DMG is **unsigned** by default. On first open users will see a Gatekeeper
warning — they must right-click the app and choose **Open** to authorise it.
To produce a signed + notarized release:

1. Obtain a Developer ID Application certificate from Apple.
2. Edit `packages/desktop/electron-builder.yml`:
   - Set `mac.identity` to your cert name (or omit to auto-detect).
   - Set `mac.hardenedRuntime: true`.
   - Add `mac.notarize: { teamId: "XXXXXXXXXX" }`.
3. Export `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` env vars.
4. Re-run `npm run package:mac`.

### A note on the npm-workspaces × electron-builder issue

`electron-builder`'s `install-app-deps` step runs `npm install --production`
in the desktop package. In an npm workspace this re-evaluates the whole tree
and can wipe hoisted binaries (notably `app-builder-bin`).

**Our workaround:** the desktop package declares no runtime `dependencies`.
Vite bundles everything (React, the UI package, the core package) into the
renderer's `out/` directory. Only Electron itself is needed at runtime, and
electron-builder ships its own copy.

If you add a runtime dep that *isn't* bundled (i.e., used by `main` or
`preload`), put it in `dependencies`. Otherwise keep it in `devDependencies`.

---

## Known gaps and roadmap

| Area | Status | Next step |
|---|---|---|
| OCR | ✅ Tesseract.js | Native Apple Vision / ML Kit for accuracy + speed |
| Conflict resolution | ✅ Resolver + Conflicts view + Facts graph | Time-aware "address history" timeline |
| At-rest encryption | ⚠️ OS disk only | SQLCipher backing store on desktop, wrapped-key IDB on web |
| Master password | ✅ Sensitivity unlock only | Full app lock + duress password + Shamir recovery |
| Audit log | ❌ | Hash-chained local-only log |
| Form fill | ✅ Detect + heuristic + LLM + apply | AcroForm PDFs, image-form layout detection |
| Image-form OCR layout | ❌ | LayoutLM-small on-device |
| Multiple profiles | ❌ | Profiles per family member / entity in v0.3 |
| Cloud-LLM fallback | ❌ — by design | Never. |
| Sync across devices | ❌ | Optional self-hosted LAN sync app in v0.5 |
| iOS / Android | ❌ | Native apps with shared Rust core, v1.0 |
| Code signing / notarization | ❌ | Wire Developer ID + notarize before public release |
| Detailed security audit | ❌ | Schedule with third party before v1.0 |

---

## What's in the repo right now

- ✅ Multi-entity vault (Self + family) with fuzzy name matching
- ✅ Document import: PDFs (text + scanned via on-device Tesseract OCR) + images
- ✅ LLM extraction with JSON-schema-constrained output (qwen3:8b)
- ✅ Form-fill: LLM-first matcher routed through localhost or via the
     desktop bridge proxy (avoids OLLAMA_ORIGINS hurdle when desktop is up)
- ✅ Chat with citations, history sidebar, react-markdown rendering,
     clickable [N] source pills
- ✅ Conflict resolver with per-field-type rules (red flag / stale / conflict)
- ✅ Facts graph (multi-entity, draggable, edge-deletable, fact-editable)
- ✅ Vault encryption: SQLCipher (whole-DB) on desktop, WebCrypto AES-GCM
     per-value on extension, both keyed off a master password
- ✅ Desktop ↔ extension bridge over `localhost:53117` (read-only)
- ✅ shadcn/ui in strict monochrome with light/dark/system themes
- ✅ Unsigned `.dmg` packaging via electron-builder

## License

Pre-launch. Not yet open-source.

---

## Contact

Engineering questions live in this repo's issues. Strategy and product
questions: [`OCTOVAULT_STRATEGY.md`](./OCTOVAULT_STRATEGY.md). Design brief
for redesign work: [`CLAUDE_DESIGN_PROMPT.md`](./CLAUDE_DESIGN_PROMPT.md).
