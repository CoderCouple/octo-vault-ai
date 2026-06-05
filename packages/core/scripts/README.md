# Core scripts

Throwaway-ish dev scripts that exercise the retrieval / QA pipeline
without standing up the full Electron app. Run with `npx tsx`.

## `test-rerank.ts`
Synthetic smoke test for `rerank()` in `qa.ts`. No vault needed.

```sh
npx tsx packages/core/scripts/test-rerank.ts
```

## `eval-qa.ts` (Phase 6)
Golden retrieval evaluator. Loads `golden.yaml` and (eventually) runs
each case against the local vault to measure recall@K on the
retrieval layer.

```sh
# Sanity-check the YAML loader and case list:
npx tsx packages/core/scripts/eval-qa.ts --dry-run

# Live mode (when the desktop main process exposes a headless retrieve API):
npx tsx packages/core/scripts/eval-qa.ts \
  --vault ~/Library/Application\ Support/OctoVault/vault.sqlite \
  --k 8
```

### Adding cases
Append to `golden.yaml`. Each case is one question + the *minimum*
set of `expect_field_keys` a correct retrieval would surface. Keep
cases focused — one failure mode per case — so a regression is
easy to triage.

### Why a golden set
LLM answer quality drifts with model versions; retrieval recall does
not. Treating recall as the regression bar lets us iterate on prompts
and models freely without losing the safety net.
