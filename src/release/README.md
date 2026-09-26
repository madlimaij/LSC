# src/release

**Owner:** `contract-architect` (WP-10).

Versioning, diff against the previous Rule Set, export (plan §5.1, §7, §8 step 8). Import from `src/release/index.ts`.

| File | Contents |
| --- | --- |
| `diff.ts` | `diffRuleSets(previous, next)`: changes between two Rule Sets and the bump they require (contract/CONTRACT.md §3; table in the file header) |
| `content-version.ts` | `nextVersion`, `isReleaseVersion`, `FIRST_VERSION` (`1.0.0`) |
| `changelog.ts` | `renderChangelogEntry`, `prependChangelogEntry` (newest first, never the same version twice) |
| `export.ts` | `exportRuleSet` (pure) and `exportFiles` (reads, writes the Rule Set and the CHANGELOG); used by `lsc export` |
| `reuse.ts` | `planReuse`, `reuseConstruct`: reuse previous rules for unchanged Skill files without a model call |

## `lsc export`

```
lsc export <draft-ruleset> --out <file> [--previous <file>] [--changelog <file>]
```

- Keeps only `validated` rules; the draft's `rejected` rules are listed as "not exported" (D25 item 5).
- `version`: `1.0.0` without `--previous`; otherwise the previous version bumped by the diff (§3). Nothing changed: the previous file is written back unchanged, same version, no CHANGELOG entry.
- `contractVersion` is set to the current `CONTRACT_VERSION`; `compiledAt` and `compilerVersion` stay as the draft has them (the compile that produced the rules).
- Refuses: an invalid draft; a draft with no validated rule; a `--previous` that is a draft (pre-release or 0.x version), contains rejected rules, or is for another language; an existing `--out` without `--previous` (so a forgotten `--previous` cannot silently restart at `1.0.0`); `--out` equal to the draft; an existing `--out` that is not the `--previous` file and does not have the same content as `--previous` (a stale `--previous` would overwrite a newer version with a lower one); an existing `--out` that is not a Rule Set; a computed version whose CHANGELOG heading already exists with a different entry (an identical entry is left as it is). Nothing is written when an export is refused.
- `checkExportTarget(outPath, previousPath?)` runs the `--out` / `--previous` checks alone, using only files that exist before the export, so `lsc compile --export` can call it before any model call.
- CHANGELOG: default `CHANGELOG.md` next to `--out`; entries are headed `## <languageId> <version> (<date of compiledAt>)`.
- Exit code 0 on success, 1 on any refusal (message on stderr).

## Reuse on recompile (not yet wired into `lsc compile`)

The WP-10 brief asks that unchanged Skill files reuse the previous rules without a model call (unless `--force`) and that `lsc compile --export` exports at the end. Both need changes in `src/synth/compile.ts` and `src/cli/commands/compile.ts`, which `llm-integrator` owns. This module provides everything they need:

1. `planReuse({ previous, ingest, force })` with `previous` = the last exported Rule Set:
   - lexical settings reusable when every general Skill file (no inline example) is unchanged and no Skill file was removed;
   - a construct reusable when the previous export has a validated rule with its id and every Skill file it depends on (its section's file and each file with an inline example of it) has the same hash.
2. `reuseConstruct({ rule, construct, allExamples, lexical })` re-tests a reusable rule with the runner on the current examples under the current lexical settings (sidecar and `reviews.yaml` examples change without any Skill file changing). It returns a `ConstructOutcome` (`validated`, zero attempts, fresh `sourceEvidence`/`tests`/`confidence`) or a reason; on a reason the construct is synthesised as usual.

Proposed wiring (for `llm-integrator`):

- `CompileOptions.reuse?: { lexical?: LexicalSettings; construct?: (construct, lexical, allExamples) => ConstructOutcome | undefined }`: `compileLanguage` skips `synthesizeLexical` when `lexical` is given, and calls `construct(...)` before `synthesizeConstruct`, using its outcome when defined.
- `synthesis.json`: mark reused results (e.g. `lexical.status: "reused"`, `ConstructSynthesis.reusedFrom: "<previous version>"`) so the report can say "reused from 1.2.0, no model call".
- `lsc compile`: `--previous <file>` (build the plan with `planReuse`), `--force`, and `--export <file>` (call `exportFiles({ draft: output.ruleSet, outPath, previousPath })` after writing the draft; `previousPath` = `--previous`).

`tests/release/reuse.test.ts` ("recompile composition") runs exactly this composition with the WP-09 building blocks and shows that only the changed construct reaches the provider.
