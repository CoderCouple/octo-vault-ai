# Extension form-fill — robustness roadmap

Status: draft. Companion to `docs/EXTRACTION_RETRIEVAL_ROADMAP.md`.
Sibling artifact (regression set) will live at
`packages/extension/tests/form-fill-fixtures/`.

## Goal

The OctoVault Chrome extension should be the most reliable way a
user has ever filled a form. Concretely:

- The fill button appears on **every** page that has a fillable field
  *at any point in the page's lifecycle* — including SPAs, lazy
  modals, iframes, and shadow DOM.
- When the button runs, it identifies **every fillable field on the
  visible form** — including contenteditable inputs, fields inside
  collapsed sections, and fields whose labels are wired up via
  modern ARIA patterns.
- When it matches, it uses **section context** (fieldsets,
  preceding headings) so "Emergency Contact > Name" doesn't collide
  with the user's own name.
- When it fills, it gives the user **legible feedback** on what it
  matched, what it skipped, and *why*.

## Why this matters now

Live testing surfaced two specific complaints:

1. **The button doesn't appear on a lot of pages.** Most often: SPAs
   that render forms after mount, login modals, multi-step flows.
2. **When it does appear, it misses fields.** Most often: forms
   with fieldsets, forms using contenteditable, forms in iframes,
   forms whose inputs sit inside collapsed sections.

These are the most visible product-quality issues in the v0 build.
Until they're fixed, OctoVault's form-fill story is a parlor trick.

## Current code (where things live)

- `packages/extension/src/content/index.ts` — content script. Runs at
  `document_idle` in the top frame only. Single button-mount check
  is a one-shot `document.querySelector("input, select, textarea")`.
  `detectFields()` only scans `input, select, textarea`, skips zero-
  sized elements, traverses the light DOM only.
- `packages/extension/src/manifest.ts` — manifest. `<all_urls>` matches
  but **not** `all_frames: true`, so iframes are not covered.
- `packages/core/src/match.ts` — heuristic + LLM matcher. Heuristic
  handles `autocomplete` + `type=email|tel`. LLM sees a flat list
  of fields with no section context.
- `packages/extension/src/background/index.ts:56` — `form.match`
  handler. Prefers desktop bridge vault; picks one entity via
  `chooseFillProfile` (always "self" if present); calls
  `matchFormFields(cfg, fields, profile)`.

## Phase A — get the button to appear everywhere

Highest user-visible win. Fixes the "no button" failure mode for
SPAs, lazy modals, multi-step flows, route changes, and iframes.
Touches only the content script + manifest.

### Changes

1. **Mount the button unconditionally** at `document_idle`.
   Today: only if the page has a fillable field *at script load*.
   New: always mount. On click, if 0 fields are detected, show a
   helpful toast ("No fillable fields detected on this view").
   No code path silently hides the button. *Predictable UI beats
   "smart" UI.*

2. **`MutationObserver` on `document.documentElement`** watching
   `childList` + `subtree`. Debounced (100 ms). On each tick, if
   the cached field count has changed since the last detection,
   re-run `detectFields()` and update the cached count for badge
   display.

3. **SPA navigation hooks.** Monkey-patch `history.pushState` and
   `history.replaceState` to dispatch a synthetic `locationchange`
   event; listen for that + `popstate`. On either, re-run detection.
   Standard pattern for SPAs; well-documented; reversible if it
   ever causes issues.

