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
import type { SynthesisConstructView, SynthesisUsageView, SynthesisView } from './model.js';
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
  'synthesis.json (src/synth/synthesis-schema.ts) does not record provider, model or recording origin as of WP-09; ' +
  'only token usage is available (see this package\'s WP-07 completion note).';

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
  }));

  const usage: SynthesisUsageView = { inputTokens: synthesis.usage.inputTokens, outputTokens: synthesis.usage.outputTokens, calls: synthesis.usage.calls };

  return {
    status: synthesis.status,
    ...(synthesis.error !== undefined ? { error: synthesis.error } : {}),
    lexicalStatus: synthesis.lexical.status,
    ...(synthesis.lexical.reason !== undefined ? { lexicalReason: synthesis.lexical.reason } : {}),
    constructs,
    summary: { ...synthesis.summary },
    usage,
    providerNote: PROVIDER_NOTE,
  };
}
