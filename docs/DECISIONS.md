# Decisions log

Append-only. D1–D9 are defined in docs/PLAN.md §4. Add new decisions below as D10, D11, … with date, author (agent or owner), decision, reason, and affected work packages.

## D1–D9 (copied from docs/PLAN.md §4 by WP-01; the plan remains authoritative)

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

## D10 — Minimum Node.js version is 22.22.2 (not 20)

- **Date:** 2026-09-24
- **Author:** `contract-architect` (WP-01)
- **Decision:** `package.json` `engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`; `.nvmrc` pins 22.
- **Reason:** WP-01 asks for "Node.js 20+ LTS". Node.js 20 reached end of life on 2026-04-30. The current releases of required dependencies no longer support it: `re2` 1.25+ requires `^22.22.2 || ^24.15.0 || >=26`, `commander` 15 requires `>=22.12`, `vitest` 5 requires `^22.12 || ^24 || >=26`. Supporting Node 20 would mean pinning an older native `re2` binding (the ReDoS safeguard, D3) and older tooling on an unsupported runtime. The engines range is the `re2` range, the strictest dependency.
- **Affects:** WP-01 (root config); every environment that runs `lsc`, including Legacy Navigator's CI if it runs the compiler. Navigator consuming the JSON Rule Set is unaffected.
- **Reversible:** yes — pin `re2@~1.24`, `commander@^14`, `vitest@^4`, `eslint@^9` and widen `engines` if the project owner requires Node 20.

## D11 — Exact engine: placeholder tokens and regex-equivalent semantics

- **Date:** 2026-09-24
- **Author:** `contract-architect` (WP-02); for approval at G1
- **Decision:** An `exact` token written exactly as `(?<name>)` is a capture placeholder matching `[0-9A-Za-z_]+`. An exact rule means the RE2 regex built by `exactToRegex` (`src/contract/exact.ts`): escaped literals with `\b` at word edges, placeholders as `\b(?<name>[0-9A-Za-z_]+)\b`, tokens joined by `[ \t]*`, flag `i` when `caseSensitive` is false, applied per line. Exact rules need at least one literal token and unique placeholder names (validation rule `exact-tokens`).
- **Reason:** Plan §5.2 gives the exact engine only `tokens` and `caseSensitive`, but every rule type requires a capture role and captures must reference a group that exists. Without placeholders no exact rule could be valid, although WP-09 asks the model to prefer `exact`. Defining the engine as an equivalent regex gives Navigator a precise spec it can reimplement.
- **Affects:** WP-04 (exact engine), WP-09 (prompt must explain placeholders), Navigator. contract/CONTRACT.md §6.4, §9 Q1.

## D12 — Contract compatibility: closed objects, newer minors rejected

- **Date:** 2026-09-24
- **Author:** `contract-architect` (WP-02); for approval at G1
- **Decision:** Every object in the schema is closed (`additionalProperties: false`). A validator for contract `1.m` accepts `contractVersion` `1.0.x` … `1.m.x` and rejects other majors and newer minors, with rule code `contract-version`. `compiledAt` must be UTC (`Z`). The JSON Schema targets draft 2020-12.
- **Reason:** Plan §5.1 says Navigator rejects unknown majors but says nothing about newer minors. Closed objects catch misspelt fields (`blockend`) that would otherwise be silently ignored; with closed objects, an old validator cannot accept a newer minor anyway, so the policy states that explicitly. UTC keeps `compiledAt` comparable. Draft 2020-12 is Zod's default target and current.
- **Affects:** Navigator's version check; WP-10 (export). contract/CONTRACT.md §2, §9 Q8.

## D13 — Matching semantics are part of the contract

- **Date:** 2026-09-24
- **Author:** `contract-architect` (WP-02); for approval at G1
- **Decision:** contract/CONTRACT.md §6 fixes how a consumer applies a Rule Set: `fileMatchers` glob subset, line splitting, the masking algorithm (single left-to-right scan; longest delimiter wins; strings end on their line; no escapes; full mask vs. comment-only mask for `searchStrings`), regex per-line/whole-text behaviour and flags, the exact engine (D11), and scope handling for `blockEnd` (a `blockEnd` match closes the latest open scope of the same rule; definitions without `blockEnd` open no scope).
- **Reason:** Navigator runs the rules itself. If its engine differs from `src/engines/` in any of these points, it finds something other than what `lsc test` measured. The plan leaves these to WP-04, which runs after G1, so they would otherwise escape the frozen contract.
- **Affects:** WP-04 must implement §6 as written (or report a conflict); Navigator. Open points are listed in contract/CONTRACT.md §9 (Q2–Q7).