4. **`all_frames: true` in the manifest's content_scripts entry.**
   The button mounts inside every same-origin iframe too. Add a
   `frameElement` check so we don't mount a *second* button when
   we're already in the top frame — only frames that aren't the
   top frame get a smaller, repositioned variant ("Fill this
   iframe").

### Success criteria

- Open a fresh React SPA (e.g., create-react-app demo with a form
  hidden behind a "Login" button). The button appears as soon as
  the form mounts, not before.
- Click around a multi-route SPA (Next.js demo). The button
  re-evaluates on each route, mounting/unmounting cleanly.
- A page with one same-origin iframe containing a form: two
  buttons appear, each correctly bound to its frame's fields.

### Risks

- `MutationObserver` on `documentElement` with `subtree: true` is
  noisy. Some sites mutate the DOM hundreds of times per second
  (chat apps, dashboards). Debounce hard (100 ms), batch, and
  short-circuit when nothing relevant changed (compare a cheap
  selector count).
- `all_frames` triggers extension load in ad iframes too. Filter
  out cross-origin iframes we can't read anyway, and stay off the
  hot path for iframes whose dimensions are < 200×200 (likely ads).

## Phase B — find more fields when detection runs

Highest accuracy win. Fixes the "missed fields" failure mode for
shadow DOM, contenteditable, collapsed sections, fieldset-grouped
forms.

### Changes

5. **Shadow DOM traversal.** Replace the flat
   `document.querySelectorAll` with a recursive walker that
   descends into every `Element.shadowRoot` (when accessible —
   closed shadow roots are opaque, that's by design and we don't
   try to defeat it).

6. **`contenteditable` and `role="textbox"` are fields.** Treat
   `[contenteditable=""]`, `[contenteditable="true"]`, and
   `[role="textbox"]` as detected fields with `type: "text"`.
   Skip if the element is also `aria-readonly="true"` or has
   `contenteditable="false"`.

7. **Don't skip zero-size elements.** Today's `if (rect.width === 0
   || rect.height === 0) continue` kills detection inside collapsed
   accordions and inactive tabs. Replace with:
   - Detect the field anyway, mark `field.hidden = true`.
   - At fill time, if a hidden field is matched, use an
     `IntersectionObserver` to write the value the next time it
     becomes visible (or just write it immediately — most modern
     forms are happy with that, and the framework dispatches its
     own change events on tab-switch).

8. **Better label resolution.** Today's `findLabel` checks
   `<label for>`, ancestor `<label>`, then ARIA singletons. Add,
   in order of precedence:
   - `aria-labelledby` — multi-id; concat referenced elements'
     text content.
   - Containing `<fieldset>`'s `<legend>` (used as a *section*
     hint, not as the field label itself — see Phase C).
   - Nearest preceding heading (`h1`-`h6`) inside the same form
     or section — also a section hint.
   - Nearest preceding non-empty text node within the field's
     direct parent (catches "Name:" labels with no `for`
     attribute).

9. **Group fields by section.** Add a `field.section?: string`
   that records the legend / heading / labelled-region the field
   belongs to. Used by Phase C; collected here.

### Success criteria

- Walk a shadow-DOM-based form (Salesforce Lightning component,
  any web-component form). Fields detected.
- A page with a Material UI / Headless UI multi-step wizard:
  fields in steps 2 and 3 (currently hidden) are still detected.
- A page with `<fieldset><legend>Emergency Contact</legend>...`:
  detected fields carry `section: "Emergency Contact"`.

### Risks

- Some "fields" inside shadow DOM are decorative wrappers used by
  third-party UI kits (e.g., a hidden buffer for IME composition).
  Filter by visibility *intent* — `aria-hidden="true"` and inputs
  with `tabindex="-1"` are excluded.
- Treating contenteditable as a field can trigger on the body of
  rich-text editors (Notion-like, ProseMirror). Limit to
  elements that also have `role="textbox"` OR a non-empty
  `aria-label` / `aria-labelledby` so we only catch form-style
  contenteditables.

## Phase C — better matching with section context

Highest semantic-quality win. Fixes the "Emergency Contact > Name
matched as self.fullName" failure mode that's almost guaranteed
once Phase B lands fieldset detection.

### Changes

10. **Pass section context to the LLM.** Restructure the matching
    prompt in `core/src/match.ts` so unresolved fields are grouped
    by `field.section`. The LLM gets:

    ```
    SECTION: "Emergency Contact"
      - id="ov-12" label="Name" type="text"
      - id="ov-13" label="Phone" type="tel"
    SECTION: "Personal information"
      - id="ov-1"  label="Full Name" type="text"
    ```

    instead of a flat list.

