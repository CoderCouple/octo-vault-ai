// Derived facts and relationships.
//
// The vault stores *asserted* facts (extracted from documents or
// entered by the user). This module computes *inferred* facts from
// the closure of those assertions:
//
//   - Age from DOB (deterministic)
//   - Spouse-of-self is co-parent of self's children (relationship closure)
//   - Children of self are siblings of each other
//   - Spouse's parent is parent-in-law; spouse's sibling is sibling-in-law
//   - Two entities at the same address → "lives with"
//   - Two entities at the same employer → "colleague"
//
// Derived facts are computed on-the-fly from the current VaultProfile
// + entities + documents. They aren't persisted. UI components flag
// them as "derived" so the user knows they weren't extracted directly.

import { canonicalValue } from "./resolver";
import type { Entity, Event, Relationship, VaultProfile } from "./schema";

export type DerivedKind =
  | "age"
  | "co-parent"          // X is also a parent of Y (because X's spouse is)
  | "sibling"            // siblings via shared parent
  | "parent-in-law"      // spouse's parent
  | "sibling-in-law"     // spouse's sibling
  | "grandparent"        // parent's parent
  | "same-address"       // two entities share a current address
  | "same-employer"      // two entities share a current employer
  | "shared-event"       // two entities both participated in the same event
  | "event-anniversary"; // bi-temporal fact about an event subject

export interface DerivedFact {
  id: string;             // stable: kind|subject|object|...
  kind: DerivedKind;
  subject: string;        // entity id this fact is about
  object?: string;        // optional related entity id
  value?: string;         // for valued facts ("Age: 38")
  description: string;    // human-readable
  derivedFrom: {          // pointers back to what justified this
    entityId?: string;
    fieldKey?: string;
    documentId?: string;
  }[];
  confidence: "high" | "medium" | "low";
}

interface ProfileLookup {
  entities: Entity[];
  vault: VaultProfile;
  // Optional — when provided, deriveFacts will also emit closure facts
  // over the event graph (shared marriage → co-participant edge, etc.).
  events?: Event[];
}

/** Field lookup helper: canonical value of a key for an entity, or null. */
function fact(vault: VaultProfile, entityId: string, key: string): string | null {
  const r = vault[entityId]?.[key as never];
  if (!r) return null;
  const c = canonicalValue(r);
  return c?.value.trim() || null;
}

