/**
 * Runs one rule against the labelled examples (WP-05 brief): its own
 * examples (from `sourceEvidence[].exampleIds`) plus, per docs/PLAN.md §8
 * step 4 and the WP-05 acceptance criteria, every negative example of every
 * other construct ("cross-construct negatives").
 *
 * D19a (owner decision, 2026-09-26): `tests.passed`/`tests.failed` (and the
 * confidence formula's pass rate and "≥2 negatives" threshold) count only
 * the rule's own examples — exactly what `coverage.ts` already counts. A
 * match on a cross-construct negative still fails the rule (reported
 * separately in `crossNegativeFailures`, blocks `high`/`medium` confidence,
 * and is not `ok` — see `index.ts`'s `ok` computation).
 */
import type { Rule } from '../contract/index.js';
import { matchRule } from '../engines/match-rule.js';
import type { CommentStringConfig } from '../engines/masking.js';
import { prepareFile } from '../engines/prepare.js';
import type { Example } from '../examples/index.js';
import { diffExample } from './compare.js';
import { computeConfidence } from './confidence.js';
import type { RuleResult } from './results-schema.js';

/** Every example id this rule cites as evidence (deduplicated, first-seen order). */
export function ownExampleIdsOf(rule: Rule): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const evidence of rule.sourceEvidence) {
    for (const id of evidence.exampleIds) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

/** Excludes `sampleMatches`, filled in by the caller once every rule has run (index.ts). */
export type RuleResultWithoutSamples = Omit<RuleResult, 'sampleMatches'>;

export function runRuleAgainstExamples(
  rule: Rule,
  maskingConfig: CommentStringConfig,
  examples: readonly Example[],
): RuleResultWithoutSamples {
  const byId = new Map(examples.map((example) => [example.id, example] as const));
  const ownIds = ownExampleIdsOf(rule);
  const ownSet = new Set(ownIds);
  const missingExampleIds = ownIds.filter((id) => !byId.has(id));

  const toTest: { example: Example; role: 'own' | 'cross-negative' }[] = [];
  for (const id of ownIds) {
    const example = byId.get(id);
    if (example !== undefined) toTest.push({ example, role: 'own' });
  }
  for (const example of examples) {
    if (example.polarity === 'negative' && !ownSet.has(example.id)) {
      toTest.push({ example, role: 'cross-negative' });
    }
  }

  const exampleResults: RuleResultWithoutSamples['examples'] = [];

  for (const { example, role } of toTest) {
    const prepared = prepareFile(maskingConfig, example.code);
    const actual = matchRule(rule, prepared);
    const diff = diffExample(example.expected, actual);
    exampleResults.push({
      exampleId: example.id,
      construct: example.construct,
      polarity: example.polarity,
      role,
      passed: diff.passed,
      missed: diff.missed,
      unexpected: diff.unexpected,
      wrongCaptures: diff.wrongCaptures,
    });
  }

  // D19a: tests.passed/failed count only the rule's own examples.
  const ownResults = exampleResults.filter((result) => result.role === 'own');
  const passed = ownResults.filter((result) => result.passed).length;
  const failed = ownResults.length - passed;
  const failingExampleIds = ownResults.filter((result) => !result.passed).map((result) => result.exampleId);

  // Cross-construct negative failures are reported separately (D19a) and never counted in tests.passed/failed.
  const crossNegativeFailures = exampleResults
    .filter((result) => result.role === 'cross-negative' && !result.passed)
    .map((result) => result.exampleId);

  const positive = ownResults.filter((result) => result.polarity === 'positive');
  const negative = ownResults.filter((result) => result.polarity === 'negative');
  const computedConfidence = computeConfidence({
    positiveTotal: positive.length,
    positivePassed: positive.filter((result) => result.passed).length,
    negativeTotal: negative.length,
    negativeFailed: negative.filter((result) => !result.passed).length,
    crossNegativeFailed: crossNegativeFailures.length,
  });

  return {
    ruleId: rule.id,
    type: rule.type,
    ownExampleIds: ownIds,
    missingExampleIds,
    examples: exampleResults,
    tests: { passed, failed, failingExampleIds },
    crossNegativeFailures,
    declaredConfidence: rule.confidence,
    ...(computedConfidence !== undefined ? { computedConfidence } : {}),
    confidenceMatchesDeclared: computedConfidence === rule.confidence,
  };
}
