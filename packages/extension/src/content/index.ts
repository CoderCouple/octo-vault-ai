// Injected into every page. Detects fillable form fields, mounts a
// floating action button, and (on click) asks the background to match
// fields to the user's profile, then fills them with visible feedback.

import { isLikelyOpenField, type DetectedField, type Entity, type FieldDraft, type FieldMatch, type VaultProfile } from "@octovault/core";

const FIELD_ATTR = "data-octovault-id";

// Phase B: a Fillable is any element we might write a value into.
// Native form controls, contenteditable elements with a textbox role,
// or generic role=textbox elements all qualify. Selects + textareas
// stay first-class.
type Fillable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLElement;

// Recursive collector that descends into open shadow roots. Closed
// shadow roots are opaque by design and we don't try to defeat that.
// We pick selectors that match either native form controls or the
// editable surfaces modern component libs use; downstream filtering
// drops anything irrelevant.
function collectCandidates(root: Document | ShadowRoot, sink: HTMLElement[]) {
  const selector = "input, select, textarea, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox']";
  const found = root.querySelectorAll<HTMLElement>(selector);
  for (const el of found) sink.push(el);
  // Walk every element looking for open shadow roots and recurse.
  // querySelectorAll("*") in modern engines is cheap on typical pages;
  // chat apps and dashboards might pay more — that's why detection is
  // debounced upstream.
  const all = root.querySelectorAll<HTMLElement>("*");
  for (const el of all) {
    if (el.shadowRoot) collectCandidates(el.shadowRoot, sink);
  }
}

// Names we never want to fill. CAPTCHAs (Google reCAPTCHA, hCaptcha,
// Cloudflare Turnstile) all use a hidden form-control that gets set
// when the user solves the challenge — we MUST NOT fill or draft for
// these. Same for honeypot fields commonly named "url", "website"
// inside hidden wrappers.
const NEVER_FILL_NAME_RE = /\b(g-recaptcha-response|h-captcha-response|cf-turnstile-response|recaptcha|captcha|honey?pot)\b/i;

function isFillableType(el: HTMLElement): boolean {
  // Hard-exclude captchas regardless of element shape.
  const name = el.getAttribute("name") ?? "";
  if (name && NEVER_FILL_NAME_RE.test(name)) return false;
  const id = el.getAttribute("id") ?? "";
  if (id && NEVER_FILL_NAME_RE.test(id)) return false;

  if (el instanceof HTMLInputElement) {
    const type = el.type;
    if (["hidden", "submit", "button", "reset", "image", "file", "password"].includes(type)) return false;
    return true;
  }
  if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return true;
  // contenteditable / role=textbox / role=combobox
  const role = el.getAttribute("role");
  const editable = el.isContentEditable;
  if (editable) return true;
  if (role === "textbox" || role === "combobox") return true;
  return false;
}

function isInteractable(el: HTMLElement): boolean {
  // Programmatic disable / aria-disabled. We do NOT zero-skip here —
  // hidden inputs are kept as Fillable with field.hidden = true so
  // multi-step forms aren't silently dropped (the matcher still
  // routes them; the fill site re-tries on visibility).
  if ("disabled" in el && (el as HTMLInputElement).disabled) return false;
  if ("readOnly" in el && (el as HTMLInputElement).readOnly) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (el.getAttribute("aria-readonly") === "true") return false;
  if (el.getAttribute("contenteditable") === "false") return false;
  return true;
}

function isHidden(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return true;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return true;
  return false;
}

function fieldType(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) return el.type || "text";
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  return "text";
}

function detectFields() {
  const out: { el: Fillable; field: DetectedField }[] = [];
  const candidates: HTMLElement[] = [];
  collectCandidates(document, candidates);

  let i = 0;
  for (const el of candidates) {
    if (!isFillableType(el)) continue;
    if (!isInteractable(el)) continue;
    const type = fieldType(el);
    const id = `ov-${i++}`;
    el.setAttribute(FIELD_ATTR, id);
    out.push({
      el: el as Fillable,
      field: {
        id, type,
        label: findLabel(el),
        name: el.getAttribute("name") ?? "",
        placeholder: (el as HTMLInputElement).placeholder ?? el.getAttribute("aria-placeholder") ?? "",
        autocomplete: el.getAttribute("autocomplete") ?? "",
        section: findSection(el),
        hidden: isHidden(el),
      },
    });
  }
  return out;
}

// Phase F1+: radio-group collapse. Each <input type="radio"> in the
// same `name` group represents one option of ONE logical question.
// detectFields() returns each radio as a separate field, which leads
// to 3+ identical drafts in the HUD when only one answer is needed.
// This pass replaces the individual radios with a single synthetic
// "choice" field whose options list is the radio labels and whose
// question label is the enclosing fieldset legend / aria-labelledby /
// preceding heading — not the option text. Filling a group fires the
// underlying radio click via the existing pill UI in showHud().

interface RadioGroup {
  syntheticId: string;
  field: DetectedField;
  options: string[];                 // option label text in DOM order
  parts: HTMLInputElement[];         // matched radios for click-to-fill
}

function findGroupLabel(els: HTMLInputElement[]): string {
  // Walk up from any radio to the nearest fieldset or aria-labelled
  // region; use its legend / aria-label as the group question. Falls
  // back to the section helper (heading-based) when no labelled
  // wrapper exists. All results go through cleanLabel().
  for (const r of els) {
    const fs = r.closest("fieldset");
    if (fs) {
      const legend = fs.querySelector(":scope > legend");
      const txt = legend?.textContent?.trim();
      if (txt) return cleanLabel(txt);
    }
    let parent: HTMLElement | null = r.parentElement;
    while (parent) {
      const role = parent.getAttribute("role");
      const aria = parent.getAttribute("aria-label")?.trim();
      if ((role === "radiogroup" || role === "group") && aria) return cleanLabel(aria);
      const lb = parent.getAttribute("aria-labelledby");
      if ((role === "radiogroup" || role === "group") && lb) {
        const ref = parent.ownerDocument.getElementById(lb.split(/\s+/)[0]);
        // Use directText so we get the heading's text *only*, not
        // a concatenation of every option-button that follows.
        const txt = ref ? directText(ref) || ref.textContent?.trim() : "";
        if (txt) return cleanLabel(txt);
      }
      parent = parent.parentElement;
    }
  }
  // Last resort: look for a heading or label-like sibling immediately
  // before the radio group's nearest common ancestor. Use directText
  // to avoid grabbing concatenated option content.
  const common = els[0].parentElement;
  if (common) {
    let prev: Element | null = common.previousElementSibling;
    while (prev) {
      const tag = prev.tagName.toLowerCase();
      if (["h1","h2","h3","h4","h5","h6","label","p","legend"].includes(tag)) {
        const t = directText(prev) || prev.textContent?.trim() || "";
        if (t) return cleanLabel(t);
      }
      prev = prev.previousElementSibling;
    }
  }
  return cleanLabel(findSection(els[0])) || "Choice";
}

function detectRadioGroups(detected: { el: Fillable; field: DetectedField }[]): RadioGroup[] {
  const byName = new Map<string, { el: HTMLInputElement; field: DetectedField }[]>();
  for (const d of detected) {
    if (!(d.el instanceof HTMLInputElement) || d.el.type !== "radio") continue;
    const key = d.el.name || `__unnamed__${d.field.section ?? ""}`;
    const arr = byName.get(key) ?? [];
    arr.push({ el: d.el, field: d.field });
    byName.set(key, arr);
  }
  const groups: RadioGroup[] = [];
  let i = 0;
  for (const [, members] of byName) {
    // A single isolated radio is rare but real (a "yes" confirm).
    // Still collapse it into a 1-option synthetic — keeps the matcher
    // path uniform.
    const els = members.map((m) => m.el);
    const options = members.map((m) => m.field.label || m.el.value || "");
    const syntheticId = `ov-rgroup-${i++}`;
    groups.push({
      syntheticId,
      field: {
        id: syntheticId,
        type: "radio",
        label: findGroupLabel(els),
        name: els[0].name ?? "",
        placeholder: "",
        autocomplete: "",
        section: members[0].field.section,
      },
      options,
      parts: els,
    });
  }
  return groups;
}

