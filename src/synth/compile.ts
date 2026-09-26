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
import { ingestSkills, type Construct, type IngestOptions, type IngestResult } from '../ingest/index.js';
import { LlmError, type LlmProvider } from '../llm/index.js';
import { runRules, type Results, type SampleFile } from '../runner/index.js';
import { synthesizeConstruct, type ConstructOutcome } from './construct-loop.js';
import { synthesizeLexical, type LexicalOutcome } from './lexical.js';
import { buildModelSource, type ModelSourceInput } from './model-source.js';
import type { LexicalDoc, PromptLimits } from './prompts.js';
import type { LexicalSettings } from './schema.js';
import type { ConstructSynthesis, SynthesisReport } from './synthesis-schema.js';

/** Content version of a draft Rule Set; `lsc export` (WP-10) assigns the real one. */
export const DRAFT_VERSION = '0.0.0-draft';

export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/**
 * What a construct callback decided (WP-10 recompile). `outcome` set: the
 * previous rule is reused as it is, no model call. `outcome` absent: the
 * construct is synthesised as usual. `note` says why, either way, and goes
 * into synthesis.json (`reuseNote`).
 */
export interface ConstructReuse {
  readonly outcome?: ConstructOutcome;
  readonly note: string;
}

/**
 * Reuse of a previous exported Rule Set (WP-10 brief: "Unchanged Skill files
 * reuse previous rules without a model call"). The decisions themselves are
 * made by src/release (`planReuse`, `reuseConstruct`); this module only
 * applies them, so the runner still decides (a reused rule has been re-tested
 * on the current examples by the callback).
 */
export interface CompileReuse {
  /** Version of the previous Rule Set; recorded as `reusedFrom`. */
  readonly previousVersion: string;
  /** `--force`: recorded in synthesis.json (`reuse.force`). */
  readonly force: boolean;
  /** Lexical settings to use instead of calling `synthesizeLexical`; absent: synthesise them. */
  readonly lexical?: { readonly settings: LexicalSettings; readonly note: string };
  /** Why the lexical settings are synthesised again (when `lexical` is absent). */
  readonly lexicalNote?: string;
  /** Called before `synthesizeConstruct`, with the lexical settings of this compile. */
  readonly construct?: (construct: Construct, lexical: LexicalSettings, allExamples: readonly Example[]) => ConstructReuse | undefined;
}

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
  /**
   * Recompile against a previous exported Rule Set (`lsc compile --previous`).
   * Built from this compile's ingest, which the reuse plan needs.
   */
  readonly reuse?: (ingest: IngestResult) => CompileReuse;
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

/** One construct's result, with how the reuse plan treated it when a previous Rule Set was given. */
interface Processed {
  readonly outcome: ConstructOutcome;
  readonly reusedFrom?: string;
  readonly reuseNote?: string;
}

function toConstructSynthesis({ outcome, reusedFrom, reuseNote }: Processed): ConstructSynthesis {
  return {
    constructId: outcome.constructId,
    ...(outcome.ruleType !== undefined ? { ruleType: outcome.ruleType } : {}),
    status: outcome.status,
    ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
    ...(outcome.rule !== undefined ? { ruleId: outcome.rule.id } : {}),
    ...(reusedFrom !== undefined ? { reusedFrom } : {}),
    ...(reuseNote !== undefined ? { reuseNote } : {}),
    attempts: outcome.attempts.map((a) => ({ ...a })),
  };
}

/** The lexical settings of this compile: synthesised (`outcome`) or reused from the previous Rule Set. */
type LexicalState =
  | { readonly kind: 'synthesised'; readonly outcome: LexicalOutcome }
  | { readonly kind: 'reused'; readonly settings: LexicalSettings; readonly from: string; readonly note: string };

function settingsOf(state: LexicalState | undefined): LexicalSettings | undefined {
  if (state === undefined) return undefined;
  if (state.kind === 'reused') return state.settings;
  return state.outcome.status === 'accepted' ? state.outcome.settings : undefined;
}

function lexicalSection(state: LexicalState | undefined, reuse: CompileReuse | undefined): SynthesisReport['lexical'] {
  if (state === undefined) return { status: 'not-attempted', attempts: [] };
  if (state.kind === 'reused') return { status: 'reused', reusedFrom: state.from, reuseNote: state.note, settings: state.settings, attempts: [] };
  const { outcome } = state;
  const attempts = outcome.attempts.map((a) => ({ ...a }));
  const note = reuse?.lexicalNote !== undefined ? { reuseNote: reuse.lexicalNote } : {};
  return outcome.status === 'accepted'
    ? { status: 'accepted', ...note, settings: outcome.settings, attempts }
    : { status: outcome.status, reason: outcome.reason, ...note, attempts };
}

