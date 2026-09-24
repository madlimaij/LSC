# Language Skill Compiler (`lsc`)

Standalone Node.js + TypeScript tool that compiles language documentation ("Skill files") and labelled code examples into a versioned, deterministic Rule Set (JSON) consumed by Legacy Navigator's CustomLanguageAdapter. The LLM (large language model) is used only while compiling rules, never for routine scanning.

## Source of truth

1. `docs/PLAN.md` — scope, decisions (D1–D9), contract, module design
2. `docs/ORCHESTRATION.md` — who owns what, build order, gates
3. `docs/work-packages/WP-xx.md` — the brief for the current task
4. `docs/DECISIONS.md` — decisions made during the build (append-only)

If these disagree, stop and report the conflict instead of choosing.

## Rules for every agent

- Read `docs/PLAN.md` and your work package before writing anything.
- Write only inside the folders your work package owns (see `docs/ORCHESTRATION.md`). Reading anything is fine.
- `src/contract/` is frozen after Gate G1. Only the `contract-architect` may change it, only with a contract version bump and a `docs/DECISIONS.md` entry.
- Tests never call a real model provider. Use `FakeProvider` (WP-08) with recorded responses.
- Until Gate G4, fixtures use only the synthetic language `toylang` (`fixtures/toylang/`). Never add employer code to the repository.
- Do not invent behaviour of the real custom language. If something is unknown, record it in the completion note as an open question.
- Prefer the simplest mechanism: exact match → regex → token matcher → state machine.
- A work package is done only when `npm run typecheck`, `npm run lint` and `npm test` pass and a completion note is appended to `docs/progress.md` with this structure:
  - WP id and agent
  - What was built (files)
  - Acceptance criteria: each marked met / not met with evidence (test name or command output)
  - Deviations from the brief and why
  - Open questions

## Orchestrator role (main session)

The main session is the orchestrator. It does not write product code. It:
- dispatches work packages to subagents wave by wave, in parallel within a wave where `docs/ORCHESTRATION.md` allows;
- passes each subagent the full path of its work package and nothing it can read itself;
- runs the `reviewer` subagent after each wave;
- stops at human gates G1–G4 and asks the project owner a short, explicit question;
- keeps `docs/progress.md` status table current.

## Commands

- `npm run build` / `npm run typecheck` / `npm run lint` / `npm test`
- CLI (command-line interface): `npx lsc <command>` — see `docs/PLAN.md` §7
