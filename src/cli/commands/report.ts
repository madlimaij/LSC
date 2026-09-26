/**
 * `lsc report <results.json>`: renders the validation report (WP-07 brief,
 * docs/PLAN.md §7) so a person can decide whether a Rule Set is trustworthy
 * without reading compiler internals (specification §5).
 *
 * `--ruleset` and `--skills-dir` are optional enrichments beyond the brief's
 * literal command line: without them the report still renders every
 * section from `Results` alone, but pattern, captures and provenance
 * (`--ruleset`) and source snippets (`--skills-dir`) are reported as
 * unavailable rather than guessed. See this package's completion note.
 */
import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { RuleSet } from '../../contract/index.js';
import { loadRuleSetFile } from '../../contract/load.js';
import type { Example } from '../../examples/index.js';
import { ingestSkills } from '../../ingest/index.js';
import { buildReport, renderHtml, renderMarkdown } from '../../report/index.js';
import { indexExamplesById } from '../../report/example-location.js';
import { loadResultsFile } from '../../report/load-results.js';

export const name = 'report';
export const description = 'Render the validation report for a Results file (Markdown, HTML or JSON)';

type Format = 'md' | 'html' | 'json';

interface Options {
  readonly format?: string;
  readonly ruleset?: string;
  readonly skillsDir?: string;
  readonly out?: string;
}

function parseFormat(raw: string | undefined): Format {
  if (raw === undefined || raw === 'md') return 'md';
  if (raw === 'html' || raw === 'json') return raw;
  throw new Error(`--format must be "md", "html" or "json" (got ${JSON.stringify(raw)})`);
}

export function configure(cmd: Command): void {
  cmd
    .argument('<results>', 'Results JSON file (written by `lsc test` or `lsc compile`)')
    .option('--format <format>', 'output format: md, html or json (default md)')
    .option('--ruleset <file>', 'the Rule Set the results were produced from, for pattern/captures/provenance')
    .option('--skills-dir <dir>', 'Skill directory used to test, for source locations and snippets')
    .option('--out <file>', 'write the report to this file instead of stdout')
    .action((resultsPath: string, options: Options) => {
      let format: Format;
      try {
        format = parseFormat(options.format);
      } catch (error) {
        process.exitCode = 1;
        process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
        return;
      }

      const loadedResults = loadResultsFile(resultsPath);
      if (!loadedResults.ok) {
        process.exitCode = 1;
        process.stderr.write(`ERROR: ${loadedResults.error}\n`);
        return;
      }
      const results = loadedResults.results;

      let ruleSet: RuleSet | undefined;
      if (options.ruleset !== undefined) {
        const loaded = loadRuleSetFile(options.ruleset);
        if (!loaded.ok) {
          process.exitCode = 1;
          process.stderr.write(`ERROR: ${options.ruleset} is not a valid Rule Set\n`);
          return;
        }
        ruleSet = loaded.ruleSet;
      }

      let examplesById: ReadonlyMap<string, Example> | undefined;
      if (options.skillsDir !== undefined) {
        const ingested = ingestSkills(options.skillsDir);
        examplesById = indexExamplesById(ingested.constructs.flatMap((construct) => construct.examples));
      }

      const report = buildReport(results, { ...(ruleSet !== undefined ? { ruleSet } : {}), ...(examplesById !== undefined ? { examplesById } : {}) });

      const rendered =
        format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : format === 'html' ? renderHtml(report) : renderMarkdown(report);

      if (options.out !== undefined) {
        writeFileSync(options.out, rendered);
      } else {
        process.stdout.write(rendered);
      }

      if (options.out !== undefined) {
        process.stdout.write(`Wrote ${format} report to ${options.out}\n`);
      }
      if (report.overall.verdict === 'rejected') process.exitCode = 1;
    });
}
