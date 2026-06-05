// Injected into every page. Detects fillable form fields, mounts a
// floating action button, and (on click) asks the background to match
// fields to the user's profile, then fills them with visible feedback.

import type { DetectedField, Entity, FieldMatch, VaultProfile } from "@octovault/core";

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

function isFillableType(el: HTMLElement): boolean {
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
      const txt = ref_el?.textContent?.trim();
      if (txt) parts.push(txt);
    }
    if (parts.length) return parts.join(" ");
  }
  const id = el.getAttribute("id");
  if (id) {
    // querySelector with CSS.escape covers ids that include special chars
    // (common with framework-generated ids like "react-hook-form-42").
    const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    const txt = l?.textContent?.trim();
    if (txt) return txt;
  }
  const parent = el.closest("label");
  if (parent?.textContent) return parent.textContent.trim();
  return (
    el.getAttribute("aria-label") ??
    el.getAttribute("title") ??
    (el as HTMLInputElement).placeholder ??
    el.getAttribute("aria-placeholder") ??
    ""
  ).trim();
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
    if (txt) return txt;
  }
  // Walk up looking for a labelled region.
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    const role = parent.getAttribute("role");
    if (role === "group" || role === "region") {
      const aria = parent.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const labelledby = parent.getAttribute("aria-labelledby");
      if (labelledby) {
        const ref = parent.ownerDocument.getElementById(labelledby.split(/\s+/)[0]);
        const txt = ref?.textContent?.trim();
        if (txt) return txt;
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
  return preceding?.textContent?.trim() ?? "";
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

// Phase C: each fill produces a structured report. The HUD renders
// from this so users can see *why* a field was skipped, not just
// the headline count.
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
  const detectedSansParts = detected.filter((d) => !compositePartEls.has(d.el as HTMLElement));

  // Phase E1: also collect suspicious candidates. The background
  // routes them through the LLM augmentation pass; the LLM may
  // promote some to first-class fields with corrected labels.
  const detectedSet = new Set(detectedSansParts.map((d) => d.el as HTMLElement));
  const candidates = detectSuspicious(detectedSet);

  if (detectedSansParts.length === 0 && composites.length === 0 && candidates.length === 0) {
    toast("No fillable fields detected on this view.");
    return;
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
      ],
      candidates: candidates.map((c) => c.cand),
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
  };
  const { matches, vault, entities, source = "extension", fields: enrichedFields, enrichment } = data;
  const entityName = (eid: string) =>
    entities.find((e) => e.id === eid)?.name ?? (eid === "self" ? "Self" : eid);
  const totalProfileKeys = Object.values(vault).reduce((n, p) => n + Object.keys(p).length, 0);

  // Promoted ids = those in enriched fields but not in either the
  // original DOM detection or the synthetic composites we built.
  const clientKnownIds = new Set([
    ...detectedSansParts.map((d) => d.field.id),
    ...composites.map((c) => c.syntheticId),
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
  // Log how much the enrichment did.
  if (enrichment) {
    const ncorr = Object.keys(enrichment.corrections).length;
    const npromo = enrichment.promotions.length;
    if (ncorr || npromo) {
      console.log(`[OctoVault] LLM enrichment: ${ncorr} label correction${ncorr === 1 ? "" : "s"}, ${npromo} candidate promotion${npromo === 1 ? "" : "s"}`);
    }
  }

  const filled = rows.filter((r) => r.status === "filled").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;

  // Console group is preserved for power users / debugging.
  console.group("[OctoVault] form fill");
  console.log(`Source: ${source} · Entities: ${entities.length} · Total profile keys: ${totalProfileKeys}`);
  console.log("Detected:", detected.map((d) => d.field));
  console.log("Rows:", rows);
  console.groupEnd();

  if (totalProfileKeys === 0) {
    toast(`Vault (${source}) is empty. Open OctoVault and import a doc.`);
    return;
  }
  showHud({ rows, source, filled, skipped });
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
function showHud(report: { rows: FillReportRow[]; source: string; filled: number; skipped: number }) {
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
  header.innerHTML = `<span>Filled ${report.filled} · Skipped ${report.skipped} <span style="opacity:0.6;font-weight:500">· ${report.source}</span></span>`;
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  Object.assign(closeBtn.style, {
    background: "transparent", color: "#f5f5f5", border: "none",
    fontSize: "18px", lineHeight: "1", cursor: "pointer", padding: "0 4px",
  } satisfies Partial<CSSStyleDeclaration>);
  closeBtn.addEventListener("click", () => wrap.remove());
  header.appendChild(closeBtn);
  wrap.appendChild(header);

  const body = document.createElement("div");
  Object.assign(body.style, {
    overflowY: "auto", padding: "8px 4px",
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
      txt.style.flex = "1";
      txt.innerHTML = `<div style="opacity:0.95">${escapeHtml(r.label)}${r.hidden ? ' <span style="opacity:0.5">(hidden)</span>' : ""}</div><div style="opacity:0.55;font-size:10.5px">${escapeHtml(r.reason)}</div>`;
      row.appendChild(txt);
      section.appendChild(row);
    }
    body.appendChild(section);
  }
  wrap.appendChild(body);
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
