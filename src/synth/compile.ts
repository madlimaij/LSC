/**
 * Full compile (plan §8): ingest → lexical settings → per-construct
 * synthesis → draft Rule Set → runner results (with the repository sample).
 *
 * Order matters for the safety rules: the repository sample is loaded and
 * scanned only after every model call is done, and only by the runner. No
 * sample file and no `reviews.yaml` example ever reaches a prompt (plan §8,
 * D16 g).
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import FastGlob from 'fast-glob';
import { CONTRACT_VERSION, validateRuleSet, formatIssue, type RuleSet } from '../contract/index.js';
import { formatLoadError, normalizeCode, type Example } from '../examples/index.js';
import { ingestSkills, type IngestOptions, type IngestResult } from '../ingest/index.js';
import { LlmError, type LlmProvider } from '../llm/index.js';
import { runRules, type Results, type SampleFile } from '../runner/index.js';
import { synthesizeConstruct, type ConstructOutcome } from './construct-loop.js';
import { synthesizeLexical, type LexicalOutcome } from './lexical.js';
import { buildModelSource, type ModelSourceInput } from './model-source.js';
import type { LexicalDoc, PromptLimits } from './prompts.js';
import type { ConstructSynthesis, SynthesisReport } from './synthesis-schema.js';

/** Content version of a draft Rule Set; `lsc export` (WP-10) assigns the real one. */
export const DRAFT_VERSION = '0.0.0-draft';

export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export interface CompileOptions {
  readonly skillsDir: string;
  readonly sampleDir?: string;
  readonly languageId: string;
  /** Use the session's guarded provider (budget + snippet log). */
  readonly provider: LlmProvider;
  readonly maxAttempts: number;
  readonly maxOutputTokens: number;
  readonly compilerVersion: string;
  /** Configured provider (and recordings, for a replay); adds `modelSource` to synthesis.json (D25 item 2). */
  readonly modelSource?: ModelSourceInput;
  readonly now?: () => Date;
  readonly limits?: PromptLimits;
  readonly ingest?: IngestOptions;
}

export interface CompileOutput {
  /** Draft Rule Set (validated and rejected rules); absent when no lexical settings could be established. */
  readonly ruleSet?: RuleSet;
  /** Runner results for the draft; absent with `ruleSet`. */
  readonly results?: Results;
  readonly synthesis: SynthesisReport;
  readonly ingest: IngestResult;
}

/** Default language id: the name of the directory holding `<skills-dir>` (e.g. `fixtures/toylang/skills` → `toylang`). */
export function defaultLanguageId(skillsDir: string): string {
  return basename(dirname(resolve(skillsDir)));
}

/** Every regular file under `dir`, recursively, as a `SampleFile`. Read only by the runner, never sent to a model. */
export function loadSampleFiles(dir: string): SampleFile[] {
  return FastGlob.sync('**/*', { cwd: dir, onlyFiles: true, dot: false })
    .sort()
    .map((relPath) => ({ path: relPath.split(sep).join('/'), content: readFileSync(join(dir, relPath), 'utf8') }));
}

/** General Skill files: those containing no inline example. They describe the language as a whole. */
export function generalSkillDocs(skillsDir: string, ingest: IngestResult): LexicalDoc[] {
  const withExamples = new Set<string>();
  for (const construct of ingest.constructs) {
    for (const example of construct.examples) {
      if (example.source.kind === 'inline') withExamples.add(example.source.skill);
    }
  }
  return ingest.sourceSkills
    .filter((skill) => !withExamples.has(skill.path))
    .map((skill) => ({ path: skill.path, text: normalizeCode(readFileSync(join(skillsDir, skill.path), 'utf8')) }));
}

function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toConstructSynthesis(outcome: ConstructOutcome): ConstructSynthesis {
  return {
    constructId: outcome.constructId,
    ...(outcome.ruleType !== undefined ? { ruleType: outcome.ruleType } : {}),
    status: outcome.status,
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    ...(outcome.rule !== undefined ? { ruleId: outcome.rule.id } : {}),
    attempts: outcome.attempts.map((a) => ({ ...a })),
  };
}

function lexicalSection(outcome: LexicalOutcome | undefined): SynthesisReport['lexical'] {
  if (outcome === undefined) return { status: 'not-attempted', attempts: [] };
  const attempts = outcome.attempts.map((a) => ({ ...a }));
  return outcome.status === 'accepted'
    ? { status: 'accepted', settings: outcome.settings, attempts }
    : { status: outcome.status, reason: outcome.reason, attempts };
}

