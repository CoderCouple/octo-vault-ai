// Single source of truth for brand-level constants and class recipes.
// Every surface — popup, desktop, landing — imports from here so the
// product never drifts on name, slogan, or typographic system.

/** Product identity. */
export const BRAND = {
  name: "OctoVault AI",
  slogan: "Private. Local. Yours.",
  version: "0.0.1",
  // Used in CTA copy, marketing pages, etc.
  promise: "Fill any web form from your own documents. Locally.",
} as const;

/**
 * Typography recipes — pre-composed Tailwind class strings. Use these
 * instead of inlining font/text sizes ad-hoc, so all text in the app
 * shares one type system.
 *
 *  - Serif is for content the AI "speaks" or that reads like prose
 *    (assistant answers, big headings, entity names).
 *  - Sans is for UI affordances (buttons, nav, labels).
 *  - Mono is for any value that is a literal user-data string (IDs,
 *    numbers, dates, addresses).
 *  - Microcaps are for taxonomy labels (field names, categories).
 */
export const tx = {
  // Headings (serif — "spoken")
  h1: "font-serif text-2xl tracking-tight",
  h2: "font-serif text-xl tracking-tight",
  h3: "font-serif text-lg tracking-tight",

  // Body
  body: "text-sm leading-relaxed",
  bodySm: "text-xs leading-relaxed",
  prose: "font-serif text-sm leading-relaxed whitespace-pre-wrap",

  // Labels
  label: "text-[11px] text-muted-foreground",
  microcap: "text-[10px] uppercase tracking-wider text-muted-foreground",

  // Values
  value: "font-mono text-sm",
  valueSm: "font-mono text-xs",

  // Muted helper / hint text
  muted: "text-xs text-muted-foreground",
} as const;

/**
 * Status-state class recipes. Mirror the conflict-state classes from
 * styles.css but expose them here so consumers can compose them
 * alongside other Tailwind classes via `cn(...)`.
 */
export const status = {
  ok: "status-ok",
  stale: "status-stale",
  conflict: "status-conflict",
  redflag: "status-redflag",
} as const;