/** Normalise a string for equality comparison. */
function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Parse a YYYY-MM-DD or DD/MM/YYYY etc. into a Date. Returns null if it doesn't look like a date. */
function parseDateLoose(s: string | null): Date | null {
  if (!s) return null;
  const t = s.trim();
  // Direct ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY (most non-US formats)
  const m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = (parseInt(yyyy) > 50 ? "19" : "20") + yyyy;
    const d = new Date(`${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function yearsBetween(a: Date, b: Date): number {
  let years = b.getFullYear() - a.getFullYear();
  const beforeBirthday =
    b.getMonth() < a.getMonth() ||
    (b.getMonth() === a.getMonth() && b.getDate() < a.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

export function deriveFacts({ entities, vault, events }: ProfileLookup, now: Date = new Date()): DerivedFact[] {
  const out: DerivedFact[] = [];
  const id = (parts: string[]) => parts.filter(Boolean).join("|");

  // Helper for entity name display.
  const nameOf = (eid: string) => entities.find((e) => e.id === eid)?.name ?? eid;

  // --- 1. Age from DOB ------------------------------------------------------
  for (const ent of entities) {
    const dob = fact(vault, ent.id, "dateOfBirth");
    const d = parseDateLoose(dob);
    if (!d) continue;
    const age = yearsBetween(d, now);
    if (age < 0 || age > 130) continue;
    out.push({
      id: id(["age", ent.id]),
      kind: "age",
      subject: ent.id,
      value: String(age),
      description: `${nameOf(ent.id)} is ${age} years old.`,
      derivedFrom: [{ entityId: ent.id, fieldKey: "dateOfBirth" }],
      confidence: "high",
    });
  }

  // --- Family closure -------------------------------------------------------
  // For OctoVault's model, every non-self entity has a Relationship
  // pointing at how they're related to Self. Self is implicit anchor.
  const self = entities.find((e) => e.id === "self");
  if (self) {
    const byRel = new Map<Relationship, Entity[]>();
    for (const e of entities) {
      if (e.id === "self") continue;
      const arr = byRel.get(e.relationship) ?? [];
      arr.push(e);
      byRel.set(e.relationship, arr);
    }
    const spouses = [...(byRel.get("spouse") ?? []), ...(byRel.get("partner") ?? [])];
    const children = byRel.get("child") ?? [];
    const parents = byRel.get("parent") ?? [];
    const siblings = byRel.get("sibling") ?? [];

    // 2. Spouse is co-parent of self's children.
    for (const spouse of spouses) {
      for (const child of children) {
        out.push({
          id: id(["co-parent", spouse.id, child.id]),
          kind: "co-parent",
          subject: spouse.id,
          object: child.id,
          description: `${nameOf(spouse.id)} is also a parent of ${nameOf(child.id)} (via marriage to ${nameOf(self.id)}).`,
          derivedFrom: [
            { entityId: spouse.id },     // spouse-of-self
            { entityId: self.id, fieldKey: "spouse" },
            { entityId: child.id },      // child-of-self
          ],
          confidence: "medium",          // unless we know stepchild/biological
        });
      }
    }

    // 3. Siblings: children of self are siblings of each other.
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        const a = children[i], b = children[j];
        out.push({
          id: id(["sibling", a.id, b.id]),
          kind: "sibling",
          subject: a.id,
          object: b.id,
          description: `${nameOf(a.id)} and ${nameOf(b.id)} are siblings (both children of ${nameOf(self.id)}).`,
          derivedFrom: [{ entityId: a.id }, { entityId: b.id }, { entityId: self.id }],
          confidence: "high",
        });
      }
    }

    // 4. Self's parents are parents-in-law of self's spouses.
    for (const spouse of spouses) {
      for (const parent of parents) {
        out.push({
          id: id(["parent-in-law", parent.id, spouse.id]),
          kind: "parent-in-law",
          subject: parent.id,
          object: spouse.id,
          description: `${nameOf(parent.id)} is ${nameOf(spouse.id)}'s parent-in-law.`,
          derivedFrom: [{ entityId: parent.id }, { entityId: spouse.id }, { entityId: self.id }],
          confidence: "high",
        });
      }
    }

    // 5. Self's siblings are siblings-in-law of self's spouses.
    for (const spouse of spouses) {
      for (const sib of siblings) {
        out.push({
          id: id(["sibling-in-law", sib.id, spouse.id]),
          kind: "sibling-in-law",
          subject: sib.id,
          object: spouse.id,
          description: `${nameOf(sib.id)} is ${nameOf(spouse.id)}'s sibling-in-law.`,
          derivedFrom: [{ entityId: sib.id }, { entityId: spouse.id }, { entityId: self.id }],
          confidence: "high",
        });
      }
    }
  }

  // --- 6. Same address ------------------------------------------------------
  // Compare every pair of entities; if they share addressLine1 + city +
  // postalCode, derive "lives with".
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i], b = entities[j];
      const a1 = norm(fact(vault, a.id, "addressLine1"));
      const a2 = norm(fact(vault, b.id, "addressLine1"));
      if (!a1 || !a2 || a1 !== a2) continue;
      const c1 = norm(fact(vault, a.id, "city"));
      const c2 = norm(fact(vault, b.id, "city"));
      const z1 = norm(fact(vault, a.id, "postalCode"));
      const z2 = norm(fact(vault, b.id, "postalCode"));
      if ((c1 && c2 && c1 !== c2) || (z1 && z2 && z1 !== z2)) continue;
      out.push({
        id: id(["same-address", a.id, b.id]),
        kind: "same-address",
        subject: a.id,
        object: b.id,
        description: `${nameOf(a.id)} and ${nameOf(b.id)} share an address.`,
        derivedFrom: [
          { entityId: a.id, fieldKey: "addressLine1" },
          { entityId: b.id, fieldKey: "addressLine1" },
        ],
        confidence: "high",
      });
    }
  }

  // --- 7. Same employer -----------------------------------------------------
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i], b = entities[j];
      const e1 = norm(fact(vault, a.id, "employerName"));
      const e2 = norm(fact(vault, b.id, "employerName"));
      if (!e1 || !e2 || e1 !== e2) continue;
      out.push({
        id: id(["same-employer", a.id, b.id]),
        kind: "same-employer",
        subject: a.id,
        object: b.id,
        description: `${nameOf(a.id)} and ${nameOf(b.id)} both work at ${fact(vault, a.id, "employerName")}.`,
        derivedFrom: [
          { entityId: a.id, fieldKey: "employerName" },
          { entityId: b.id, fieldKey: "employerName" },
        ],
        confidence: "high",
      });
    }
  }

  // --- 8. Event closure -----------------------------------------------------
  // Phase 4b — when two entities are participants in the same event,
  // emit a "shared-event" derived edge. Marriages, births and adoptions
  // are the most useful sources: they connect spouses, parents, and
  // children even when one side hasn't been entered as a Relationship.
  // Also emit "event-anniversary" age-style facts so the chat can
  // answer "how long have they been married?".
  if (events?.length) {
    const entitySet = new Set(entities.map((e) => e.id));
    for (const ev of events) {
      const present = ev.participants.filter((p) => entitySet.has(p.entityId));
      if (present.length < 2) {
        // Solo event — still useful for anniversary closure below.
      } else {
        for (let i = 0; i < present.length; i++) {
          for (let j = i + 1; j < present.length; j++) {
            const a = present[i], b = present[j];
            out.push({
              id: id(["shared-event", ev.id, a.entityId, b.entityId]),
              kind: "shared-event",
              subject: a.entityId,
              object: b.entityId,
              description: `${nameOf(a.entityId)} and ${nameOf(b.entityId)} share a ${ev.type} event${ev.date ? ` (${ev.date})` : ""}.`,
              derivedFrom: [{ documentId: ev.source.documentId }],
              confidence: "high",
            });
          }
        }
      }
      // Anniversary closure: years since event date for the subject.
      if (ev.date) {
        const d = parseDateLoose(ev.date);
        if (d) {
          const years = yearsBetween(d, now);
          if (years >= 0 && years < 200) {
            const subj = ev.participants.find((p) => p.role === "subject") ?? ev.participants[0];
            if (subj && entitySet.has(subj.entityId)) {
              out.push({
                id: id(["event-anniversary", ev.id, subj.entityId]),
                kind: "event-anniversary",
                subject: subj.entityId,
                value: String(years),
                description: `${nameOf(subj.entityId)}'s ${ev.type} was ${years} year${years === 1 ? "" : "s"} ago.`,
                derivedFrom: [{ documentId: ev.source.documentId }],
                confidence: "high",
              });
            }
          }
        }
      }
    }
  }

  return out;
}

/** Convenience: get all derived facts where this entity is subject or object. */
export function derivedFactsFor(facts: DerivedFact[], entityId: string): DerivedFact[] {
  return facts.filter((f) => f.subject === entityId || f.object === entityId);
}

/** Convenience: derived family-relationship edges between entities. */
export function derivedRelationshipEdges(facts: DerivedFact[]): DerivedFact[] {
  const kinds: DerivedKind[] = ["co-parent", "sibling", "parent-in-law", "sibling-in-law", "grandparent"];
  return facts.filter((f) => kinds.includes(f.kind) && f.object);
}

