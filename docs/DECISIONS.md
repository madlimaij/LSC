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

## D20 — Contract 1.0.1: D19 b/c and the 1.0 mapping rules written into CONTRACT.md

- **Date:** 2026-09-26
- **Author:** `contract-architect` (contract follow-up for D19)
- **Decision:**
  1. contract/CONTRACT.md gains §4.1 "Mapping rules" (normative): (1) low confidence adds an uncertainty; (2) a required role whose group did not take part or captured the empty string is missing, and the match produces an uncertainty and no record of its type (Q3 proposal, D16 f); for definitions this is the unnamed definition of D19 c, which also opens no scope; (3) `symbol_definition` kind: `kind` capture lowercased starting with `func` → `function`, else `procedure` (Q2 as implemented in WP-04, D16 f); (4) source of relations, db accesses and config refs: innermost open scope, else the last named `module_declaration` match before the match in the same file, else the file (D19 b); never a `missing-source-symbol` uncertainty. §6.5 and §6.6 are aligned; §9 marks Q3, Q5 and the new Q9 (the WP-04 "no open scope" question) resolved and lists what stays open; §8 gains a version history.
  2. Where D19 is silent, the contract now fixes: only *named* module declarations count as fallback source (a nameless one produced an uncertainty and names nothing); whether the module's rule has `blockEnd` or its scope is already closed does not matter ("the last one before the match"); "before" means an earlier start position; the file is identified by its repository-relative path with `/` separators (the §6.1 string); an unnamed definition's `blockEnd` match is processed like any other (closes the latest open scope of the same rule, or is ignored with a warning).
  3. **Version: patch bump, 1.0.0 → 1.0.1.** `CONTRACT_VERSION` bumped, `contract/rule-set.schema.json` re-exported (only `$id`, `title` and the `contractVersion` description change; the accepted pattern stays `1.0.x`), contract tests updated. The fixture Rule Set keeps `contractVersion: "1.0.0"` and now doubles as proof that a 1.0.1 validator accepts an older patch; a new test checks it also validates when stamped `1.0.1`. §2 now states explicitly that specifying behaviour for a case the contract left open, without changing validity or anything already specified, is a patch.
