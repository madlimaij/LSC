# Orchestration

## Summary

The main Claude Code session acts as orchestrator and never writes product code. Six subagents do the work: five builders, each owning specific folders, and one read-only reviewer. The work runs in five waves. The contract is built first by a single agent and frozen at a human gate, because every later package depends on it. After that, independent packages run in parallel. Each wave ends with a reviewer check, and four human gates (G1–G4) stop the build where a decision belongs to the project owner.

## 1. Agent roster

| Agent | Model | Why this model | Work packages |
| --- | --- | --- | --- |
| `contract-architect` | opus | Shared contract and versioning rules are costly to change later; design judgement matters most here | WP-01, WP-02, WP-03, WP-10 |
| `engine-builder` | sonnet | Well-specified implementation with clear tests | WP-04, WP-05, WP-12 |
| `skill-ingester` | sonnet | Well-specified parsing work | WP-06 |
| `llm-integrator` | opus | Prompt design and the refinement loop decide rule quality; hard to specify fully in advance | WP-08, WP-09 |
| `report-builder` | sonnet | Presentation of an already-defined results format | WP-07 |
| `reviewer` | opus | Read-only quality gate; must catch what builders missed | After every wave |

Model aliases follow Claude Code's subagent `model` field (`opus`, `sonnet`, `haiku`, `inherit`). Change them in `.claude/agents/*.md` if cost or availability requires.

## 2. Folder ownership

| Path | Owner |
| --- | --- |
| root config (`package.json`, `tsconfig.json`, lint/test config), `contract/`, `src/contract/`, `src/examples/`, `src/release/`, `fixtures/toylang/` | `contract-architect` |
| `src/engines/`, `src/runner/` | `engine-builder` |
| `src/ingest/` | `skill-ingester` |
| `src/llm/`, `src/synth/`, `fixtures/recordings/` | `llm-integrator` |
| `src/report/` | `report-builder` |
| `src/cli/commands/<command>.ts` | owner of the work package that adds the command |
| `docs/progress.md`, `docs/DECISIONS.md` | anyone may append; nobody rewrites earlier entries |
| `tests/<module>/` | owner of the matching `src/<module>/` |

Conflict rules:
- CLI commands are discovered automatically from `src/cli/commands/` (set up in WP-01), so no shared registration file is edited in parallel.
- WP-01 installs all dependencies the plan foresees. A builder that needs a new dependency writes the request in its completion note; the orchestrator adds it between waves.
- If a builder needs a change in a folder it does not own, it stops and writes the request in its completion note.

## 3. Waves

| Wave | Runs | Mode | Ends with |
| --- | --- | --- | --- |
| 1 | WP-01 → WP-02 → WP-03 (`contract-architect`) | Sequential | Reviewer, then **G1** |
| 2 | WP-04 → WP-05 (`engine-builder`) ‖ WP-06 (`skill-ingester`) ‖ WP-08 (`llm-integrator`) | Three parallel tracks | Reviewer |
| 3 | WP-07 (`report-builder`) ‖ WP-09 (`llm-integrator`) | Two parallel tracks | Reviewer, then **G2** |
| 4 | WP-10 (`contract-architect`) | Single | Reviewer, then **G3** |
| 5 | **G4** first, then WP-11; WP-12 only if WP-11 shows the need | Orchestrator-led fix loop | Reviewer, final report |

WP-00 (real-language inputs) is a human task. It can be prepared at any time and is required only before Wave 5.

## 4. Human gates

At each gate the orchestrator stops and asks the project owner one explicit question, attaching the reviewer's summary.

| Gate | Question to the owner | Shows |
| --- | --- | --- |
| G1 | Approve the Rule Set contract (including decisions D1 and D6) so it can be frozen and shared with Legacy Navigator? | `contract/rule-set.schema.json`, fixture Rule Set, mapping table |
| G2 | Is the validation report on toylang understandable enough to decide whether a Rule Set can be trusted? | Report from a full `lsc compile` on toylang |
| G3 | Is the toylang MVP complete enough to move to the real language? | Acceptance traceability table with evidence |
| G4 | Are the real Skill files and examples ready, and does employer policy allow sending them to the configured provider (or which approved/local provider must be used)? | WP-00 checklist, provider configuration, snippet-log location |

## 5. Dispatch procedure

For each work package:

1. Check that all dependencies listed in the work package are marked done in `docs/progress.md`.
2. Start the owning subagent with this prompt:

   ```
   Work package: docs/work-packages/WP-xx.md
   Read CLAUDE.md, docs/PLAN.md and the work package, then complete it.
   Finish with the completion note required by CLAUDE.md and return that note as your final message.
   ```

3. Start all packages of a parallel wave in the same turn so they run concurrently.
4. When all packages of the wave have returned, start `reviewer` with:

   ```
   Review wave N: WP-aa, WP-bb.
   Follow your checklist and return a verdict per work package.
   ```

5. If the reviewer returns `changes required`, send the listed findings back to the owning agent as a new task referencing the same work package, then review again. After two failed review rounds on the same package, stop and ask the project owner.
6. Update the status table in `docs/progress.md`.

## 6. Wave 5 fix loop

1. The orchestrator runs `lsc compile` on the real inputs (path from environment variable `LSC_REAL_INPUTS`, outside the repository) with the provider approved at G4.
2. Each problem found is classified:
   - **input gap** (missing or contradictory Skill text or examples) → reported to the project owner, not fixed by agents
   - **tool defect** → dispatched to the owning agent as a fix task with a toylang reproduction
   - **engine limitation** (construct not expressible with exact or regex) → recorded as evidence for WP-12
3. Real-language code is never copied into fixtures, tests or recordings.