// Phase F1: composite-date detection.
// Many government forms split a date into three <select> elements
// (year / month / day) inside one fieldset, e.g.
//   <fieldset><legend>When will you enter Canada?</legend>
//     <select aria-label="Year">...</select>
//     <select aria-label="Month">...</select>
//     <select aria-label="Day">...</select>
//   </fieldset>
// detectFields() returns these as three separate select fields with
// no useful type — matching skips them. This function looks for the
// pattern after detection and emits a synthetic composite field that
// the matcher can treat as one type=date input. The fill step
// decomposes the value across the three parts.

interface DateComposite {
  syntheticId: string;            // e.g. "ov-comp-0"
  field: DetectedField;           // what we send to the matcher
  parts: { year: HTMLElement; month: HTMLElement; day: HTMLElement };
}

function labelOfPart(el: HTMLElement): string {
  // Cheap probe — what does this look like? We check aria-label, name,
  // and the visible option contents to classify a select as a year /
  // month / day picker.
  const aria = (el.getAttribute("aria-label") ?? "").toLowerCase();
  const name = (el.getAttribute("name") ?? "").toLowerCase();
  const label = findLabel(el).toLowerCase();
  return `${aria} ${name} ${label}`.trim();
}

function classifyDatePart(el: HTMLElement): "year" | "month" | "day" | null {
  const t = labelOfPart(el);
  if (/\byear|yyyy|yy\b|\bann[eé]e\b|वर्ष/.test(t)) return "year";
  if (/\bmonth|mm\b|mois|माह/.test(t)) return "month";
  if (/\bday|dd\b|jour|दिन/.test(t)) return "day";
  // Fall back to option-content heuristic for unlabelled selects:
  // year options are 4-digit numbers; month options are 12 entries.
  if (el instanceof HTMLSelectElement) {
    const opts = Array.from(el.options).slice(1, 5).map((o) => o.textContent?.trim() ?? "");
    if (opts.length && opts.every((o) => /^\d{4}$/.test(o))) return "year";
    if (el.options.length >= 12 && el.options.length <= 13) {
      // 12 months ± a "Select month" header.
      if (opts.some((o) => /january|jan|february|feb|march|april/i.test(o))) return "month";
    }
    if (opts.length && opts.every((o) => /^\d{1,2}$/.test(o))) {
      const max = Math.max(...Array.from(el.options).map((o) => parseInt(o.textContent ?? "0", 10)));
      if (max <= 31) return "day";
    }
  }
  return null;
}

function detectDateComposites(detected: { el: Fillable; field: DetectedField }[]): DateComposite[] {
  // Group detected fields by their section label. Then within each
  // group, look for a {year, month, day} triple.
  const bySection = new Map<string, { el: HTMLElement; field: DetectedField; part: "year" | "month" | "day" }[]>();
  for (const d of detected) {
    if (!(d.el instanceof HTMLSelectElement)) continue;
    const part = classifyDatePart(d.el as HTMLElement);
    if (!part) continue;
    const sec = d.field.section ?? "";
    const arr = bySection.get(sec) ?? [];
    arr.push({ el: d.el as HTMLElement, field: d.field, part });
    bySection.set(sec, arr);
  }
  const composites: DateComposite[] = [];
  let i = 0;
  for (const [sec, parts] of bySection) {
    const year = parts.find((p) => p.part === "year")?.el;
    const month = parts.find((p) => p.part === "month")?.el;
    const day = parts.find((p) => p.part === "day")?.el;
    if (!year || !month || !day) continue;
    const syntheticId = `ov-comp-${i++}`;
    composites.push({
      syntheticId,
      field: {
        id: syntheticId,
        type: "date",
        label: sec || "Date",
        name: "",
        placeholder: "",
        autocomplete: "",
        section: sec || undefined,
      },
      parts: { year, month, day },
    });
  }
  return composites;
}

// Parse a date range out of free-text intent. Used to auto-fill
// composite date fields ("When will you enter / leave Canada?")
// without burning an LLM call per page. Covers the common patterns
// the user might type:
//   - "May 5–15, 2026" / "May 5 to May 15, 2026"
//   - "2026-05-05 to 2026-05-15"
//   - "5/5/26 - 5/15/26"
//   - "10-day trip in May 2026" → start=May 1, end=May 10
//   - "May 2026" → start=May 1 (no end)
// Returns ISO YYYY-MM-DD strings. Conservative: returns null when
// nothing parseable was found.
const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
function pad(n: number): string { return String(n).padStart(2, "0"); }
function toIso(y: number, m: number, d: number): string { return `${y}-${pad(m)}-${pad(d)}`; }

export interface ParsedIntentDates {
  start?: string;
  end?: string;
}

function parseIntentDates(intent: string): ParsedIntentDates {
  if (!intent || intent.trim().length === 0) return {};
  const text = intent.trim();
  const out: ParsedIntentDates = {};

  // ISO range: 2026-05-05 to 2026-05-15
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})\s*(?:to|-|–|—|until)\s*(\d{4})-(\d{2})-(\d{2})/i);
  if (iso) {
    out.start = `${iso[1]}-${iso[2]}-${iso[3]}`;
    out.end = `${iso[4]}-${iso[5]}-${iso[6]}`;
    return out;
  }
  // Single ISO date
  const isoSingle = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoSingle) out.start = `${isoSingle[1]}-${isoSingle[2]}-${isoSingle[3]}`;

  // "Month DD–DD, YYYY" / "Month DD to Month DD, YYYY"
  // Common range patterns with month names.
  const monthRange = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})\s*(?:to|-|–|—|until)\s*(?:([A-Za-z]{3,9})\s+)?(\d{1,2}),?\s+(\d{4})\b/i);
  if (monthRange) {
    const m1 = MONTH_NAMES[monthRange[1].toLowerCase()];
    const m2 = monthRange[3] ? MONTH_NAMES[monthRange[3].toLowerCase()] : m1;
    const y = parseInt(monthRange[5], 10);
    if (m1 && m2) {
      out.start = toIso(y, m1, parseInt(monthRange[2], 10));
      out.end = toIso(y, m2, parseInt(monthRange[4], 10));
      return out;
    }
  }

  // "Month YYYY" — month only
  const monthOnly = text.match(/\b([A-Za-z]{3,9})\s+(\d{4})\b/i);
  if (monthOnly && !out.start) {
    const m = MONTH_NAMES[monthOnly[1].toLowerCase()];
    const y = parseInt(monthOnly[2], 10);
    if (m) out.start = toIso(y, m, 1);
  }

  // "N-day trip" / "N day" + anchor month → infer end from start + N - 1
  const dur = text.match(/\b(\d{1,3})\s*[-\s]?day\b/i);
  if (dur && out.start && !out.end) {
    const n = parseInt(dur[1], 10);
    if (n > 0 && n < 365) {
      const [y, m, d] = out.start.split("-").map(Number);
      const start = new Date(Date.UTC(y, m - 1, d));
      const end = new Date(start.getTime() + (n - 1) * 86400000);
      out.end = toIso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
    }
  }

  return out;
}

// Decide whether a composite's label semantically points to the
// "start" or "end" half of an intent date range. Conservative
// keyword matching; defaults to start when unclear so a single-date
// fill ("May 2026") doesn't accidentally land on the end field.
function pickIntentDateForComposite(label: string, parsed: ParsedIntentDates): string | undefined {
  const l = label.toLowerCase();
  if (/\b(leave|depart|exit|end|return|until|to)\b/.test(l)) return parsed.end ?? parsed.start;
  return parsed.start ?? parsed.end;
}

