/**
 * Runs one rule against the labelled examples (WP-05 brief): its own
 * examples (from `sourceEvidence[].exampleIds`) plus, per docs/PLAN.md §8
 * step 4 and the WP-05 acceptance criteria, every negative example of every
 * other construct ("cross-construct negatives").
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
  let passed = 0;
  let failed = 0;
  const failingExampleIds: string[] = [];

  for (const { example, role } of toTest) {
    const prepared = prepareFile(maskingConfig, example.code);
    const actual = matchRule(rule, prepared);
    const diff = diffExample(example.expected, actual);
    if (diff.passed) passed += 1;
    else {
      failed += 1;
      failingExampleIds.push(example.id);
    }
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

  const positive = exampleResults.filter((result) => result.polarity === 'positive');
  const negative = exampleResults.filter((result) => result.polarity === 'negative');
  const computedConfidence = computeConfidence({
    positiveTotal: positive.length,
    positivePassed: positive.filter((result) => result.passed).length,
    negativeTotal: negative.length,
    negativeFailed: negative.filter((result) => !result.passed).length,
  });

  return {
    ruleId: rule.id,
    type: rule.type,
    ownExampleIds: ownIds,
    missingExampleIds,
    examples: exampleResults,
    tests: { passed, failed, failingExampleIds },
    declaredConfidence: rule.confidence,
    ...(computedConfidence !== undefined ? { computedConfidence } : {}),
    confidenceMatchesDeclared: computedConfidence === rule.confidence,
  };
}
