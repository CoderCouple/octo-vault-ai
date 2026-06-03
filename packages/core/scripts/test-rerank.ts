// Smoke test for the rerank pass in qa.ts. Builds synthetic
// embeddings + documents + entities and asserts that:
//   1. Fact records beat near-equivalent chunks (fact boost).
//   2. A high-authority doc beats a low-authority one for the same fieldKey.
//   3. Recent docs beat older ones at otherwise-equal scores.
//   4. MMR drops near-duplicate vectors so the top-K is diverse.
//
// Run with:  npx tsx packages/core/scripts/test-rerank.ts

import { rerank } from "../src/qa";
import type { EmbeddingRecord } from "../src/qa";
import type { Entity, VaultProfile } from "../src/schema";
import type { StoredDocument } from "../src/storage";

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function makeDoc(over: Partial<StoredDocument>): StoredDocument {
  return {
    id: over.id ?? "d",
    entityId: "self",
    name: "doc",
    importedAt: now,
    bytes: 0,
    text: "",
    pageCount: 1,
    docType: "unknown",
    ocrUsed: false,
    ...over,
  };
}

function makeEmb(over: Partial<EmbeddingRecord>): EmbeddingRecord {
  return {
    id: over.id ?? crypto.randomUUID(),
    kind: over.kind ?? "chunk",
    entityId: over.entityId ?? "self",
    text: over.text ?? "",
    vector: over.vector ?? [1, 0, 0, 0],
    ...over,
  };
}

const entities: Entity[] = [
  { id: "self", name: "Self", relationship: "self", initials: "ME", createdAt: now },
];
const vault: VaultProfile = {};

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log("  ✓", label); }
  else { failed++; console.log("  ✗", label, detail ? `\n      ${detail}` : ""); }
}

// --- Test 1: fact boost ---------------------------------------------------
{
  console.log("\n[1] fact boost: a fact should beat an equally-cosine chunk");
  const docs: StoredDocument[] = [makeDoc({ id: "d1", docType: "unknown" })];
  const factEmb = makeEmb({ id: "f", kind: "fact", documentId: "d1", fieldKey: "fullName", vector: [1, 0, 0] });
  const chunkEmb = makeEmb({ id: "c", kind: "chunk", documentId: "d1", vector: [1, 0, 0] });
  const out = rerank(
    [{ e: factEmb, score: 0.8 }, { e: chunkEmb, score: 0.8 }],
    { entities, vault, documents: docs },
    2,
    now,
  );
  check("fact ranks first", out[0].e.id === "f", `got order: ${out.map(o => o.e.id).join(",")}`);
}

// --- Test 2: authority boost ----------------------------------------------
{
  console.log("\n[2] authority boost: passport beats utility_bill for passportNumber");
  const docs: StoredDocument[] = [
    makeDoc({ id: "passport", docType: "passport" }),
    makeDoc({ id: "bill", docType: "utility_bill" }),
  ];
  const passportFact = makeEmb({ id: "fp", kind: "fact", documentId: "passport", fieldKey: "passportNumber", vector: [1, 0] });
  const billFact = makeEmb({ id: "fb", kind: "fact", documentId: "bill", fieldKey: "passportNumber", vector: [1, 0] });
  const out = rerank(
    [{ e: passportFact, score: 0.7 }, { e: billFact, score: 0.7 }],
    { entities, vault, documents: docs },
    2,
    now,
  );
  check("passport-sourced fact ranks first", out[0].e.id === "fp", `order: ${out.map(o => o.e.id).join(",")}`);
}

// --- Test 3: recency boost ------------------------------------------------
{
  console.log("\n[3] recency boost: recent doc beats older one at equal cosine + same kind");
  const docs: StoredDocument[] = [
    makeDoc({ id: "old", importedAt: now - 720 * DAY }),
    makeDoc({ id: "new", importedAt: now }),
  ];
  const oldEmb = makeEmb({ id: "co", kind: "chunk", documentId: "old", vector: [1, 0] });
  const newEmb = makeEmb({ id: "cn", kind: "chunk", documentId: "new", vector: [1, 0] });
  const out = rerank(
    [{ e: oldEmb, score: 0.5 }, { e: newEmb, score: 0.5 }],
    { entities, vault, documents: docs },
    2,
    now,
  );
  check("newer doc ranks first", out[0].e.id === "cn", `order: ${out.map(o => o.e.id).join(",")}`);
}

// --- Test 4: MMR diversification ------------------------------------------
{
  console.log("\n[4] MMR: near-duplicate vectors should not both make topK");
  const docs: StoredDocument[] = [makeDoc({ id: "d" })];
  // a, b, c are near-duplicate vectors (cosine ~ 1.0); z is orthogonal.
  // Scores are close — within the range where MMR's diversity term
  // should outweigh the small relevance gap.
  const a = makeEmb({ id: "a", kind: "chunk", documentId: "d", vector: [1, 0, 0, 0] });
  const b = makeEmb({ id: "b", kind: "chunk", documentId: "d", vector: [0.99, 0.05, 0, 0] });
  const c = makeEmb({ id: "c", kind: "chunk", documentId: "d", vector: [0.98, 0.1, 0, 0] });
  const diff = makeEmb({ id: "z", kind: "chunk", documentId: "d", vector: [0, 1, 0, 0] });
  const out = rerank(
    [
      { e: a, score: 0.90 },
      { e: b, score: 0.89 },
      { e: c, score: 0.88 },
      { e: diff, score: 0.85 },
    ],
    { entities, vault, documents: docs },
    2,
    now,
  );
  const ids = out.map(o => o.e.id);
  check(
    "top-2 includes the diverse vector (z), not just near-dupes",
    ids.includes("z"),
    `order: ${ids.join(",")}`,
  );
}

// --- Test 5: respects topK -------------------------------------------------
{
  console.log("\n[5] respects topK");
  const docs: StoredDocument[] = [makeDoc({ id: "d" })];
  const items = Array.from({ length: 8 }, (_, i) => ({
    e: makeEmb({ id: `e${i}`, kind: "chunk", documentId: "d", vector: [i / 10, 1, 0] }),
    score: 0.5 + i * 0.01,
  }));
  const out = rerank(items, { entities, vault, documents: docs }, 3, now);
  check("returns exactly topK", out.length === 3, `got ${out.length}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
