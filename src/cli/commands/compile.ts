import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { formatIssue, type RuleSet } from '../../contract/index.js';
import { loadRuleSetFile } from '../../contract/load.js';
import { exampleLocations } from '../../examples/index.js';
import { createSession, LlmConfigError, loadConfig, loadRecordings, type LlmConfig } from '../../llm/index.js';
import type { IngestResult } from '../../ingest/index.js';
import {
  ExportError,
  exportFiles,
  isReleaseVersion,
  planReuse,
  reuseConstruct,
  VersionError,
  type ExportFilesResult,
} from '../../release/index.js';
import { renderReportFiles } from '../../report/index.js';
import { ResultsSchema } from '../../runner/index.js';
import {
  assertRecordingAllowed,
  compileLanguage,
  DEFAULT_MAX_OUTPUT_TOKENS,
  defaultLanguageId,
  RecordingRefusedError,
  SynthesisReportSchema,
  type CompileOutput,
  type CompileReuse,
  type ModelSourceInput,
} from '../../synth/index.js';
import { getPackageInfo } from '../package-info.js';

export const name = 'compile';
export const description =
  'Full pipeline: ingest Skill files, synthesise rules with the configured model, test and refine them, write a draft Rule Set and the report';

interface Options {
  readonly sample?: string;
  readonly provider?: string;
  readonly recordings?: string;
  readonly config?: string;
  readonly out: string;
  readonly languageId?: string;
  readonly maxAttempts?: string;
  readonly previous?: string;
  readonly force?: boolean;
  readonly export?: string;
}

/** Exit codes: 0 every construct validated; 2 finished with rejected / not-justified / skipped constructs; 1 no usable result. */
export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_INCOMPLETE = 2;

class UsageError extends Error {}

function selectProvider(config: LlmConfig, options: Options): LlmConfig {
  if (options.recordings !== undefined && options.provider !== 'fake') {
    throw new UsageError('--recordings is only valid with --provider fake');
  }
  if (options.provider === 'fake' && options.recordings !== undefined) {
    if (config.recording !== undefined) throw new UsageError('recording mode needs a real provider; remove "recording" or --provider fake');
    return { ...config, provider: { name: 'fake', recordingsDir: resolve(options.recordings) } };
  }
  if (config.provider === undefined) {
    throw new UsageError(
      'no model provider configured: add "provider" to lsc.config.json (see src/llm/README.md), or use --provider fake --recordings <dir>',
    );
  }
  if (options.provider !== undefined && options.provider !== config.provider.name) {
    throw new UsageError(
      `--provider ${options.provider} is not the provider configured in lsc.config.json (${config.provider.name}); ` +
        (options.provider === 'fake' ? 'add --recordings <dir>' : `configure "${options.provider}" there`),
    );
  }
  return config;
}

/** What synthesis.json records about the provider (D25 item 2): configured provider and model, or the recordings replayed. */
function modelSourceInput(config: LlmConfig): ModelSourceInput {
  const pc = config.provider;
  if (pc === undefined) throw new UsageError('no model provider configured');
  switch (pc.name) {
    case 'fake':
      return { mode: 'replay', provider: pc.name, recordings: loadRecordings(pc.recordingsDir) };
    case 'anthropic':
      return { mode: config.recording !== undefined ? 'live-recording' : 'live', provider: pc.name, model: pc.model };
  }
}

/**
 * `--previous`: the last exported Rule Set (D31 b). Checked before any model
 * call, with the same conditions `lsc export` applies to its `--previous`.
 */
function loadPrevious(path: string, languageId: string): RuleSet {
  const loaded = loadRuleSetFile(path);
  if (!loaded.ok) {
    if ('fileError' in loaded) throw new UsageError(`--previous: ${loaded.fileError}`);
    throw new UsageError(`--previous: ${path} is not a valid Rule Set:\n${loaded.issues.map((i) => `  ${formatIssue(i)}`).join('\n')}`);
  }
  const previous = loaded.ruleSet;
  if (!isReleaseVersion(previous.version)) {
    throw new UsageError(
      `--previous: ${path} has version ${previous.version}, which is not an exported version; pass the Rule Set written by the last \`lsc export\`, not a draft`,
    );
  }
  if (previous.rules.some((r) => r.status !== 'validated')) {
    throw new UsageError(`--previous: ${path} contains rejected rules, so it was not written by \`lsc export\`; pass the last exported Rule Set`);
  }
  if (previous.languageId !== languageId) {
    throw new UsageError(`--previous: ${path} is for language ${previous.languageId}, this compile is for ${languageId}`);
  }
  return previous;
}

