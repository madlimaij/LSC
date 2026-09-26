# src/runner

**Owner:** `engine-builder` (WP-05).

Measures a Rule Set against labelled examples and an optional repository sample, fully offline (docs/PLAN.md §7). Imports nothing from `src/llm`.

## Modules

- `glob.ts` — `matchesGlob`/`matchesAnyGlob`: `fileMatchers` selection (contract/CONTRACT.md §6.1), not implemented in `src/engines` (WP-04). Globs are translated to an RE2 pattern and run under RE2 (D3).
- `confidence.ts` — `computeConfidence`: the fixed formula (docs/PLAN.md §6.3, D8). Returns `undefined` when a rule passes no positive example (a candidate for `status: "rejected"`, decided elsewhere).
- `compare.ts` — `diffExample`: compares one rule's matches on one example's code against its expected matches (plan §6.2): `missed`, `unexpected`, `wrongCaptures`.
- `coverage.ts` — `computeCoverage`: which rule types have a validated rule, which constructs (from the loaded examples) are below the `high`-confidence example threshold.
- `rule-run.ts` — `ownExampleIdsOf`, `runRuleAgainstExamples`: runs one rule against its own examples (from `sourceEvidence[].exampleIds`) plus every negative example of every other construct ("cross-construct negatives", plan §8 step 4).
- `sample-run.ts` — `scanSampleFiles`: `fileMatchers`-filtered `scanFile` over repository-sample files; ±3-line snippets; excludes matches already recorded in `reviews.yaml` (D9).
- `results-schema.ts` — `ResultsSchema` (Zod) and every nested schema/type; WP-07 and WP-09 should import types from here, not redefine them.
- `index.ts` — public API: `runRules(ruleSet, examples, sampleFiles?, options?) -> Results`.

## Conventions worth knowing

- A rule's "own" examples are its `sourceEvidence[].exampleIds`, not a `construct` field (the contract has none). "Cross-construct negatives" = every negative example in the given example set that is not already one of the rule's own examples.
- **D19 a (owner decision, 2026-09-26):** `tests.passed`/`tests.failed` (the contract's `RuleTests` shape) count only the rule's own examples — matching `contract/fixtures/toylang.ruleset.json`'s static numbers and `coverage.ts`. A rule is still run against every cross-construct negative (plan §8 step 4); a match on any of them is reported in `RuleResult.crossNegativeFailures` (never in `tests`), forces `computeConfidence` to `low` (`confidence.ts`'s `crossNegativeFailed` input), and fails the rule overall (`Results.ok`, `lsc test`'s exit code), even when every own example passes.
- Per-example testing calls `matchRule` directly (not `scanFile`): `blockEnd`/`enclosingSymbol` do not affect whether an example's expected captures are matched. Only the repository-sample scan uses `scanFile`, with every validated rule together, so scopes and warnings behave as in real usage.