11. **Multi-entity routing.** Today's `chooseFillProfile` always
    returns "self". Extend it to take the section labels into
    account: if a section's title strongly matches a known
    relationship (`/spouse|wife|husband|partner/i`,
    `/father|mother|parent/i`, `/child|son|daughter/i`,
    `/emergency/i`), look up that entity's profile and route the
    matches inside that section to it.

12. **Match telemetry in the UI.** Today: results go to
    `console.group("[OctoVault] form fill")`. Promote to a
    dismissible HUD card (positioned next to the launcher) that
    shows: total detected, matched, skipped; click each skip to
    see *why*. Most form-fill tools have nothing like this; it
    pays for itself in trust and in user-facing debug data when
    something goes wrong.

### Success criteria

- A school enrollment form with sections for "Student", "Parent
  1", "Parent 2", "Emergency Contact": filling routes each
  section's name field to the right entity (parents from the
  graph, self for student, emergencyContactName for the last
  section).
- A USCIS form (we have several examples in test docs): "Beneficiary"
  fields fill from `self`; "Petitioner" fields try a "petitioner"
  entity if one exists, otherwise leave blank.

### Risks

- Multi-entity routing is the place to overreach. If we
  aggressively route a name field to "spouse" based on a weak
  section hint, we'll fill the wrong value. Require both a
  high-confidence section match AND a profile that actually has
  the relevant field, otherwise fall back to self and let the
  user see the "matched as self.fullName" annotation in the HUD.

## Phase D — polish + correctness

Smaller, opportunistic. Do after A–C land.

13. **Re-verify React-controlled inputs.** The current
    `setNativeValue` uses the prototype-setter trick to bypass
    React 18's hijack of `value`. Confirm with a fresh smoke
    test on a CRA / Vite-React form; add to the regression set.

14. **Refill pass on validation rejection.** Some forms reject
    a fill on submit (date format mismatch, postal-code regex).
    Detect via aria-invalid mutation; show "Refill?" in the HUD
    with the corrected value.

15. **Persistent dev badge.** When user toggles dev mode in
    Settings, the launcher shows a small "detected / matched /
    filled" counter at all times. Useful for our own debugging
    and for users who care to verify.

## Phase E — LLM + vision-assisted detection

Augments DOM detection (Phases A+B) for the long tail of pages where
the DOM doesn't tell the truth: canvas/SVG-rendered widgets, custom
web components without ARIA, forms whose labels are images / icons,
hostile anti-bot layouts. Two layers:

### E1 — LLM-text augmentation (default, cheap)

After Phase B detection, we have a list of candidate fields with
labels and section hints. Before running matching, send the LLM:
- the list of detected fields (label, name, type, section, snippet
  of nearby text content)
- a flat list of *suspicious* elements DOM detection chose **not** to
  include: clickable divs with text content that looks form-like
  ("Click to enter your name"), labelled containers with no matching
  input, etc.

Ask the model to (a) confirm or correct each detected field's purpose
in plain words, and (b) flag any suspicious candidate that's really a
field. Cost: one extra Ollama call per fill click. ~1–2s on `qwen3:8b`
warm. Runs only on click, not on every detection refresh.

Implementation:
- New file: `packages/core/src/detect.ts` — `enrichDetection(cfg, fields,
  candidates)` returns annotated fields with LLM-suggested labels +
  any newly-promoted fields.
- Content script: pass an additional `suspiciousCandidates` array
  alongside fields when calling `form.match`. Background routes to
  `enrichDetection` first, then to existing matcher.
- HUD: when the LLM corrected a label or promoted a hidden field,
  flag those rows so the user understands why the count differs from
  DOM-only Phase B's count.

### E2 — Vision-assisted fallback (on-demand)

For the long tail where the DOM is genuinely opaque (Stripe-style
hosted forms, canvas widgets, image-based labels), capture a
screenshot of the visible viewport and ask `qwen3-vl:8b`:
"List every form field you see, with its visible label and an
approximate bounding box."

