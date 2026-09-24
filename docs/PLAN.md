# Language Skill Compiler — MVP plan

## Contents

1. Summary
2. Terms
3. Scope
4. Decisions
5. Rule Set contract
6. Example format and confidence
7. Module design and CLI
8. Compilation pipeline
9. Phases and work packages
10. Risks
11. Acceptance criteria traceability
12. References

## 1. Summary

The Language Skill Compiler turns Skill files (Markdown documentation of a custom legacy language) plus labelled code examples into a versioned JSON Rule Set. Legacy Navigator applies that Rule Set to scan repositories without any LLM (large language model) call. The compiler is built deterministic-first: the contract, rule engines, test runner and validation report exist and are tested before any model is connected, so every model-proposed rule is measured the moment it is produced.

Development uses a synthetic language, `toylang`, so the whole pipeline can be built and tested without employer code. The real custom language enters only in the final acceptance wave, after an explicit check that sending its snippets to the chosen model provider is permitted.

## 2. Terms

- **Skill file** — Markdown file describing a language construct, its conventions and traps, with code examples.
- **Construct** — a language feature a rule should detect, e.g. a procedure definition or a database read.
- **Example** — a labelled code snippet: positive (the rule must match, with given captures) or negative (the rule must not match).
- **Rule** — a deterministic matcher (exact text or regex) plus metadata: type, captures, provenance, test results, confidence.
- **Rule Set** — the versioned JSON file of all rules for one language; the contract with Legacy Navigator.
- **Capture** — a named part of a match, e.g. the procedure name or the table name.
- **Provenance** — the Skill file section and example IDs that justify a rule.
- **Repository sample** — a small, unlabelled set of real files used to surface unexpected matches for human review.
- **RE2** — a regular-expression engine that guarantees matching time grows linearly with input size.
- **ReDoS** — Regular expression Denial of Service: a regex that takes extremely long on certain inputs.

## 3. Scope

In scope (from the compiler specification):
- Skill file ingestion with provenance
- Rule synthesis by LLM, only where documentation and examples justify it
- Deterministic engines: exact match and regex in the MVP (see D6)
- Tests generated from positive and negative examples
- Bounded automatic refinement of failing rules
- Validation report and review CLI (command-line interface)
- Versioned Rule Set export; recompiling after Skill changes
- Cost and safety controls: bounded snippets, capped retries and tokens, snippet log, offline validation

Out of scope: a full parser for the custom language, control-flow reconstruction, vector search, repository-wide LLM parsing, PHP.

## 4. Decisions

| ID | Decision | Reason |
| --- | --- | --- |
| D1 | `branch_marker` and `exit` rule types are left out of the MVP contract | Navigator's `NormalizedFileAnalysis` has no field for them and no MVP view needs them; adding them later is a minor contract version |
| D2 | Captures are named groups (`(?<name>...)`), not numeric indexes | Numeric indexes break silently when a pattern is edited |
| D3 | All regex patterns must be RE2-compatible and are executed with an RE2 engine | Prevents ReDoS on large repositories; LLM-written patterns are otherwise unbounded |
| D4 | Definition rules may declare a `blockEnd` pattern; the adapter attributes calls, reads and writes to the innermost open definition | Navigator relations need a source symbol, which a single-line match cannot supply |
| D5 | Development uses the synthetic `toylang`; the real language is used only from Wave 5 | Lets the whole pipeline be built without employer code; separates tool bugs from language-knowledge gaps |
| D6 | Token-matcher and state-machine engines are deferred to WP-12, built only if real-language evidence shows exact + regex are insufficient | Deviation from the specification's engine list; avoids building engines no rule needs yet |
| D7 | Tests use a `FakeProvider` replaying recorded model responses; real providers are used only in manual compile runs | Deterministic, free, offline tests |
| D8 | Confidence is computed by a fixed formula (§6.3), never assigned by the model | Confidence must reflect evidence, not model self-assessment |
| D9 | Human review of repository-sample matches is saved as labelled examples (`reviews.yaml`) and feeds the next compile | Turns reviewed false positives into negative examples, so they stay fixed |

## 5. Rule Set contract

### 5.1 Top-level fields

| Field | Type | Purpose |
| --- | --- | --- |
| `contractVersion` | semver string | Version of the format; Navigator rejects unknown major versions |
| `languageId` | string | Language identifier |
| `version` | semver string | Version of this rule content |
| `compiledAt` | ISO 8601 timestamp | Compile time |
| `compilerVersion` | semver string | Compiler build that produced the file |
| `sourceSkills` | array of `{ path, sha256 }` | Exact inputs used |
| `fileMatchers` | array of glob strings | Files the Rule Set applies to |
| `lineComment`, `blockComment`, `stringDelimiters` | optional strings/pairs | Lets engines skip comments and string literals (a common source of false positives) |
| `rules` | array of Rule | The rules |

