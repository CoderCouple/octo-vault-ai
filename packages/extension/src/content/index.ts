// Injected into every page. Detects fillable form fields, mounts a
// floating action button, and (on click) asks the background to match
// fields to the user's profile, then fills them with visible feedback.

import type { DetectedField, FieldMatch, Profile } from "@octovault/core";

const FIELD_ATTR = "data-octovault-id";

function detectFields() {
  const out: { el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement; field: DetectedField }[] = [];
  const els = Array.from(document.querySelectorAll<HTMLElement>("input, select, textarea"));
  let i = 0;
  for (const el of els) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    const type = (el as HTMLInputElement).type ?? "text";
    if (["hidden", "submit", "button", "reset", "image", "file", "password"].includes(type)) continue;
    if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const id = `ov-${i++}`;
    el.setAttribute(FIELD_ATTR, id);
    out.push({
      el,
      field: {
        id, type,
        label: findLabel(el),
        name: el.getAttribute("name") ?? "",
        placeholder: (el as HTMLInputElement).placeholder ?? "",
        autocomplete: el.getAttribute("autocomplete") ?? "",
      },
    });
  }
  return out;
}

function findLabel(el: HTMLElement): string {
  const id = el.getAttribute("id");
  if (id) {
    const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (l?.textContent) return l.textContent.trim();
  }
  const parent = el.closest("label");
  if (parent?.textContent) return parent.textContent.trim();
  return (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.getAttribute("placeholder") ?? "").trim();
}

// Browsers silently reject invalid values for typed inputs (date/time/
// number/email/url) which makes our "Filled N" number a lie. Validate
// against the input's expected format and skip mismatches rather than
// quietly fail.
function valueIsCompatible(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): boolean {
  if (el.tagName !== "INPUT") return true;
  const type = (el as HTMLInputElement).type;
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

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): boolean {
  if (!valueIsCompatible(el, value)) return false;
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function runFill() {
  const detected = detectFields();
  if (detected.length === 0) { toast("No fillable fields detected."); return; }
  toast("Matching fields…");

  let resp: { ok: boolean; data?: unknown; error?: string } | undefined;
  try {
    resp = await chrome.runtime.sendMessage({
      type: "form.match",
      fields: detected.map((d) => d.field),
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
    profile: Profile;
    entityId?: string;
    source?: "desktop" | "extension";
  };
  const { matches, profile, source = "extension", entityId = "?" } = data;
  const profileKeys = Object.keys(profile);
  let filled = 0, skipped = 0;
  const skippedDetails: string[] = [];

  for (const m of matches) {
    const target = detected.find((d) => d.field.id === m.fieldId);
    if (!target || !m.profileKey) {
      skipped++;
      const label = target?.field.label || target?.field.name || target?.field.id;
      if (label) skippedDetails.push(`${label} → no match`);
      continue;
    }
    const canonicalId = profile[m.profileKey]?.canonicalId;
    const value = profile[m.profileKey]?.candidates.find((c) => c.id === canonicalId)?.value;
    if (!value) {
      skipped++;
      skippedDetails.push(`${target.field.label || m.profileKey} → matched but no value in profile`);
      continue;
    }
    const wrote = setNativeValue(target.el, value);
    if (!wrote) {
      skipped++;
      skippedDetails.push(`${target.field.label || m.profileKey} → "${value}" doesn't fit ${target.field.type} input`);
      continue;
    }
    target.el.style.outline = m.conflicted ? "2px dashed currentColor" : "2px solid currentColor";
    target.el.style.outlineOffset = "1px";
    setTimeout(() => { target.el.style.outline = ""; target.el.style.outlineOffset = ""; }, 2500);
    filled++;
  }

  // Loud, debuggable feedback so 0/N is never a mystery.
  console.group("[OctoVault] form fill");
  console.log("Source:", source, " · Entity:", entityId, " · Profile keys:", profileKeys.length);
  console.log("Detected fields:", detected.map((d) => d.field));
  console.log("Matches:", matches);
  if (skippedDetails.length) console.log("Skipped:", skippedDetails);
  console.groupEnd();

  const summary = profileKeys.length === 0
    ? `Filled 0 — vault (${source}) is empty. Open the OctoVault popup and import a doc, or switch the source pill.`
    : `Filled ${filled} · ${skipped} skipped · source: ${source} · see console for details`;
  toast(summary);
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
  btn.innerHTML = `${OCTO_MARK_SVG}<span>Fill</span>`;
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

if (document.querySelector("input, select, textarea")) mountButton();