Then map model output back to DOM nodes via:
1. Bounding box → `document.elementFromPoint` at the box center
2. If the hit element isn't fillable, walk up to nearest fillable
   ancestor or sibling within the box
3. Use the LLM-given label as `field.label` for that node

This is invoked **only** when detection looks suspicious — heuristic:
fewer than 3 DOM fields detected on a page whose visible viewport
has at least one form-like rectangle (text + a box + a submit-style
control). Vision is expensive (30 GB model + 5–15 s); we don't pay
unless DOM detection clearly under-counted.

Implementation:
- Manifest: `activeTab` already covers screenshot capture on click.
- Content script: add `requestVisionAssist()` that captures the visible
  viewport via `chrome.tabs.captureVisibleTab` (called from background,
  delegated via message) and sends to `vision()` in core/ollama.ts
  (already exists for OCR).
- Vision prompt is tuned for form fields specifically — different
  from the OCR prompt — and returns JSON with `[{label, bbox}, ...]`.
- Wire results into the detection pipeline as another source.

### Risks

- **Mapping vision bboxes to DOM elements is fragile.** Page scrolls
  between capture and use will misalign. Capture must be on the same
  tick as the click; freeze the layout if needed.
- **Vision model evicts the chat model.** Already mitigated by
  `keep_alive: "1m"` on vision calls, but a chain of vision-assist
  fills could thrash. Budget: at most one vision assist per fill
  click.
- **Privacy / capture surface.** `chrome.tabs.captureVisibleTab`
  requires user-initiated context. We're inside the launcher's onClick
  so that's satisfied — but document the implications clearly in
  Settings.

### Success criteria

- A Stripe-style hosted card-input iframe (read-only DOM) gets at
  least its label-meaning right via vision, even if we can't fill
  the cross-origin frame.
- A site with image-as-label form fields ("Email" as a graphic next
  to an unlabelled input) gets the right label attached.
- A page with 0 DOM fields but a visible custom-rendered form
  triggers the vision pass and surfaces fields the user can act on.

### Order of ship

E1 first — it's a small additive call, low risk, immediately useful
on real-world forms whose ARIA is incomplete. E2 second — it requires
new permissions plumbing and a different prompt + mapping layer; ship
when E1's gaps justify the cost.

## Phase F — generated content + composite fields

The Phases A–E matcher only does *lookup* — find a profile key for
each field. Real-world government forms (visa applications, school
enrolments, mortgage paperwork) consistently demand things lookup
can't produce:

1. **Free-text answers** the user is expected to write themselves
   (e.g., "Tell us more about what you'll do in Canada", 475 char max).
2. **Inferred radio / select choices** with options the form supplies
   ("Visitor visa or super visa", "Not sure", etc.) that depend on
   the user's intent, not their profile.
3. **Composite fields** where one logical value is split across N
   inputs — most commonly dates split across three `<select>` for
   year / month / day. The current matcher skips these because no
   single field matches `type=date`.

Without this, OctoVault saves at most 30% of typing on a form like
Canada IRCC's tourist-visa application. Phase F is the difference
between a demo and a tool people actually use.

### Components

**F1 — Composite field detection**

Detect that a group of inputs is one logical field. Heuristics:
- Three `<select>` elements within the same fieldset/region whose
  labels (or option contents) include {Year, Month, Day} → date.
- Two `<input type="text">` with `pattern=[0-9]{3}` and `pattern=[0-9]{4}`
  inside a "Phone" fieldset → phone parts.
- An `<input>` paired with a country-code `<select>` → phone with country.

Implementation: a new pass after `detectFields()` that walks the
section graph and emits a `CompositeField` whose `parts` are the
already-detected children. The matcher treats it as a single field
with the composite's label/section, and the fill step decomposes the
value across the parts using a tiny per-composite formatter.

**F2 — Per-session intent context**

The user provides, once per form, a sentence or two of context:
> "I'm visiting Canada for a 10-day family trip in May 2026."

This is asked for on first fill click on a page that contains *any*
generation-needing field (textareas, free-text radios). Stored in
the active conversation / session — not the long-lived profile, so
it doesn't leak across unrelated forms.