export async function compileLanguage(options: CompileOptions): Promise<CompileOutput> {
  const now = options.now ?? ((): Date => new Date());
  const ingest = ingestSkills(options.skillsDir, options.ingest);
  const allExamples: Example[] = ingest.constructs.flatMap((c) => c.examples);

  let lexical: LexicalOutcome | undefined;
  const outcomes: ConstructOutcome[] = [];
  const notAttempted: ConstructSynthesis[] = [];
  let error: string | undefined;

  try {
    lexical = await synthesizeLexical(options.provider, {
      languageId: options.languageId,
      docs: generalSkillDocs(options.skillsDir, ingest),
      maxAttempts: options.maxAttempts,
      maxOutputTokens: options.maxOutputTokens,
      ...(options.limits !== undefined ? { limits: options.limits } : {}),
    });
    if (lexical.status === 'accepted') {
      for (const construct of ingest.constructs) {
        outcomes.push(
          await synthesizeConstruct(options.provider, {
            languageId: options.languageId,
            construct,
            allExamples,
            lexical: lexical.settings,
            maxAttempts: options.maxAttempts,
            maxOutputTokens: options.maxOutputTokens,
            ...(options.limits !== undefined ? { limits: options.limits } : {}),
          }),
        );
      }
    }
  } catch (err) {
    // Infrastructure errors (budget exhausted, provider failure, unknown recording) stop the compile (D17).
    if (!(err instanceof LlmError)) throw err;
    error = `${err.name}: ${err.message}`;
  }
  if (error !== undefined) {
    const done = new Set(outcomes.map((o) => o.constructId));
    for (const construct of ingest.constructs) {
      if (!done.has(construct.id)) {
        notAttempted.push({ constructId: construct.id, status: 'not-attempted', reason: 'the compile stopped before this construct', attempts: [] });
      }
    }
  }

  const constructs = [...outcomes.map(toConstructSynthesis), ...notAttempted];
  const attempts = [...(lexical?.attempts ?? []), ...outcomes.flatMap((o) => o.attempts)];
  const count = (status: ConstructSynthesis['status']): number => constructs.filter((c) => c.status === status).length;
  const status: SynthesisReport['status'] = error !== undefined ? 'aborted' : lexical?.status !== 'accepted' ? 'failed' : 'completed';
  const generatedAt = isoSeconds(now());

  const synthesis: SynthesisReport = {
    languageId: options.languageId,
    compilerVersion: options.compilerVersion,
    generatedAt,
    status,
    ...(error !== undefined
      ? { error }
      : lexical !== undefined && lexical.status !== 'accepted'
        ? { error: `lexical settings: ${lexical.reason}` }
        : {}),
    maxAttemptsPerConstruct: options.maxAttempts,
    lexical: lexicalSection(lexical),
    constructs,
    summary: {
      constructs: constructs.length,
      validated: count('validated'),
      rejected: count('rejected'),
      notJustified: count('not-justified'),
      skipped: count('skipped'),
      notAttempted: count('not-attempted'),
    },
    usage: {
      inputTokens: attempts.reduce((sum, a) => sum + a.usage.inputTokens, 0),
      outputTokens: attempts.reduce((sum, a) => sum + a.usage.outputTokens, 0),
      calls: attempts.length,
    },
    ...(options.modelSource !== undefined
      ? { modelSource: buildModelSource(options.modelSource, attempts.map((a) => a.requestHash)) }
      : {}),
    ingestDiagnostics: ingest.diagnostics.map(formatLoadError),
  };

  if (lexical?.status !== 'accepted') {
    return { synthesis, ingest };
  }

  const draft: RuleSet = {
    contractVersion: CONTRACT_VERSION,
    languageId: options.languageId,
    version: DRAFT_VERSION,
    compiledAt: generatedAt,
    compilerVersion: options.compilerVersion,
    sourceSkills: ingest.sourceSkills.map((s) => ({ path: s.path, sha256: s.sha256 })),
    ...lexical.settings,
    rules: outcomes.flatMap((o) => (o.rule !== undefined ? [o.rule] : [])),
  };
  const checked = validateRuleSet(draft);
  if (!checked.ok) {
    // Every rule passed validateRule individually; a failure here is a bug in this module.
    throw new Error(`internal error: the draft Rule Set is invalid:\n${checked.issues.map(formatIssue).join('\n')}`);
  }

  // Only now, after the last model call, is the repository sample read, and only by the runner.
  const sampleFiles = options.sampleDir !== undefined ? loadSampleFiles(options.sampleDir) : [];
  const base = runRules(checked.ruleSet, allExamples, sampleFiles, { now: () => generatedAt, compilerVersion: options.compilerVersion });
  const rejected = outcomes.flatMap((o) => (o.status === 'rejected' && o.result !== undefined ? [{ ...o.result, sampleMatches: [] }] : []));
  const byId = new Map([...base.rules, ...rejected].map((r) => [r.ruleId, r] as const));
  const results: Results = {
    ...base,
    rules: checked.ruleSet.rules.flatMap((r) => {
      const found = byId.get(r.id);
      return found !== undefined ? [found] : [];
    }),
    ok: base.ok && rejected.length === 0,
  };

  return { ruleSet: checked.ruleSet, results, synthesis, ingest };
}
