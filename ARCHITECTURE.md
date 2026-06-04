# OctoVault AI — Architecture

> **TL;DR.** OctoVault is a private, on-device knowledge graph built from a
> user's personal documents. Three client surfaces (macOS desktop, Chrome
> side-panel extension, and a marketing landing page), one shared core
> library, one SQLCipher-encrypted vault, and zero outbound network calls
> from the product itself. Everything that needs an LLM uses a local
> Ollama instance. Built end-to-end by 2 founders with heavy Claude Code
> assistance.
>
> The design echoes Andrej Karpathy's
> [LLM Knowledge Base](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
> pattern — a private, local, LLM-queryable personal corpus that
> deliberately bypasses cloud AI and traditional RAG — adapted for
> consumer documents instead of research notes. See "Architectural
> lineage" below.

---

## Repository layout (npm workspaces)

```
octo-vault-ai/
├── packages/
│   ├── core/        Shared TS lib — types, StorageAdapter, vault crypto,
│   │                qa/ask pipeline, document/fact extraction, knowledge
│   │                graph derivation, closure rules.
│   ├── ui/          Shared React component library — App shell, views
│   │                (Documents, Conflicts, FactsGraph, Settings, Chat,
│   │                UnlockScreen, SpotlightOverlay, FloatingShortcut),
│   │                shadcn-style primitives, brand tokens.
│   ├── desktop/     Electron app — main process (Node), preload bridge,
│   │                renderer (React), SQLCipher store, localhost HTTP
│   │                bridge for extension. Three BrowserWindows from one
│   │                renderer bundle (URL-param-routed).
│   ├── extension/   Chrome Manifest V3 — side-panel UI + content scripts
│   │                for form-fill, background service worker, two vault
│   │                sources (own IndexedDB vault or live bridge to
│   │                desktop's localhost).
│   └── landing/     Vite + React + Tailwind marketing site at
│                    www.octovault.ai. Vercel-hosted, PostHog instrumented,
│                    Supabase waitlist.
├── supabase/        CLI scaffold + migration for the public.waitlist
│                    table (anon-INSERT RLS policy). Only piece of the
│                    system that talks to a server, and it's strictly
│                    one row per email.
├── api/             Reserved for Vercel Edge functions (currently empty).
└── vercel.json      Vite framework, npm run build:landing, output
                     packages/landing/dist, static-asset cache headers.
```

---

## High-level system architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          MAIN BROWSERWINDOW                          │
│  React renderer (UnlockScreen / App shell / Documents / Conflicts /  │
│  Facts Graph / Chat / Settings)                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ IPC (contextBridge)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       ELECTRON MAIN PROCESS                          │
│                                                                      │
│  ┌───────────────┐  ┌─────────────────┐  ┌────────────────────────┐  │
│  │ Vault         │  │ Ollama proxy    │  │ Localhost HTTP bridge  │  │
│  │ • SQLCipher   │  │ • /api/generate │  │ • port 53117           │  │
│  │   key load    │  │ • /api/embed    │  │ • CORS so extension    │  │
│  │ • Schema      │  │ • /api/tags     │  │   can fetch snapshot   │  │
│  │ • CRUD via    │  │ (kills CORS for │  │ • Ollama relay         │  │
│  │   ipcMain     │  │  the renderer)  │  │                        │  │
│  └───────────────┘  └────────┬────────┘  └────────────────────────┘  │
│                              │                                       │
│  ┌────────────────────────┐  │  ┌─────────────────────────────────┐  │
│  │ Multi-window manager   │  │  │ Global shortcut (configurable,  │  │
│  │ • Main window          │  │  │  default ⌘⌥O) toggles overlay   │  │
│  │ • Overlay (frameless,  │  │  │ Login-item registration (macOS) │  │
│  │   alwaysOnTop, panel)  │  │  │ Native context menu (popup on   │  │
│  │ • Floating shortcut    │  │  │  right-click of shortcut)       │  │
│  │   (48×48, edge-snapped)│  │  └─────────────────────────────────┘  │
│  └────────────────────────┘  │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               ▼
                  ┌──────────────────────┐
                  │ Ollama runtime       │
                  │ (localhost:11434)    │
                  │ • qwen3:8b           │
                  │ • nomic-embed-text   │
                  └──────────────────────┘
                               │
       ┌───────────────────────┴───────────────────────┐
       ▼                                               ▼
┌────────────────┐                          ┌───────────────────────┐
│ SQLCipher DB   │                          │ Chrome extension      │
│ (encrypted,    │                          │ side panel            │
│  userData/     │                          │ • Auto-discovers      │
│  vault/        │◀──── HTTP snapshot ─────│   bridge on localhost │
│  vault.db)     │      (read-only, JSON)   │   :53117              │
└────────────────┘                          │ • Falls back to its   │
                                            │   own IndexedDB+      │
                                            │   WebCrypto vault     │
                                            │   if bridge not found │
                                            └───────────────────────┘
```

---

## Three windows, one renderer bundle

The desktop app spawns **three BrowserWindows** but ships **one renderer
bundle**. `main.tsx` reads `window.location.search` and mounts the right
React tree:

```tsx
const mode = new URLSearchParams(window.location.search).get("mode") ?? "main";

if (mode === "overlay") {
  // Spotlight-style ⌘⌥O bar — transparent body, frameless window,
  // alwaysOnTop, vault-state-aware (no-vault / locked / ready).
  createRoot(root).render(<SpotlightOverlay />);
} else if (mode === "shortcut") {
  // Tiny 48×48 floating capsule on a screen edge, custom JS drag,
  // native right-click menu via IPC.
  createRoot(root).render(<FloatingShortcut />);
} else {
  createRoot(root).render(<App layout="full" />);
}
```

The main process loads each window with `?mode=overlay` / `?mode=shortcut`
appended to the renderer URL. Same preload, same React, same Tailwind —
no second build pipeline.

**Why this matters:** the Spotlight overlay (centered, vibrancy-style)
and the floating shortcut (48×48 always-on-top capsule on the edge) are
their own OS windows but share the entire stack. Avoids the typical
Electron pain of maintaining 3 separate `BrowserWindow` configs with
3 separate bundles.

---

## Storage abstraction — one interface, two backends

```
packages/core/src/storage.ts
├── interface StorageAdapter
│   • listEntities / saveEntity / deleteEntity
│   • saveDocument / listDocuments / getDocument / deleteDocument
│   • getRecord / setRecord / deleteRecord  (per-entity facts)
│   • getProfile / getAllProfiles / clearProfile
│   • saveEmbeddings / listEmbeddings / deleteEmbeddingsForDoc
│   • listRelationships / saveRelationship / deleteRelationship
│   • getSettings / updateSettings
│   • getAuthBlob / setAuthBlob / deleteAuthBlob
│
├── Two concrete implementations:
│   ├── packages/core/src/adapters/indexeddb-adapter.ts
│   │     • Used by the extension (WebCrypto + IndexedDB)
│   │     • Same idb-keyval stores: docs, entities, embeddings,
│   │       relationships, profiles, settings, auth (vault blob)
│   │
│   └── packages/desktop/src/renderer/src/storage/ipc-adapter.ts
│         • Used by the desktop renderer
│         • Forwards every method via window.octovault.store.*
│           → ipcRenderer.invoke("store.<method>", …)
│         • Main process unpacks into SQL via better-sqlite3-multiple-ciphers
```

The UI package is storage-agnostic — it gets a `StorageAdapter` injected via
React context and calls the same methods regardless of surface. This is
why the extension and desktop UIs are byte-identical.

---

## Vault lifecycle

Both surfaces implement the same `AppHost` interface for vault management:

```ts
interface AppHost {
  vaultExists():   Promise<boolean>;
  vaultInit(pw):   Promise<void>;     // first-time setup
  vaultUnlock(pw): Promise<boolean>;
  vaultLock():     Promise<void>;
  vaultReset():    Promise<void>;     // "forgot password? start fresh"
  isVaultUnlocked(): boolean;
  ...
}
```

- **Desktop**: SQLCipher-encrypted SQLite file at
  `~/Library/Application Support/OctoVault/vault/vault.db`. Master password
  derives the SQLCipher key via PBKDF2 (handled by SQLCipher itself).
  Vault state lives in the main process; renderer flag is a cache.
- **Extension**: WebCrypto AES-GCM with a key derived from the master
  password via PBKDF2; ciphertext stored in IndexedDB. Wraps the
  same `StorageAdapter` interface so the UI package doesn't care.

**Reset path** (recent addition):
- `UnlockScreen` shows a subtle "Forgot password? Reset and start fresh"
  link below the unlock form.
- AlertDialog confirms; on accept, `host.vaultReset()` wipes the SQLite
  file (or deletes the IndexedDB auth blob), then triggers Onboarding.

---

## Document → fact extraction pipeline

```
Drop a PDF or image
        │
        ▼
┌──────────────────────┐
│ Type detection       │  Filename + first-page text against a small
│ packages/core/src/   │  list of known doc kinds (passport, drivers
│ document-types.ts    │  license, utility_bill, tax_form, …).
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Text extraction      │  Native PDF text where present (PDF.js).
│                      │  Falls back to Tesseract.js OCR (workerPath,
│                      │  corePath, langPath all bundled in /public).
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ LLM extraction       │  Local Ollama call (qwen3:8b) with a
│ packages/core/src/   │  schema-aware prompt per doc kind. Returns
│ extract.ts           │  candidate field/value pairs with confidence.
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Deterministic        │  Strip leading/trailing whitespace, normalize
│ sanitize             │  dates to ISO, strip honorifics, trim noisy
│ (sanitize.ts)        │  punctuation. Done before storage.
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ LLM self-review      │  Second LLM pass given the candidate facts
│ (review.ts)          │  and the source text — asks "any of these
│                      │  look wrong? drop them." Catches hallucinated
│                      │  fields and bad OCR.
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Persist              │  StorageAdapter.saveDocument + per-field
│                      │  candidate rows linked to documentId.
└──────────────────────┘
```

---

## Knowledge graph — derived facts via closure rules

Stored facts are the LEAVES. Edges between entities are computed:

```
packages/core/src/derive.ts
│
├── Direct edges (stored as Relationship rows):
│     self ↔ spouse
│     self → child
│     self → parent
│     self → sibling
│
└── Derived edges (closure rules, computed at read time):
      spouse(A,B) ∧ parent(B,C)  →  parent-in-law(A,C)
      parent(A,X) ∧ parent(B,X)  →  co-parent(A,B)
      sibling(A,B)                → in-law (transitive over spouse)
      ...
```

The `FactsGraph` view (`packages/ui/src/views/FactsGraph.tsx`) renders
direct edges as solid lines and derived edges as dashed lines, with
hover-tooltip showing the rule that produced each derived edge.

---

## Conflict resolution

Multiple documents claim a fact (e.g., two passports both say "Date of
Birth"). The `Conflicts` view classifies them per field-type rules:

```
packages/core/src/conflicts.ts
│
├── red_flag   — different DOBs across passport+insurance
│                 (DOBs should never differ; this is a hard error)
├── stale      — older license vs newer utility bill for address
│                 (timestamp-aware; newest wins, older marked stale)
├── conflict   — two phone numbers, both equally valid
│                 (user picks the canonical one)
└── none       — identical values across sources, all confirm
```

Each candidate carries provenance: documentId, page, score. The user
**pins** their preferred candidate; the canonical re-resolves immediately
and the pin survives future re-imports.

---

## Q&A / Chat — local RAG with citations

```
packages/core/src/qa.ts
│
├── 1. Embed query                  nomic-embed-text via Ollama
│
├── 2. Retrieve top-K               cosine similarity over stored
│                                   EmbeddingRecord[] (one row per
│                                   chunk OR per fact). Currently
│                                   loaded into memory at unlock; the
│                                   k=50 prefilter then narrows to k=8.
│
├── 3. MMR rerank                   Maximal Marginal Relevance to
│                                   diversify — avoid 5 hits from the
│                                   same paragraph.
│
├── 4. @mention scoping             If query mentions an entity name,
│                                   restrict retrieval to that entity's
│                                   embeddings.
│
├── 5. Query rewriting              Resolves "she" / "their" / "the
│                                   one I mentioned" across turns.
│
├── 6. LLM generate                 qwen3:8b given retrieved chunks +
│                                   the rewritten query. Returns
│                                   answer with [N] inline citations.
│
└── 7. Wrap                         Returns { answer, citations[],
                                    retrieved[] } where each citation
                                    has documentId, documentName,
                                    page, excerpt, score.
```

The same `host.ask(question)` call is used by:
- `Chat` view (main app)
- `SpotlightOverlay` (⌘⌥O quick-ask)
- A `/api/v1/ask` endpoint exposed by the localhost bridge for the
  Chrome extension's chat tab

---

## Chrome extension form-fill

The side panel observes the active web page via a content script and
attempts to match form fields to graph facts:

```
1. autocomplete attribute  e.g. autocomplete="given-name" → entity.firstName
                           Instant, no LLM call needed.

2. Label/name/placeholder  Keyword match: "First Name" → firstName.
   keyword match           Handled by a deterministic similarity scorer.

3. LLM tiebreaker          For the residual unmatched fields, single
                           LLM call with the page's form schema +
                           the entity's full profile. Returns the
                           field→value mapping with confidences.

4. User review             Every proposed value shown in the panel
                           before insertion. No auto-submit ever.
```

DS-160 visa form is the showcase: 14 real US Department of State fields
fill in ~3 seconds. The landing-page mock at www.octovault.ai animates
this exact flow.

---

## Floating shortcut + Spotlight overlay

Two surfaces invokable from anywhere on macOS:

### Floating shortcut (new BrowserWindow, type:panel candidate, frameless, transparent)

- **48 × 48** window — exactly matches the OctoMark badge size to kill
  any "transparent-window halo" rendering quirk on Sequoia.
- **Drag in JS, not CSS.** `-webkit-app-region: drag` doesn't coexist
  with `onClick`; we capture mousedown + screen coords + window pos,
  attach mousemove/mouseup listeners to `document` (not the button, so
  the cursor briefly leaving the window mid-drag doesn't reset state),
  and send `shortcut.move(absX, absY)` IPC for each frame. 4px threshold
  distinguishes drag from click.
- **Edge snap on release** — picks the nearer left/right edge from the
  window's center X; persists to `userData/shortcut-position.json` so
  it survives reboots (separate from the encrypted vault since the
  shortcut must appear *before* unlock).
- **Right-click → native menu** via `ipcMain.on('shortcut.contextMenu')`:
  Open OctoVault, Open quick search, Snap left/right, Hide for now,
  Quit.
- **Configurable** — Settings exposes "Show floating shortcut" toggle,
  "Floating shortcut edge" dropdown, "Launch at login" toggle.

### Spotlight overlay

- Frameless, transparent, alwaysOnTop BrowserWindow at center-top of
  the primary display.
- **Tri-state on every open**: `no-vault` (CTA to set up), `locked`
  (mini password prompt inline), `ready` (search bar + ask flow).
  Uses `vault.isOpen()` IPC to read main-process state across windows.
- Branded header (OctoMark + "OctoVault AI · quick ask") + × close.
- Streams the same `host.ask` answer with [N] citation pills + source
  cards.
- Esc / blur / × all dismiss.

### Global hotkey

- Default `CommandOrControl+Alt+O` (= ⌘⌥O on macOS).
- **Configurable** — Settings exposes the Electron Accelerator string;
  push to main re-registers immediately, no app restart.
- Re-registered after every vault unlock from the stored setting.

---

## Distribution — signed + notarized DMG

```
packages/desktop/
├── electron-builder.yml
│   • appId: app.octovault.desktop
│   • mac.identity: "Sunil Deviprasad Tiwari (6RF9THVXBJ)"
│   • mac.hardenedRuntime: true
│   • mac.entitlements: build/entitlements.mac.plist
│   • mac.notarize: true (uses APPLE_TEAM_ID + APPLE_KEYCHAIN_PROFILE
│     env vars at build time)
│   • asarUnpack: better-sqlite3-multiple-ciphers + bindings +
│     file-uri-to-path (native .node files must live outside asar)
│
├── build/icon.svg + icon.png  1024×1024 OctoMark in a Big-Sur rounded
│                              square. electron-builder auto-generates
│                              the .icns from the PNG at package time.
│
├── build/entitlements.mac.plist
│   • com.apple.security.cs.allow-jit                  (V8)
│   • com.apple.security.cs.allow-unsigned-executable-memory
│   • com.apple.security.cs.allow-dyld-environment-variables
│
└── DMG layout via create-dmg (electron-builder's built-in DMG step
    fails on Sequoia with -anyowners; create-dmg works). Custom
    540×380 background image with drag-to-Applications arrow + first-
    launch instructions.
```

**Release flow** (one command on a clean Mac):

```bash
APPLE_TEAM_ID=6RF9THVXBJ \
APPLE_KEYCHAIN_PROFILE=octovault-notarize \
npm run package:mac
```

…produces both `OctoVault-0.0.1-arm64.dmg` and `OctoVault-0.0.1.dmg`,
signed with Developer ID Application, notarized via `notarytool`, and
stapled. Downloaded DMGs open without Gatekeeper warnings.

---

## Landing page (`packages/landing`)

- Vite + React + Tailwind, single page, deployed to Vercel from `main`.
- Live demos use real components from `@octovault/ui` (React Flow for
  the knowledge graph view; the DS-160 form-fill animation).
- `analytics.ts` wraps PostHog (autocapture + custom events for
  hero-demo phase clicks, download clicks, waitlist signups).
- Waitlist writes go to **Supabase** via PostgREST (raw fetch — no SDK,
  zero bundle weight added). RLS policy on `public.waitlist` allows
  anon INSERT only.
- **`vercel.json`** at repo root pins framework: vite, install with
  `--ignore-scripts` (skips the desktop's better-sqlite3 native rebuild
  on Vercel), build command `npm run build:landing`, immutable cache
  headers on hashed assets.

---

## How we use Claude Code

Heavy. Specifically:

- **Multi-window refactor** (overlay + shortcut + main from one bundle):
  designed + shipped in one ~3-hour Claude Code session.
- **Floating shortcut drag → snap → context-menu → settings** (this
  doc's longest section): also one session.
- **Apple Developer ID setup** (CSR via openssl → cert import → keychain
  partition list → notarytool credentials → entitlements.plist → electron-
  builder wiring): walked through interactively with Claude Code over IPC
  + shell. Caught the "remove 'Developer ID Application:' prefix" gotcha
  + the `APPLE_TEAM_ID` env-var migration before failing the build twice.
- **Vault-reset escape hatch**: required edits across 11 files (StorageAdapter
  interface, IndexedDB + SQLite + bridge adapters, host implementations
  for both surfaces, IPC handlers, UnlockScreen UI). Claude Code did the
  full traversal + typecheck in one go.
- **PostHog + Supabase landing instrumentation**: scaffolded from a brief
  description, including the RLS-locked Supabase table + migration.
- **Daily commits**: 3–5/day across two contributors. Most commits have a
  `Co-Authored-By: Claude Opus 4.7 (1M context)` line.

---

## Architectural lineage

OctoVault's core design choices — local LLM, personal corpus as the
LLM's long-term memory, deliberately bypassing both cloud AI and
vector-RAG-on-cloud — converge with a pattern Andrej Karpathy has been
publicly documenting and building since late 2025: the **LLM Knowledge
Base** (also called "LLM Wiki").

His version is for ML researchers. Karpathy maintains a private
markdown vault on his own machine, queried by a local LLM agent
(typically Claude Code) that reads files directly rather than retrieving
chunks from a vector store. The argument: for a personal corpus, vector
RAG loses too much structure; markdown files are the most compact,
LLM-readable, human-auditable format that exists. Karpathy's framing
extends to his broader "LLM OS" thesis — the LLM as the kernel process
of a personal computing layer, with the user's own data as its
long-term memory.

OctoVault adopts the same architectural insights and adds the layers
the pattern needs to ship as a consumer product:

|                          | Karpathy LLM-KB pattern        | OctoVault                        |
| ------------------------ | ------------------------------ | -------------------------------- |
| Corpus                   | Hand-written markdown notes    | Real user documents (PDF, image) |
| Ingestion                | User edits markdown            | OCR + LLM extraction pipeline    |
| Structure over content   | Markdown headings + links      | Entity-fact-relationship graph   |
| Truth resolution         | User edits file                | Conflict-detection with provenance + closure rules |
| LLM agent                | Claude Code in terminal        | Embedded in app (Spotlight overlay, in-app chat) |
| Storage                  | Plaintext markdown files       | SQLCipher-encrypted SQLite       |
| Visualization            | Obsidian graph view (external) | First-party Facts graph view (React Flow) |
| Action                   | Read-only Q&A                  | Q&A + Chrome form-fill side panel + cross-document conflict surfacing |
| Audience                 | ML researchers, power devs     | Anyone with a passport and an internet form to fill |

**Reference implementations + writeups in the same pattern family:**

- Karpathy's original gist —
  https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
- Karpathy on X —
  https://x.com/karpathy/status/2039805659525644595
- DAIR.AI architecture deep-dive —
  https://academy.dair.ai/blog/llm-knowledge-bases-karpathy
- `jeremyrayner/kb-template` — open-source vault template —
  https://github.com/jeremyrayner/kb-template
- Urvil Joshi's walkthrough using Claude Code —
  https://medium.com/@urvvil08/andrej-karpathys-llm-wiki-create-your-own-knowledge-base-8779014accd5
- MindStudio's Claude-Code-as-agent guide —
  https://www.mindstudio.ai/blog/andrej-karpathy-llm-wiki-knowledge-base-claude-code
- Obsidian (the de-facto visualization layer used with the pattern) —
  https://obsidian.md/

The thesis is identical to Karpathy's: the highest-signal context for
an LLM is your personal corpus, and it shouldn't ever leave your
device. The opportunity OctoVault is going after is that nobody has
shipped this shape of product for people who will never open a
markdown editor or a terminal.

---

## What's deliberately *not* in the architecture

- **No backend.** The only piece of OctoVault that ever talks to a server
  is the landing-page waitlist (Supabase row insert). The product itself
  is server-free, by policy. Users can verify with `lsof`, Little Snitch,
  or by flipping airplane mode and re-running anything.
- **No analytics on the product.** PostHog runs on the landing site only.
  The desktop app has zero telemetry.
- **No cloud sync (yet).** Roadmap: end-to-end-encrypted relay so the same
  vault syncs across a user's Mac + iPhone + iPad without ever being
  decrypt-able server-side. This is the paid tier.
- **No 3rd-party AI APIs.** Every LLM call goes to the user's local
  Ollama on `localhost:11434`. Default model is `qwen3:8b`; embeddings
  via `nomic-embed-text`. Both are open-weight.

---

## Code-of-trust

```
Repo:           https://github.com/CoderCouple/octo-vault-ai
Landing:        https://www.octovault.ai/
macOS beta:     https://github.com/CoderCouple/octo-vault-ai/releases/latest
License:        MIT
```

The whole thing is open source. You can read every line that touches
your data, and verify with `npm run package:mac` from a clean clone that
the binary we ship matches the source.
