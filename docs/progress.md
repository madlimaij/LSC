# Progress

| WP | Title | Owner | Depends on | Status |
| --- | --- | --- | --- | --- |
| WP-00 | Real-language inputs | project owner | — | not started |
| WP-01 | Skeleton and tooling | contract-architect | — | done (reviewed wave 1) |
| WP-02 | Rule Set contract | contract-architect | WP-01 | done (reviewed wave 1) |
| WP-03 | Example format + toylang | contract-architect | WP-02 | done (reviewed wave 1) |
| WP-04 | Rule engines | engine-builder | WP-02, WP-03 | review: changes required (round 1 fixes in progress) |
| WP-05 | Test runner | engine-builder | WP-04 | review: changes required (round 1 fixes in progress; one item awaits owner decision) |
| WP-06 | Skill ingestion | skill-ingester | WP-03 | review: changes required (round 1 fixes in progress) |
| WP-07 | Report + review CLI | report-builder | WP-05 | not started |
| WP-08 | Model provider layer | llm-integrator | WP-02 | done (reviewed wave 2) |
| WP-09 | Synthesis loop | llm-integrator | WP-05, WP-06, WP-08 | not started |
| WP-10 | Versioning and export | contract-architect | WP-07, WP-09 | not started |
| WP-11 | Real-language acceptance | orchestrator | WP-10, WP-00, G4 | not started |
| WP-12 | Extra engines (conditional) | engine-builder | WP-11 | not started |

Gates: G1 ☑ G2 ☐ G3 ☐ G4 ☐

## Completion notes

(Agents append below.)

### WP-01 — Project skeleton and tooling (`contract-architect`, 2026-09-24)

**What was built**
- Root config: `package.json` (ESM, `bin.lsc` → `bin/lsc.js`, scripts `build`/`typecheck`/`lint`/`test`, `prepare` builds `dist/` on `npm install`/`npm ci`), `package-lock.json`, `tsconfig.json` (strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, NodeNext), `tsconfig.build.json` (emits `src/` → `dist/`), `eslint.config.js` (flat config, typescript-eslint strict + stylistic), `vitest.config.ts`, `.gitignore`, `.nvmrc`.
- Dependencies: `zod` 4.6, `re2` 1.26, `yaml`, `commander` 15, `fast-glob`, `unified`, `remark-parse`, `@anthropic-ai/sdk`; dev: `typescript` 5.9, `vitest` 5, `eslint` 10, `tsx`, plus `typescript-eslint`, `@eslint/js`, `@types/node` (needed to lint and typecheck TypeScript).
- CLI bootstrap: `src/cli/index.ts` (`loadCommands`, `createProgram`, `run`, `isCommandFile`), `src/cli/command-module.ts` (`CommandModule` interface + validation), `src/cli/package-info.ts`, `src/cli/commands/version.ts`, `bin/lsc.js`.
- Folder READMEs stating owners: `src/{contract,examples,ingest,engines,runner,llm,synth,report,release,cli,cli/commands}`, `fixtures/toylang`, `fixtures/recordings`, `contract/`, `tests/`.
- Tests: `tests/cli/registry.test.ts`, `tests/cli/version.test.ts`, `tests/tooling/re2-smoke.test.ts`.
- `docs/DECISIONS.md`: D1–D9 copied from the plan; D10 added (Node.js minimum version). The `docs/progress.md` status table already existed and was left unchanged.

**Acceptance criteria**
- `npm run typecheck`, `npm run lint`, `npm test` pass on a fresh clone — **met**. Copied the tracked and untracked non-ignored files into an empty directory, ran `npm ci` (which also builds through `prepare`), then all three: typecheck clean, lint clean, `Test Files 3 passed (3), Tests 14 passed (14)`.
- `npx lsc version` prints the package version — **met**. In that fresh copy, `npx lsc version` printed `0.1.0`. Also covered by `tests/cli/version.test.ts` ("prints the package.json version", "prints the version through the TypeScript entry point in a child process").
- Adding a file to `src/cli/commands/` adds a command without editing any other file — **met**. `tests/cli/registry.test.ts` › "adding one file to src/cli/commands adds a command without editing any other file" copies the real `src/cli/` and `package.json` to a temp directory, adds only `commands/hello-world.ts`, imports the copied `index.ts`, and checks that `hello-world` is registered and runs. Other tests check sorted discovery, default-export modules, and loud failures (missing description/configure, non-kebab-case name, reserved `help`, duplicate names).
- `re2` installs and a smoke test runs one RE2 pattern — **met**. The native binding installed without errors on Node 22.22.2. `tests/tooling/re2-smoke.test.ts` compiles `^PROC\s+(?<name>…)`, checks the named group, and checks that RE2 rejects a backreference and a lookahead.

