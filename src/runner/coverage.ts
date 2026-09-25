/**
 * Coverage summary (WP-05 brief): which rule types have a validated rule,
 * and which constructs have too few examples for `high` confidence
 * (docs/PLAN.md §6.3: at least 5 positive and 2 negative examples).
 */
import { RULE_TYPES, type Rule } from '../contract/index.js';
import type { Example } from '../examples/index.js';
import type { Coverage } from './results-schema.js';

export function computeCoverage(rules: readonly Rule[], examples: readonly Example[]): Coverage {
  const validatedTypes = new Set(rules.filter((rule) => rule.status === 'validated').map((rule) => rule.type));
  const ruleTypesCovered = RULE_TYPES.filter((type) => validatedTypes.has(type));
  const ruleTypesMissing = RULE_TYPES.filter((type) => !validatedTypes.has(type));

  const counts = new Map<string, { positive: number; negative: number }>();
  for (const example of examples) {
    const entry = counts.get(example.construct) ?? { positive: 0, negative: 0 };
    if (example.polarity === 'positive') entry.positive += 1;
    else entry.negative += 1;
    counts.set(example.construct, entry);
  }

  const constructs = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([construct, entry]) => ({
      construct,
      positive: entry.positive,
      negative: entry.negative,
      meetsHighThreshold: entry.positive >= 5 && entry.negative >= 2,
    }));

  return { ruleTypesCovered: [...ruleTypesCovered], ruleTypesMissing: [...ruleTypesMissing], constructs };
}
