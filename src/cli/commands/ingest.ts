import type { Command } from 'commander';
import { formatLoadError, ingestSkills } from '../../ingest/index.js';

export const name = 'ingest';
export const description = 'Parse Skill files and print the constructs, example counts and diagnostics found';

interface Options {
  readonly json?: boolean;
  readonly proseLimit?: string;
}

export function configure(cmd: Command): void {
  cmd
    .argument('<skills-dir>', 'directory of Skill Markdown files')
    .option('--json', 'print the result as JSON instead of text')
    .option('--prose-limit <chars>', 'character cap on the prose sent to the model per construct')
    .action((skillsDir: string, options: Options) => {
      const proseCharLimit = options.proseLimit === undefined ? undefined : Number.parseInt(options.proseLimit, 10);
      const result = ingestSkills(skillsDir, proseCharLimit === undefined ? {} : { proseCharLimit });

      if (options.json === true) {
        const payload = {
          skillsDir,
          sourceSkills: result.sourceSkills,
          constructs: result.constructs.map((construct) => ({
            id: construct.id,
            ruleTypeHint: construct.ruleTypeHint,
            skillPath: construct.skillPath,
            anchor: construct.anchor,
            proseLength: construct.prose.length,
            positiveExamples: construct.examples.filter((e) => e.polarity === 'positive').length,
            negativeExamples: construct.examples.filter((e) => e.polarity === 'negative').length,
          })),
          diagnostics: result.diagnostics.map((d) => ({ file: d.file, line: d.line, message: d.message })),
        };
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        if (result.diagnostics.length > 0) process.exitCode = 1;
        return;
      }

      process.stdout.write(`Skill files: ${String(result.sourceSkills.length)}\n\n`);
      for (const construct of result.constructs) {
        const positive = construct.examples.filter((e) => e.polarity === 'positive').length;
        const negative = construct.examples.filter((e) => e.polarity === 'negative').length;
        const type = construct.ruleTypeHint ?? '(no rule type: no positive example)';
        process.stdout.write(
          `${construct.id}  [${type}]  ${String(positive)} positive, ${String(negative)} negative  ${construct.anchor}\n`,
        );
      }

      if (result.diagnostics.length > 0) {
        process.stdout.write(`\nDiagnostics (${String(result.diagnostics.length)}):\n`);
        for (const diagnostic of result.diagnostics) process.stdout.write(`  ${formatLoadError(diagnostic)}\n`);
        process.exitCode = 1;
      } else {
        process.stdout.write('\nNo diagnostics.\n');
      }
    });
}