**Deviations from the brief**
1. **Node.js minimum is 22.22.2, not 20 (D10).** Node 20 has been end-of-life since 2026-04-30. The current `re2` (1.25+) requires `^22.22.2 || ^24.15.0 || >=26`, and `commander` 15 and `vitest` 5 need ≥22.12. `engines` is set to the `re2` range. This can be reversed by pinning older versions (listed in D10) if the owner requires Node 20.
2. **Extra dev dependencies:** `typescript-eslint`, `@eslint/js`, `@types/node`. ESLint cannot lint TypeScript without them.
3. **TypeScript is pinned to `~5.9.3`**, not the latest 7.x, because `typescript-eslint` 8 supports only `<6.1`.
4. **`prepare` script:** it builds `dist/` on `npm install`/`npm ci` so that `npx lsc` works right after a fresh clone. `bin/lsc.js` prints a clear error if `dist/` is missing.
5. **`tests/tooling/`** was added for the root-tooling smoke test (`re2`). It is owned by `contract-architect`, as recorded in `tests/README.md`.
6. **`vitest.config.ts` sets `ANTHROPIC_API_KEY` to an empty string** in the test environment. This guards against real provider calls (D7).

**Open questions**
- Is Node ≥22.22.2 acceptable to the project owner and to any CI that runs the compiler (D10)?
- Command files are imported every time `lsc` starts. That is fine at MVP size. Command authors should keep top-level code free of side effects (noted in `src/cli/commands/README.md`).

### WP-02 — Rule Set contract (`contract-architect`, 2026-09-24)

**What was built**
- `src/contract/`: `version.ts` (`CONTRACT_VERSION = '1.0.0'`, semver, supported range), `rule-types.ts` (`RULE_TYPES`, `CAPTURE_ROLES`, `RULE_TYPE_SPEC`), `schema.ts` (Zod schemas and inferred types; `RuleSchema` is a discriminated union on `engine`; all objects strict), `exact.ts` (exact-engine definition, `exactToRegex`), `regex-groups.ts` (named-group scanner), `validate.ts` (`validateRuleSet`, `validateRule`, `checkRule`, rule codes, `formatIssue`), `load.ts` (`loadRuleSetFile`), `json-schema.ts` + `export-json-schema.ts`, `index.ts`, README.
- `src/cli/commands/validate-ruleset.ts`: `lsc validate-ruleset <file> [--json]`. Output is one line per problem (`<JSON path>: [<rule code>] <message>`); exit code 1 when invalid.
- `contract/rule-set.schema.json` (generated, draft 2020-12), `contract/CONTRACT.md`, `contract/README.md`.
- `contract/fixtures/toylang.ruleset.json`: 8 rules, one per rule type, both engines, with `blockEnd` and `searchStrings`.
- `contract/fixtures/invalid/`: 23 files named `<rule>--<variant>.json` (13 cross-field/version, 10 structural).
- `package.json`: script `contract:export`; dev dependencies `ajv` ^8 and `ajv-formats` ^3 (the standard validator for the test).
- Tests in `tests/contract/`: `fixtures`, `json-schema`, `validate`, `exact`, `regex-groups`, `rule-types`, `validate-ruleset-cli`.
- `docs/DECISIONS.md`: D11–D14.

**Acceptance criteria**
- Valid fixture passes — **met**. `fixtures.test.ts` › "passes full validation"; `node bin/lsc.js validate-ruleset contract/fixtures/toylang.ruleset.json` → `OK: … valid Rule Set (contract 1.0.0, 8 rules)`.
- Each invalid fixture fails with an error naming the violated rule — **met**. `fixtures.test.ts` › "<file> fails only for the rule named in its file name" (23 cases): every issue's code equals the file-name prefix, and each non-`schema` fixture yields exactly one issue. "include at least one fixture per validation rule" fails if any rule code lacks a fixture.
- Each WP-02 cross-field rule has a fixture — **met**: `captures-required-roles--call-without-callee`, `capture-group-missing--regex-pattern` / `--exact-placeholder`, `block-end-type--on-call`, `re2-compile--lookahead` / `--block-end-backreference`, `duplicate-rule-id--two-rules-same-id`.
- A standard validator accepts the valid fixture and rejects the structurally invalid ones — **met**. `json-schema.test.ts` uses Ajv 2020 (strict mode) with ajv-formats: "accepts the valid fixture", "rejects structurally invalid …" (12 cases), plus "accepts cross-field fixture … (needs lsc validate-ruleset)" (11 cases), which shows the JSON Schema gap that CONTRACT.md §5.2 documents.
- Schema generated by `npm run contract:export`, committed, checked for staleness — **met**. `json-schema.test.ts` › "is up to date with the Zod schema".
- `contractVersion` is `1.0.0` — **met**. `fixtures.test.ts` › "uses contractVersion 1.0.0".
- `branch_marker` / `exit` absent (D1) — **met**. `rule-types.test.ts` › "does not contain branch_marker or exit (D1)"; fixtures `schema--rule-type-branch-marker`, `schema--rule-type-exit`.
- `RULE_TYPE_SPEC` matches plan §5.3 — **met**. `rule-types.test.ts` › "matches the mapping table in the plan".
- CLI errors are readable (JSON path + message) — **met**. `validate-ruleset-cli.test.ts` (4 tests: valid, invalid text output, `--json`, missing file / broken JSON).
- `npm run typecheck`, `npm run lint`, `npm test` pass — **met**. Typecheck and lint are clean; `Test Files 10 passed (10), Tests 99 passed (99)`. `npm run build` succeeds, and `node bin/lsc.js validate-ruleset` works from `dist/`.

