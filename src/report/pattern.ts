/**
 * Human-readable summaries of a rule's matcher and captures, for the
 * per-rule report section (docs/PLAN.md §5.2, contract/CONTRACT.md §6.4).
 * Needs the Rule Set (not just Results), so these are only available when
 * the report is built with `--ruleset` (see src/cli/commands/report.ts).
 */
import type { Rule } from '../contract/index.js';

/** One line describing what the rule matches, engine-specific. */
export function describePattern(rule: Rule): string {
  if (rule.engine === 'exact') {
    const tokens = rule.exact.tokens
      .map((token) => (token === '(?<name>)' ? '<token>' : token.replace(/^\(\?<(\w+)>\)$/, '<$1>')))
      .join(' ');
    return `exact: ${tokens}${rule.exact.caseSensitive ? '' : ' (case-insensitive)'}`;
  }
  const scope = rule.regex.multiline ? 'whole file' : 'per line';
  return `regex: /${rule.regex.pattern}/${rule.regex.flags} (${scope})`;
}

/** Capture role → group/placeholder name, sorted by role for stable output. */
export function describeCaptures(rule: Rule): [string, string][] {
  return Object.entries(rule.captures).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