// Fill a composite date by writing each part. Returns true if all
// parts wrote successfully. Year/Day are numeric strings; Month
// handles two formats: numeric (1, 2, ..., 12) or named (january,
// february, ...) — we try the numeric value first, then walk the
// options to find a matching text/value.
function fillDateComposite(parts: DateComposite["parts"], iso: string): boolean {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, yyyy, mm, dd] = m;
  const setSelectByText = (el: HTMLElement, candidates: string[]): boolean => {
    if (!(el instanceof HTMLSelectElement)) return false;
    for (const cand of candidates) {
      const found = Array.from(el.options).find((o) =>
        o.value === cand || (o.textContent?.trim().toLowerCase() === cand.toLowerCase()),
      );
      if (found) {
        el.value = found.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  };
  const monthNamesLong = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const monthNamesShort = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  const monthIdx = parseInt(mm, 10) - 1;
  const dayInt = parseInt(dd, 10);
  const yearOk = setSelectByText(parts.year, [yyyy]);
  const monthOk = setSelectByText(parts.month, [mm, String(parseInt(mm, 10)), monthNamesLong[monthIdx] ?? "", monthNamesShort[monthIdx] ?? ""]);
  const dayOk = setSelectByText(parts.day, [dd, String(dayInt)]);
  return yearOk && monthOk && dayOk;
}

// Phase E1: suspicious candidates. Elements that LOOK form-like but
// didn't make it through detectFields(). The LLM augmentation pass
// decides which are real fields. We bias toward including too few
// rather than too many — the LLM call is cheap, but each promotion
// fans out to a fill attempt.
function detectSuspicious(detectedEls: Set<HTMLElement>): { el: HTMLElement; cand: import("@octovault/core").SuspiciousCandidate }[] {
  const out: { el: HTMLElement; cand: import("@octovault/core").SuspiciousCandidate }[] = [];
  let i = 0;

  // (a) labelled containers that don't contain any detected input.
  // Things like <div role="textbox" aria-labelledby="..."> with no
  // child input — most often custom widgets.
  const labelled = document.querySelectorAll<HTMLElement>("[aria-labelledby], [aria-label]");
  for (const el of labelled) {
    if (detectedEls.has(el)) continue;
    // Skip if any descendant is a real form control we already detected.
    let hasDetectedChild = false;
    for (const ch of el.querySelectorAll<HTMLElement>("input, select, textarea")) {
      if (detectedEls.has(ch)) { hasDetectedChild = true; break; }
    }
    if (hasDetectedChild) continue;
    const text = (el.textContent ?? "").trim();
    if (text.length === 0 || text.length > 200) continue;
    if (isHidden(el)) continue;
    // Buttons / links / headings are NOT fields.
    const tag = el.tagName.toLowerCase();
    if (["button", "a", "h1", "h2", "h3", "h4", "h5", "h6", "label", "fieldset", "legend"].includes(tag)) continue;

    const id = `ov-cand-${i++}`;
    el.setAttribute(FIELD_ATTR, id);
    out.push({
      el,
      cand: {
        id, tag,
        text,
        section: findSection(el),
        reason: "labelled container, no input child",
      },
    });
    if (out.length >= 12) break; // cap to keep prompt size reasonable
  }
  return out;
}

// Resolution order (most specific first):
//   1. aria-labelledby (multi-id; concat referenced elements' text)
//   2. <label for="id">
//   3. ancestor <label>
//   4. aria-label
//   5. title
//   6. placeholder / aria-placeholder
function findLabel(el: HTMLElement): string {
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const parts: string[] = [];
    for (const ref of labelledby.split(/\s+/).filter(Boolean)) {
      const ref_el = el.ownerDocument.getElementById(ref);
      if (!ref_el) continue;
      // Prefer direct text (the heading's own text) over textContent
      // (which would concatenate every descendant — including every
      // sibling radio's text in modern radio-group widgets).
      const txt = directText(ref_el) || (ref_el.textContent ?? "").trim();
      if (txt) parts.push(txt);
    }
    if (parts.length) return cleanLabel(parts.join(" "));
  }
  const id = el.getAttribute("id");
  if (id) {
    const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l) {
      const txt = directText(l) || (l.textContent ?? "").trim();
      if (txt) return cleanLabel(txt);
    }
  }
  const parent = el.closest("label");
  if (parent) {
    const txt = directText(parent) || (parent.textContent ?? "").trim();
    if (txt) return cleanLabel(txt);
  }
  const fallback = (
    el.getAttribute("aria-label") ??
    el.getAttribute("title") ??
    (el as HTMLInputElement).placeholder ??
    el.getAttribute("aria-placeholder") ??
    ""
  ).trim();
  return cleanLabel(fallback);
}

// Normalize a section / group label captured from messy DOM. Forms
// often wrap the question text alongside required-markers, help text,
// and whitespace formatting. Strip the noise so the matcher prompt
// and HUD show a clean question. Also caps the result so we never
// surface a 500-char concatenation of every option (a real bug seen
// on Angular Material radio groups where findLabel walked all
// descendants and pasted "High school or equivalentAssociate's…").
function cleanLabel(s: string): string {
  const collapsed = s
    .replace(/\s+/g, " ")                           // collapse newlines + multi-space
    .replace(/^\*+\s*/g, "")                        // leading asterisk
    .replace(/\s*\(\s*required\s*\)\s*/gi, " ")     // "(required)"
    .replace(/\s*\(\s*optional\s*\)\s*/gi, " ")     // "(optional)"
    .replace(/\s+\(req…[^)]*\)\s*/gi, " ")         // truncated "(required) help text"
    .trim();
  // If a label runs longer than ~140 chars, it almost certainly grew
  // by concatenating descendant text. Truncate with an ellipsis so
  // the HUD stays readable and the matcher prompt doesn't bloat.
  if (collapsed.length <= 140) return collapsed;
  return collapsed.slice(0, 137).trimEnd() + "…";
}

// "Direct text content" — only the immediate text nodes of the
// element, not descendants. Used to pull a question text out of an
// element that wraps a bunch of option-button descendants whose
// concatenation would dominate textContent.
function directText(el: Element): string {
  let out = "";
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) out += (n.textContent ?? "");
  }
  return out.trim();
}

// Section context resolution (most specific first):
//   1. Nearest ancestor <fieldset>'s <legend>
//   2. Nearest ancestor [role='group'] / [role='region'] with aria-label
//   3. aria-labelledby on a containing section / region
//   4. Nearest preceding heading (h1-h6) within the same form
function findSection(el: HTMLElement): string {
  const fs = el.closest("fieldset");
  if (fs) {
    const legend = fs.querySelector(":scope > legend");
    const txt = legend?.textContent?.trim();
    if (txt) return cleanLabel(txt);
  }
  // Walk up looking for a labelled region.
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    const role = parent.getAttribute("role");
    if (role === "group" || role === "region") {
      const aria = parent.getAttribute("aria-label")?.trim();
      if (aria) return cleanLabel(aria);
      const labelledby = parent.getAttribute("aria-labelledby");
      if (labelledby) {
        const ref = parent.ownerDocument.getElementById(labelledby.split(/\s+/)[0]);
        const txt = ref?.textContent?.trim();
        if (txt) return cleanLabel(txt);
      }
    }
    parent = parent.parentElement;
  }
  // Preceding heading within the same form (or document if no form).
  const form = el.closest("form") ?? el.ownerDocument.body;
  const headings = Array.from(form.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
  let preceding: HTMLElement | undefined;
  for (const h of headings) {
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) preceding = h;
    else break;
  }
  return cleanLabel(preceding?.textContent ?? "");
}

// Browsers silently reject invalid values for typed inputs (date/time/
// number/email/url) which makes our "Filled N" number a lie. Validate
// against the input's expected format and skip mismatches rather than
// quietly fail.
function valueIsCompatible(el: HTMLElement, value: string): boolean {
  if (!(el instanceof HTMLInputElement)) return true;
  const type = el.type;
  switch (type) {
    case "date":          return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "time":          return /^\d{2}:\d{2}(:\d{2})?$/.test(value);
    case "datetime-local":return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value);
    case "month":         return /^\d{4}-\d{2}$/.test(value);
    case "week":          return /^\d{4}-W\d{2}$/.test(value);
    case "number":
    case "range":         return /^-?\d+(\.\d+)?$/.test(value);
    case "email":         return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    case "url":           return /^https?:\/\/\S+/.test(value);
    case "color":         return /^#[0-9a-f]{6}$/i.test(value);
    default:              return true;
  }
}