**Deviations from the brief and why**
1. **Placeholders in exact tokens (D11).** The plan gives exact rules no way to capture, yet every rule type requires a capture role and "group names must exist in the pattern". Without a capture mechanism no exact rule could ever be valid. I added placeholder tokens `(?<name>)`, defined exact rules as an equivalent RE2 regex (CONTRACT.md §6.4), and added rule `exact-tokens`. **Please confirm at G1.**
2. **Matching semantics written into the contract (D13).** Masking, the per-line/whole-text regex behaviour, the exact engine, `blockEnd` scopes and the `fileMatchers` glob subset are specified in CONTRACT.md §6. Navigator runs the rules itself, so these must be frozen at G1 rather than left to WP-04. WP-04 must implement §6 as written.
3. **Extra validation rules (D14):** `capture-role-not-allowed`, `named-group-syntax`, `exact-tokens`, `contract-version`. Regex `flags` are limited to `^i?m?s?$`. Each has a fixture.
4. **Compatibility policy (D12):** objects are closed; a 1.0 consumer rejects `contractVersion` 1.1+ as well as other majors; `compiledAt` must be UTC `Z`; the JSON Schema targets draft 2020-12.
5. **Interpretations of "strings/pairs":** `lineComment` is a string, `blockComment` is `{start,end}`, and `stringDelimiters` is an array of `{start,end}`. Constraints stricter than the plan's bare types: `fileMatchers` needs at least one entry, `sourceEvidence` at least one entry, `languageId` has no whitespace, `sha256` is 64 lowercase hex characters.
6. **New dev dependencies `ajv`, `ajv-formats`.** The brief asks for "a standard validator in the test". The only Ajv present was v6, pulled in transitively by eslint, which lacks draft 2020-12 support. I own root config (docs/ORCHESTRATION.md §2) and Wave 1 is sequential, so I added them directly instead of filing a request.
7. **Edited `tests/cli/registry.test.ts` (WP-01, mine).** Its temp copy contained only `src/cli/`, so it broke once a real command imported another module. It now copies all of `src/` and compares against the real command list plus `hello-world`. Without this fix every later command (WP-05, WP-07, …) would have broken it.
8. **Placeholders in the fixture.** `sourceSkills` hashes, Skill paths, anchors and example ids in `toylang.ruleset.json` are placeholders. The comment markers (`--`, `/* */`) and `"` strings are assumed. WP-03 aligns all of these with the real toylang files.

**Open questions** (also in contract/CONTRACT.md §9)
- Q1: Accept the exact-engine placeholder design (D11)? The placeholder matches only `[0-9A-Za-z_]+`, so identifiers with other characters need regex rules.
- Q2: How does `symbol_definition` choose between Navigator kinds `function` and `procedure`? (Proposal: map from the `kind` capture, default `procedure`.)
- Q3: What happens when a required capture is missing or empty in a match? (Proposal: an uncertainty record instead of a normal record.) What counts as "ambiguous captures" (plan §5.3)?
- Q4: Do the real language's string literals have escapes? 1.0 has none.
- Q5: Should a definition without `blockEnd` (e.g. a file-level `MODULE`) enclose the rest of the file? In 1.0 it opens no scope.
- Q6: Multiple line/block comment markers? The plan's single-value fields cannot express them.
- Q7: Source file encoding (UTF-8 assumed).
- Q8: Should consumers reject newer minor contract versions (current policy) or skip unknown rule types and fields?

### WP-03 — Example format and the toylang fixture language (`contract-architect`, 2026-09-24)

