# OctoVault — Claude Design brief

Paste this whole document into Claude Design (or hand it to any product
designer) to commission a full UI pass. It's self-contained: it tells the
designer what the product is, who it's for, the screens that exist, the
visual constraints, and the deliverables you want back.

---

## 1. What OctoVault is

OctoVault is a **local-only personal AI vault** for a user's most important
paperwork — passports, driver's licenses, tax forms, insurance cards, utility
bills, employment letters. It reads those documents on the user's device,
extracts the identity facts, and uses them to **fill any web form** in the
browser. It also resolves conflicts between documents (e.g., two different
addresses across a passport and a utility bill) and visualises which document
supports which fact.

Crucially: **nothing leaves the device.** No cloud. No servers. The AI runs
locally via Ollama. The entire brand promise is privacy + intelligence,
together.

It ships as three coordinated surfaces:
- A **macOS / Windows desktop app** (Electron) — the primary vault, with the
  Documents library, Conflicts view, and the Facts graph.
- A **Chrome / Edge / Brave / Arc browser extension** — the form-fill wedge.
- A **landing site** — marketing.

The same React component library powers desktop and extension.

## 2. Who it's for

**Primary persona — The Private Professional (28–55).**
Knowledge worker, freelancer, consultant, immigrant, parent, small-business
owner. Manages 50–500 personal documents a year. Owns a modern Mac, Windows
PC, or recent iPhone/Android. Has read at least one privacy-related news
story that genuinely worried them. Willing to pay $40–$200 once for software
that solves a real pain. **Not interested in another subscription.**

Secondary personas: immigrants with multi-country paperwork; parents managing
dependents' forms; small-business owners separating personal and business
identity.

Pain points they all share:
- Re-typing the same identity data into every form. Forever.
- Documents scattered across drives, email, scans, photos, paper.
- Cloud-storage anxiety ("is Google reading my passport?").
- Missed renewals (passport, license, insurance) because nothing told them.

## 3. Voice and feel

- **Quiet.** Like a safe, not a startup. No celebratory confetti, no exclamation
  marks, no "Hey! 👋", no emoji in product copy.
- **Direct and factual.** "Your passport expires March 14, 2028." Not "We found
  it!"
- **Premium without being precious.** Closer to 1Password / Linear / Tana than
  to Notion / Figma marketing.
- **Trust-reinforcing on every screen.** A user should be able to confirm,
  three seconds into using the app, that it's truly local.

## 4. Visual direction (the hard constraint)

**Strict black-and-white monochrome.** No accent color anywhere. Light mode
is mostly white with near-black ink; dark mode is mostly near-black with
soft-white ink. Status, confidence, and conflict semantics are encoded
**exclusively** via:

- **Icons** (Lucide set — already in the codebase).
- **Border style and weight** — solid 1px (ok), dashed 1px (stale),
  double 2px (conflict), solid 2px (red flag).
- **Typography** — uppercase microcaps for labels, **mono** for IDs / numeric
  values, **serif** (Source Serif or Tiempos) for AI-spoken content, sans
  (Inter) for everything else.

A theme picker exists in Settings with three modes — **System** (default),
**Light**, **Dark**. The system mode follows the OS via
`prefers-color-scheme`.

If you ever feel the urge to add a color: use a darker or lighter grey
instead. The monochrome is the brand.

## 5. Component vocabulary (pre-existing, please reuse / restyle)

The codebase uses **shadcn/ui** primitives over **Radix** with Tailwind. You
can redesign visually but please keep the primitive list — it's what's wired
into the code:

`Button` · `Card` · `Badge` · `Dialog` · `AlertDialog` · `Tabs` · `Input`
`Label` · `Separator` · `Switch` · `ScrollArea` · `Tooltip`

Plus the conflict-state markers, which are CSS classes:
`status-ok` · `status-stale` (dashed) · `status-conflict` (double border)
· `status-redflag` (heavy solid)

## 6. Screens to design

Below are every screen the app currently has. Please redesign all of them
with the same monochrome system. The desktop layout is full-window (~1280
× 800 default). The extension popup is a fixed 400 × 600. The two share
~95% of components.

### 6.1 Onboarding modal (first run only)
- Welcome line: "Your documents and the AI both stay on this device."
- Three short bullets emphasising what is and isn't going to happen.
- A 3-step checklist:
  1. Install Ollama and start it (auto-detected with live indicator).
  2. Pull a model (one command shown in a copyable code box).
  3. Drag a document into the Documents tab.