/** Reuse plan for `--previous` (src/release `planReuse`), applied by `compileLanguage`; the runner re-tests every reused rule (`reuseConstruct`). */
function reuseFrom(previous: RuleSet, force: boolean): (ingest: IngestResult) => CompileReuse {
  return (ingest) => {
    const plan = planReuse({ previous, ingest, force });
    return {
      previousVersion: plan.previousVersion,
      force,
      ...(plan.lexical.reuse
        ? { lexical: { settings: plan.lexical.settings, note: plan.lexical.reason } }
        : { lexicalNote: plan.lexical.reason }),
      construct: (construct, lexical, allExamples) => {
        const decision = plan.constructs.get(construct.id);
        if (decision === undefined) return undefined;
        if (!decision.reuse) return { note: decision.reason };
        const reused = reuseConstruct({ rule: decision.rule, construct, allExamples, lexical });
        return reused.ok ? { outcome: reused.outcome, note: decision.reason } : { note: reused.reason };
      },
    };
  };
}

/** `--export` refusals that can be known before any model call (the rest are `exportFiles`' own, D31). */
function checkExportTarget(options: Options, outputs: string[]): void {
  if (options.export === undefined) return;
  const target = resolve(options.export);
  if (outputs.some((o) => resolve(o) === target)) throw new UsageError(`--export must not be one of the files lsc compile writes (${options.export})`);
  if (options.previous === undefined && existsSync(target)) {
    throw new UsageError(
      `--export: ${options.export} already exists; pass --previous <file> (normally that same file) so the new version is derived from it, or remove it to start again at 1.0.0`,
    );
  }
}

function parseAttempts(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new UsageError(`--max-attempts must be a whole number from 1 to 10 (got ${value})`);
  return n;
}

