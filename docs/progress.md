# Progress

| WP | Title | Owner | Depends on | Status |
| --- | --- | --- | --- | --- |
| WP-00 | Real-language inputs | project owner | — | not started |
| WP-01 | Skeleton and tooling | contract-architect | — | done (awaiting wave 1 review) |
| WP-02 | Rule Set contract | contract-architect | WP-01 | done (awaiting wave 1 review) |
| WP-03 | Example format + toylang | contract-architect | WP-02 | in progress |
| WP-04 | Rule engines | engine-builder | WP-02, WP-03 | not started |
| WP-05 | Test runner | engine-builder | WP-04 | not started |
| WP-06 | Skill ingestion | skill-ingester | WP-03 | not started |
| WP-07 | Report + review CLI | report-builder | WP-05 | not started |
| WP-08 | Model provider layer | llm-integrator | WP-02 | not started |
| WP-09 | Synthesis loop | llm-integrator | WP-05, WP-06, WP-08 | not started |
| WP-10 | Versioning and export | contract-architect | WP-07, WP-09 | not started |
| WP-11 | Real-language acceptance | orchestrator | WP-10, WP-00, G4 | not started |
| WP-12 | Extra engines (conditional) | engine-builder | WP-11 | not started |

Gates: G1 ☐ G2 ☐ G3 ☐ G4 ☐

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