function setNativeValue(el: HTMLElement, value: string): boolean {
  if (!valueIsCompatible(el, value)) return false;
  // contenteditable and role=textbox elements don't have a `value`
  // property — set textContent and fire an input event. Frameworks
  // listening for "input" on these widgets (Lexical, Slate, etc.)
  // handle that correctly.
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement)) {
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  // Native form controls: prototype-setter dance so React 18's
  // controlled-input value tracker picks the change up. el.value =
  // ... alone is swallowed; the prototype setter forces a re-render.
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

// Phase F2: per-field options and maxlength so the generator knows
// the choice space + character cap. Radio groups (role=radio /
// type=radio) and selects both produce an option list; other inputs
// don't.
function optionsFor(el: Fillable): string[] | undefined {
  if (el instanceof HTMLSelectElement) {
    return Array.from(el.options)
      .map((o) => o.textContent?.trim() ?? "")
      .filter((t) => t.length > 0);
  }
  if (el instanceof HTMLInputElement && el.type === "radio") {
    const name = el.name;
    if (!name) return undefined;
    const group = el.ownerDocument.querySelectorAll<HTMLInputElement>(`input[type='radio'][name="${CSS.escape(name)}"]`);
    return Array.from(group)
      .map((r) => findLabel(r))
      .filter((t) => t.length > 0);
  }
  return undefined;
}

function maxLengthOf(el: Fillable): number | undefined {
  const ml = el.getAttribute("maxlength");
  if (ml) {
    const n = parseInt(ml, 10);
    if (n > 0) return n;
  }
  return undefined;
}

// Phase F5 (partial): form fingerprint — the key under which intent
// is persisted in chrome.storage. Currently origin + first two path
// segments; tightened in full F5.
function formFingerprint(): string {
  const u = new URL(location.href);
  const segments = u.pathname.split("/").filter(Boolean).slice(0, 2).join("/");
  return `${u.origin}/${segments}`;
}

async function readIntent(): Promise<string | undefined> {
  const fp = formFingerprint();
  return new Promise<string | undefined>((resolve) => {
    try {
      chrome.storage?.local?.get(`intent:${fp}`, (v) => {
        const obj = v as { [k: string]: { text: string; at: number } | undefined };
        resolve(obj[`intent:${fp}`]?.text);
      });
    } catch { resolve(undefined); }
  });
}

async function writeIntent(text: string): Promise<void> {
  const fp = formFingerprint();
  return new Promise<void>((resolve) => {
    try {
      chrome.storage?.local?.set({ [`intent:${fp}`]: { text, at: Date.now() } }, () => resolve());
    } catch { resolve(); }
  });
}

// Phase F5: per-form session. Tracks every successful fill across
// pages of the same form (same fingerprint). Used to show a running
// total in the HUD and to restore intent on page reloads (which the
// intent code already does). Stored separately from intent so
// "End session" can wipe fills without forgetting the intent.
interface FormSessionFill { url: string; label: string; value: string; at: number; entityId: string; profileKey: string }
interface FormSession { startedAt: number; fills: FormSessionFill[] }

async function readSession(): Promise<FormSession | undefined> {
  const fp = formFingerprint();
  return new Promise<FormSession | undefined>((resolve) => {
    try {
      chrome.storage?.local?.get(`session:${fp}`, (v) => {
        resolve((v as Record<string, FormSession | undefined>)[`session:${fp}`]);
      });
    } catch { resolve(undefined); }
  });
}

async function appendSessionFills(newFills: FormSessionFill[]): Promise<void> {
  if (newFills.length === 0) return;
  const fp = formFingerprint();
  const existing = (await readSession()) ?? { startedAt: Date.now(), fills: [] };
  const next: FormSession = {
    startedAt: existing.startedAt,
    fills: [...existing.fills, ...newFills],
  };
  return new Promise<void>((resolve) => {
    try {
      chrome.storage?.local?.set({ [`session:${fp}`]: next }, () => resolve());
    } catch { resolve(); }
  });
}

async function endSession(): Promise<void> {
  const fp = formFingerprint();
  return new Promise<void>((resolve) => {
    try {
      chrome.storage?.local?.remove([`session:${fp}`, `intent:${fp}`], () => resolve());
    } catch { resolve(); }
  });
}

// Modal-ish intent prompt embedded in the HUD container. Returns the
// intent the user provided, "" if they chose to skip, or undefined
// if they cancelled.
function promptForIntent(): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const id = "octovault-intent";
    document.getElementById(id)?.remove();
    const wrap = document.createElement("div");
    wrap.id = id;
    Object.assign(wrap.style, {
      position: "fixed", right: "20px", bottom: "70px", zIndex: "2147483647",
      width: "340px",
      background: "#0a0a0a", color: "#f5f5f5", border: "1px solid rgba(245,245,245,0.18)",
      borderRadius: "10px", fontFamily: "Inter, system-ui, sans-serif",
      boxShadow: "0 10px 36px rgba(0,0,0,0.5)",
      padding: "12px",
      display: "flex", flexDirection: "column", gap: "8px",
    } satisfies Partial<CSSStyleDeclaration>);
    const head = document.createElement("div");
    head.textContent = "What are you filling this out for?";
    Object.assign(head.style, { fontSize: "12px", fontWeight: "600" } satisfies Partial<CSSStyleDeclaration>);
    const sub = document.createElement("div");
    sub.textContent = "A sentence or two — dates, purpose, who's involved. OctoVault uses this to draft text fields.";
    Object.assign(sub.style, { fontSize: "10.5px", opacity: "0.7", lineHeight: "1.4" } satisfies Partial<CSSStyleDeclaration>);
    const ta = document.createElement("textarea");
    ta.rows = 3;
    Object.assign(ta.style, {
      background: "#1a1a1a", color: "#f5f5f5", border: "1px solid rgba(245,245,245,0.18)",
      borderRadius: "6px", padding: "8px", fontSize: "12px", fontFamily: "inherit",
      resize: "vertical",
    } satisfies Partial<CSSStyleDeclaration>);
    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "6px" } satisfies Partial<CSSStyleDeclaration>);
    const skip = document.createElement("button");
    skip.textContent = "Skip";
    Object.assign(skip.style, {
      background: "transparent", color: "#f5f5f5", border: "1px solid rgba(245,245,245,0.25)",
      borderRadius: "6px", padding: "4px 10px", fontSize: "11px", cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    const cont = document.createElement("button");
    cont.textContent = "Continue";
    Object.assign(cont.style, {
      background: "#f5f5f5", color: "#0a0a0a", border: "none",
      borderRadius: "6px", padding: "4px 12px", fontSize: "11px", fontWeight: "600", cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    skip.addEventListener("click", () => { wrap.remove(); resolve(""); });
    cont.addEventListener("click", () => {
      const v = ta.value.trim();
      wrap.remove();
      resolve(v);
    });
    actions.appendChild(skip); actions.appendChild(cont);
    wrap.appendChild(head); wrap.appendChild(sub); wrap.appendChild(ta); wrap.appendChild(actions);
    document.documentElement.appendChild(wrap);
    ta.focus();
  });
}

// Phase C: each fill produces a structured report. The HUD renders
// from this so users can see *why* a field was skipped, not just
// the headline count.
// Phase F3-F4: drafts surface in the HUD with editable values and a
// per-row Fill button. Generated values never auto-fill.
interface HudDraft {
  fieldId: string;
  label: string;
  draft: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  el?: HTMLElement;
  fieldType: string;
  options?: string[];
}

interface FillReportRow {
  fieldId: string;
  label: string;
  status: "filled" | "skipped";
  reason: string;            // human-readable; for filled rows: "self.fullName = Sunil Tiwari"
  entityName?: string;
  profileKey?: string;
  conflicted?: boolean;
  value?: string;
  hidden?: boolean;
}

async function runFill() {
  const detected = detectFields();
  // Phase F1: collapse Y/M/D triples into a single synthetic date
  // field BEFORE matching. We then strip the part fields from what
  // we send to the matcher so it doesn't double-process them.
  const composites = detectDateComposites(detected);
  const compositePartEls = new Set<HTMLElement>();
  for (const c of composites) {
    compositePartEls.add(c.parts.year);
    compositePartEls.add(c.parts.month);
    compositePartEls.add(c.parts.day);
  }
  // Phase F1+: collapse same-name radios into a synthetic choice
  // field. The individual radios get stripped — what reaches the
  // matcher is one row per group with the actual question label.
  // We re-tag the first radio of each group with the synthetic id
  // so elFor() can resolve the group via DOM lookup (the choice
  // pill click only needs *one* radio's name to find the whole
  // group via querySelectorAll).
  const radioGroups = detectRadioGroups(detected);
  const radioPartEls = new Set<HTMLElement>();
  for (const g of radioGroups) {
    for (const p of g.parts) radioPartEls.add(p);
    g.parts[0].setAttribute(FIELD_ATTR, g.syntheticId);
  }
  const detectedSansParts = detected.filter((d) =>
    !compositePartEls.has(d.el as HTMLElement) &&
    !radioPartEls.has(d.el as HTMLElement),
  );

  // Phase E1: also collect suspicious candidates. The background
  // routes them through the LLM augmentation pass; the LLM may
  // promote some to first-class fields with corrected labels.
  const detectedSet = new Set(detectedSansParts.map((d) => d.el as HTMLElement));
  const candidates = detectSuspicious(detectedSet);

  if (detectedSansParts.length === 0 && composites.length === 0 && candidates.length === 0) {
    toast("No fillable fields detected on this view.");
    return;
  }

  // Phase F2: collect options + maxlengths per element so the
  // generator can pick from choice fields and respect character caps.
  // Radio groups contribute their own option list (collected by
  // detectRadioGroups) so the matcher sees one row + N options
  // instead of N rows of identical option lists.
  const fieldOptions: Record<string, string[]> = {};
  const fieldMaxLengths: Record<string, number> = {};
  for (const d of detectedSansParts) {
    const opts = optionsFor(d.el);
    if (opts && opts.length) fieldOptions[d.field.id] = opts;
    const ml = maxLengthOf(d.el);
    if (ml) fieldMaxLengths[d.field.id] = ml;
  }
  for (const g of radioGroups) {
    fieldOptions[g.syntheticId] = g.options;
  }

  // Phase F2: any field that looks like it needs *generated* content
  // gets the intent prompt before we ship to the matcher. Radio
  // groups (synthetic) always have options → they're choice fields,
  // so they participate in this check too.
  const wouldGenerate =
    detectedSansParts.some((d) => isLikelyOpenField(d.field, !!fieldOptions[d.field.id]?.length)) ||
    radioGroups.some((g) => isLikelyOpenField(g.field, true));
  let intent = "";
  if (wouldGenerate) {
    const stored = await readIntent();
    if (stored != null) intent = stored;
    else {
      const got = await promptForIntent();
      if (got === undefined) return; // cancelled
      intent = got;
      if (intent) await writeIntent(intent);
    }
  }

  toast("Matching fields…");

  // Composites flow alongside regular fields. The synthetic id is
  // what the matcher sees; the fill step uses a side map to find
  // the parts.
  const compositeById = new Map(composites.map((c) => [c.syntheticId, c]));

  let resp: { ok: boolean; data?: unknown; error?: string } | undefined;
  try {
    resp = await chrome.runtime.sendMessage({
      type: "form.match",
      fields: [
        ...detectedSansParts.map((d) => d.field),
        ...composites.map((c) => c.field),
        ...radioGroups.map((g) => g.field),
      ],
      candidates: candidates.map((c) => c.cand),
      intent,
      fieldOptions,
      fieldMaxLengths,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Extension context invalidated")) {
      toast("OctoVault was reloaded. Refresh this page (⌘R) to re-link.");
    } else {
      toast(`Error: ${msg}`);
    }
    return;
  }
  if (!resp?.ok) { toast(`Error: ${resp?.error ?? "unknown"}`); return; }

  const data = resp.data as {
    matches: FieldMatch[];
    vault: VaultProfile;
    entities: Entity[];
    source?: "desktop" | "extension";
    fields: DetectedField[];        // post-enrichment; source of truth for labels
    enrichment?: { corrections: Record<string, { label?: string }>; promotions: { id: string; label: string; type: string }[] };
    drafts?: FieldDraft[];           // Phase F3 — AI-generated drafts for open fields
  };
  const { matches, vault, entities, source = "extension", fields: enrichedFields, enrichment, drafts = [] } = data;
  const entityName = (eid: string) =>
    entities.find((e) => e.id === eid)?.name ?? (eid === "self" ? "Self" : eid);
  const totalProfileKeys = Object.values(vault).reduce((n, p) => n + Object.keys(p).length, 0);

  // Promoted ids = those in enriched fields but not in either the
  // original DOM detection or the synthetic composites/groups we built.
  const clientKnownIds = new Set([
    ...detectedSansParts.map((d) => d.field.id),
    ...composites.map((c) => c.syntheticId),
    ...radioGroups.map((g) => g.syntheticId),
  ]);
  const promotedIds = new Set(
    enrichedFields.filter((f) => !clientKnownIds.has(f.id)).map((f) => f.id),
  );

  // Element lookup. detect / detectSuspicious both set FIELD_ATTR,
  // so a DOM query reaches whichever element the id refers to.
  // Composite ids resolve through compositeById instead — there's no
  // single DOM element for the whole composite.
  function elFor(fieldId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[${FIELD_ATTR}="${fieldId}"]`);
  }

  const rows: FillReportRow[] = [];
  for (const m of matches) {
    const field = enrichedFields.find((f) => f.id === m.fieldId);
    const composite = compositeById.get(m.fieldId);
    const label = field?.label || field?.name || m.fieldId;
    const promoted = promotedIds.has(m.fieldId);

    // Resolve the value from the matched profile entry (or skip).
    const record = field && m.profileKey ? vault[m.entityId]?.[m.profileKey] : undefined;
    const canonicalId = record?.canonicalId;
    const value = record?.candidates.find((c) => c.id === canonicalId)?.value;

    if (!field || !m.profileKey) {
      rows.push({
        fieldId: m.fieldId, label, status: "skipped",
        reason: promoted ? "LLM-promoted; no profile key matched" : "no profile key matched",
        entityName: entityName(m.entityId),
      });
      continue;
    }
    if (!value) {
      rows.push({
        fieldId: m.fieldId, label, status: "skipped",
        reason: `matched ${m.entityId}.${m.profileKey} but no canonical value`,
        entityName: entityName(m.entityId), profileKey: m.profileKey,
      });
      continue;
    }

    // Phase F1: composite fill path — decompose date across Y/M/D parts.
    if (composite) {
      const ok = fillDateComposite(composite.parts, value);
      if (!ok) {
        rows.push({
          fieldId: m.fieldId, label, status: "skipped",
          reason: `composite date "${value}" couldn't be decomposed (one or more parts missing the option)`,
          entityName: entityName(m.entityId), profileKey: m.profileKey, value,
        });
        continue;
      }
      // Visual confirm on all three parts.
      for (const p of [composite.parts.year, composite.parts.month, composite.parts.day]) {
        p.style.outline = m.conflicted ? "2px dashed currentColor" : "2px solid currentColor";
        p.style.outlineOffset = "1px";
        setTimeout(() => { p.style.outline = ""; p.style.outlineOffset = ""; }, 2500);
      }
      rows.push({
        fieldId: m.fieldId, label, status: "filled",
        reason: `${entityName(m.entityId)}.${m.profileKey} = ${value} → Y/M/D parts`,
        entityName: entityName(m.entityId), profileKey: m.profileKey,
        conflicted: m.conflicted, value,
      });
      continue;
    }

    // Single-field fill path (regular field or LLM-promoted candidate).
    const el = elFor(m.fieldId);
    if (!el) {
      rows.push({
        fieldId: m.fieldId, label, status: "skipped",
        reason: "no DOM element found for this match",
        entityName: entityName(m.entityId), profileKey: m.profileKey,
      });
      continue;
    }
    const wrote = setNativeValue(el, value);
    if (!wrote) {
      rows.push({
        fieldId: m.fieldId, label, status: "skipped",
        reason: `"${value}" doesn't fit ${field.type} input`,
        entityName: entityName(m.entityId), profileKey: m.profileKey, value,
      });
      continue;
    }
    el.style.outline = m.conflicted ? "2px dashed currentColor" : "2px solid currentColor";
    el.style.outlineOffset = "1px";
    setTimeout(() => { el.style.outline = ""; el.style.outlineOffset = ""; }, 2500);
    rows.push({
      fieldId: m.fieldId, label, status: "filled",
      reason: `${entityName(m.entityId)}.${m.profileKey} = ${value}${promoted ? " (LLM-promoted)" : ""}`,
      entityName: entityName(m.entityId), profileKey: m.profileKey,
      conflicted: m.conflicted, value, hidden: field.hidden,
    });
  }
  // Phase F1+intent: composite dates the matcher couldn't fill (no
  // profile key) get a second pass from the user's intent. "May 5–15,
  // 2026" → start fills "When will you enter Canada?", end fills
  // "When will you leave Canada?". Composite already filled by the
  // matcher (rare — profile rarely has trip dates) is left alone.
  const parsedDates = parseIntentDates(intent);
  if (parsedDates.start || parsedDates.end) {
    const filledIds = new Set(rows.filter((r) => r.status === "filled").map((r) => r.fieldId));
    for (const c of composites) {
      if (filledIds.has(c.syntheticId)) continue;
      const iso = pickIntentDateForComposite(c.field.label, parsedDates);
      if (!iso) continue;
      const ok = fillDateComposite(c.parts, iso);
      // Replace the skipped row for this composite with a filled one.
      const existingIdx = rows.findIndex((r) => r.fieldId === c.syntheticId);
      const filledRow: FillReportRow = ok ? {
        fieldId: c.syntheticId, label: c.field.label, status: "filled",
        reason: `from intent: ${iso}`,
        value: iso,
        entityName: "intent",
      } : {
        fieldId: c.syntheticId, label: c.field.label, status: "skipped",
        reason: `intent gave ${iso} but selects didn't have a matching option`,
        entityName: "intent",
      };
      if (existingIdx >= 0) rows[existingIdx] = filledRow;
      else rows.push(filledRow);
      if (ok) {
        for (const p of [c.parts.year, c.parts.month, c.parts.day]) {
          p.style.outline = "2px solid currentColor";
          p.style.outlineOffset = "1px";
          setTimeout(() => { p.style.outline = ""; p.style.outlineOffset = ""; }, 2500);
        }
      }
    }
  }
  // Log enrichment + drafts so the diagnostic story is in one place.
  if (enrichment) {
    const ncorr = Object.keys(enrichment.corrections).length;
    const npromo = enrichment.promotions.length;
    if (ncorr || npromo) {
      console.log(`[OctoVault] LLM enrichment: ${ncorr} label correction${ncorr === 1 ? "" : "s"}, ${npromo} candidate promotion${npromo === 1 ? "" : "s"}`);
    }
  }
  console.log(`[OctoVault] drafts: ${drafts.length}`, drafts);
  // Per-row breakdown to make "0 filled" debuggable from one paste.
  console.table(rows.map((r) => ({ id: r.fieldId, label: r.label.slice(0, 40), status: r.status, reason: r.reason.slice(0, 80), entity: r.entityName, key: r.profileKey })));

  const filled = rows.filter((r) => r.status === "filled").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;

  // Console group is preserved for power users / debugging.
  console.group("[OctoVault] form fill");
  console.log(`Source: ${source} · Entities: ${entities.length} · Total profile keys: ${totalProfileKeys}`);
  console.log("Detected:", detected.map((d) => d.field));
  console.log("Rows:", rows);
  console.groupEnd();

  if (totalProfileKeys === 0 && drafts.length === 0) {
    toast(`Vault (${source}) is empty. Open OctoVault and import a doc.`);
    return;
  }
  // Phase F3-F4: per-draft elements for the HUD. We look up the DOM
  // element here so showHud can render an editable + "Fill" button
  // that writes back to the element when the user approves.
  const draftItems: HudDraft[] = [];
  for (const d of drafts) {
    const field = enrichedFields.find((f) => f.id === d.fieldId);
    if (!field) continue;
    const el = elFor(d.fieldId);
    draftItems.push({
      fieldId: d.fieldId,
      label: field.label || d.fieldId,
      draft: d.draft,
      reason: d.reason,
      confidence: d.confidence,
      el: el ?? undefined,
      fieldType: field.type,
      options: fieldOptions[d.fieldId],
    });
  }
  // Phase F5: append this page's filled rows to the persistent
  // session so the HUD can show a running total across pages.
  const filledRows = rows.filter((r) => r.status === "filled");
  if (filledRows.length > 0) {
    void appendSessionFills(filledRows.map((r) => ({
      url: location.href,
      label: r.label,
      value: r.value ?? "",
      at: Date.now(),
      entityId: r.entityName ?? "self",
      profileKey: r.profileKey ?? "",
    })));
  }

  const session = await readSession();
  showHud({ rows, source, filled, skipped, drafts: draftItems, session });
  watchForRejections(rows);
}