## D14 — Validation rules added beyond WP-02's list

- **Date:** 2026-09-24
- **Author:** `contract-architect` (WP-02)
- **Decision:** Besides the five rules in WP-02, the validator enforces: `capture-role-not-allowed` (captures may only use the type's required and optional roles), `named-group-syntax` (named groups must be `(?<name>…)`, not `(?P<name>…)`), `exact-tokens` (D11), and `contract-version` (D12). Regex `flags` are limited to `^i?m?s?$`. Each has a failing fixture in `contract/fixtures/invalid/`.
- **Reason:** A role outside the type's spec has no Navigator meaning. `(?P<name>)` compiles in RE2 but not in JavaScript or most other engines. RE2 silently accepts unknown flags such as `x`, and `g`/`y` would change engine behaviour.
- **Affects:** WP-09 (model output must satisfy them), Navigator (reimplement or run `lsc validate-ruleset`).

## D15 — Example format details and example source locations

- **Date:** 2026-09-24
- **Author:** `contract-architect` (WP-03)
- **Decision:**
  1. `expected[].captures` is keyed by capture **role** (`callee`, `table`, …), not by group name, and must satisfy `RULE_TYPE_SPEC` (required roles present, no other roles). All expected matches of one example share one rule type. A positive example's actual captures must equal the expected captures exactly (src/examples/README.md §1).
  2. `Example.source` is a discriminated union `inline` / `sidecar` / `review`; review sources keep `ruleId`, `sampleFile`, `sampleLine` and `verdict`.
  3. Sidecar examples live in `<language>/examples/<construct>/<id>.<ext>` + `<id>.expect.yaml` (`{ polarity, expected? }`); `reviews.yaml` lives at `<language>/reviews.yaml`, where `<language>/skills/` is the `<skills-dir>` argument (`exampleLocations`).
  4. `reviews.yaml` is `{ reviews: ReviewEntry[] }`; verdict `correct` → positive (needs `expected`), `false_positive` → negative. `skip` is not written.
  5. Inline `yaml expect` blocks contain a YAML list of expected matches; negative examples have no block.
  6. Loaders return `{ examples, errors }` and never throw on bad input; errors are `file:line: path: message`.
  7. The fixture Rule Set `contract/fixtures/toylang.ruleset.json` was aligned with final toylang (before G1, so no contract change): `call-statement` became a regex (to capture `module`), `module-declaration` and `entry-point` became `exact`, `proc-definition` gained the `kind` capture (`PROC`/`FUNC`), `db-read` became whole-text (`multiline: true`) for reads continued after the keyword, real Skill hashes, anchors and example ids.
- **Reason:** Plan §6.1 names the record's fields but not these details, and WP-05, WP-06, WP-07 and WP-09 all depend on them. Roles are stable across rule edits; group names are not (same reasoning as D2). One type per example keeps "every expected match is found" (plan §6.2) unambiguous. Plan §8 step 4 runs every rule against every negative example, so negatives must contain no match of any construct; this is documented, not enforceable without engines.
- **Affects:** WP-05 (pass/fail comparison), WP-06 (inline examples via `parseExpectBlock` + `buildExample`, locations), WP-07 (`stringifyReviews`), WP-09 (see the open question on review examples and the model in the WP-03 completion note).

## D16 — Gate G1: Rule Set contract 1.0.0 approved and frozen

- **Date:** 2026-09-25
- **Author:** orchestrator, recording the project owner's decision at G1
- **Decision:** The project owner approved the Rule Set contract 1.0.0 with these decisions as proposed:
  a. D1 and D6 as planned;
  b. D10: minimum Node.js 22.22.2;
  c. D11: exact-engine placeholder tokens `(?<name>)` matching `[0-9A-Za-z_]+`;
  d. D12: closed objects; 1.0 consumers reject 1.1+ and other majors;
  e. D13: matching semantics (contract/CONTRACT.md §6) are part of the frozen contract;
  f. contract/CONTRACT.md §9 Q2–Q7: the proposals in CONTRACT.md stand for 1.0 and are revisited with real inputs at G4;
  g. examples from `reviews.yaml` (repository-sample text) are used only by the runner and are never sent to a model provider (plan §8);
  h. negative examples must contain no match of any construct (no look-alike negatives);
  i. dev dependencies `ajv` and `ajv-formats` added in WP-02 are accepted.
- **Reason:** Human gate G1 (docs/ORCHESTRATION.md §4).
- **Affects:** `src/contract/` is frozen; changes need a contract version bump and a DECISIONS entry by `contract-architect`. WP-09 must not put review examples into prompts. WP-05 applies every rule to every negative example.

## D17 — Model-layer conventions

- **Date:** 2026-09-25
- **Author:** `llm-integrator` (WP-08); appended by the orchestrator
- **Decision:** Recordings are keyed by sha256 of canonical `{system, messages}`, excluding `maxOutputTokens`, provider and model. The API key comes only from the environment variable named in `provider.apiKeyEnv`. Budgets refuse and never shrink requests. `structured()` accepts only a whole-text JSON document or exactly one `json` or unlabelled fence. Infrastructure errors are thrown; output errors are returned as failed attempts. Malformed requests are not logged; refused and failed requests are.
- **Reason:** Stable recordings across budget changes; no secrets in files; no silent fallback (plan §8, D7).
- **Affects:** WP-09; adding a provider at G4.

## D18 — Construct anchors and orphan examples

- **Date:** 2026-09-25
- **Author:** `skill-ingester` (WP-06); appended by the orchestrator
- **Decision:** A construct's anchor is the heading enclosing the first inline example (document order) that declares it; nested sub-headings (e.g. `### Traps`) belong to the parent construct's section. Sidecar or `reviews.yaml` examples for a construct that no Skill file documents are dropped with an "example without construct" diagnostic rather than becoming a construct of their own.
- **Reason:** WP-09 needs one stable anchor per construct, and every example must be traceable to documentation, not only to a directory name.
- **Affects:** WP-09 (anchors in `sourceEvidence`), WP-00 (real Skill files must document every construct that has examples).

## D19 — Owner decisions after the wave 2 review

- **Date:** 2026-09-26
- **Author:** orchestrator, recording the project owner's answers
- **Decision:**
  a. **Cross-construct negatives (reviewer Q-C).** Every rule is still applied to every negative example of every construct (D16 h), and a match on any of them fails the rule and blocks `high`/`medium`. But `tests.passed`/`tests.failed`, the pass rate and the "≥2 negatives" threshold of plan §6.3 use only the construct's own examples (as coverage already does). Cross-construct negative failures are reported separately. The fixture's `tests` counts and SPEC §8 ("own examples") stay as they are.
  b. **Matches outside any open scope (reviewer Q-A).** A relation, db-access or config-ref match with no enclosing definition uses as its source the name of the `module_declaration` matched in the same file (the last one before the match), or, if none, the file itself. Such matches produce normal records, not `missing-source-symbol` uncertainties.
  c. **Unnamed definitions (reviewer Q-B).** A definition match whose `name` capture is missing or empty produces an uncertainty and opens no scope; matches inside it keep the outer scope.
  d. **Recording guard (WP-08 question a).** `lsc compile` refuses recording mode when `LSC_REAL_INPUTS` is set or any input lies outside `fixtures/toylang/`.
- **Reason:** Owner answers to the wave 2 review questions.
- **Affects:** b and c clarify contract/CONTRACT.md §4/§6.6/§9 (Q3, Q5 and the WP-04 question) — `contract-architect` documents them and decides the version impact under D12; `engine-builder` implements a–c in `src/engines/` and `src/runner/`; WP-09 implements d. Still open for G4: WP-08 b (mandatory `baseUrl`), WP-08 c (keep `responseText` in the snippet log), D18 impact on real inputs, reviewer Q-D (same-type rules and each other's negatives).