export async function compileLanguage(options: CompileOptions): Promise<CompileOutput> {
  const now = options.now ?? ((): Date => new Date());
  const ingest = ingestSkills(options.skillsDir, options.ingest);
  const allExamples: Example[] = ingest.constructs.flatMap((c) => c.examples);

  const reuse = options.reuse?.(ingest);

  let lexicalState: LexicalState | undefined;
  const processed: Processed[] = [];
  const notAttempted: ConstructSynthesis[] = [];
  let error: string | undefined;

  try {
    if (reuse?.lexical !== undefined) {
      lexicalState = { kind: 'reused', settings: reuse.lexical.settings, from: reuse.previousVersion, note: reuse.lexical.note };
    } else {
      lexicalState = {
        kind: 'synthesised',
        outcome: await synthesizeLexical(options.provider, {
          languageId: options.languageId,
          docs: generalSkillDocs(options.skillsDir, ingest),
          maxAttempts: options.maxAttempts,
          maxOutputTokens: options.maxOutputTokens,
          ...(options.limits !== undefined ? { limits: options.limits } : {}),
        }),
      };
    }
    const settings = settingsOf(lexicalState);
    if (settings !== undefined) {
      for (const construct of ingest.constructs) {
        const decided = reuse?.construct?.(construct, settings, allExamples);
        if (decided?.outcome !== undefined && reuse !== undefined) {
          processed.push({ outcome: decided.outcome, reusedFrom: reuse.previousVersion, reuseNote: decided.note });
          continue;
        }
        const outcome = await synthesizeConstruct(options.provider, {
          languageId: options.languageId,
          construct,
          allExamples,
          lexical: settings,
          maxAttempts: options.maxAttempts,
          maxOutputTokens: options.maxOutputTokens,
          ...(options.limits !== undefined ? { limits: options.limits } : {}),
        });
        processed.push({ outcome, ...(decided !== undefined ? { reuseNote: decided.note } : {}) });
      }
    }
  } catch (err) {
    // Infrastructure errors (budget exhausted, provider failure, unknown recording) stop the compile (D17).
    if (!(err instanceof LlmError)) throw err;
    error = `${err.name}: ${err.message}`;
  }
  const outcomes = processed.map((p) => p.outcome);
  const lexicalSettings = settingsOf(lexicalState);
  const lexicalOutcome = lexicalState?.kind === 'synthesised' ? lexicalState.outcome : undefined;
  if (error !== undefined) {
    const done = new Set(outcomes.map((o) => o.constructId));
    for (const construct of ingest.constructs) {
      if (!done.has(construct.id)) {
        notAttempted.push({ constructId: construct.id, status: 'not-attempted', reason: 'the compile stopped before this construct', attempts: [] });
      }
    }
  }

  const constructs = [...processed.map(toConstructSynthesis), ...notAttempted];
  const attempts = [...(lexicalOutcome?.attempts ?? []), ...outcomes.flatMap((o) => o.attempts)];
  const count = (status: ConstructSynthesis['status']): number => constructs.filter((c) => c.status === status).length;
  const status: SynthesisReport['status'] = error !== undefined ? 'aborted' : lexicalSettings === undefined ? 'failed' : 'completed';
  const generatedAt = isoSeconds(now());

  const synthesis: SynthesisReport = {
    languageId: options.languageId,
    compilerVersion: options.compilerVersion,
    generatedAt,
    status,
    ...(error !== undefined
      ? { error }
      : lexicalOutcome !== undefined && lexicalOutcome.status !== 'accepted'
        ? { error: `lexical settings: ${lexicalOutcome.reason}` }
        : {}),
    maxAttemptsPerConstruct: options.maxAttempts,
    ...(reuse !== undefined ? { reuse: { previousVersion: reuse.previousVersion, force: reuse.force } } : {}),
    lexical: lexicalSection(lexicalState, reuse),
    constructs,
    summary: {
      constructs: constructs.length,
      validated: count('validated'),
      rejected: count('rejected'),
      notJustified: count('not-justified'),
      skipped: count('skipped'),
      notAttempted: count('not-attempted'),
      ...(reuse !== undefined ? { reused: constructs.filter((c) => c.reusedFrom !== undefined).length } : {}),
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

  if (lexicalSettings === undefined) {
    return { synthesis, ingest };
  }

  const draft: RuleSet = {
    contractVersion: CONTRACT_VERSION,
    languageId: options.languageId,
    version: DRAFT_VERSION,
    compiledAt: generatedAt,
    compilerVersion: options.compilerVersion,
    sourceSkills: ingest.sourceSkills.map((s) => ({ path: s.path, sha256: s.sha256 })),
    ...lexicalSettings,
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