// Inline OctoMark — keep in sync with packages/ui/src/components/octo-mark.tsx.
const OCTO_MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
  <polygon points="7,1.5 17,1.5 22.5,7 22.5,17 17,22.5 7,22.5 1.5,17 1.5,7"
           fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="12" cy="11" r="1.75" fill="currentColor"/>
  <path d="M11 12.5 L11 16.25 L13 16.25 L13 12.5 Z" fill="currentColor"/>
</svg>`;

function mountButton() {
  if (document.getElementById("octovault-launcher")) return;
  const btn = document.createElement("button");
  btn.id = "octovault-launcher";
  // Phase D — the button has a label span and a count badge span.
  // The badge is only populated when dev mode is on (chrome.storage
  // local key 'octovaultDevBadge') so non-power-users see a clean
  // "Fill" affordance and developers see live detection counts.
  btn.innerHTML = `${OCTO_MARK_SVG}<span id="octovault-launcher-label">Fill</span><span id="octovault-launcher-count" style="display:none;font-size:11px;font-weight:500;opacity:0.7"></span>`;
  Object.assign(btn.style, {
    position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647",
    background: "#0a0a0a", color: "#f5f5f5", border: "1px solid #f5f5f5",
    borderRadius: "999px", padding: "8px 14px", fontSize: "13px", fontWeight: "600",
    fontFamily: "Inter, system-ui, sans-serif", cursor: "pointer",
    boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
    display: "inline-flex", alignItems: "center", gap: "8px",
  } satisfies Partial<CSSStyleDeclaration>);
  btn.addEventListener("click", () => void runFill());
  document.documentElement.appendChild(btn);
}

// Phase D — dev badge.
// Read from chrome.storage.local (works across content + sidepanel +
// background) and react to changes live. Power-user feature; no UI
// surface in v1 — enable from devtools:
//   chrome.storage.local.set({ octovaultDevBadge: true })
let devBadgeEnabled = false;
function applyDevBadgeUi(count: number) {
  const countEl = document.getElementById("octovault-launcher-count");
  if (!countEl) return;
  if (devBadgeEnabled && count > 0) {
    countEl.textContent = `· ${count}`;
    countEl.style.display = "inline";
  } else {
    countEl.style.display = "none";
  }
}
function loadDevBadgeFlag() {
  try {
    chrome.storage?.local?.get("octovaultDevBadge", (v) => {
      devBadgeEnabled = !!v?.octovaultDevBadge;
      applyDevBadgeUi(lastFieldCount);
    });
    chrome.storage?.onChanged?.addListener?.((changes, area) => {
      if (area !== "local" || !changes.octovaultDevBadge) return;
      devBadgeEnabled = !!changes.octovaultDevBadge.newValue;
      applyDevBadgeUi(lastFieldCount);
    });
  } catch { /* chrome.storage not available in non-extension contexts */ }
}

// Phase D — watch for aria-invalid mutations on filled fields.
// Many forms mark a field aria-invalid="true" after a failed submit
// or onBlur validation. When that happens within a short window of
// our fill, surface it in the HUD so the user knows our value was
// rejected and they can try a different one.
function watchForRejections(rows: FillReportRow[]) {
  const filled = rows.filter((r) => r.status === "filled");
  if (filled.length === 0) return;
  const watchers: MutationObserver[] = [];
  for (const r of filled) {
    const el = document.querySelector(`[${FIELD_ATTR}="${r.fieldId}"]`);
    if (!el) continue;
    const mo = new MutationObserver(() => {
      const invalid = el.getAttribute("aria-invalid");
      if (invalid === "true") flagRejected(r.fieldId);
    });
    mo.observe(el, { attributes: true, attributeFilter: ["aria-invalid"] });
    watchers.push(mo);
  }
  // 8 seconds is long enough to catch onBlur validation and a manual
  // submit click; beyond that the user has moved on.
  setTimeout(() => { for (const w of watchers) w.disconnect(); }, 8000);
}

function flagRejected(fieldId: string) {
  const hud = document.getElementById("octovault-hud");
  if (!hud) return;
  // Add a small "rejected" indicator to the row whose reason text
  // includes the fieldId-derived label. We tag rows with data-fid
  // when building the HUD; look that up.
  const row = hud.querySelector(`[data-fid="${fieldId}"]`) as HTMLElement | null;
  if (!row) return;
  if (row.querySelector(".octovault-rejected")) return;
  const tag = document.createElement("span");
  tag.className = "octovault-rejected";
  tag.textContent = "rejected";
  Object.assign(tag.style, {
    background: "#7f1d1d", color: "#fecaca", fontSize: "9.5px",
    padding: "1px 5px", borderRadius: "6px", marginLeft: "6px",
  } satisfies Partial<CSSStyleDeclaration>);
  row.querySelector("div")?.appendChild(tag);
}

// Phase C HUD — dismissible card showing the structured fill report.
// Replaces the single-line toast for actual fill results (toast is
// still used for "no fields detected" and other one-liners).
function showHud(report: { rows: FillReportRow[]; source: string; filled: number; skipped: number; drafts?: HudDraft[]; session?: FormSession }) {
  const id = "octovault-hud";
  document.getElementById(id)?.remove();

  const wrap = document.createElement("div");
  wrap.id = id;
  Object.assign(wrap.style, {
    position: "fixed", right: "20px", bottom: "70px", zIndex: "2147483647",
    width: "340px", maxHeight: "60vh",
    background: "#0a0a0a", color: "#f5f5f5", border: "1px solid rgba(245,245,245,0.18)",
    borderRadius: "10px",
    fontFamily: "Inter, system-ui, sans-serif",
    boxShadow: "0 10px 36px rgba(0,0,0,0.5)",
    display: "flex", flexDirection: "column", overflow: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 12px", borderBottom: "1px solid rgba(245,245,245,0.12)",
    fontSize: "12px", fontWeight: "600",
  } satisfies Partial<CSSStyleDeclaration>);
  // Phase F5: running total across the multi-page session, when one
  // exists. Pages are de-duplicated by URL — fills are per-page but
  // the total reflects the whole flow.
  const session = report.session;
  const sessionPageCount = session
    ? new Set(session.fills.map((f) => f.url)).size
    : 0;
  const sessionTotal = session?.fills.length ?? 0;
  header.innerHTML = `<span>Filled ${report.filled} · Skipped ${report.skipped} <span style="opacity:0.6;font-weight:500">· ${report.source}</span>${sessionTotal > 0 ? `<div style="font-size:10px;opacity:0.65;font-weight:500;margin-top:2px">Session: ${sessionTotal} across ${sessionPageCount} page${sessionPageCount === 1 ? "" : "s"}</div>` : ""}</span>`;
  const headerActions = document.createElement("div");
  Object.assign(headerActions.style, { display: "flex", alignItems: "center", gap: "4px" } satisfies Partial<CSSStyleDeclaration>);
  if (sessionTotal > 0) {
    const endBtn = document.createElement("button");
    endBtn.textContent = "End session";
    Object.assign(endBtn.style, {
      background: "transparent", color: "#f5f5f5",
      border: "1px solid rgba(245,245,245,0.2)", borderRadius: "6px",
      padding: "2px 8px", fontSize: "10px", cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    endBtn.addEventListener("click", async () => {
      await endSession();
      wrap.remove();
      toast("Session ended.");
    });
    headerActions.appendChild(endBtn);
  }
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  Object.assign(closeBtn.style, {
    background: "transparent", color: "#f5f5f5", border: "none",
    fontSize: "18px", lineHeight: "1", cursor: "pointer", padding: "0 4px",
  } satisfies Partial<CSSStyleDeclaration>);
  closeBtn.addEventListener("click", () => wrap.remove());
  headerActions.appendChild(closeBtn);
  header.appendChild(headerActions);
  wrap.appendChild(header);

  // Single scrollable container for both matched rows AND drafts.
  // Previously the body alone was scrollable and the drafts section
  // appended directly to `wrap`, leaving long draft lists clipped
  // below the viewport with no way to reach them.
  const scroller = document.createElement("div");
  Object.assign(scroller.style, {
    overflowY: "auto", flex: "1 1 auto", minHeight: "0",
  } satisfies Partial<CSSStyleDeclaration>);
  wrap.appendChild(scroller);

  const body = document.createElement("div");
  Object.assign(body.style, {
    padding: "8px 4px",
    fontSize: "11.5px", lineHeight: "1.4",
  } satisfies Partial<CSSStyleDeclaration>);

  // Group by entity for readability — the same structure the matcher
  // saw. Within each entity, filled rows first, then skipped.
  const byEntity = new Map<string, FillReportRow[]>();
  for (const r of report.rows) {
    const k = r.entityName ?? "(?)";
    const arr = byEntity.get(k) ?? [];
    arr.push(r);
    byEntity.set(k, arr);
  }
  for (const [entityName, rows] of byEntity) {
    const section = document.createElement("div");
    Object.assign(section.style, { padding: "4px 10px 6px" } satisfies Partial<CSSStyleDeclaration>);
    const head = document.createElement("div");
    head.textContent = entityName;
    Object.assign(head.style, {
      fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.15em",
      opacity: "0.55", margin: "4px 0 4px",
    } satisfies Partial<CSSStyleDeclaration>);
    section.appendChild(head);

    rows.sort((a, b) => a.status === b.status ? 0 : a.status === "filled" ? -1 : 1);
    for (const r of rows) {
      const row = document.createElement("div");
      row.setAttribute("data-fid", r.fieldId);
      const dot = r.status === "filled" ? "●" : "○";
      const dotColor = r.status === "filled" ? (r.conflicted ? "#facc15" : "#34d399") : "#a3a3a3";
      Object.assign(row.style, {
        display: "flex", alignItems: "flex-start", gap: "6px",
        padding: "3px 4px",
      } satisfies Partial<CSSStyleDeclaration>);
      const dotEl = document.createElement("span");
      dotEl.textContent = dot;
      Object.assign(dotEl.style, { color: dotColor, flex: "0 0 auto", marginTop: "1px" } satisfies Partial<CSSStyleDeclaration>);
      row.appendChild(dotEl);
      const txt = document.createElement("div");
      txt.style.cssText = "flex:1;min-width:0;line-height:1.35;";
      // !important on display/line-height defeats the host page's
      // global resets that were causing label + reason to overlap
      // on Ashby / similar Tailwind-heavy pages.
      txt.innerHTML =
        `<div style="opacity:0.95;display:block !important;line-height:1.35 !important;overflow-wrap:anywhere;">${escapeHtml(r.label)}${r.hidden ? ' <span style="opacity:0.5">(hidden)</span>' : ""}</div>` +
        `<div style="opacity:0.55;font-size:10.5px;display:block !important;line-height:1.35 !important;overflow-wrap:anywhere;">${escapeHtml(r.reason)}</div>`;
      row.appendChild(txt);
      section.appendChild(row);
    }
    body.appendChild(section);
  }
  scroller.appendChild(body);

  // Phase F3-F4: drafts section. Each draft renders as an editable
  // textarea (or button list for choice fields) with a per-row Fill
  // button. Drafts never auto-fill — that's the whole point.
  const drafts = report.drafts ?? [];
  if (drafts.length > 0) {
    const section = document.createElement("div");
    Object.assign(section.style, {
      borderTop: "1px solid rgba(245,245,245,0.12)",
      padding: "8px 10px 10px",
    } satisfies Partial<CSSStyleDeclaration>);

    const headRow = document.createElement("div");
    Object.assign(headRow.style, { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 6px" } satisfies Partial<CSSStyleDeclaration>);
    const head = document.createElement("div");
    head.textContent = `Drafts (${drafts.length}) — review before filling`;
    Object.assign(head.style, {
      fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.15em",
      opacity: "0.6",
    } satisfies Partial<CSSStyleDeclaration>);
    // Phase F4+: fill-all for textarea/text drafts (choice drafts
    // still need a click — picking an option is itself the user's
    // approval). Iterates all draft rows and triggers their Fill
    // button click for non-choice drafts.
    const fillAllBtn = document.createElement("button");
    fillAllBtn.textContent = "Fill all";
    Object.assign(fillAllBtn.style, {
      background: "#f5f5f5", color: "#0a0a0a", border: "none",
      borderRadius: "6px", padding: "2px 10px",
      fontSize: "10px", fontWeight: "600", cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    fillAllBtn.addEventListener("click", () => {
      const fills = section.querySelectorAll<HTMLButtonElement>("button[data-fill='1']:not([disabled])");
      for (const b of fills) b.click();
    });
    headRow.appendChild(head);
    headRow.appendChild(fillAllBtn);
    section.appendChild(headRow);

    for (const d of drafts) {
      const row = document.createElement("div");
      Object.assign(row.style, {
        marginBottom: "8px", padding: "6px 8px",
        background: "rgba(245,245,245,0.05)", borderRadius: "6px",
      } satisfies Partial<CSSStyleDeclaration>);
      const labelEl = document.createElement("div");
      labelEl.innerHTML = `<span style="opacity:0.95">${escapeHtml(d.label)}</span> <span style="opacity:0.45;font-size:10px">· ${d.confidence}</span>`;
      Object.assign(labelEl.style, { fontSize: "11.5px", marginBottom: "4px" } satisfies Partial<CSSStyleDeclaration>);
      row.appendChild(labelEl);

      // Choice draft → render options as buttons. Free-text draft →
      // editable textarea.
      if (d.options?.length) {
        const list = document.createElement("div");
        Object.assign(list.style, { display: "flex", flexWrap: "wrap", gap: "4px" } satisfies Partial<CSSStyleDeclaration>);
        for (const opt of d.options) {
          const btn = document.createElement("button");
          btn.textContent = opt;
          const selected = opt.trim().toLowerCase() === d.draft.trim().toLowerCase();
          Object.assign(btn.style, {
            background: selected ? "#f5f5f5" : "transparent",
            color: selected ? "#0a0a0a" : "#f5f5f5",
            border: "1px solid rgba(245,245,245,0.25)",
            borderRadius: "999px", padding: "2px 8px",
            fontSize: "10.5px", cursor: "pointer",
          } satisfies Partial<CSSStyleDeclaration>);
          btn.addEventListener("click", () => {
            if (!d.el) return;
            // For radio groups, find the matching radio by label
            // and CLICK the user-facing wrapper (Angular Material,
            // Vuetify, headless UI etc. all hide the native input
            // and listen for clicks on the visible label/wrapper).
            // .click() fires the full native sequence — mousedown,
            // mouseup, click, change — so framework state updates
            // correctly. Simply setting .checked = true does not.
            if (d.el instanceof HTMLInputElement && d.el.type === "radio") {
              const group = d.el.ownerDocument.querySelectorAll<HTMLInputElement>(`input[type='radio'][name="${CSS.escape(d.el.name)}"]`);
              for (const r of group) {
                // Ashby and other modern hiring tools render the
                // <input type="radio"> as sr-only and rely on a
                // sibling/label/parent for the visible click target.
                // The label text may live in any of those — match on
                // the radio's findLabel result OR on the rendered
                // text of the nearest associated label / wrapper.
                const rLabel = findLabel(r).trim().toLowerCase();
                const associatedLabel =
                  (r.id ? r.ownerDocument.querySelector(`label[for="${CSS.escape(r.id)}"]`) : null) ??
                  r.closest("label");
                const wrapperText = (associatedLabel?.textContent ?? "").trim().toLowerCase();
                if (rLabel === opt.trim().toLowerCase() || wrapperText === opt.trim().toLowerCase()) {
                  // Try every plausible click target in priority order.
                  // First one that's visible AND clicks successfully
                  // wins. We do NOT short-circuit on the first try —
                  // some frameworks (Ashby's Radix-style) need both
                  // the wrapper click AND the native dispatchEvent
                  // for state to propagate.
                  r.checked = true;
                  if (associatedLabel) (associatedLabel as HTMLElement).click();
                  r.click();
                  // Synthesize a pointerdown→pointerup sequence too;
                  // some React handlers listen for that instead of click.
                  for (const evt of ["pointerdown", "pointerup", "click", "change", "input"] as const) {
                    r.dispatchEvent(new Event(evt, { bubbles: true, cancelable: true }));
                  }
                  btn.style.background = "#34d399"; btn.style.color = "#0a0a0a";
                  return;
                }
              }
            } else if (d.el instanceof HTMLSelectElement) {
              const match = Array.from(d.el.options).find((o) =>
                (o.textContent?.trim().toLowerCase() === opt.trim().toLowerCase()) || o.value === opt);
              if (match) {
                d.el.value = match.value;
                d.el.dispatchEvent(new Event("input", { bubbles: true }));
                d.el.dispatchEvent(new Event("change", { bubbles: true }));
                btn.style.background = "#34d399"; btn.style.color = "#0a0a0a";
              }
            }
          });
          list.appendChild(btn);
        }
        row.appendChild(list);
      } else {
        const ta = document.createElement("textarea");
        ta.value = d.draft;
        ta.rows = 3;
        Object.assign(ta.style, {
          width: "100%", boxSizing: "border-box",
          background: "#1a1a1a", color: "#f5f5f5", border: "1px solid rgba(245,245,245,0.18)",
          borderRadius: "6px", padding: "6px 8px",
          fontSize: "11.5px", fontFamily: "inherit", resize: "vertical",
        } satisfies Partial<CSSStyleDeclaration>);
        row.appendChild(ta);
        const actions = document.createElement("div");
        Object.assign(actions.style, { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px" } satisfies Partial<CSSStyleDeclaration>);
        const reasonEl = document.createElement("span");
        reasonEl.textContent = d.reason;
        Object.assign(reasonEl.style, { fontSize: "10px", opacity: "0.55" } satisfies Partial<CSSStyleDeclaration>);
        const fillBtn = document.createElement("button");
        fillBtn.textContent = "Fill";
        fillBtn.dataset.fill = "1";
        Object.assign(fillBtn.style, {
          background: "#f5f5f5", color: "#0a0a0a", border: "none",
          borderRadius: "6px", padding: "3px 12px",
          fontSize: "10.5px", fontWeight: "600", cursor: "pointer",
        } satisfies Partial<CSSStyleDeclaration>);
        fillBtn.addEventListener("click", () => {
          if (!d.el) return;
          const ok = setNativeValue(d.el, ta.value);
          if (ok) {
            fillBtn.textContent = "Filled";
            fillBtn.style.background = "#34d399";
            fillBtn.disabled = true;
          }
        });
        actions.appendChild(reasonEl);
        actions.appendChild(fillBtn);
        row.appendChild(actions);
      }
      section.appendChild(row);
    }
    scroller.appendChild(section);
  }

  document.documentElement.appendChild(wrap);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c] ?? c));
}

function toast(text: string) {
  const id = "octovault-toast";
  document.getElementById(id)?.remove();
  const t = document.createElement("div");
  t.id = id;
  t.textContent = text;
  Object.assign(t.style, {
    position: "fixed", right: "20px", bottom: "70px", zIndex: "2147483647",
    background: "#0a0a0a", color: "#f5f5f5", border: "1px solid rgba(245,245,245,0.2)",
    borderRadius: "8px", padding: "10px 14px", fontSize: "12px",
    fontFamily: "Inter, system-ui, sans-serif", maxWidth: "320px",
    boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.documentElement.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// --- Phase A: surface the button reliably on modern pages ----------------
//
// The original gate (`if (document.querySelector(...))`) ran exactly once at
// document_idle. Three failure modes were silently shipped:
//   1. SPAs that mount their forms after first paint never saw the button.
//   2. Lazy modals / multi-step flows never re-triggered detection.
//   3. SPA route changes inside the same document were invisible.
//
// New behaviour: mount the button unconditionally on document_idle. Then
// re-evaluate the page on three signals — DOM mutations, SPA navigation,
// and load — keeping a cached field count so we only do real work when
// something changed. The button stays mounted; the *click handler* is what
// shows "no fields detected" when applicable, never the page state.

let lastFieldCount = -1;

function refreshDetection(reason: string) {
  const next = detectFields().length;
  if (next === lastFieldCount) return;
  lastFieldCount = next;
  applyDevBadgeUi(next);
  // eslint-disable-next-line no-console
  console.debug(`[OctoVault] detection refreshed (${reason}): ${next} fields`);
}

function installSpaHooks() {
  // SPAs route via history.pushState / replaceState. Patch both to emit a
  // synthetic locationchange event we can listen to alongside popstate.
  // Standard pattern; reversible if it ever bites us.
  const w = window as unknown as Window & { __octovaultSpaHooksInstalled?: boolean };
  if (w.__octovaultSpaHooksInstalled) return;
  w.__octovaultSpaHooksInstalled = true;
  const fire = () => window.dispatchEvent(new Event("locationchange"));
  const wrap = (name: "pushState" | "replaceState") => {
    const orig = history[name];
    history[name] = function patched(this: History, ...args: Parameters<typeof orig>) {
      const r = orig.apply(this, args);
      fire();
      return r;
    } as typeof orig;
  };
  wrap("pushState");
  wrap("replaceState");
  window.addEventListener("popstate", fire);
  window.addEventListener("locationchange", () => refreshDetection("spa"));
}

function installMutationObserver() {
  // Debounce hard — some sites mutate hundreds of times per second.
  // We only care that *something* changed; refreshDetection short-
  // circuits when the field count is stable. A 150 ms tail collapses
  // bursts of mutations into a single re-evaluation.
  let timer: number | null = null;
  const schedule = () => {
    if (timer != null) return;
    timer = window.setTimeout(() => { timer = null; refreshDetection("mutation"); }, 150);
  };
  const mo = new MutationObserver(schedule);
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

// --- Boot ----------------------------------------------------------------
mountButton();
loadDevBadgeFlag();
refreshDetection("init");
installSpaHooks();
installMutationObserver();
