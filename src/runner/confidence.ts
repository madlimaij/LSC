/**
 * The confidence formula (docs/PLAN.md §6.3, D8): computed once here so
 * WP-09 (synthesis) and WP-10 (export) use exactly the same rule. Never
 * assigned by a model.
 *
 * - high — at least 5 positive and 2 negative examples, 100% pass
 * - medium — at least 3 positive examples, at least 90% pass, no failing
 *   negative example
 * - low — everything else that still passes at least one positive example
 * - (rejected is not computed here: "passes no positive example" is
 *   `undefined` below; "exceeds the refinement budget while failing" is a
 *   synthesis-loop concern, not a property of one test run.)
 *
 * D19a (owner decision, 2026-09-26): the "≥2 negatives" threshold and the
 * pass rate use only the construct's own examples (`negativeTotal`/
 * `negativeFailed` below), never cross-construct negatives. But a rule that
 * matched *any* cross-construct negative example still cannot be `high` or
 * `medium` — it matched text it must not match — so `crossNegativeFailed`
 * forces `low` when positive.
 */
import type { Confidence } from '../contract/index.js';

export interface ConfidenceInput {
  /** Number of the rule's own positive examples tested. */
  readonly positiveTotal: number;
  /** How many of those positive examples passed (plan §6.2). */
  readonly positivePassed: number;
  /** Number of the rule's own negative examples tested (D19a: own construct only, not cross-construct negatives). */
  readonly negativeTotal: number;
  /** How many of the rule's own negative examples failed (the rule produced a match). */
  readonly negativeFailed: number;
  /**
   * How many negative examples of *other* constructs ("cross-construct
   * negatives", plan §8 step 4) this rule matched. Never counted in
   * `negativeTotal`/`negativeFailed` or the pass rate (D19a), but any value
   * above 0 blocks `high`/`medium` regardless of the rule's own statistics.
   * Defaults to 0.
   */
  readonly crossNegativeFailed?: number;
}

/**
 * `undefined` means the rule passes no positive example at all — not a
 * confidence level; a candidate for `status: "rejected"` (docs/PLAN.md §6.3).
 */
export function computeConfidence(input: ConfidenceInput): Confidence | undefined {
  const { positiveTotal, positivePassed, negativeTotal, negativeFailed, crossNegativeFailed = 0 } = input;
  if (positivePassed <= 0) return undefined;

  const allPositivesPass = positivePassed === positiveTotal;
  const allNegativesPass = negativeFailed === 0;
  const totalExamples = positiveTotal + negativeTotal;
  const totalPassed = positivePassed + (negativeTotal - negativeFailed);
  const passRate = totalExamples === 0 ? 0 : totalPassed / totalExamples;

  if (crossNegativeFailed > 0) return 'low';
  if (positiveTotal >= 5 && negativeTotal >= 2 && allPositivesPass && allNegativesPass) return 'high';
  if (positiveTotal >= 3 && passRate >= 0.9 && allNegativesPass) return 'medium';
  return 'low';
}