function printExport(result: ExportFilesResult): void {
  const w = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  const { ruleSet } = result;
  if (result.unchanged) w(`Export ${ruleSet.languageId} ${result.version}: no changes since the previous export; version unchanged`);
  else if (result.previousVersion === undefined) w(`Export ${ruleSet.languageId} ${result.version}: first export, ${String(ruleSet.rules.length)} validated rule(s)`);
  else w(`Export ${ruleSet.languageId} ${result.previousVersion} → ${result.version} (${result.diff.bump}), ${String(ruleSet.rules.length)} validated rule(s)`);
  if (result.previousVersion !== undefined) {
    for (const change of result.diff.changes) w(`  ${change.bump.padEnd(5)}  ${change.summary.replace(/`/g, '')}`);
  }
  if (result.droppedRejected.length > 0) w(`  not exported (rejected): ${result.droppedRejected.join(', ')}`);
  w(`Wrote ${result.outPath}`);
  w(result.changelogUpdated ? `Updated ${result.changelogPath}` : `CHANGELOG unchanged: ${result.changelogPath}`);
}

function printSummary(output: CompileOutput, files: string[], logPath: string, budget: { used: number; max: number }, report: string | undefined): void {
  const { synthesis } = output;
  const w = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };
  const s = synthesis.summary;
  w(
    `Compile ${synthesis.languageId}: ${String(s.constructs)} construct(s): ${String(s.validated)} validated, ${String(s.rejected)} rejected, ` +
      `${String(s.notJustified)} not justified, ${String(s.skipped)} skipped` +
      (s.notAttempted > 0 ? `, ${String(s.notAttempted)} not attempted` : ''),
  );
  if (synthesis.reuse !== undefined) {
    w(
      synthesis.reuse.force
        ? `  previous Rule Set ${synthesis.reuse.previousVersion}: --force, everything synthesised again`
        : `  previous Rule Set ${synthesis.reuse.previousVersion}: ${String(s.reused ?? 0)} rule(s) reused without a model call`,
    );
  }
  if (synthesis.lexical.status === 'reused') {
    w(`  lexical settings: reused from ${synthesis.lexical.reusedFrom ?? '?'}, no model call`);
  } else if (synthesis.lexical.settings !== undefined) {
    w(`  lexical settings: accepted after ${String(synthesis.lexical.attempts.length)} attempt(s)`);
  } else {
    w(`  lexical settings: ${synthesis.lexical.status}${synthesis.lexical.reason !== undefined ? `: ${synthesis.lexical.reason}` : ''}`);
  }
  const rules = new Map((output.ruleSet?.rules ?? []).map((r) => [r.id, r] as const));
  for (const c of synthesis.constructs) {
    const rule = c.ruleId !== undefined ? rules.get(c.ruleId) : undefined;
    const attempts = c.reusedFrom !== undefined ? `reused from ${c.reusedFrom}, no model call` : `${String(c.attempts.length)} attempt(s)`;
    switch (c.status) {
      case 'validated':
        w(
          `  VALIDATED      ${c.constructId}  ${rule?.type ?? ''} ${rule?.engine ?? ''}  confidence ${rule?.confidence ?? '?'}  ` +
            `${String(rule?.tests.passed ?? 0)}/${String((rule?.tests.passed ?? 0) + (rule?.tests.failed ?? 0))} examples  ${attempts}`,
        );
        break;
      case 'rejected':
        w(`  REJECTED       ${c.constructId}  ${attempts}: ${c.reason ?? ''}`);
        break;
      case 'not-justified':
        w(`  NOT JUSTIFIED  ${c.constructId}: ${c.reason ?? ''}`);
        break;
      case 'skipped':
        w(`  SKIPPED        ${c.constructId}: ${c.reason ?? ''}`);
        break;
      case 'not-attempted':
        w(`  NOT ATTEMPTED  ${c.constructId}: ${c.reason ?? ''}`);
        break;
    }
  }
  if (synthesis.error !== undefined) w(`ERROR: ${synthesis.error}`);
  w(
    `Model usage: ${String(synthesis.usage.calls)} call(s), ${String(synthesis.usage.inputTokens)} input + ${String(synthesis.usage.outputTokens)} output tokens ` +
      `(budget used ${String(budget.used)} of ${String(budget.max)})`,
  );
  if (synthesis.modelSource !== undefined) w(`Model source: ${synthesis.modelSource.summary}`);
  w(`Snippet log: ${logPath}`);
  for (const file of files) w(`Wrote ${file}`);
  w(report ?? 'Report: not written (no draft Rule Set, so no results to report on; see synthesis.json)');
}

export function configure(cmd: Command): void {
  cmd
    .argument('<skills-dir>', 'Skill directory (examples/ and reviews.yaml are read from its siblings)')
    .option('--sample <dir>', 'repository sample to scan with the synthesised rules (never sent to the model)')
    .option('--provider <name>', 'model provider: the one configured in lsc.config.json, or "fake" with --recordings')
    .option('--recordings <dir>', 'with --provider fake: replay recorded responses from this directory')
    .option('--config <file>', 'configuration file (default: ./lsc.config.json)')
    .option('--out <dir>', 'output directory', '.lsc/out')
    .option('--language-id <id>', 'language id (default: name of the directory holding <skills-dir>)')
    .option('--max-attempts <n>', 'attempts per construct (default: budgets.maxAttemptsPerConstruct, 3)')
    .option('--previous <file>', 'last exported Rule Set of this language: rules of unchanged Skill files are re-tested and reused without a model call')
    .option('--force', 'with --previous: reuse nothing, synthesise everything again')
    .option('--export <file>', 'after compiling, export the Rule Set to this file as `lsc export` does (with --previous as the previous export)')
    .action(async (skillsDir: string, options: Options) => {
      try {
        const loaded = loadConfig(options.config !== undefined ? { path: options.config } : {});
        const config = selectProvider(loaded, options);
        const maxAttempts = parseAttempts(options.maxAttempts, config.budgets.maxAttemptsPerConstruct);
        const languageId = options.languageId ?? defaultLanguageId(skillsDir);
        if (!/^\S+$/.test(languageId)) throw new UsageError(`language id must contain no whitespace (got ${JSON.stringify(languageId)})`);

        if (options.force === true && options.previous === undefined) throw new UsageError('--force only has a meaning with --previous');
        const draftFile = `${languageId}.ruleset.draft.json`;
        checkExportTarget(options, [draftFile, 'results.json', 'synthesis.json', 'report.md', 'report.html'].map((f) => join(options.out, f)));
        const previous = options.previous !== undefined ? loadPrevious(options.previous, languageId) : undefined;

        const locations = exampleLocations(skillsDir);
        assertRecordingAllowed({
          recording: config.recording !== undefined,
          inputs: [skillsDir, locations.examplesDir, locations.reviewsFile, ...(options.sample !== undefined ? [options.sample] : [])],
        });

        const session = createSession(config);
        const output = await compileLanguage({
          skillsDir,
          ...(options.sample !== undefined ? { sampleDir: options.sample } : {}),
          languageId,
          provider: session.provider,
          maxAttempts,
          maxOutputTokens: Math.min(DEFAULT_MAX_OUTPUT_TOKENS, config.budgets.maxOutputTokensPerCall),
          compilerVersion: getPackageInfo().version,
          modelSource: modelSourceInput(config),
          ...(previous !== undefined ? { reuse: reuseFrom(previous, options.force === true) } : {}),
        });

        mkdirSync(options.out, { recursive: true });
        const files: string[] = [];
        const write = (file: string, value: unknown): void => {
          const path = join(options.out, file);
          writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
          files.push(path);
        };
        if (output.ruleSet !== undefined) write(draftFile, output.ruleSet);
        if (output.results !== undefined) write('results.json', ResultsSchema.parse(output.results));
        const synthesis = SynthesisReportSchema.parse(output.synthesis);
        write('synthesis.json', synthesis);

        // D25 item 2: the report (WP-07) is written here too, from the same data.
        let reportLine: string | undefined;
        if (output.results !== undefined && output.ruleSet !== undefined) {
          const report = renderReportFiles({
            results: output.results,
            ruleSet: output.ruleSet,
            examples: output.ingest.constructs.flatMap((c) => c.examples),
            synthesis,
            outDir: options.out,
          });
          files.push(report.markdownPath, report.htmlPath);
          reportLine = `Report: ${report.markdownPath} and ${report.htmlPath} (verdict: ${report.report.overall.summary})`;
        }

        printSummary(output, files, session.log.path, {
          used: session.budget.totalUsed,
          max: session.budget.limits.maxTotalTokensPerCompile,
        }, reportLine);

        const s = output.synthesis;
        if (s.status !== 'completed') process.exitCode = EXIT_FAILED;
        else if (s.summary.validated !== s.summary.constructs) process.exitCode = EXIT_INCOMPLETE;
        else process.exitCode = EXIT_OK;

        if (options.export !== undefined) {
          // An aborted or failed compile is never exported: its missing rules would read as removed (a major bump).
          if (s.status !== 'completed' || output.ruleSet === undefined) {
            process.stderr.write(`ERROR: --export: not exported, because the compile did not complete (status ${s.status}); see synthesis.json\n`);
            process.exitCode = EXIT_FAILED;
            return;
          }
          printExport(
            exportFiles({
              draft: output.ruleSet,
              outPath: options.export,
              ...(options.previous !== undefined ? { previousPath: options.previous } : {}),
            }),
          );
        }
      } catch (err) {
        if (err instanceof ExportError || err instanceof VersionError) {
          process.stderr.write(`ERROR: --export: ${err.message}\n`);
          process.exitCode = EXIT_FAILED;
          return;
        }
        if (err instanceof UsageError || err instanceof RecordingRefusedError || err instanceof LlmConfigError) {
          process.stderr.write(`ERROR: ${err.message}\n`);
          process.exitCode = EXIT_FAILED;
          return;
        }
        throw err;
      }
    });
}