- **Reason:** No file becomes valid or invalid and no field, rule type or engine changes, so neither a major (meaning of something already specified changes) nor a minor (format addition; would also make every 1.0 consumer reject new files for no format reason) applies. Q3 and Q2 only write down the proposals D16 f already adopted. D19 b/c fill cases 1.0.0 did not specify (a match with no enclosing definition; a definition with no name). That is the patch row of §2 ("clarifying §6 text"). A bump rather than none because §8/§9 require every post-G1 change to go through the procedure, and the version history must show which text Navigator implemented. Caveat: a patch does not gate acceptance, so a consumer cannot tell from `contractVersion` whether the producer expected 1.0.0 or 1.0.1 mapping; §2 now says producers must not rely on that. Mapping is consumer-side behaviour and the Rule Set content is identical either way.
- **Affects:** Navigator (implement §4.1 and §6.6 as in 1.0.1; must be told with the new schema file, §8 item 5); `engine-builder` (src/engines/mapping.ts, blocks.ts: drop `missing-source-symbol`, add the fallback source, treat empty `name` as missing and open no scope; the scan must know the file's repository-relative path); WP-10 (export stamps `CONTRACT_VERSION` = 1.0.1). Open, for owner confirmation: the two details in item 2 about named-only modules and file identification; nested same-rule unnamed definitions ending the outer scope early (CONTRACT.md §9 Q9 b); Navigator's representation of a file as source (Q9 a).

## D21 — Unnamed definitions still pair with their own `blockEnd`

- **Date:** 2026-09-26
- **Author:** orchestrator, recording the project owner's decision
- **Decision:** An unnamed definition (D19 c) still takes part in `blockEnd` pairing for its rule, so its own `blockEnd` closes it (LIFO per rule), but it never becomes an enclosing symbol or a fallback source. This is the engine's current behaviour (commit 1c7d893). CONTRACT.md 1.0.1 §6.6 and §9 Q9 b, which say its `blockEnd` closes the most recent open scope of the same rule, are to be corrected by `contract-architect`.
- **Reason:** With nested same-rule definitions, the 1.0.1 text would end an outer procedure early and misattribute the matches that follow it.
- **Affects:** contract/CONTRACT.md §6.6, §9 Q9 (version impact decided by `contract-architect` under D12); no engine change.

## D22 — Contract 1.0.2: D21 written into CONTRACT.md (unnamed definitions pair with their own `blockEnd`)

- **Date:** 2026-09-26
- **Author:** `contract-architect` (contract correction for D21)
- **Decision:**
  1. contract/CONTRACT.md §6.6 now says: an unnamed definition (missing or empty `name`, §6.5) of a rule with `blockEnd` opens an **anonymous scope**. The scope takes part in same-rule `blockEnd` pairing (LIFO per rule id), so its own `blockEnd` closes it, and a `blockEnd` never skips it to close an older scope of the rule. It is never an enclosing symbol or a fallback source. Matches inside it get the innermost *named* open scope. If still open at end of file, it gets the usual unclosed-scope warning. §4.1 item 2, §9 Q3 and §9 Q9 are aligned. Q9 b is marked resolved, and the 1.0.1 text ("its `blockEnd` closes the most recent open scope of the same rule") is withdrawn. This matches `src/engines/blocks.ts` (commit 1c7d893) and the unnamed-definition tests in tests/engines/blocks.test.ts. No engine change.
  2. **Version: patch bump, 1.0.1 → 1.0.2.** `CONTRACT_VERSION` bumped, `contract/rule-set.schema.json` re-exported (only `$id`, `title` and the `contractVersion` description change; the pattern still accepts `1.0.x`), contract tests updated, §8 history row added. §2 now also names "replacing a provisional answer that §9 still listed as open with the owner's decision" as a patch.
- **Reason:** No file becomes valid or invalid, and no field, rule type or engine changes, so this is not a minor bump. It is not a major bump either, although 1.0.1 text is reversed. (1) D20 and 1.0.1 §9 Q9 b listed exactly this point as still open, pending owner confirmation. (2) The reference engine never implemented the 1.0.1 text, so every `lsc test` result so far was measured with the 1.0.2 behaviour. (3) No Rule Set has been exported under 1.0.1 (WP-10 has not run), and Navigator has not implemented 1.0.1 as far as this project records. A major bump would make every 1.0 consumer reject files whose format has not changed. Caveat: strictly, §2's patch rule says "without changing any behaviour already specified", and 1.0.1 did specify this case. The patch stands on the case being provisional (open in §9). If Navigator had already implemented the 1.0.1 text, it must change. The owner may overrule and require a stricter reading.
- **Affects:** Navigator (implement §6.6 as in 1.0.2; tell it with the new schema file, §8 item 5); WP-10 (export stamps 1.0.2); `engine-builder` (the header comment of src/engines/blocks.ts still describes the 1.0.1 text and should be corrected; the code is right).

## D23 — Contract 1.0.1/1.0.2 details accepted; wave 2 round 3 authorised

- **Date:** 2026-09-26
- **Author:** orchestrator, with authority delegated by the project owner ("choose what you think is best")
- **Decision:**
  1. The §2 rewording made with 1.0.1 is accepted: `contractVersion` also covers consumer behaviour, and specifying a case the contract left open is a patch.
  2. The D21 correction ships as patch 1.0.2, not a major bump (reasons in D22: no Rule Set was exported under 1.0.1, and the engine never implemented the 1.0.1 text).
  3. Only named `module_declaration` matches count as the fallback source (D20).
  4. A file used as the fallback source is identified by its repository-relative path with `/` separators (D20).
  5. The owner authorised a third, targeted fix-and-review round for WP-04, WP-05 and WP-06, beyond the two-round limit in docs/ORCHESTRATION.md §5.
- **Reason:** 1–2: a major bump would make every 1.0 consumer reject files whose format has not changed. 3: an unnamed module has no name to give. 4: a path is stable and unique within a repository. 5: the remaining round-2 findings are small, and the contract already settles each one.
- **Affects:** Navigator needs contract 1.0.2 and the new schema file before any Rule Set ships (CONTRACT.md §8 item 5; to be raised at G2).

## D24 — Synthesis conventions

- **Date:** 2026-09-26
- **Author:** `llm-integrator` (WP-09); appended by the orchestrator
- **Decision:**
  a. Lexical settings (comment and string markers, `fileMatchers`) are proposed by the model from the general Skill files and accepted only if every marker and every literal part of every glob occurs verbatim in the text sent.
  b. At most one rule per construct. The model never sets `id`, `type`, `sourceEvidence`, `tests`, `confidence` or `status`.
  c. A "not justified" answer ends the construct with no retry.
  d. A rejected rule keeps its last runnable pattern in the draft (`status: "rejected"`) and in `results.json`; the reasons are in `synthesis.json`.
  e. Review examples are excluded from prompts and from the pass counts in feedback; if a review example fails, only a count is sent (D16 g).
  f. `lsc compile` exits 0 (all validated), 2 (finished with a rejected, not-justified or skipped construct) or 1 (no usable result). Infrastructure errors abort the compile and mark the remaining constructs `not-attempted`.
  g. The draft Rule Set `version` is `0.0.0-draft`; WP-10 assigns the real one.
- **Reason:** The plan gives no source for the lexical fields; the runner's pass/fail semantics; D8; D16 g; honest partial output.
- **Affects:** WP-07, WP-10, G4.

## D25 — Wave 3 review outcome: real run deferred, report extended before G2

- **Date:** 2026-09-26
- **Author:** orchestrator, recording the project owner's answers and orchestrator rulings
- **Decision:**
  1. **Owner:** WP-09 acceptance criterion 5 (manual real-provider run on toylang) is deferred to G4. The first real-provider run happens with the provider approved at G4, on toylang first, before any real-language input. G2 judges the report format using the hand-written replay, which must be labelled as such.
  2. **Owner:** before G2, `lsc compile` writes the report itself (Markdown and HTML) into `--out`. The report also shows: the lexical settings (comment and string markers, `fileMatchers`); each construct's outcome and reasons from `synthesis.json` (e.g. not justified, rejected, attempts); the provider, model and recording origin (hand-written or recorded); and the number of unreviewed sample matches in the verdict line.
  3. **Orchestrator ruling:** the WP-07 layout that puts unreviewed sample matches and provenance inside each rule section (instead of separate sections after the rules) is accepted as a recorded deviation; the global Provenance section keeps the Skill file hashes.
  4. **Orchestrator ruling (reviewer Q5):** `lsc report --skills-dir` warns when the current Skill file hashes differ from the Rule Set's `sourceSkills`.
  5. **For WP-10 (reviewer Q2):** export must drop `status: "rejected"` rules, and a draft Rule Set (`0.0.0-draft`) must never be delivered to Navigator.
- **Reason:** Owner answers after the wave 3 review; the reviewer judged the report sufficient for "do the rules pass their examples" but not yet for "should this Rule Set be trusted".
- **Affects:** WP-07, WP-09, WP-10, G2, G4. Still open for G4: reviewer Q1 (single-character markers pass the verbatim check trivially), Q3 (one rule per construct vs. constructs with several forms).