**What was built**
- `src/examples/`: `schema.ts` (`ExampleSchema` and type, `ExpectedMatchSchema`, source union `inline`/`sidecar`/`review`, `normalizeCode`, `codeLineCount`, `compareExamples`, `exampleRuleType`), `build.ts` (`buildExample`, `parseExpectBlock` for WP-06's inline `yaml expect` blocks, `SidecarExpectSchema`), `sidecar.ts` (`loadSidecarExamples`), `reviews.ts` (`ReviewEntrySchema`, `loadReviews`, `parseReviews`, `stringifyReviews`), `yaml-file.ts` (YAML parsing with line numbers), `errors.ts` (`ExampleLoadError`, `formatLoadError`), `locations.ts` (`exampleLocations`), `index.ts`, and `README.md`, the format reference for WP-05/06/07/09.
- `fixtures/toylang/`: `SPEC.md` (language, labelling conventions, example counts, trap table T1–T20 with covering examples, sample-only traps S1–S14, fixture Rule Set notes), `skills/` (8 construct Skill files + `language-basics.md`; 34 inline examples), `examples/` (40 sidecar examples in 8 construct directories), `sample-repo/` (20 `.tl` files + `docs/notes.txt`), `.gitattributes` (keeps CRLF in `sample-repo/legacy/dos_export.tl`), README.
- `contract/fixtures/toylang.ruleset.json`: aligned with final toylang (real Skill hashes, anchors, example ids; rule changes listed in D15 item 7). Still 8 rules, both engines, `blockEnd`, `searchStrings`; now also a whole-text regex.
- Tests in `tests/examples/`: `schema.test.ts`, `sidecar.test.ts`, `reviews.test.ts`, `toylang.test.ts`, and fixtures `tests/examples/fixtures/sidecar/<case>/` (29 directories) and `fixtures/reviews/<case>.yaml` (16 files).
- `docs/DECISIONS.md`: D15.

**Acceptance criteria**
- Loaders produce valid `Example` records from sidecars and `reviews.yaml` — **met**. `sidecar.test.ts` › "produces complete Example records"; `reviews.test.ts` › "turns verdict false_positive into a negative example", "turns verdict correct into a positive example …"; `toylang.test.ts` › "all sidecar examples load without errors" (40 examples). `stringifyReviews` output loads back to the same entries ("writes a file that loads back to the same entries and examples"), which WP-07 needs.
- Malformed files give readable errors — **met**. Each malformed fixture has a test asserting the exact `file:line: field: message` output: 27 sidecar cases (`sidecar.test.ts` › "malformed files give readable errors", e.g. `call/call-01.expect.yaml:5: expected[0].captures: type "call" requires capture "callee"`), 11 reviews cases plus 2 partial-load cases (`reviews.test.ts`), 18 schema invariant cases (`schema.test.ts` › "rejects: …"). "Every fixture directory/file is checked by a test" fails if someone adds a fixture without an assertion.
- Every rule type in the contract has toylang positive and negative examples — **met**. `toylang.test.ts` › "every rule type in the contract has positive and negative examples" and "every construct has at least 5 positive and 2 negative examples": 6–7 positive and 3 negative per construct, 74 examples in total (inline + sidecar).
- `SPEC.md` lists every trap and which example covers it — **met**. SPEC §6 (T1–T20) and §7 (S1–S14). `toylang.test.ts` › "lists every trap with at least one existing covering example (§6)", "covers the traps named in WP-03", "every sample-repo location in §7 exists".
- Fixture Rule Set aligned with toylang — **met** for what can be checked now. `toylang.test.ts` › "sourceSkills lists every Skill file with its current SHA-256", "each rule cites an existing Skill heading and exactly the examples of one construct of its type"; `node bin/lsc.js validate-ruleset contract/fixtures/toylang.ruleset.json` → OK, 8 rules. I also checked that it matches: a throwaway implementation of CONTRACT.md §6 (masking, exact-as-regex, per-line/whole-text RE2), kept in my scratchpad and not committed, ran the fixture on all 74 examples: every positive matched exactly, and no rule matched any negative of any construct (0 failures). WP-05 repeats this with the real runner.
- `npm run typecheck`, `npm run lint`, `npm test` — **met**. All clean; `Test Files 14 passed (14), Tests 204 passed (204)`. `npm run build` succeeds.

**Deviations from the brief and why**
1. **Fixture Rule Set rules changed, not only renamed** (D15 item 7). Final toylang needed `module` on calls (`CALL billing.apply_discount`), `kind` on definitions (`PROC`/`FUNC`), and a whole-text `db-read` rule for reads continued right after the keyword. So that both engines stay covered, `module-declaration` and `entry-point` became `exact`. This happened before G1, so there is no contract version change. Navigator should use the new file.
2. **Extra Skill file `language-basics.md`** with no examples (comments, strings, continuation, case). Real teams document these once, and WP-09 needs them to choose masking fields. It is listed in `sourceSkills`.
3. **Beyond the plan's record:** role-keyed captures, one rule type per example, and loader error/partial-load behaviour. These are specified in D15 and `src/examples/README.md`.
4. **The sample repository has one false positive (S2) and one miss (S3) on purpose** for the fixture Rule Set, so the review flow has a real finding. WP-05/07 should not "fix" them in the fixture.

**Open questions**
- **Review examples vs. plan §8 (needs owner decision).** `reviews.yaml` stores repository-sample snippets as example code (D9), but plan §8 says no repository-sample file is ever sent to the model. If WP-09 puts review examples into prompts, sample code reaches the provider. Proposal: WP-09 uses `source.kind === 'review'` examples only in the runner, never in prompts (written in `src/examples/README.md` §4). Please confirm at G1.
- **Negatives must contain no match of any construct** (a consequence of plan §8 step 4 and §6.2). The toylang examples obey this, but it rules out "look-alike" negatives that contain another construct (e.g. a `CALL WRITE_LOG()` line as a `db-write` negative). If the owner wants such negatives, the runner would have to apply cross-construct negatives only to rules of other types, or check only the rule under test. That is WP-05's semantics, not a format change.
- **`tests.passed` in the fixture** counts the construct's own examples (9–10). If WP-05 also counts cross-construct negatives, the fixture numbers must be updated. They are informational and not validated.
- **How a construct's rule type is known.** It is inferred from the positive examples' `expected[].type`. Skill files carry no explicit construct → rule type field. WP-06's `ruleTypeHint` can use `exampleRuleType`.
- **Real language, for WP-00:** whether review snippets should be one line or more, and whether example ids from the real team follow kebab-case. The loaders reject other id styles today.

### WP-02 follow-up: invalid fixtures re-derived (`contract-architect`, 2026-09-25)

**What was built**
- `contract/fixtures/invalid/*.json` (all 23 files): re-derived from the current `contract/fixtures/toylang.ruleset.json` (the WP-03 version). Each file is the valid fixture with one mutation, serialized with 2-space JSON like the valid fixture. File names, rule coverage and the rule each file breaks are unchanged.
- `tests/contract/helpers.ts`: `differingPaths(a, b)` lists the JSON Pointer paths where two JSON values differ. Objects, and arrays that contain objects, are compared member by member. Scalars and arrays of scalars (e.g. `exact.tokens`) count as one place. An added or removed member counts as one place.
- `tests/contract/fixtures.test.ts`: new test "`<file>` differs from the current valid fixture in exactly one place". It runs for every invalid fixture, the structural `schema--`/`contract-version--` ones included, because all of them can be made single-place. There is also a unit test for `differingPaths`. The comment at the old line 58 now points to this test.
- No change to `src/contract/`, `contract/rule-set.schema.json`, `contract/CONTRACT.md` or `contractVersion` (still 1.0.0).

**Acceptance criteria**
- Every invalid fixture differs from the current valid fixture in exactly one place — **met**. `fixtures.test.ts` › "%s differs from the current valid fixture in exactly one place" (23 cases pass). Against the WP-02 valid fixture the same comparison gives up to 76 differing paths per file, so the test would have caught the drift.
- Each fixture still fails only for the rule named in its file name — **met**. `fixtures.test.ts` › "%s fails only for the rule named in its file name" (cross-field ones: exactly one issue). `json-schema.test.ts` still shows structural fixtures rejected and cross-field fixtures accepted by the exported JSON Schema.
- CLI tests that name specific fixtures still hold: `$.rules[2].captures` for `captures-required-roles--call-without-callee.json` and `$.rules[5].id` for `duplicate-rule-id--two-rules-same-id.json` (`validate-ruleset-cli.test.ts`).
- `npm run typecheck`, `npm run lint`, `npm test` — **met**. All clean; `Test Files 14 passed (14), Tests 228 passed (228)`.

**Deviations from the brief and why**
- Some mutations had to target different rules or use a different single edit, because WP-03 changed the rules in the valid fixture:
  - `call-statement` is now `regex`, so the exact-engine cases moved. `capture-group-missing--exact-placeholder` now targets `entry-point` (rules[7]). `exact-tokens--*` and `schema--exact-token-with-space` now target `module-declaration` (rules[0]).
  - Two old fixtures made a two-place edit and now make a one-place edit that breaks the same rule. `schema--engine-config-mismatch` changes `engine` to `exact` on `db-read` instead of swapping the config blocks. `schema--unknown-field` adds a misspelled `blockend` key next to `blockEnd` instead of renaming the key.
- Every JSON file was rewritten in full, so the git diff shows whole-file churn even though each file's content differs from the valid fixture in one place only.

**Open questions**
- None for the contract. Navigator should take the new `contract/fixtures/invalid/` files together with the current valid fixture. The file names are unchanged.

### WP-08: Model provider layer (`llm-integrator`, 2026-09-25)

*(Appended by the orchestrator from the agent's final message; parallel wave.)*

**What was built:** `src/llm/` — `types.ts` (`LlmProvider`), `errors.ts` (typed errors), `request.ts` (request schema, `requestHash`), `config.ts` (`lsc.config.json` schema, `loadConfig`), `budget.ts` (`TokenBudget`), `snippet-log.ts` (per-run JSONL log), `guarded.ts` (`GuardedProvider`: validate → budget → call → log), `anthropic.ts` (`AnthropicProvider`, injectable client factory), `fake.ts` (`FakeProvider`), `recordings.ts` (recording format), `recording-provider.ts`, `structured.ts` (`structured`, `parseStructured`, `extractJson`), `factory.ts` (`createProvider`, `createSession`), `index.ts`, `README.md`. `fixtures/recordings/wp08/` (8 hand-written toylang recordings) and `fixtures/recordings/README.md`. Tests in `tests/llm/` (8 files, 69 tests).

**Acceptance criteria**
- All tests use `FakeProvider`; constructing the Anthropic client under `npm test` fails — **met** (`anthropic.test.ts › constructing the real Anthropic client during npm test throws`; `› only src/llm/anthropic.ts imports the Anthropic SDK`).
- Budget exhaustion tested — **met** (`budget.test.ts › stops the run with a clear error when the per-compile budget is exceeded`, `› throws after a call whose actual usage pushes the run over the cap`, `› refuses a request above the per-call output cap without sending it`).
- Invalid JSON tested — **met** (`structured.test.ts › invalid JSON is a typed error, not a repaired value`, plus `no_json`, `schema`, `truncated`, `ambiguous_json`, `stopped`).
- Every request appears in the snippet log — **met** (`snippet-log.test.ts › records every request of a run, including failed and refused ones, with full text and usage`).
- typecheck/lint/test — `npm run typecheck` clean; `eslint src/llm tests/llm` clean; `vitest run tests/llm` 69/69. Repo-wide lint/test failures at hand-back were all in WP-04's in-progress files; to be re-run when WP-04 lands.

**Deviations:** (1) API key only from the env var named in `provider.apiKeyEnv`; a key in the file is rejected; `provider.model` required. (2) Recording hash covers `system` + `messages` only (not `maxOutputTokens`, provider, model). (3) Budgets refuse, never shrink; pre-call check `used + maxOutputTokens ≤ total`, post-call overrun is logged then throws. (4) WP-08 recordings are hand-written (`origin: "hand-written"`); real toylang recording belongs to WP-09. (5) Malformed requests are not logged (never sent); refused and failed calls are. (6) `structured()` throws on infrastructure errors; accepts only whole-text JSON or exactly one `json`/unlabelled fence, no repair.

**Open questions:** (a) Should `lsc compile` refuse recording mode when `LSC_REAL_INPUTS` is set or inputs are outside `fixtures/toylang`? (b) Should `provider.baseUrl` be mandatory so the endpoint is explicit for the G4 policy check (SDK otherwise falls back to `ANTHROPIC_BASE_URL`)? (c) Should the snippet log keep `responseText`, or only what was sent? No new dependencies needed.

### WP-06: Skill ingestion (`skill-ingester`, 2026-09-25)

*(Appended by the orchestrator from the agent's final message; parallel wave.)*

**What was built:** `src/ingest/` — `markdown.ts` (unified + remark-parse wrapper; no regex over Markdown), `slug.ts` (`slugify`, `SlugCounter`), `info-string.ts` (`parseInfoString`), `hash.ts` (`sha256Hex`), `inline.ts` (`extractInline`), `construct.ts` (`Construct`, `sectionText`, `truncateProse`, `ruleTypeHintOf`, `compareConstructs`), `diagnostics.ts` (re-exports the `src/examples` error shape), `ingest.ts` (`ingestSkills`: discover, hash, merge inline + sidecar + `reviews.yaml` by construct, cross-source id dedup), `index.ts`, `README.md`. `src/cli/commands/ingest.ts` (`lsc ingest <skills-dir> [--json] [--prose-limit <chars>]`). Tests in `tests/ingest/` (5 files, 39 tests) with 8 fixture directories.

**Acceptance criteria**
- All toylang Skill files ingest with zero errors and expected counts — **met** (`ingest.test.ts › ingestSkills: toylang (acceptance criterion 1)`: 0 diagnostics, 9 files hashed, 8 constructs with the plan §5.3 `ruleTypeHint`, ≥5 positive / ≥2 negative each).
- Each diagnostic has a triggering fixture — **met** (`ingest.test.ts › diagnostics have a triggering fixture each`, 7 fixtures, exact text and line asserted).
- Changing one character changes the hash and nothing else — **met** (`ingest.test.ts › ingestSkills: hashing`).
- typecheck/lint/test — clean on all WP-06 files (`eslint src/ingest tests/ingest src/cli/commands/ingest.ts` clean, `vitest run tests/ingest` 39/39, orchestrator re-ran). Repo-wide typecheck errors at hand-back were only in WP-04's in-progress `src/engines/masking.ts`.

**Deviations:** (1) Sub-headings such as `### Traps` are folded into the parent construct's section (prose and anchor). (2) Extra diagnostic: positive examples disagree on rule type. (3) `lsc ingest` adds `--json` and `--prose-limit`.

**Open questions:** Proposed DECISIONS entry recorded as D18. No new dependencies.

### WP-04: Rule engines (`engine-builder`, 2026-09-25)

*(Appended by the orchestrator from the agent's final message; parallel wave.)*

**What was built:** `src/engines/` — `lines.ts` (line endings, splitting, offset→line/column, CONTRACT.md §6.2), `masking.ts` (`maskText`, full and comment-only masks per §6.3), `prepare.ts` (`prepareFile`), `regex-run.ts` (`runRegexPerLine`, `runRegexWholeText`; RE2 compiled once per rule), `match-rule.ts` (`matchRule`, `matchBlockEnd`; exact engine via `exactToRegex` from `src/contract`), `blocks.ts` (`scanFile`: `blockEnd` scopes per D4/§6.6, `enclosingSymbol`, `unmatched-block-end`/`unclosed-block` warnings), `mapping.ts` (`mapMatches` → Navigator-shaped records via `RULE_TYPE_SPEC`), `types.ts`, `index.ts`, `README.md`. Tests: `tests/engines/{lines,masking,match-rule,blocks,mapping,edge-cases,performance,toylang-snapshot}.test.ts`, fixture `tests/engines/fixtures/billing.tl`, snapshot `tests/engines/__snapshots__/toylang-snapshot.test.ts.snap`.

**Acceptance criteria**
- Engine interface `match(rule, preparedFile) -> Match[]` — **met** (`match-rule.test.ts`).
- Exact engine (tokens, `caseSensitive`) — **met** (`match-rule.test.ts` "exact engine").
- Regex engine: RE2 only, per-line default, whole-text with `multiline: true`, correct lines — **met** (`match-rule.test.ts` "regex engine"; only `re2` used, D3).
- Masking keeps lines and columns — **met** (`masking.test.ts`; `match-rule.test.ts` "columns and lines stay exact after masking").
- Block tracking, nested and unclosed (warnings, not errors) — **met** (`blocks.test.ts`, `edge-cases.test.ts`).
- Mapping via `RULE_TYPE_SPEC`, low confidence also yields an uncertainty — **met** (`mapping.test.ts`).
- Performance guard, 50,000-line file — **met** (`performance.test.ts`; ~1.3 s measured, asserts < 5 s).
- Keyword inside comment or string never matches — **met** (`masking.test.ts`, `match-rule.test.ts`, `toylang-snapshot.test.ts`).
- Mapping output for a full toylang file matches a committed snapshot — **met** (`toylang-snapshot.test.ts`).
- typecheck/lint/test — **met** repo-wide (orchestrator re-ran: 35 files, 386 tests, lint clean). This also completes the repo-wide checks for WP-06 and WP-08.

**Deviations:** (1) RE2 pattern compiled once per rule and reused across lines (per-line compilation took ~15 s on the guard file). (2) `fileMatchers` glob selection (CONTRACT.md §6.1) is not in `src/engines/`; left to `src/runner/` (WP-05). (3) Navigator's `NormalizedFileAnalysis` is not defined in the contract, so `NavigatorAnalysis` and per-record types are defined in `src/engines/mapping.ts` from CONTRACT.md §4.

**Open questions:** (a) CONTRACT.md §9 Q2 implemented as proposed: `kind` capture starting with `func` → `function`, else `procedure`. (b) New: a relation/db-access/config-ref match with no open definition scope (e.g. module-level `INCLUDE` when `module_declaration` has no `blockEnd`, as in the toylang fixture) produces no primary record, only an uncertainty `missing-source-symbol`. Related to §9 Q3 and Q5; should be added to CONTRACT.md §9 by `contract-architect`.

### WP-05: Test runner (`engine-builder`, 2026-09-25)

**What was built:** `src/runner/` — `glob.ts` (`matchesGlob`/`matchesAnyGlob`: `fileMatchers` selection per contract/CONTRACT.md §6.1, translated to an RE2 pattern, D3), `confidence.ts` (`computeConfidence`, the fixed formula from docs/PLAN.md §6.3/D8, exported for WP-09/WP-10), `compare.ts` (`diffExample`: pairs one rule's matches on one example against its expected matches per plan §6.2, producing `missed`/`unexpected`/`wrongCaptures`), `coverage.ts` (`computeCoverage`: rule types with a validated rule, constructs below the high-confidence example threshold), `rule-run.ts` (`ownExampleIdsOf`, `runRuleAgainstExamples`: runs one rule against its own `sourceEvidence` examples plus every negative example of every other construct — "cross-construct negatives", plan §8 step 4), `sample-run.ts` (`scanSampleFiles`: `fileMatchers`-filtered `scanFile` over repository-sample files, ±3-line snippets, excludes matches already recorded in `reviews.yaml` via D9's `source.kind === 'review'`), `results-schema.ts` (Zod `ResultsSchema` and every nested schema; WP-07/WP-09 import types from here), `index.ts` (`runRules(ruleSet, examples, sampleFiles?, options?) → Results`, the public API), `README.md`. `src/cli/commands/test.ts`: `lsc test <ruleset> <skills-dir> [--sample <dir>] [--out <file>]`. Tests: `tests/runner/{glob,confidence,compare,coverage,rule-run,sample-run,toylang-acceptance,broken-ruleset,no-network}.test.ts`, `tests/cli/test-cmd.test.ts` (10 files, 62 tests).

**Acceptance criteria**
- The toylang fixture Rule Set passes all toylang examples — **met**. `tests/runner/toylang-acceptance.test.ts` › "passes every example (positive and negative, inline and sidecar), for every rule": all 74 examples (fixtures/toylang/SPEC.md §5) load with zero ingestion diagnostics, every rule's `tests.failed` is 0, `results.ok` is `true`; also confirmed via the built CLI (`node bin/lsc.js test contract/fixtures/toylang.ruleset.json fixtures/toylang/skills` → `OK: every rule passed its examples`, all 8 rules `PASS`). Every rule also reaches computed confidence `high` (`toylang-acceptance.test.ts` › "every rule reaches high computed confidence…") and every construct clears the coverage threshold ("every construct has enough examples for the high coverage threshold"). Against the sample repository, the runner reproduces exactly the documented traps: S11 (`docs/notes.txt` not scanned, `fileMatchers`), S2 (the deliberate false positive: a second `db_read` of table `LET` on `customers/messages.tl:4`), S3 (the deliberate miss: the continued `CALL` on `batch/nightly.tl:6` absent from `call-statement`'s sample matches), S7/S8 (the two block-tracking warnings), S10 (the CRLF file scans the same as LF) — `toylang-acceptance.test.ts` describe block "…against the sample repository (SPEC.md §7)".
  - **Discrepancy to report, per the orchestrator's wave-1 note:** the fixture's per-rule `tests.passed` (9 or 10, matching `SPEC.md §8`: "counts the construct's own examples") does not match this runner's convention, which also counts cross-construct negatives (plan §8 step 4 and this WP's acceptance criterion "apply every rule to every negative example of every construct"). With cross-negatives included, each rule's `tests.passed` is the construct's own count plus 21 more (3 negatives × 7 other constructs), e.g. `module-declaration`: 9 → 30 (measured, see the acceptance test's confidence check). This is informational only — the static fixture file was not edited (frozen, contract-architect-owned) — but `contract-architect` may want to update `SPEC.md §8`'s wording or the fixture's `tests` fields to match, or record the convention as a `docs/DECISIONS.md` entry.
- A deliberately broken copy of the fixture produces the expected misses, false positives and wrong-capture entries — **met**. `tests/runner/broken-ruleset.test.ts` (3 cases, each a single-field mutation of a clone of the real fixture, with every other rule asserted still fully passing): (1) `db-read.regex.multiline` `true`→`false` breaks trap T8 (statement continued right after the keyword) and produces exactly one missed match on `read-03`; (2) loosening `db-write.regex.pattern` (dropping the leading `\b`, `\s+`→`\s*`) produces two unexpected (false-positive) matches inside the identifiers of trap-T4 negative example `write-neg-01` (`REWRITE_count`, `write_mode`); (3) swapping `proc-definition`'s `name`/`kind` capture mapping produces a `wrongCaptures` entry on every proc-definition example (checked on `proc-01`: expected `{name: calc_total, kind: PROC}`, actual `{name: PROC, kind: calc_total}`). `tests/cli/test-cmd.test.ts` › "a Rule Set that fails an example exits with code 1…" repeats mutation (1) through the CLI end to end.
- The run makes no network calls — **met**. `tests/runner/no-network.test.ts`: every `.ts` file in `src/runner/` and `src/cli/commands/test.ts` is checked to contain no import from `src/llm` (static check), and `runRules` is additionally run against the full toylang fixture with `fetch` stubbed to throw (dynamic check), confirming it still returns `ok: true`.
- `npm run typecheck`, `npm run lint`, `npm test` — **met**. All clean; `Test Files 45 passed (45), Tests 448 passed (448)` repo-wide (up from 386 before this WP). `npm run build` succeeds; `node bin/lsc.js test …` works from `dist/`.

**Deviations from the brief and why**
1. **`fileMatchers` glob matching implemented here (`src/runner/glob.ts`), as WP-04's completion note flagged.** Not in `src/engines/`; translated to an RE2 pattern (`^`/`$`-anchored, `**`, `*`, `?` per contract/CONTRACT.md §6.1) and run under RE2, consistent with D3, rather than the JavaScript `RegExp` engine or a `fast-glob`/`micromatch` dependency (none installed; adding one felt unnecessary for three glob primitives).
2. **A rule's "own" examples are read from `sourceEvidence[].exampleIds`, not from a `construct` field on the rule (the contract has none).** "Cross-construct negatives" are therefore implemented as: every negative example in the full example set that is not already one of the rule's own examples. This matches the WP-05 acceptance wording ("apply every rule to every negative example of every construct") without requiring a new contract field. A `sourceEvidence` id that resolves to no loaded example is reported per rule as `missingExampleIds`, not silently dropped.
3. **`tests.passed`/`tests.failed` convention (flagged as open by WP-03/WP-04's completion notes and the orchestrator's wave-1 note): counts every example tested against the rule, including cross-construct negatives, not just the rule's own examples.** See the discrepancy note above; the toylang fixture's static `tests` numbers were not changed (frozen file, not this WP's to edit).
4. **Per-example testing calls `matchRule` directly, not `scanFile`.** `blockEnd`/`enclosingSymbol` are irrelevant to whether one example's expected captures (`name`, `kind`, `callee`, `table`, …) are matched — `enclosingSymbol` is not an expected-match field — so per-example runs do not need block tracking; only the repository-sample scan uses `scanFile` (all validated rules together, so scopes and warnings behave as in real usage).
5. **Repository-sample matches already present in `reviews.yaml` are excluded from `sampleMatches`.** Read from `Example`s whose `source.kind === 'review'` (already loaded via `ingestSkills`/`loadReviews`, no new file access), keyed by `(ruleId, sampleFile, sampleLine)`. Not explicitly required by the brief, but implied by D9 ("feeds the next compile") — without it, a reviewed false positive would be reported again on every subsequent `lsc test` run. Toylang's `reviews.yaml` does not exist yet (WP-03's completion note), so this path is exercised only by `tests/runner/sample-run.test.ts`, not the toylang acceptance test.
6. **`Results` includes `compilerVersion`** (read via `getPackageInfo()` in the CLI, defaults to `"0.0.0-dev"` in `runRules` when not supplied), not listed in the WP-05 brief's deliverable bullet list, because WP-07/WP-09/WP-10 consumers are likely to want to know which compiler build produced a given `results.json`; easy to drop if unwanted.
7. **`lsc test`'s example loading reuses `ingestSkills` (`src/ingest`, WP-06) rather than re-implementing Skill/sidecar/review merging in `src/cli/commands/test.ts`.** WP-06 was already complete when this WP started (docs/progress.md). `src/runner/` itself takes a plain `Example[]` and does not import `src/ingest`, so the runner stays independent of how examples are gathered.

**Open questions**
- Should `contract-architect` update `fixtures/toylang/SPEC.md` §8 and/or the fixture's per-rule `tests.passed`/`tests.failed` to reflect the cross-construct-negative counting convention (deviation 3), or record the convention in `docs/DECISIONS.md` instead? The runner's own acceptance test (`toylang-acceptance.test.ts`) is the source of truth either way; this only affects the static JSON file and `SPEC.md`'s prose.
- `contract/CONTRACT.md` and `docs/PLAN.md` do not say whether a rule's cross-construct negatives should include negatives from *every* other construct or only from constructs not already covered by its own `sourceEvidence` (deviation 2's reading: every negative example not already "own"). With one rule per type in the toylang fixture, both readings coincide; a future Rule Set with two rules of the same type could differ. Left to `contract-architect`/`llm-integrator` to confirm before WP-09.
- No new dependencies needed (RE2 was already a dependency, from WP-01/WP-04).
