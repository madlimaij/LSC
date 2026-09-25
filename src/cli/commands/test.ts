import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Command } from 'commander';
import FastGlob from 'fast-glob';
import { formatIssue } from '../../contract/validate.js';
import { loadRuleSetFile } from '../../contract/load.js';
import { ingestSkills } from '../../ingest/index.js';
import { getPackageInfo } from '../package-info.js';
import { ResultsSchema, runRules, type Results, type SampleFile } from '../../runner/index.js';

export const name = 'test';
export const description = 'Run a Rule Set against labelled examples and an optional repository sample, fully offline';

interface Options {
  readonly sample?: string;
  readonly out?: string;
}

/** Reads every regular file under `dir` (recursively) as a `SampleFile`; `fileMatchers` selection happens in the runner. */
function loadSampleFiles(dir: string): SampleFile[] {
  const files = FastGlob.sync('**/*', { cwd: dir, onlyFiles: true, dot: false }).sort();
  return files.map((relPath) => ({
    path: relPath.split(sep).join('/'),
    content: readFileSync(join(dir, relPath), 'utf8'),
  }));
}

function printSummary(results: Results, diagnosticCount: number): void {
  process.stdout.write(`Rule Set ${results.languageId} ${results.ruleSetVersion}\n`);
  for (const rule of results.rules) {
    const status = rule.tests.failed === 0 ? 'PASS' : 'FAIL';
    const computed = rule.computedConfidence ?? 'none (passes no positive example)';
    process.stdout.write(
      `  ${status}  ${rule.ruleId}  ${String(rule.tests.passed)} passed, ${String(rule.tests.failed)} failed` +
        `  confidence: declared=${rule.declaredConfidence} computed=${computed}` +
        (rule.sampleMatches.length > 0 ? `  sample matches: ${String(rule.sampleMatches.length)}` : '') +
        '\n',
    );
    for (const id of rule.tests.failingExampleIds) process.stdout.write(`      failing example: ${id}\n`);
  }
  if (results.coverage.ruleTypesMissing.length > 0) {
    process.stdout.write(`No validated rule for: ${results.coverage.ruleTypesMissing.join(', ')}\n`);
  }
  if (results.sampleWarnings.length > 0) {
    process.stdout.write(`Sample-scan warnings: ${String(results.sampleWarnings.length)}\n`);
  }
  if (diagnosticCount > 0) {
    process.stdout.write(`Skill/example ingestion diagnostics: ${String(diagnosticCount)}\n`);
  }
  process.stdout.write(results.ok ? 'OK: every rule passed its examples\n' : 'FAILED: at least one rule failed an example\n');
}

export function configure(cmd: Command): void {
  cmd
    .argument('<ruleset>', 'Rule Set JSON file')
    .argument('<skills-dir>', 'Skill directory (examples/ and reviews.yaml are read from its siblings)')
    .option('--sample <dir>', 'repository sample directory to scan for unlabelled matches')
    .option('--out <file>', 'write the results as JSON to this file')
    .action((rulesetPath: string, skillsDir: string, options: Options) => {
      const loaded = loadRuleSetFile(rulesetPath);
      if (!loaded.ok) {
        process.exitCode = 1;
        if ('fileError' in loaded) {
          process.stderr.write(`ERROR: ${loaded.fileError}\n`);
        } else {
          process.stderr.write(`INVALID: ${rulesetPath} is not a valid Rule Set\n`);
          for (const issue of loaded.issues) process.stderr.write(`  ${formatIssue(issue)}\n`);
        }
        return;
      }

      const ingested = ingestSkills(skillsDir);
      const examples = ingested.constructs.flatMap((construct) => construct.examples);
      const sampleFiles = options.sample !== undefined ? loadSampleFiles(options.sample) : [];

      const results = runRules(loaded.ruleSet, examples, sampleFiles, { compilerVersion: getPackageInfo().version });
      ResultsSchema.parse(results);

      if (options.out !== undefined) {
        writeFileSync(options.out, `${JSON.stringify(results, null, 2)}\n`);
      }

      printSummary(results, ingested.diagnostics.length);
      if (!results.ok) process.exitCode = 1;
    });
}
