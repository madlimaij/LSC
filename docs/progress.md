# Progress

| WP | Title | Owner | Depends on | Status |
| --- | --- | --- | --- | --- |
| WP-00 | Real-language inputs | project owner | — | not started |
| WP-01 | Skeleton and tooling | contract-architect | — | done (awaiting wave 1 review) |
| WP-02 | Rule Set contract | contract-architect | WP-01 | in progress |
| WP-03 | Example format + toylang | contract-architect | WP-02 | not started |
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