- Two buttons: "Skip" (outline), "Get started" (primary).

### 6.2 Persistent header
- Brand mark (currently a black square glyph; you can propose a real mark).
- Two status pills on the right: **Ollama ready / offline** and **Local**.
- Tab nav (Tabs primitive): **Docs · Profile · Conflicts · Facts · Settings**.
  (`Facts` is hidden in the extension popup variant.)

### 6.3 Persistent footer
- Single line: "Processed on this device · {ollamaUrl}". Microcaps muted text.

### 6.4 Documents view
- Drag-and-drop card at the top (large dashed-border tile).
- Busy state line below ("Reading… 60%", "OCR page 3/5").
- Empty state below busy ("No documents yet. Import a passport, license, or
  utility bill to populate your profile.") — same micro-card pattern as
  other empty states.
- List of documents below. Each row: icon (file vs OCR'd scan), filename,
  document type badge ("passport", "drivers_license", etc.), OCR badge if
  applicable, metadata line (page count · size · imported date), and a
  trash button on the right.
- Removing a document opens an `AlertDialog` confirming the destruction of
  every extracted fact from it.

### 6.5 Profile view
- A row showing "X/N fields populated" — N is fixed (~31 canonical fields).
- Sections (with `Separator`): Personal, Contact, Government IDs,
  Employment, Emergency.
- Within each section, each field is a card showing:
  - Label (uppercase microcap).
  - Confidence badge (high / medium / low).
  - Source count badge if more than one document contributed.
  - Pin icon if user pinned a value.
  - AlertTriangle icon if the field is a red-flag conflict.
  - The value itself — **masked by default for highly-sensitive fields**
    (SSN, passport, license, national ID, tax ID). A small eye icon
    toggles reveal. First reveal opens a master-password dialog.
- Clicking a non-sensitive value enters inline edit mode (input + Save
  button).
- A field with no value shows a discreet "+ Add" ghost button.

### 6.6 Conflicts view
- Split into two sections: **Red flags** (DOB / SSN-style — should never
  differ) and **To review** (everything else).
- Each conflict is a card with:
  - Field label and conflict-state badge.
  - One row per live candidate showing: the value (mono font), "canonical"
    badge if it's the current winner, a pin icon if user-pinned, then a
    metadata line with source document name, doc type, confidence, and a
    truncated source excerpt in quotes.
  - Pin and dismiss icon buttons on the right of each row.
- Empty state: "No conflicts. All your documents agree on every extracted
  field."

### 6.7 Facts view (desktop only, full-screen)
- A real **node-and-edge graph** rendered with React Flow.
- Document nodes on the left (file icon, name, doc type).
- Fact nodes on the right (label microcap, value in mono, source count
  badge).
- Edges from each document to each fact it contributed to, styled by
  confidence (solid 1.5px = high, solid 1px = medium/low, dashed = a
  non-canonical candidate of a conflicted record). Arrowheads in the
  foreground colour.
- Clicking any node dims everything except its direct neighbours.
- Pan, zoom, and fit-to-view controls in a corner.
- Empty state: "Nothing to graph yet. Import documents to see how every
  fact connects to its source."

> The current graph works but could be much more elegant. Please propose a
> better layout (force-directed, ELK / dagre flow, or a different metaphor
> entirely). Maintain the monochrome constraint.

### 6.8 Settings view
Sections (with `Separator`):

- **Appearance.** Theme picker — three buttons (System / Light / Dark) with
  Monitor / Sun / Moon icons. Active state shown by border colour, not fill.
- **Ollama.** URL input, LLM model picker (auto-detects installed models),
  embedding model picker.
- **Privacy.** Three rows:
  - Toggle: "Require master password for sensitive fields."
  - Toggle: "Confirm before auto-fill."
  - Number input: "App lock timeout (minutes)."
- **Data.** Destructive "Clear all extracted fields" button (opens
  AlertDialog).
- Bottom card: the local-only verification copy ("OctoVault never sends
  your documents…").

### 6.9 Sensitivity unlock dialog
- A small Dialog. Title: "Unlock sensitive fields" with a Lock icon.
- Description varies based on first-set vs subsequent-unlock:
  - First time: "Set a master password. Used only on this device to gate
    highly-sensitive values."
  - Subsequent: "Enter your master password to reveal the value ending in
    {last 3 chars}."
- A password Input + inline error text.
- Buttons: Cancel (outline) + "Set & unlock" / "Unlock" (primary).

### 6.10 Form-fill in the browser (extension content script)
- A small **floating action button** in the bottom-right of every page that
  has any form field on it. Today it's a black pill with "⬛ Fill" — please
  redesign it.
- On click, an overlay toast tells the user what's happening: "Matching
  fields…", "Filled 14 fields · 3 skipped · review before submitting".
- Each filled field gets a brief outline that fades after 2.5 seconds —
  solid for confident matches, dashed for matches drawn from a conflicted
  record. You can replace these treatments with something more elegant as
  long as the meaning is preserved.

### 6.11 Landing site
- Sticky top nav: brand mark, links (Features, How it works, FAQ), Download
  button.
- Hero: a chip ("Private · On-device · Beta"), a serif headline ("Your
  private AI for personal paperwork."), a subheadline, primary + secondary
  CTAs.
- "Trust line" row: four short chips with icons — Offline by default,
  Encrypted vault, 0 outbound connections, Open SBOM at launch.
- Features grid (3 columns, 5 cells) — each cell is icon + title + body.
- How-it-works ordered list (4 steps).
- A small preview of the Facts graph (illustrative, not interactive).
- Comparison table — OctoVault vs Cloud doc AI vs Password manager.
- FAQ (5 Q&A pairs).
- Email-capture CTA at the bottom.
- Minimal footer.

## 7. Microcopy guidelines

- Use sentence case for buttons. "Get started", not "Get Started".
- Use mono font for any user-data value (names, IDs, numbers).
- Use serif for any text spoken *by* the AI ("Your passport expires March
  14, 2028").
- Use microcaps (uppercase, 10px, tracked +0.05em) for taxonomy labels:
  field names, doc types, confidence levels.
- Status pill text is one word where possible: "Ready", "Offline", "Local",
  "High", "Stale", "Conflict".
- Empty states are factual and short. Never apologetic.
- AlertDialogs say what is about to be destroyed and why it's permanent.

## 8. Interaction details to preserve

- **Drag-and-drop** for document import on the Documents card. Hover state
  on dragenter, drop dispatches the file pipeline.
- **Click a fact value** to inline-edit (unless sensitive, in which case
  click triggers the reveal flow first).
- **Click a graph node** to dim un-neighboured nodes/edges.
- **Tab nav** is keyboard-navigable (Radix Tabs is already wired).
- **First-run modal** is dismissible; we never block the user from poking
  around without Ollama installed.

## 9. Deliverables I'd like from you

1. **A redesigned visual system** — colour tokens (still monochrome),
   typography scale, spacing scale, radius scale, shadow scale (if any —
   we currently use none). Match Tailwind / shadcn variable conventions
   (`--background`, `--foreground`, `--muted`, etc.) so they drop into our
   `styles.css`.
2. **High-fidelity mockups** of every screen above, in both light and dark.
   Desktop screens at 1280×800. Popup screens at 400×600. Landing page
   responsive (mobile + desktop hero at minimum).
3. **States** for the important screens: empty, loading, populated,
   error, conflict, conflict-resolved.
4. **A redesigned Facts-graph layout** — propose the visual language for
   nodes, edges, edge labels (if any), and the optional minimap / legend.
5. **A redesigned in-page form-fill UX** — the floating button, the toast,
   and the per-field outline treatment.
6. **An icon mark** for the product, in a form that works as a 16/48/128/512
   icon (extension toolbar, dock, dmg, favicon) and a 1024 master.
7. **A logo lockup** — wordmark + mark, horizontal and stacked variants.
8. **A short style guide** describing how to apply the system to future
   screens we haven't built yet.

## 10. Out of scope

- Don't propose adding a colour. Even for a single accent.
- Don't propose cloud features (sync, sharing, comments). The product is
  local-only by design.
- Don't propose a chatbot persona / avatar. The AI is a function, not a
  character.
- Don't propose dark patterns (cookie banners, trial countdowns, friction on
  delete). The product's whole point is the absence of those.

## 11. Reference points

- 1Password (premium feel, security as content).
- Linear (typography discipline, monochrome elegance).
- Tana (information density done well).
- Standard Notes (privacy as identity).
- iA Writer (typographic confidence).
- The Browser Company / Arc (interaction polish, calm motion).

Avoid: anything that looks like a chatbot wrapper, anything that looks like
a Google product, anything bright-teal / electric-blue.

---

*End of brief.*