UI surface: a small input in the HUD that appears when generation
fields are detected. User can edit and re-run.

**F3 — Generation engine**

For each "open" field that needs generation:
- **Free text**: prompt qwen3:8b with the field label + character
  limit + intent context + relevant profile snippets. Return a
  draft.
- **Radio / select**: prompt with the field label + intent +
  available `<option>` text values. Return the selected option text.
- **Date**: parse intent ("May 2026" → `2026-05-15`) deterministically
  via a small parser first, fall back to LLM if ambiguous.

Generation produces draft values that flow into the same `FieldMatch`
pipeline, with `source: "generated"` so the HUD can show them
differently.

**F4 — Approval gate**

Generated values do not auto-fill until the user reviews them.
The HUD shows each generated value with:
- The draft (editable inline)
- A regenerate button
- A "fill this" / "fill all" action

Profile-lookup values continue to fill on the existing click.
Generation only lights up when the form actually needs it.

### Risks

- **Hallucinated facts**. The intent ("May 2026, 10 days") gives the
  model dates, but it might invent details ("staying at the Hilton
  Toronto"). The free-text prompt forbids invention and asks the
  model to keep statements consistent with what the user provided.
- **Form-specific compliance language**. Canadian / US government
  forms expect specific phrasing ("applicant", "the named subject");
  generated answers should sound like the user, not boilerplate.
  Tunable via a single style hint in the prompt.
- **Radio option text drift**. The model might return text that's
  close but not exactly equal to an `<option>`. The dispatcher must
  fuzzy-match (normalized whitespace, case) and only fill on exact
  match; never write half-matches.

### Success criteria

- The Canada IRCC tourist visa form: composite dates fill from the
  user's "May 5–15, 2026" intent; radio choices select the right
  visa class; the textarea is populated with an editable paragraph
  the user can refine before submission.
- A US passport renewal form: the "Reason for renewal" radio gets
  the right option; the "Provide details" textarea is generated.
- A school enrolment form: parent-section name fields fill from the
  parent entity (Phase C); the "Why do you want this school for
  your child?" textarea is generated.

### Order of ship

F1 first — composite dates alone unlock a huge chunk of government
forms and are deterministic (no LLM call needed for the common case).
F2 + F3 + F4 ship together because they're a single UX loop: ask
for context, generate, review, fill.

### F5 — Multi-page forms

Most government forms are multi-page (Canada IRCC, USCIS, IRS,
school enrolments). The user's intent context from page 1 must
survive to pages 2..N without re-entry, and the user wants a
running view of what's been filled so far. Two sub-problems:

**State persistence across pages**

A `FormSession` keyed by an *origin + pathname-prefix* fingerprint.
For an IRCC form at `apply.cic.gc.ca/visit-canada/...`, the prefix
matches every page in that flow. The session stores:
- `intent`: the free-text context the user typed
- `entityRouting`: per-section entity assignments confirmed by the
  user (so "Spouse" stays bound to the right entity across pages)
- `filledRows`: an append-only log of every successful fill,
  per page URL, so the HUD can show a "23 fields filled across 4
  pages" running total

Stored in `chrome.storage.local` keyed by fingerprint. Survives tab
close and re-open. Cleared when the user explicitly ends the session
(HUD button) or after 7 days idle.

**Page-change detection**

- SPA forms: Phase A's `locationchange` hook fires on `pushState`.
  Re-mount the HUD with the existing session state.
- Server-rendered multi-page: each page is a fresh document. On
  content-script boot, look up the FormSession by fingerprint
  before declaring "no session" — if one matches, restore the
  intent + HUD running total automatically.

**Fingerprint heuristic**

Origin + first two pathname segments + presence of form-flow
breadcrumbs (e.g., a "Step 2 of 5" element, a hidden CSRF token
form, repeated section labels across pages). Tuned to be loose
enough that mid-flow URL changes don't lose state, strict enough
that an unrelated form on the same origin doesn't inherit context.

**Multi-page review UX**

The HUD gains a "Session" tab showing the running total. Click an
older page's row to navigate back (browser history) and verify.
Submit button never auto-clicks — submission stays the user's call.

### Risks (multi-page)

- **Session bleeding across users**. If two people share a browser
  profile, person B's IRCC intent could leak to person A. The
  fingerprint is per-origin so cross-form bleed is unlikely; but
  for shared devices we offer an "End session" button prominently.
- **Stale resumption**. A session resumed two weeks later may
  reference outdated dates ("entering Canada in May 2026" when it's
  now June 2026). Surface the session timestamp in the HUD; require
  re-confirmation of any date-relative context if > 48 h old.
- **Server-rendered page-reloads lose ephemeral entity-routing**.
  Mitigated by persisting `entityRouting` in the session, not just
  in memory.

### What this means for Phase E

Phase E (LLM/vision-assisted detection) and Phase F (generation +
composites + multi-page) are orthogonal — E expands *what* we
detect, F expands *how* we fill what we detected, and F5 in
particular adds the *across-pages* dimension. All three fit
between B and the v1 "production form-fill" milestone.

## Out of scope

- Cross-origin iframes (Stripe, Plaid). MV3 has no API to read
  fields inside another origin's iframe, by design.
- Captchas and bot-protected fields.
- File uploads. The matcher could surface "needs document",
  but actually attaching one is a much larger UX surface.
- Autofilling the *whole* form (every field including those the
  user has explicitly skipped). The button is opt-in per click.

## Open questions to resolve before / during implementation

- **MutationObserver budget.** What's the per-page CPU ceiling we
  accept? Concrete number — e.g., "≤ 1ms per tick averaged over
  5 s on a 60-fps page" — so we have something to measure
  against.
- **iframe button UX.** Two buttons feels noisy. Alternative:
  the top-frame button has a "↳ Fill iframe forms (N)" sub-action.
  Decide before Phase A ships.
- **Section-based entity routing — confidence threshold.** Cheap
  to over-route; expensive to under-route. Need a manual rubric
  for "this looks like a spouse section" *before* we ship Phase C.
- **HUD vs toast.** The current toast is one-shot, 4.5 s. The
  HUD adds a click surface. Worth the visual weight? My vote:
  yes, but configurable in Settings.

## Regression test approach

Mirroring the QA pipeline's `packages/core/scripts/golden.yaml`,
we add `packages/extension/tests/form-fill-fixtures/`:

```
form-fill-fixtures/
  00-vanilla-html/index.html        ← server-rendered, no JS
  01-react-spa/index.html           ← inputs render after mount
  02-multi-step/index.html          ← step 2 has hidden inputs
  03-shadow-dom/index.html          ← inputs inside shadow root
  04-iframe-form/index.html         ← cross-frame
  05-fieldset-sections/index.html   ← emergency contact section
  06-contenteditable/index.html
  07-aria-labelledby/index.html
  expected.yaml                     ← per fixture: which fields
                                       must be detected, which
                                       must match a given profile,
                                       which must be skipped.
```

A small headless harness (Playwright) loads each fixture, injects
the content script, runs detection, runs matching against a
canned profile, and asserts against `expected.yaml`. Fast feedback;
CI-able later. Each phase ships with at least one new fixture.

## Order of ship

- **A + B in one PR.** They're tightly coupled (Phase A unblocks
  the user-visible bug; Phase B is what makes A's coverage
  trustworthy). Add fixtures 00–04 and 06 with the PR.
- **C in its own PR** because the prompt rewrite is invasive and
  the HUD is its own design surface. Add fixtures 05 and 07.
- **D as opportunistic follow-ups.** No reason to delay A/B/C
  while we discuss them.

## What this isn't

This roadmap is about making form-fill *actually work* on the
modern web. It is **not** a rewrite of the matcher's underlying
ranking model. The LLM-with-section-context approach in Phase C
is the highest-ROI matcher change we can make without leaving the
local-only constraint. A learned ranker, a CRF, a finetuned
field-classifier — all out of scope here. Revisit only if Phase C
plateaus on quality.
