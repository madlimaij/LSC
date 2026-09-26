# src/synth

**Owner:** `llm-integrator` (WP-09).

Rule synthesis: the model proposes rules, the runner decides (plan §8). Import
from `src/synth/index.ts`. CLI: `lsc compile` (`src/cli/commands/compile.ts`).

## Pipeline (`compileLanguage`)

1. **Ingest** (`src/ingest`): constructs, prose, examples, Skill hashes.
2. **Lexical settings** (`lexical.ts`): `fileMatchers`, `lineComment`,
   `blockComment`, `stringDelimiters` are proposed from the general Skill files
   (files with no inline example; `language-basics.md` for toylang). The
   runner accepts them only if every marker and every literal part of every
   glob occurs verbatim in the documentation sent. Without accepted settings
   there is no Rule Set (`synthesis.status: "failed"`).
3. **Per construct** (`construct-loop.ts`), up to `maxAttemptsPerConstruct`
   (default 3) attempts:
   1. propose (`buildProposalMessage`)
   2. parse the answer with `ProposalSchema` (Zod, via `structured()`), then
      build the full rule and run the contract validator (`validateRule`:
      schema, RE2, captures, D14)
   3. run it with `runRuleAgainstExamples` (WP-05) against the construct's
      examples plus every other construct's negative examples
   4. on failure, append the answer and a feedback message
      (`buildRefinementMessage`: failing examples, expected vs actual, the
      previous rule) and try again
   5. `validated` when the runner passes it; `rejected` after the cap (last
      runnable rule kept, with failure reasons); `not-justified` when the
      model proposes no rule (no retry: that answer is accepted as the
      outcome, with its reason); `skipped` when the construct has no positive
      example or its positives disagree on the rule type.
4. **Draft Rule Set**: validated and rejected rules, `version: "0.0.0-draft"`
   (WP-10 assigns the real version), checked with `validateRuleSet`.
5. **Results**: `runRules` on the draft (validated rules, sample scan), plus
   the rejected rules' last runs; the repository sample is read only here,
   after the last model call.

The model never chooses `id` (construct id), `type` (fixed by the construct's
positive examples), `sourceEvidence`, `tests`, `confidence` (formula, D8) or
`status`.

## Model answer (`schema.ts`)

`{ "rules": [RULE] }` or `{ "rules": [], "notJustified": "<reason>" }`.
At most one rule per construct: a positive example lists every match of its
construct, and each rule is tested on its own, so a second rule could never
pass. RULE: `engine` + `exact` | `regex`, `captures`, optional `blockEnd`,
`searchStrings`, and a required `rationale`. Unknown fields fail the attempt.

## What is sent, and what never is

Sent: the construct's Skill section (capped by ingest at 4000 chars), its
Skill-file and sidecar examples (at most 12, 1200 chars each, 10 000 total;
the rest are still tested and the prompt says how many were left out), the
contract excerpt for its rule type, the lexical settings, and on refinement
failing examples (at most 6) with expected vs actual matches and the previous
rule. Limits: `DEFAULT_PROMPT_LIMITS` in `prompts.ts`.

Never sent: repository-sample files (plan §8) and `reviews.yaml` examples
(repository-sample text, D16 g). Review examples are tested by the runner and
count in `tests`; the feedback's pass counts exclude them, and a failing one is
mentioned only as "N failing example(s) come from human review … content not
shown". So prompts do not change when `reviews.yaml` changes, unless a review
example fails. Tested in `tests/synth/privacy.test.ts`.

Prompts are pure functions of their inputs (no timestamps, no absolute
paths), so recordings keyed by request hash (D17) replay.

## Failures

- Output or rule problems are failed attempts (`invalid-output`,
  `invalid-rule`, `failed-tests`), never repaired.
- Infrastructure errors (`LlmError`: budget exhausted, provider error,
  unknown recording) stop the compile: `synthesis.status: "aborted"`, the
  remaining constructs are `not-attempted`, outputs written so far are kept.

## Recording guard (`guard.ts`, D19 d)

`assertRecordingAllowed` refuses recording mode when `LSC_REAL_INPUTS` is set
(any value) or any input (Skill dir, examples dir, `reviews.yaml`, sample dir)
resolves, symlinks followed, outside `fixtures/toylang/`. `lsc compile` calls
it before a provider is constructed.

## `lsc compile`

```
lsc compile <skills-dir> [--sample <dir>] [--provider <name>] [--recordings <dir>]
            [--config <file>] [--out <dir>] [--language-id <id>] [--max-attempts <n>]
```

Writes to `--out` (default `.lsc/out`): `<languageId>.ruleset.draft.json`,
`results.json` (runner `Results`, WP-05 schema, readable by `lsc report`),
`synthesis.json` (`SynthesisReportSchema`: per construct and attempt, outcome,
problems, drafts, token usage). Prints the `lsc report` command for WP-07.
Exit code 0: every construct validated; 2: finished with rejected,
not-justified or skipped constructs; 1: no usable result (no provider,
refused recording, lexical settings failed, compile aborted).

`--provider fake --recordings <dir>` replays recordings offline. Otherwise
`--provider` must name the provider configured in `lsc.config.json`.
