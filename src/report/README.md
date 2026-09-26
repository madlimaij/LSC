# src/report

**Owner:** `report-builder` (WP-07).

Turns a `Results` file (WP-05, `src/runner/results-schema.ts`) into the validation report a person reads to decide whether a Rule Set is trustworthy (docs/PLAN.md §7, specification §5), and drives the interactive review CLI (D9). No file I/O here except `load-results.ts`'s read and `render-files.ts`'s write; everything else is pure functions over data, so it is unit-testable without a terminal.

## Modules

- `model.ts` — the report's own data model (`Report`, `RuleReport`, `OverallVerdict`, `CoverageRow`, `LexicalSettingsView`, `SynthesisView`, `SkillHashMismatch`, …), built once so renderers never recompute confidence reasons or coverage status themselves.
- `build.ts` — `buildReport(results, { ruleSet?, examplesById?, synthesis?, currentSourceSkills? })`: assembles the model from `Results` alone, optionally enriched with the Rule Set it came from (pattern, captures, provenance, lexical settings), the examples it was tested against (source locations, snippets), a `synthesis.json` (WP-09, each construct's synthesis outcome, D25 item 2) and a freshly-hashed Skill directory (Skill-hash drift check, D25 item 4).
- `synthesis-view.ts` — `buildSynthesisView`/`redactReviewProblem`: turns a `SynthesisReport` (WP-09, `src/synth/synthesis-schema.ts`, import only) into the report's view of it. `redactReviewProblem` withholds a failing review example's captured repository-sample text (`describeFailure`, `src/synth/construct-loop.ts`, tags it `[review example]`) — the report keeps the example id and the fact that it is a review example, not the table/callee names it captured (plan §8: repository-sample text is never sent to a model, and must not leak into a report either).
- `skill-hash-check.ts` — `findSkillHashMismatches`/`describeSkillHashMismatch`: compares a Rule Set's `sourceSkills` against a freshly-hashed Skill directory (reviewer Q5, D25 item 4).
- `confidence-reason.ts` — `explainConfidence`/`deriveConfidenceStats`/`declaredMismatchNote`: the human reason behind a computed confidence level, re-stating the thresholds from `docs/PLAN.md §6.3` (D8) so the text can name which one was missed. **Every confidence level the report shows has a reason attached (CLAUDE.md)** — including the coverage table, whose own cell is a single word: every row also links to (or, with no rule, names) the place that gives the reason (reviewer finding 4).
- `rule-status.ts` — `isRuleOk`: the same "this rule's last run is fine" test as `src/runner/index.ts`'s `ok` computation and `lsc test`'s `printSummary`, duplicated on purpose (this package does not own those files).
- `pattern.ts` — `describePattern`/`describeCaptures`: human-readable rule matcher/captures from a `Rule` (needs the Rule Set).
- `example-location.ts` — `exampleLocation`/`exampleSnippet`/`indexExamplesById`: turns an `Example` (needs the examples, i.e. Skill files re-ingested) into a `file:line` and a small code snippet.
- `match-span.ts` — `computeMatchSpan`: the line span (start..end, inclusive) a rule's match covers in a sample file, and every match of that rule on those lines, by re-running the rule's pattern (import only from `src/engines/`). Needed because `SampleMatch` (WP-05) records only a match's *start* position, but a whole-text (`multiline: true`) rule can match text continued onto a later line.
- `review-session.ts` — the interactive review logic, free of terminal I/O: `collectUnreviewedMatches`, `deriveConstruct`, `makeIdGenerator`, `buildReviewEntry`, `parseAnswer`, and the driver `runReviewSession` (asks about every unreviewed sample match via a caller-supplied `ask` callback, returns entries + counts). `src/cli/commands/review.ts` supplies a `readline`-backed `ask`; tests supply a scripted one. See "`reviews.yaml` conventions" below for `buildReviewEntry`'s span-aware behaviour (reviewer finding 1).
- `load-results.ts` — `loadResultsFile`: reads and validates a `results.json` (shared by `lsc report` and `lsc review`).
- `render-files.ts` — `renderReportFiles({ results, ruleSet?, examples?, synthesis?, outDir, baseName? }) -> { report, markdownPath, htmlPath }`: builds the report model and writes `<baseName>.md` / `<baseName>.html` (default `report.md`/`report.html`) to `outDir`. The one file-writing entry point besides `load-results.ts`'s read, so `lsc compile` (llm-integrator, D25 item 2: "`lsc compile` writes the report itself ... into `--out`") and `lsc report` share it instead of duplicating "build, render, write".
- `markdown.ts` / `html.ts` — renderers. Section order, top to bottom:
  1. Overall verdict — including the number of sample matches not yet reviewed (D25 item 2, e.g. "138 sample matches not yet reviewed").
  2. Coverage table — each row links to (or, with no rule for that type, names) the place that gives its confidence reason (reviewer finding 4).
  3. `## Lexical settings` / `<h2>Lexical settings</h2>`: comment/string markers and `fileMatchers` from the Rule Set (D25 item 2). Only with `--ruleset`.
  4. `## Rules` / `<h2>Rules</h2>`: one section per rule (`### \`ruleId\`` / `<section class="rule ..." id="rule-<ruleId>">`), each holding, **in this order**: pattern, captures, confidence + reason, pass rate, representative matches, missed examples, wrong captures, false positives, extra matches on positive examples, **that rule's own unreviewed sample matches**, **that rule's own provenance** (Skill file + anchor + example ids).
  5. Sample-scan warnings (block-tracking warnings, not per rule).
  6. `## Synthesis` / `<h2>Synthesis</h2>`: each construct's synthesis outcome, reason, attempt count and per-attempt problems (redacted for review examples) from `synthesis.json` (D25 item 2). Only with `--synthesis`. Also states plainly that `synthesis.json` has no provider/model/recording-origin field as of WP-09 (see this package's WP-07 completion note) — token usage is the only usage/provenance data it carries.
  7. `## Provenance` / `<h2>Provenance</h2>`: Skill file hashes (`sourceSkills`), and, with `--skills-dir`, any hash that no longer matches the current Skill directory (reviewer Q5, D25 item 4) — not per-rule provenance (that lives inside each rule's own section, step 4).

  Putting unreviewed sample matches and provenance *inside* each rule's section (rather than as their own top-level sections after every rule, as literally listed by the WP-07 brief's bullet order) is a recorded deviation, accepted by the project owner (D25 item 3): a reader deciding whether to trust rule `X` wants `X`'s pattern, failures, unreviewed matches and provenance together, not scattered across three separately-ordered lists they must cross-reference by rule id. `tests/report/markdown.test.ts` and `html.test.ts` ("layout (D25 item 3)") check this order explicitly, per rule and against the global Provenance section. `html.ts` inlines all CSS in one `<style>` tag and makes no external request, so the file is readable offline (WP-07 brief).
