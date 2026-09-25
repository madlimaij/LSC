/**
 * Public API of the test runner (docs/PLAN.md §7, WP-05 brief).
 *
 * `runRules` measures a Rule Set against labelled examples and an optional
 * repository sample, fully offline: it imports nothing from `src/llm`.
 */
import type { RuleSet } from '../contract/index.js';
import type { Example } from '../examples/index.js';
import { computeCoverage } from './coverage.js';
import { runRuleAgainstExamples } from './rule-run.js';
import { reviewedMatchKey, scanSampleFiles, type SampleFile } from './sample-run.js';
import type { Results, SampleMatch } from './results-schema.js';

export * from './glob.js';
export * from './confidence.js';
export * from './compare.js';
export * from './coverage.js';
export * from './rule-run.js';
export * from './sample-run.js';
export * from './results-schema.js';

export interface RunRulesOptions {
  /** Injectable clock for deterministic tests. Defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
  /** `lsc` build version to record (defaults to `"0.0.0-dev"`; the CLI passes the real one). */
  readonly compilerVersion?: string;
}

/**
 * Runs every `validated` rule in `ruleSet` against `examples` (its own
 * examples plus cross-construct negatives, plan §8 step 4) and, if given,
 * scans `sampleFiles` for unlabelled matches (plan §6.2, D9).
 */
export function runRules(
  ruleSet: RuleSet,
  examples: readonly Example[],
  sampleFiles: readonly SampleFile[] = [],
  options: RunRulesOptions = {},
): Results {
  const validatedRules = ruleSet.rules.filter((rule) => rule.status === 'validated');

  const reviewedKeys = new Set(
    examples
      .map((example) => example.source)
      .filter((source): source is Extract<Example['source'], { kind: 'review' }> => source.kind === 'review')
      .map((source) => reviewedMatchKey(source.ruleId, source.sampleFile, source.sampleLine)),
  );

  const sampleScan = scanSampleFiles(validatedRules, ruleSet.fileMatchers, ruleSet, sampleFiles, reviewedKeys);

  const sampleMatchesByRule = new Map<string, SampleMatch[]>();
  for (const match of sampleScan.matches) {
    const list = sampleMatchesByRule.get(match.ruleId) ?? [];
    list.push(match);
    sampleMatchesByRule.set(match.ruleId, list);
  }

  const rules = validatedRules.map((rule) => {
    const result = runRuleAgainstExamples(rule, ruleSet, examples);
    return { ...result, sampleMatches: sampleMatchesByRule.get(rule.id) ?? [] };
  });

  const coverage = computeCoverage(ruleSet.rules, examples);
  const ok = rules.every((rule) => rule.tests.failed === 0);

  return {
    languageId: ruleSet.languageId,
    ruleSetVersion: ruleSet.version,
    compilerVersion: options.compilerVersion ?? '0.0.0-dev',
    generatedAt: options.now?.() ?? new Date().toISOString(),
    rules,
    coverage,
    sampleWarnings: sampleScan.warnings,
    filesScanned: sampleScan.filesScanned,
    ok,
  };
}
