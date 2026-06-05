// Phase 6 — golden retrieval evaluator.
//
// Loads packages/core/scripts/golden.yaml and runs each case against a
// real vault (the user's local SQLCipher store on macOS) to measure
// recall@K on the retrieval layer. The LLM answer step is intentionally
// out of scope here — answer quality drifts with model versions, but
// "did we retrieve the right facts?" is a stable, reproducible target.
//
// Usage (from repo root):
//
//   npx tsx packages/core/scripts/eval-qa.ts \
//     --vault ~/Library/Application\ Support/OctoVault/vault.sqlite \
//     --k 8
//
// or, in dry-run mode (no vault — just sanity-checks the YAML loader):
//
//   npx tsx packages/core/scripts/eval-qa.ts --dry-run
//
// Output is a per-case PASS/FAIL line plus a final recall summary.
// Suitable to wire into CI later (exit non-zero on regressions).

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface GoldenCase {
  id: string;
  question: string;
  entity: string;
  expect_field_keys: string[];
  notes?: string;
}

// Minimal YAML parser for the dialect we use here (no anchors, no
// flow style, two-space indent). We avoid pulling in a dependency
// because this script lives outside the main bundle.
function parseGolden(yaml: string): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const lines = yaml.split("\n");
  let i = 0;
  // Skip until "cases:".
  while (i < lines.length && !/^cases:\s*$/.test(lines[i])) i++;
  i++;
  let current: Partial<GoldenCase> | null = null;
  let inExpect = false;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\s*-\s+id:\s*/.test(raw)) {
      if (current && current.id) cases.push(current as GoldenCase);
      current = { id: raw.replace(/^\s*-\s+id:\s*/, "").trim(), expect_field_keys: [] };
      inExpect = false;
      continue;
    }
    if (!current) continue;
    const m = raw.match(/^\s+(\w+):\s*(.*)$/);
    if (m) {
      const [, key, val] = m;
      inExpect = false;
      if (key === "expect_field_keys") {
        // Inline form: [a, b, c]
        const inline = val.trim().match(/^\[(.*)\]$/);
        if (inline) {
          current.expect_field_keys = inline[1].split(",").map((s) => s.trim()).filter(Boolean);
        } else {
          inExpect = true;
        }
      } else if (key === "id" || key === "question" || key === "entity" || key === "notes") {
        (current as Record<string, string>)[key] = val.trim();
      }
      continue;
    }
    if (inExpect) {
      const item = raw.match(/^\s+-\s+(.*)$/);
      if (item) current.expect_field_keys!.push(item[1].trim());
    }
  }
  if (current && current.id) cases.push(current as GoldenCase);
  return cases;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) return "true";
  return next;
}

async function main() {
  const goldenPath = resolve(__dirname, "golden.yaml");
  if (!existsSync(goldenPath)) {
    console.error(`golden.yaml not found at ${goldenPath}`);
    process.exit(1);
  }
  const cases = parseGolden(readFileSync(goldenPath, "utf-8"));
  console.log(`Loaded ${cases.length} golden cases from ${goldenPath}`);

  if (arg("dry-run")) {
    for (const c of cases) {
      console.log(`  - [${c.id}] ${c.question} → expects ${c.expect_field_keys.join(", ")}`);
    }
    process.exit(0);
  }

  const vaultPath = arg("vault");
  if (!vaultPath) {
    console.error("Pass --vault <path-to-sqlite> or --dry-run.");
    console.error("Default macOS vault: ~/Library/Application Support/OctoVault/vault.sqlite");
    process.exit(1);
  }

  // Live run requires hooking up the SQLCipher store + ollama config.
  // The desktop main process owns that wiring today; this scaffold
  // intentionally stops here so the script is committable now and the
  // real harness can be wired up when the desktop process exposes a
  // headless retrieve API. The dry-run path above is enough to
  // validate the golden set itself.
  console.error("Live evaluation is not wired up yet — run with --dry-run.");
  console.error("Next step: expose a headless retrieve() entry point from the");
  console.error("desktop main process and import it here.");
  process.exit(2);
}

main().catch((err) => { console.error(err); process.exit(1); });