- `index.ts` — public API; import from here.

## What `Results` alone cannot show

`Results` (WP-05) records pass/fail and diff data (missed/unexpected/wrongCaptures all carry line + captures) but not a rule's pattern, its captures map, its provenance, or the source of a *passing* positive example (a pass has no diff to show). So:

- Missed examples, wrong captures and false positives are always fully shown (ruleId + exampleId + line + captures), with or without extra options.
- Pattern, captures and provenance need `buildReport`'s `ruleSet` option (`lsc report --ruleset <file>`).
- Representative matches (passing positive examples) and source snippets need the `examplesById` option (`lsc report --skills-dir <dir>`, which re-ingests the Skill files the same way `lsc test` does).

Without these, the report still renders every section (WP-07 acceptance criterion); the affected fields say so explicitly ("unavailable (pass --ruleset ...)") rather than guessing.

## `lsc report` / `lsc review` command lines

The WP-07 brief's literal command lines are `lsc report <results.json> [--format md|html|json]` and `lsc review <results.json>`. Both commands need more than `results.json` alone can give them:

- `lsc report` additionally accepts `--ruleset <file>`, `--skills-dir <dir>` and `--synthesis <file>` (all optional; see above) and `--out <file>`. With `--ruleset` **and** `--skills-dir` together, it also re-hashes the Skill directory and, if any hash differs from the Rule Set's `sourceSkills`, warns on stderr as well as in the rendered report (reviewer Q5, D25 item 4).
- `lsc review` needs to know where `reviews.yaml` lives (D15: a sibling of the Skill directory, not derivable from `results.json`), so it requires either `--skills-dir <dir>` (the usual convention) or `--reviews-file <file>` (an explicit path). It now also requires `--ruleset <file>` and `--sample <dir>` (the same two the results were produced from): `buildReviewEntry` needs the rule's pattern/masking config and the sample file's actual text to recompute a match's line span (reviewer finding 1, below).

See the WP-07 completion note (`docs/progress.md`) for the reasoning; this is flagged there as a deviation from the brief's literal signature, not a silent addition.

## `reviews.yaml` conventions this package follows (D9, D15, src/examples/README.md §4)

- `code` is **the lines the match spans** (`computeMatchSpan`, `match-span.ts`) — usually one line, but a whole-text (`multiline: true`) rule can match text continued onto a later line (db-read's trap T8, `READ &` continued on the next line). Earlier this package used only the single matched line (`matchedLineText`, still exported for that one case), which let a reviewed "correct" match become an example a correct rule fails whenever another match of the same rule shared its line (reviewer finding 1) — fixed.
- Other matches of the *same rule* on those spanned lines are handled per README §4: for `verdict: correct`, every one of them (including the reviewed match) is listed in `expected`, sorted by line then capture. For `verdict: false_positive`, any *other* match of the same rule on those lines makes the example impossible to write as a negative (D16 h: "a negative example must contain no match of any construct"); `buildReviewEntry` refuses in that case (returns `{ ok: false, reason }`) rather than writing an entry a correct rule could never pass — `runReviewSession` reports the refusal the same way as a skip, with the reason.
- `verdict: correct` records every same-rule match on the spanned lines as an expected match (roles from the rule's own captures). A reviewer who disagrees with a capture chooses `false positive` instead (or edits `reviews.yaml` afterwards) — the CLI does not offer to edit individual capture values.
- ids follow `review-<construct>-<n>` (`makeIdGenerator`), continuing after the highest existing number for that construct so two sessions never collide.
- `skip` is never written (matches README.md); an unrecognised answer, an unknown rule id, an unreadable sample file, or a refused entry (above) are all treated as skips, each with its own reason.
- The reviews file is rewritten after every recorded verdict (`onRecorded`), so an interrupted session (Ctrl+C, `quit`) loses nothing already decided.
- If `reviews.yaml` already has an invalid entry, `lsc review` refuses to write to it at all (a rewrite would silently drop the invalid entries); fix the file first.
