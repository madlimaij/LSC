import type { Command } from 'commander';
import { CONTRACT_VERSION } from '../../contract/version.js';
import { loadRuleSetFile } from '../../contract/load.js';
import { formatIssue, formatPath } from '../../contract/validate.js';

export const name = 'validate-ruleset';
export const description = 'Validate a Rule Set against the contract (schema and cross-field rules)';

interface Options {
  readonly json?: boolean;
}

export function configure(cmd: Command): void {
  cmd
    .argument('<file>', 'Rule Set JSON file')
    .option('--json', 'print the result as JSON instead of text')
    .action((file: string, options: Options) => {
      const result = loadRuleSetFile(file);

      if (options.json === true) {
        const payload = result.ok
          ? { valid: true, file, contractVersion: CONTRACT_VERSION, rules: result.ruleSet.rules.length, issues: [] }
          : {
              valid: false,
              file,
              contractVersion: CONTRACT_VERSION,
              ...('fileError' in result ? { fileError: result.fileError } : {}),
              issues: result.issues.map((issue) => ({
                rule: issue.rule,
                path: formatPath(issue.path),
                message: issue.message,
              })),
            };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        if (!result.ok) process.exitCode = 1;
        return;
      }

      if (result.ok) {
        const count = result.ruleSet.rules.length;
        process.stdout.write(
          `OK: ${file} is a valid Rule Set (contract ${CONTRACT_VERSION}, ${String(count)} rule${count === 1 ? '' : 's'})\n`,
        );
        return;
      }
      process.exitCode = 1;
      if ('fileError' in result) {
        process.stderr.write(`ERROR: ${result.fileError}\n`);
        return;
      }
      const n = result.issues.length;
      process.stderr.write(`INVALID: ${file} (${String(n)} problem${n === 1 ? '' : 's'})\n`);
      for (const issue of result.issues) process.stderr.write(`  ${formatIssue(issue)}\n`);
    });
}
