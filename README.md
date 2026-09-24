# Language Skill Compiler — MVP build pack

This pack contains the full MVP (minimum viable product) plan for the Language Skill Compiler and the setup needed to have Claude Code build it with subagents.

## Contents

- `CLAUDE.md` — standing instructions every Claude Code session and subagent reads
- `docs/PLAN.md` — full plan: scope, decisions, contract, module design, phases, risks
- `docs/ORCHESTRATION.md` — agent roster, folder ownership, build waves, quality and human gates
- `docs/work-packages/WP-*.md` — one self-contained brief per unit of work
- `.claude/agents/*.md` — subagent definitions

## How to start

1. Create an empty Git repository and copy this pack into its root.
2. Open Claude Code in that folder.
3. Say: `Act as orchestrator. Follow docs/ORCHESTRATION.md and start Wave 1.`
4. The orchestrator stops at every human gate (G1–G4) and asks for approval before continuing.

## Inputs needed from the project owner

- Before Gate G1: approval of the Rule Set contract (it is shared with Legacy Navigator).
- Before Wave 5: real Skill files and code examples for the custom language (see WP-00) and confirmation that sending those snippets to the chosen model provider is allowed by employer policy.