Content version bumps (semantic versioning):
- **Major** — a rule removed or renamed, or its output meaning changed
- **Minor** — rules added
- **Patch** — patterns refined, no change in meaning

### 5.2 Rule fields

| Field | Type | Purpose |
| --- | --- | --- |
| `id` | kebab-case string | Stable identifier |
| `type` | enum (§5.3) | What the rule detects |
| `engine` | `exact` \| `regex` | Discriminates the engine config |
| `exact` | `{ tokens: string[], caseSensitive: boolean }` | Only when `engine = exact` |
| `regex` | `{ pattern: string, flags: string, multiline: boolean }` | Only when `engine = regex`; RE2-compatible |
| `captures` | map of capture role → group name | Must include the roles required by the type |
| `blockEnd` | optional regex config | Only on `module_declaration` and `symbol_definition` |
| `searchStrings` | optional boolean, default `false` | Lets a rule match inside string literals (e.g. a table name passed as a string) despite masking |
| `confidence` | `high` \| `medium` \| `low` | Computed (§6.3) |
| `sourceEvidence` | array of `{ skill, anchor, exampleIds[] }` | Provenance |
| `tests` | `{ passed, failed, failingExampleIds[] }` | Result of the last validation |
| `status` | `validated` \| `rejected` | Only `validated` rules are exported |

### 5.3 Rule types and Navigator mapping

| Rule type | Navigator record | Required capture roles | Optional roles |
| --- | --- | --- | --- |
| `module_declaration` | `symbols` (kind: module) | `name` | — |
| `symbol_definition` | `symbols` (kind: function/procedure) | `name` | `kind` |
| `call` | `relations` (kind: calls) | `callee` | `module` |
| `include` | `relations` (kind: includes) | `target` | — |
| `db_read` | `dbAccesses` (mode: read) | `table` | — |
| `db_write` | `dbAccesses` (mode: write) | `table` | — |
| `config_ref` | `configRefs` | `key` | — |
| `entry_point` | `entryPoints` | `name` | `kind` |

Matches from `low`-confidence rules, and matches whose captures are ambiguous, additionally produce `uncertainties` records.

The contract is published as TypeScript types, a Zod schema and an exported JSON Schema file (`contract/rule-set.schema.json`), so Navigator can validate Rule Sets without depending on compiler code.

## 6. Example format and confidence

### 6.1 Example sources

- **Inline** — fenced code blocks in Skill files with an info string, e.g. `toylang example=positive construct=proc-definition id=proc-01`. Expected captures follow in a `yaml expect` block directly below.
- **Sidecar** — `examples/<construct>/<id>.<ext>` plus `<id>.expect.yaml`, for longer snippets.
- **Reviews** — `reviews.yaml` entries created from human review of repository-sample matches (D9).

All three are normalised into one `Example` record: `{ id, construct, polarity, code, expected: [{ line, type, captures }], source }`.

### 6.2 Pass/fail semantics

- A positive example passes when every expected match is found on the stated line with identical captures, and no extra match of that rule appears.
- A negative example passes when the rule produces no match.
- Repository-sample matches are unlabelled: they are reported for review, not counted as pass or fail until reviewed.

### 6.3 Confidence formula

- **high** — at least 5 positive and 2 negative examples, 100 % pass
- **medium** — at least 3 positive examples, at least 90 % pass, no failing negative example
- **low** — everything else that still passes at least one positive example
- **rejected** — passes no positive example, or exceeds the refinement budget while failing

## 7. Module design and CLI

| Folder | Responsibility |
| --- | --- |
| `src/contract` | Types, Zod schemas, JSON Schema export, version rules |
| `src/examples` | `Example` record, sidecar and review loaders |
| `src/ingest` | Skill Markdown parsing, construct and inline-example extraction, hashing |
| `src/engines` | Exact and regex (RE2) engines, comment/string masking, block tracking |
| `src/runner` | Runs rules against examples and sample files, produces `RuleResult` |
| `src/llm` | Provider interface, Anthropic provider, `FakeProvider`, budgets, snippet log |
| `src/synth` | Rule proposal, validation, refinement loop |
| `src/report` | Validation report (JSON + Markdown/HTML), review CLI |
| `src/release` | Versioning, diff against previous Rule Set, export |
| `src/cli` | Command wiring |
| `fixtures/toylang` | Synthetic language specification, Skill files, examples, sample repository |

