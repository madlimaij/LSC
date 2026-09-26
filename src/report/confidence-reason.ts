/**
 * A human reason for a rule's confidence, so the report never shows a
 * confidence level without saying which threshold was met or missed
 * (docs/PLAN.md §6.3, D8; CLAUDE.md "Never show a confidence level without
 * the reason for it").
 *
 * The thresholds mirror `computeConfidence` (`src/runner/confidence.ts`)
 * exactly; they are re-stated here (not imported) because this module
 * explains *why*, which needs the individual comparisons, not just the
 * final verdict. If the formula in `src/runner/confidence.ts` ever changes,
 * this file must change with it.
 */
import type { RuleResult } from '../runner/index.js';

export interface ConfidenceStats {
  readonly positiveTotal: number;
  readonly positivePassed: number;
  readonly negativeTotal: number;
  readonly negativeFailed: number;
  readonly crossNegativeFailed: number;
}

/** Recomputes the counts `computeConfidence` was fed, from the rule's own recorded example results. */
export function deriveConfidenceStats(rule: RuleResult): ConfidenceStats {
  const own = rule.examples.filter((example) => example.role === 'own');
  const positive = own.filter((example) => example.polarity === 'positive');
  const negative = own.filter((example) => example.polarity === 'negative');
  return {
    positiveTotal: positive.length,
    positivePassed: positive.filter((example) => example.passed).length,
    negativeTotal: negative.length,
    negativeFailed: negative.filter((example) => !example.passed).length,
    crossNegativeFailed: rule.crossNegativeFailures.length,
  };
}

function plural(n: number, word: string): string {
  return `${String(n)} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Explains `computed` (or, when it is `undefined`, why the rule passes no
 * positive example and is therefore a candidate for `status: "rejected"`,
 * plan §6.3).
 */
export function explainConfidence(stats: ConfidenceStats, computed: RuleResult['computedConfidence']): string {
  const { positiveTotal, positivePassed, negativeTotal, negativeFailed, crossNegativeFailed } = stats;

  if (positivePassed <= 0) {
    return `rejected — passes no positive example (${plural(positiveTotal, 'own positive example')} tested); a rule must pass at least one to receive any confidence level (docs/PLAN.md §6.3)`;
  }

  const allPositivesPass = positivePassed === positiveTotal;
  const allNegativesPass = negativeFailed === 0;
  const totalExamples = positiveTotal + negativeTotal;
  const totalPassed = positivePassed + (negativeTotal - negativeFailed);
  const passRatePct = totalExamples === 0 ? 100 : Math.round((totalPassed / totalExamples) * 1000) / 10;

  if (crossNegativeFailed > 0) {
    return (
      `low — matched ${plural(crossNegativeFailed, 'negative example')} of other constructs ` +
      `("cross-construct negatives"); this blocks high and medium regardless of its own pass rate (D19 a)`
    );
  }

  if (computed === 'high') {
    return (
      `high — ${String(positivePassed)}/${String(positiveTotal)} own positive and ` +
      `${String(negativeTotal - negativeFailed)}/${String(negativeTotal)} own negative examples pass (100%), ` +
      `meeting the high threshold (≥5 positive, ≥2 negative, all passing)`
    );
  }

  if (computed === 'medium') {
    const missedForHigh: string[] = [];
    if (positiveTotal < 5) missedForHigh.push(`only ${plural(positiveTotal, 'positive example')} (high needs ≥5)`);
    if (negativeTotal < 2) missedForHigh.push(`only ${plural(negativeTotal, 'negative example')} (high needs ≥2)`);
    if (!allPositivesPass) {
      missedForHigh.push(`${plural(positiveTotal - positivePassed, 'positive example')} failed (high needs 100%)`);
    }
    return (
      `medium — meets the medium threshold (≥3 positive, ≥90% pass rate, no failing own negative) but not high: ` +
      `${missedForHigh.length > 0 ? missedForHigh.join('; ') : 'high threshold not met'}`
    );
  }

  // low
  const missedForMedium: string[] = [];
  if (positiveTotal < 3) missedForMedium.push(`only ${plural(positiveTotal, 'positive example')} (medium needs ≥3)`);
  if (passRatePct < 90) missedForMedium.push(`pass rate is ${String(passRatePct)}% (medium needs ≥90%)`);
  if (!allNegativesPass) {
    missedForMedium.push(`${plural(negativeFailed, 'own negative example')} failed (medium needs none failing)`);
  }
  return (
    `low — passes at least one positive example, but not the medium threshold: ` +
    `${missedForMedium.length > 0 ? missedForMedium.join('; ') : 'medium threshold not met'}`
  );
}

/**
 * `explainConfidence` returns a string starting with the level word itself ("high — ...",
 * "rejected — ..."), because it must be a complete, self-contained explanation on its own (it is
 * also used, e.g., by any future consumer that shows the reason without a separate level label).
 * The rule-section confidence line already shows the level once, in its own `**level**`; showing it
 * again at the start of the reason read as "high — high — ..." (G2 round, D27 item f). This strips
 * that redundant leading "<level> — " for display next to an already-shown level, without changing
 * what `explainConfidence` itself returns.
 */
export function reasonWithoutLeadingLevel(reason: string): string {
  return reason.replace(/^(high|medium|low|rejected)\s+—\s+/, '');
}

/** Notes a mismatch between the Rule Set's declared confidence and what the last run computed. */
export function declaredMismatchNote(rule: Pick<RuleResult, 'declaredConfidence' | 'computedConfidence' | 'confidenceMatchesDeclared'>): string | undefined {
  if (rule.confidenceMatchesDeclared) return undefined;
  const computed = rule.computedConfidence ?? 'rejected (no computed confidence)';
  return `declared confidence is "${rule.declaredConfidence}" but the last run computed "${computed}" — the Rule Set was not re-exported after this result, or it was hand-edited`;
}
