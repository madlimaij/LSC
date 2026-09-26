/**
 * Turns a `synthesis.json` (WP-09, src/synth/synthesis-schema.ts) into the
 * report's view of it (D25 item 2: "each construct's outcome and reasons
 * ... not justified, rejected, not attempted, number of attempts, and
 * per-attempt problems in short form"). Import-only: WP-07 does not own
 * `src/synth/`.
 *
 * `describeFailure` (src/synth/construct-loop.ts) puts a failing example's
 * *captured text* into `problems` (table names, callee names, …), tagged
 * `[review example]` when the example came from `reviews.yaml` — i.e.
 * repository-sample text (D9, plan §8: "no file from the repository sample
 * is ever sent to the model", and it must not leak into a report either).
 * `redactReviewProblem` keeps the example id, its polarity/role and the
 * `[review example]` tag, and drops everything after it.
 */
import type { LexicalAttemptView, SynthesisConstructView, SynthesisModelSourceView, SynthesisUsageView, SynthesisView } from './model.js';
import type { SynthesisReport } from '../synth/synthesis-schema.js';

const REVIEW_TAG = '[review example]';

/** Withholds a review example's captured details, keeping only its id/role and the fact that it is a review example. */
export function redactReviewProblem(problem: string): string {
  const tagAt = problem.indexOf(REVIEW_TAG);
  if (tagAt === -1) return problem;
  const head = problem.slice(0, tagAt + REVIEW_TAG.length);
  return `${head} (repository-sample details withheld from the report; see \`lsc review\`)`;
}

const PROVIDER_NOTE =
  'synthesis.json (src/synth/synthesis-schema.ts) does not record provider, model or recording origin; ' +
  'only token usage is available. (This file was written before modelSource was added — see this package\'s WP-07 follow-up completion note.)';

/** Builds the report's view of `synthesis.json`'s `modelSource`, when present (D25 item 2). */
function buildModelSourceView(synthesis: SynthesisReport): SynthesisModelSourceView | undefined {
  const m = synthesis.modelSource;
  if (m === undefined) return undefined;
  return {
    mode: m.mode,
    configuredProvider: m.configuredProvider,
    provider: m.provider,
    model: m.model,
    origin: m.origin,
    summary: m.summary,
    // hand-written: every answer was hand-written. mixed: at least some were (D25 item 2 / WP-07 follow-up:
    // "when the origin is hand-written or mixed, state plainly that the rules were not produced by a real model").
    notRealModel: m.origin === 'hand-written' || m.origin === 'mixed',
  };
}

/** Builds the report's view of `synthesis.json`'s `lexical.attempts` (D27 item e). No repository-sample text is ever involved in a lexical proposal, so nothing here needs redaction. */
function buildLexicalAttempts(synthesis: SynthesisReport): LexicalAttemptView[] {
  return synthesis.lexical.attempts.map((attempt) => {
    const p = attempt.proposal;
    return {
      attempt: attempt.attempt,
      outcome: attempt.outcome,
      problems: attempt.problems,
      ...(p !== undefined
        ? {
            proposal: {
              fileMatchers: p.fileMatchers,
              ...(p.lineComment !== undefined ? { lineComment: p.lineComment } : {}),
              ...(p.blockComment !== undefined ? { blockComment: p.blockComment } : {}),
              ...(p.stringDelimiters !== undefined ? { stringDelimiters: p.stringDelimiters } : {}),
              ...(p.notJustified !== undefined ? { notJustified: p.notJustified } : {}),
            },
          }
        : {}),
    };
  });
}

/** Builds the report's view of one `synthesis.json` (D25 item 2). */
export function buildSynthesisView(synthesis: SynthesisReport): SynthesisView {
  const constructs: SynthesisConstructView[] = synthesis.constructs.map((construct) => ({
    constructId: construct.constructId,
    ...(construct.ruleType !== undefined ? { ruleType: construct.ruleType } : {}),
    status: construct.status,
    ...(construct.reason !== undefined ? { reason: construct.reason } : {}),
    ...(construct.ruleId !== undefined ? { ruleId: construct.ruleId } : {}),
    attemptCount: construct.attempts.length,
    attempts: construct.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      outcome: attempt.outcome,
      problems: attempt.problems.map(redactReviewProblem),
    })),
    // WP-10 recompile (--previous): no repository-sample text is ever involved in a reuse decision
    // (it compares Skill-file hashes and re-runs the runner), so neither field needs redaction.
    ...(construct.reusedFrom !== undefined ? { reusedFrom: construct.reusedFrom } : {}),
    ...(construct.reuseNote !== undefined ? { reuseNote: construct.reuseNote } : {}),
  }));

  const usage: SynthesisUsageView = { inputTokens: synthesis.usage.inputTokens, outputTokens: synthesis.usage.outputTokens, calls: synthesis.usage.calls };
  const modelSource = buildModelSourceView(synthesis);

  return {
    status: synthesis.status,
    ...(synthesis.error !== undefined ? { error: synthesis.error } : {}),
    lexicalStatus: synthesis.lexical.status,
    ...(synthesis.lexical.reason !== undefined ? { lexicalReason: synthesis.lexical.reason } : {}),
    ...(synthesis.lexical.reusedFrom !== undefined ? { lexicalReusedFrom: synthesis.lexical.reusedFrom } : {}),
    ...(synthesis.lexical.reuseNote !== undefined ? { lexicalReuseNote: synthesis.lexical.reuseNote } : {}),
    lexicalAttempts: buildLexicalAttempts(synthesis),
    constructs,
    summary: {
      constructs: synthesis.summary.constructs,
      validated: synthesis.summary.validated,
      rejected: synthesis.summary.rejected,
      notJustified: synthesis.summary.notJustified,
      skipped: synthesis.summary.skipped,
      notAttempted: synthesis.summary.notAttempted,
      ...(synthesis.summary.reused !== undefined ? { reused: synthesis.summary.reused } : {}),
    },
    usage,
    ...(synthesis.reuse !== undefined ? { reuse: synthesis.reuse } : {}),
    // modelSource replaces providerNote (WP-07 follow-up, D25 item 2): older synthesis.json files
    // (no modelSource) still get a clear "not recorded" note instead of the section going silent.
    ...(modelSource !== undefined ? { modelSource } : { providerNote: PROVIDER_NOTE }),
  };
}
