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
 */
import type { Confidence } from '../contract/index.js';

export interface ConfidenceInput {
  /** Number of the rule's own positive examples tested. */
  readonly positiveTotal: number;
  /** How many of those positive examples passed (plan §6.2). */
  readonly positivePassed: number;
  /** Number of negative examples tested (the rule's own construct plus every other construct's negatives). */
  readonly negativeTotal: number;
  /** How many of those negative examples failed (the rule produced a match). */
  readonly negativeFailed: number;
}

/**
 * `undefined` means the rule passes no positive example at all — not a
 * confidence level; a candidate for `status: "rejected"` (docs/PLAN.md §6.3).
 */
export function computeConfidence(input: ConfidenceInput): Confidence | undefined {
  const { positiveTotal, positivePassed, negativeTotal, negativeFailed } = input;
  if (positivePassed <= 0) return undefined;

  const allPositivesPass = positivePassed === positiveTotal;
  const allNegativesPass = negativeFailed === 0;
  const totalExamples = positiveTotal + negativeTotal;
  const totalPassed = positivePassed + (negativeTotal - negativeFailed);
  const passRate = totalExamples === 0 ? 0 : totalPassed / totalExamples;

  if (positiveTotal >= 5 && negativeTotal >= 2 && allPositivesPass && allNegativesPass) return 'high';
  if (positiveTotal >= 3 && passRate >= 0.9 && allNegativesPass) return 'medium';
  return 'low';
}
