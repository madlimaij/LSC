# src/report

**Owner:** `report-builder` (WP-07).

Turns a `Results` file (WP-05, `src/runner/results-schema.ts`) into the validation report a person reads to decide whether a Rule Set is trustworthy (docs/PLAN.md §7, specification §5), and drives the interactive review CLI (D9). No file I/O here except `load-results.ts`'s read; everything else is pure functions over data, so it is unit-testable without a terminal.

## Modules

- `model.ts` — the report's own data model (`Report`, `RuleReport`, `OverallVerdict`, `CoverageRow`, …), built once so renderers never recompute confidence reasons or coverage status themselves.
- `build.ts` — `buildReport(results, { ruleSet?, examplesById? })`: assembles the model from `Results` alone, optionally enriched with the Rule Set it came from (pattern, captures, provenance) and the examples it was tested against (source locations, snippets).
- `confidence-reason.ts` — `explainConfidence`/`deriveConfidenceStats`/`declaredMismatchNote`: the human reason behind a computed confidence level, re-stating the thresholds from `docs/PLAN.md §6.3` (D8) so the text can name which one was missed. **Every confidence level the report shows has a reason attached (CLAUDE.md).**
- `rule-status.ts` — `isRuleOk`: the same "this rule's last run is fine" test as `src/runner/index.ts`'s `ok` computation and `lsc test`'s `printSummary`, duplicated on purpose (this package does not own those files).
- `pattern.ts` — `describePattern`/`describeCaptures`: human-readable rule matcher/captures from a `Rule` (needs the Rule Set).
- `example-location.ts` — `exampleLocation`/`exampleSnippet`/`indexExamplesById`: turns an `Example` (needs the examples, i.e. Skill files re-ingested) into a `file:line` and a small code snippet.
- `review-session.ts` — the interactive review logic, free of terminal I/O: `collectUnreviewedMatches`, `deriveConstruct`, `makeIdGenerator`, `buildReviewEntry`, `parseAnswer`, and the driver `runReviewSession` (asks about every unreviewed sample match via a caller-supplied `ask` callback, returns entries + counts). `src/cli/commands/review.ts` supplies a `readline`-backed `ask`; tests supply a scripted one.
- `load-results.ts` — `loadResultsFile`: reads and validates a `results.json` (shared by `lsc report` and `lsc review`).
- `markdown.ts` / `html.ts` — renderers. Section order is fixed by the WP-07 brief: overall verdict, coverage table, per-rule detail (pattern, captures, confidence+reason, pass rate, representative matches, missed examples, wrong captures, false positives), unreviewed sample matches per rule, provenance (Skill file + anchor per rule, Skill file hashes). `html.ts` inlines all CSS in one `<style>` tag and makes no external request, so the file is readable offline (WP-07 brief).
- `index.ts` — public API; import from here.

## What `Results` alone cannot show

`Results` (WP-05) records pass/fail and diff data (missed/unexpected/wrongCaptures all carry line + captures) but not a rule's pattern, its captures map, its provenance, or the source of a *passing* positive example (a pass has no diff to show). So:

- Missed examples, wrong captures and false positives are always fully shown (ruleId + exampleId + line + captures), with or without extra options.
- Pattern, captures and provenance need `buildReport`'s `ruleSet` option (`lsc report --ruleset <file>`).
- Representative matches (passing positive examples) and source snippets need the `examplesById` option (`lsc report --skills-dir <dir>`, which re-ingests the Skill files the same way `lsc test` does).

Without these, the report still renders every section (WP-07 acceptance criterion); the affected fields say so explicitly ("unavailable (pass --ruleset ...)") rather than guessing.

## `lsc report` / `lsc review` command lines

The WP-07 brief's literal command lines are `lsc report <results.json> [--format md|html|json]` and `lsc review <results.json>`. Both commands need more than `results.json` alone can give them:

- `lsc report` additionally accepts `--ruleset <file>` and `--skills-dir <dir>` (both optional; see above) and `--out <file>`.
- `lsc review` needs to know where `reviews.yaml` lives (D15: a sibling of the Skill directory, not derivable from `results.json`), so it requires either `--skills-dir <dir>` (the usual convention) or `--reviews-file <file>` (an explicit path).

See the WP-07 completion note (`docs/progress.md`) for the reasoning; this is flagged there as a deviation from the brief's literal signature, not a silent addition.

## `reviews.yaml` conventions this package follows (D9, D15)

- `code` is the single matched line (`matchedLineText`), per `src/examples/README.md`'s recommendation: it contains the reviewed match and nothing else that could fail the example for an unrelated reason.
- `verdict: correct` records the match's own captures as the expected match on line 1 of that single-line `code`. A reviewer who disagrees with a capture chooses `false positive` instead (or edits `reviews.yaml` afterwards) — the CLI does not offer to edit individual capture values.
- ids follow `review-<construct>-<n>` (`makeIdGenerator`), continuing after the highest existing number for that construct so two sessions never collide.
- `skip` is never written (matches README.md); an unrecognised answer is treated as `skip`.
- The reviews file is rewritten after every recorded verdict (`onRecorded`), so an interrupted session (Ctrl+C, `quit`) loses nothing already decided.
- If `reviews.yaml` already has an invalid entry, `lsc review` refuses to write to it at all (a rewrite would silently drop the invalid entries); fix the file first.