CLI commands:

| Command | Does |
| --- | --- |
| `lsc validate-ruleset <file>` | Validate a Rule Set against the contract |
| `lsc ingest <skills-dir>` | Parse Skill files, print constructs and examples found |
| `lsc test <ruleset> <skills-dir> [--sample <dir>]` | Run rules against examples and sample; offline |
| `lsc compile <skills-dir> [--sample <dir>] [--provider <name>]` | Full pipeline: ingest → synthesise → test → refine → write Rule Set |
| `lsc report <results.json>` | Render validation report |
| `lsc review <results.json>` | Step through sample matches, record verdicts into `reviews.yaml` |
| `lsc export <ruleset> --out <file>` | Assign version and write the validated Rule Set |

## 8. Compilation pipeline

1. Ingest Skill files; hash them; extract constructs and examples.
2. For each construct with at least one positive example: send the construct's Skill section and its examples (bounded size) to the provider; ask for one or more rules as JSON.
3. Validate the model output with Zod and check RE2 compatibility; invalid output counts as a failed attempt.
4. Run the proposed rule against all examples of that construct, plus negative examples of all other constructs.
5. If it fails, send the failing examples and the actual matches back for refinement. Maximum 3 attempts per construct (configurable).
6. Run surviving rules on the repository sample; record unlabelled matches for review.
7. Compute confidence; mark rules `validated` or `rejected`.
8. Compare with the previous Rule Set; assign the next version (§5.1); write Rule Set, results file and report.

Cost and safety controls:
- per-call and per-compile token caps
- per-construct attempt cap
- a JSONL (JSON Lines) log of every snippet sent
- no file from the repository sample is ever sent to the model

## 9. Phases and work packages

| Phase | Work packages | Result |
| --- | --- | --- |
| 1. Contract | WP-01 skeleton, WP-02 contract, WP-03 example format + toylang | Frozen contract, fixture Rule Set for Navigator |
| 2. Engines and tests | WP-04 engines, WP-05 runner | Hand-written rules measurable offline |
| 3. Skill ingestion | WP-06 | Skill files → constructs + examples with provenance |
| 4. LLM synthesis | WP-08 provider layer, WP-09 synthesis loop | Rules produced without hand-written regexes |
| 5. Validation report | WP-07 report + review CLI | Misses and false positives inspectable |
| 6. Recompile and export | WP-10 | Versioned Rule Set, rebuild after Skill change |
| Acceptance | WP-00 real inputs, WP-11 real-language run, WP-12 conditional engines | MVP proven on the real language |

The build order in `docs/ORCHESTRATION.md` runs some of these phases in parallel.

## 10. Risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Skill files or examples are thin or wrong | Rules inherit the gaps; confidence stays low | Coverage report shows constructs without enough examples; WP-00 checklist |
| Real language needs context regex cannot see (nesting, multi-line statements) | Misses or wrong captures | `blockEnd`, comment/string masking; WP-12 adds engines if evidence shows the need |
| Model proposes overfitted rules (match the examples only) | False positives on real code | Negatives from all constructs; repository-sample review; D9 feedback |
| Employer policy forbids sending code to the chosen provider | Compile cannot run on the real language | Gate G4 checks policy first; provider adapter allows an approved or local model |
| Contract drift between compiler and Navigator | Navigator breaks silently | Frozen contract, JSON Schema export, `contractVersion` check |
| Parallel agents editing the same files | Merge conflicts, broken builds | Strict folder ownership; contract frozen before parallel waves |

## 11. Acceptance criteria traceability

| Specification criterion | Proven by |
| --- | --- |
| Skill files + examples → valid Rule Set without hand-written regexes | WP-09, WP-11 |
| Re-run after a Skill change creates a new version | WP-10 |
| Every rule has provenance and automated tests | WP-02 schema, WP-05, WP-09 |
| Report makes false positives and misses inspectable | WP-07 |
| Routine scanning runs without an LLM | WP-05 (`lsc test` offline), WP-10 |
| Navigator consumes the Rule Set through a stable JSON contract | WP-02 JSON Schema + fixture |

## 12. References

- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Zod: https://zod.dev — JSON Schema export: https://zod.dev/json-schema
- RE2 syntax: https://github.com/google/re2/wiki/Syntax
- `re2` npm package: https://www.npmjs.com/package/re2
- Named capture groups: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Regular_expressions/Named_capturing_group
- Semantic versioning: https://semver.org
- Vitest: https://vitest.dev
