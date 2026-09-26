/**
 * `lsc export <draft-ruleset> --out <file> [--previous <file>] [--changelog <file>]`
 * (WP-10 brief, plan §7): writes the Rule Set delivered to Navigator. Only
 * `validated` rules, a real content version derived from the diff against
 * the previous export (contract/CONTRACT.md §3), and a CHANGELOG entry.
 * Logic: src/release/export.ts.
 */
import type { Command } from 'commander';
import { ExportError, exportFiles, VersionError, type ExportFilesResult } from '../../release/index.js';

export const name = 'export';
export const description = 'Assign the content version and write the validated Rule Set for Navigator, with a CHANGELOG entry';

interface Options {
  readonly out: string;
  readonly previous?: string;
  readonly changelog?: string;
}

function printSummary(result: ExportFilesResult): void {
  const w = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  const { ruleSet } = result;
  if (result.unchanged) {
    w(`Export ${ruleSet.languageId} ${result.version}: no changes since the previous export; version unchanged`);
  } else if (result.previousVersion === undefined) {
    w(`Export ${ruleSet.languageId} ${result.version}: first export, ${String(ruleSet.rules.length)} validated rule(s)`);
  } else {
    w(`Export ${ruleSet.languageId} ${result.previousVersion} → ${result.version} (${result.diff.bump}), ${String(ruleSet.rules.length)} validated rule(s)`);
  }
  if (result.previousVersion !== undefined) {
    for (const change of result.diff.changes) w(`  ${change.bump.padEnd(5)}  ${change.summary.replace(/`/g, '')}`);
  }
  if (result.droppedRejected.length > 0) w(`  not exported (rejected): ${result.droppedRejected.join(', ')}`);
  w(`Wrote ${result.outPath}`);
  w(result.changelogUpdated ? `Updated ${result.changelogPath}` : `CHANGELOG unchanged: ${result.changelogPath}`);
}

export function configure(cmd: Command): void {
  cmd
    .argument('<draft-ruleset>', 'draft Rule Set written by `lsc compile` (<lang>.ruleset.draft.json)')
    .requiredOption('--out <file>', 'Rule Set file to write (the file Navigator gets)')
    .option('--previous <file>', 'the last exported Rule Set of this language; required when --out exists (usually the same file)')
    .option('--changelog <file>', 'CHANGELOG file to prepend the entry to (default: CHANGELOG.md next to --out)')
    .action((draftPath: string, options: Options) => {
      try {
        const result = exportFiles({
          draft: draftPath,
          outPath: options.out,
          ...(options.previous !== undefined ? { previousPath: options.previous } : {}),
          ...(options.changelog !== undefined ? { changelogPath: options.changelog } : {}),
        });
        printSummary(result);
        process.exitCode = 0;
      } catch (err) {
        if (err instanceof ExportError || err instanceof VersionError) {
          process.stderr.write(`ERROR: ${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}
