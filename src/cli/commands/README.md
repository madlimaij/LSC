# src/cli/commands

**Owner:** each file is owned by the work package that adds the command (docs/ORCHESTRATION.md §2).

Every `.ts` file here is discovered automatically by `src/cli/index.ts` (sorted by file name) and registered as an `lsc` sub-command. No other file needs editing.

A command file exports either named members or a default object with the same members:

```ts
import type { Command } from 'commander';

export const name = 'validate-ruleset';          // kebab-case, unique
export const description = 'Validate a Rule Set against the contract';
export function configure(cmd: Command): void { // may also return a Promise
  cmd.argument('<file>').action(async (file: string) => { /* ... */ });
}
```

Rules:
- Only command modules live here. Put helpers in the owning module's folder (e.g. `src/report/`). Files starting with `_` or `.`, `*.d.ts`, `*.test.ts` and non-code files are ignored.
- A malformed file (missing `name`, `description` or `configure`, non-kebab-case name, the reserved name `help`) or a duplicate name makes the CLI fail at start-up, on purpose.
- Keep top-level code free of side effects: every command file is imported whenever `lsc` starts.
