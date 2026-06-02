// Given many candidates for the same field, pick a canonical value and
// describe the conflict state for the UI.

import {
  authorityFor,
  fieldByKey,
  type ConflictState,
  type FieldCandidate,
  type FieldRecord,
  type ProfileKey,
} from "./schema";

const HALF_LIFE_DAYS = 365 * 2; // 2-year half-life on recency boost

export function normalizeValue(key: ProfileKey, value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, " ");
  const kind = fieldByKey(key).kind;
  if (kind === "date_static" || kind === "date_monotonic") {
    // Best-effort ISO date normalization. Falls back to raw string.
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (kind === "id_unique" || kind === "id_versioned") {
    return v.replace(/[^a-z0-9]/g, "");
  }
  if (kind === "contact" && v.match(/^[+\d][\d\s\-()]+$/)) {
    return v.replace(/\D/g, "");
  }
  return v;
}

export function scoreCandidate(c: FieldCandidate, now: number = Date.now()): number {
  if (c.userPinned) return 100;
  if (c.dismissedAt) return -1;

  const authority = authorityFor(c.docType, c.fieldKey);   // 0..1
  const confidenceBoost = c.confidence === "high" ? 0.3 : c.confidence === "medium" ? 0.15 : 0;
  const userBoost = c.userEdited ? 0.4 : 0;

  const ageDays = (now - c.extractedAt) / (1000 * 60 * 60 * 24);
  const recencyBoost = 0.2 * Math.exp(-ageDays / HALF_LIFE_DAYS);

  return authority + confidenceBoost + recencyBoost + userBoost;
}

export function resolve(record: FieldRecord, now: number = Date.now()): FieldRecord {
  const live = record.candidates.filter((c) => !c.dismissedAt);
  if (live.length === 0) {
    return { ...record, canonicalId: null, conflictState: "none", lastResolvedAt: now };
  }

  const pinned = live.find((c) => c.userPinned);
  if (pinned) {
    return { ...record, canonicalId: pinned.id, conflictState: detectConflict(record.key, live), lastResolvedAt: now };
  }

  const ranked = [...live].sort((a, b) => scoreCandidate(b, now) - scoreCandidate(a, now));
  const canonical = ranked[0];
  const conflictState = detectConflict(record.key, live);

  return { ...record, canonicalId: canonical.id, conflictState, lastResolvedAt: now };
}

function detectConflict(key: ProfileKey, candidates: FieldCandidate[]): ConflictState {
  const kind = fieldByKey(key).kind;
  const distinct = new Set(candidates.map((c) => c.normalizedValue));
  if (distinct.size <= 1) return "none";

  if (kind === "date_static" || kind === "id_unique") {
    // DOB, SSN, etc. should never differ. This is a serious flag.
    return "red_flag";
  }

  if (kind === "date_monotonic" || kind === "id_versioned" || kind === "address" || kind === "contact") {
    // Older value can simply be stale, not a contradiction.
    return "stale";
  }

  // Free-form text or names — could be normal variation (nicknames).
  return "conflict";
}

export function canonicalValue(record: FieldRecord): FieldCandidate | null {
  if (!record.canonicalId) return null;
  return record.candidates.find((c) => c.id === record.canonicalId) ?? null;
}

export function isStale(c: FieldCandidate, canonical: FieldCandidate): boolean {
  const kind = fieldByKey(c.fieldKey).kind;
  if (c.id === canonical.id) return false;
  if (kind === "date_monotonic") {
    return c.normalizedValue < canonical.normalizedValue;
  }
  return c.extractedAt < canonical.extractedAt;
}
