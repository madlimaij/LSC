/**
 * Whether a rule's last test run is trustworthy enough to call it done
 * (docs/PLAN.md §6.2/§6.3, D19 a). Mirrors the `ok` computation in
 * `src/runner/index.ts` and `src/cli/commands/test.ts`'s `printSummary`
 * (WP-05), duplicated here on purpose: `src/report/` does not own those
 * files and must not edit them, but the report needs the same, single
 * definition of "this rule's result is fine" for every section it renders.
 */
import type { RuleResult } from '../runner/index.js';

export function isRuleOk(rule: Pick<RuleResult, 'tests' | 'crossNegativeFailures' | 'missingExampleIds' | 'computedConfidence'>): boolean {
  return (
    rule.tests.failed === 0 &&
    rule.crossNegativeFailures.length === 0 &&
    rule.missingExampleIds.length === 0 &&
    rule.computedConfidence !== undefined
  );
}
