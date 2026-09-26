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
import { readFileSync, writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import type { RuleSet } from '../../contract/index.js';
import { loadRuleSetFile } from '../../contract/load.js';
import type { Example } from '../../examples/index.js';
import { ingestSkills } from '../../ingest/index.js';
import { buildReport, renderHtml, renderMarkdown } from '../../report/index.js';
import { indexExamplesById } from '../../report/example-location.js';
import { describeSkillHashMismatch, findSkillHashMismatches } from '../../report/skill-hash-check.js';
import { loadResultsFile } from '../../report/load-results.js';
import { SynthesisReportSchema, type SynthesisReport } from '../../synth/index.js';

export const name = 'report';
export const description = 'Render the validation report for a Results file (Markdown, HTML or JSON)';

type Format = 'md' | 'html' | 'json';

interface Options {
  readonly format?: string;
  readonly ruleset?: string;
  readonly skillsDir?: string;
  readonly synthesis?: string;
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
    .option('--ruleset <file>', 'the Rule Set the results were produced from, for pattern/captures/provenance/lexical settings')
    .option('--skills-dir <dir>', 'Skill directory used to test, for source locations, snippets and a Skill-hash drift check (with --ruleset)')
    .option('--synthesis <file>', 'synthesis.json (written by `lsc compile`), for each construct\'s synthesis outcome and reasons (D25 item 2)')
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
      let currentSourceSkills: { path: string; sha256: string }[] | undefined;
      if (options.skillsDir !== undefined) {
        const ingested = ingestSkills(options.skillsDir);
        examplesById = indexExamplesById(ingested.constructs.flatMap((construct) => construct.examples));
        currentSourceSkills = ingested.sourceSkills;
      }

      // Reviewer Q5 / D25 item 4: warn (report + stderr) when the current Skill file hashes differ
      // from what the Rule Set was compiled from — needs both --ruleset and --skills-dir.
      if (ruleSet !== undefined && currentSourceSkills !== undefined) {
        const mismatches = findSkillHashMismatches(ruleSet.sourceSkills, currentSourceSkills);
        for (const mismatch of mismatches) {
          process.stderr.write(`WARNING: ${describeSkillHashMismatch(mismatch)}\n`);
        }
      }

      let synthesis: SynthesisReport | undefined;
      if (options.synthesis !== undefined) {
        let text: string;
        try {
          text = readFileSync(options.synthesis, 'utf8');
        } catch (error) {
          process.exitCode = 1;
          process.stderr.write(`ERROR: cannot read ${options.synthesis}: ${error instanceof Error ? error.message : String(error)}\n`);
          return;
        }
        const parsed = SynthesisReportSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          process.exitCode = 1;
          process.stderr.write(`ERROR: ${options.synthesis} is not a valid synthesis.json\n`);
          return;
        }
        synthesis = parsed.data;
      }

      const report = buildReport(results, {
        ...(ruleSet !== undefined ? { ruleSet } : {}),
        ...(examplesById !== undefined ? { examplesById } : {}),
        ...(synthesis !== undefined ? { synthesis } : {}),
        ...(ruleSet !== undefined && currentSourceSkills !== undefined ? { currentSourceSkills } : {}),
      });

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
