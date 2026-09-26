import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeMatchSpan } from '../../src/report/match-span.js';
import { loadFixtureRuleSet, SAMPLE_DIR } from './helpers.js';

function ruleNamed(ruleId: string) {
  const rule = loadFixtureRuleSet().rules.find((r) => r.id === ruleId);
  if (rule === undefined) throw new Error(`no rule "${ruleId}"`);
  return rule;
}

describe('computeMatchSpan', () => {
  const ruleSet = loadFixtureRuleSet();
  const orderLinesText = readFileSync(join(SAMPLE_DIR, 'orders/order_lines.tl'), 'utf8');

  it('a per-line rule always spans a single line', () => {
    const rule = ruleNamed('call-statement');
    const dispatchText = readFileSync(join(SAMPLE_DIR, 'orders/dispatch.tl'), 'utf8');
    const found = computeMatchSpan(rule, ruleSet, dispatchText, 8, 3);
    expect(found?.span).toEqual({ startLine: 8, endLine: 8 });
    expect(found?.sameRuleMatches).toHaveLength(1);
  });

  it('a whole-text rule can span onto the next line (db-read trap T8: READ & continued)', () => {
    const rule = ruleNamed('db-read');
    const found = computeMatchSpan(rule, ruleSet, orderLinesText, 4, 3);
    expect(found?.span).toEqual({ startLine: 4, endLine: 5 });
    expect(found?.sameRuleMatches).toHaveLength(1);
  });

  it('lists every match of the same rule whose start line falls within the span', () => {
    const rule = ruleNamed('db-read');
    const found = computeMatchSpan(rule, ruleSet, orderLinesText, 6, 3);
    expect(found?.span).toEqual({ startLine: 6, endLine: 6 });
    expect(found?.sameRuleMatches.map((m) => m.captures.table)).toEqual(['products', 'stock_levels']);
  });

  it('returns undefined when the rule no longer matches at that exact position', () => {
    const rule = ruleNamed('db-read');
    expect(computeMatchSpan(rule, ruleSet, orderLinesText, 999, 1)).toBeUndefined();
  });

  it("extends the span over a same-rule match that starts inside it but continues past it (G2 round, D27 defect A1: customers/messages.tl:4)", () => {
    // customers/messages.tl:4 `  READ inbox WHERE owner = uid AND NOT read` has two db-read matches:
    // one for `inbox` (spans only line 4), and a second, case-insensitive match on the trailing
    // "read" that continues across the newline to capture `LET` on line 5 (`messages.tl:5` is
    // `  LET n = ROWCOUNT()`). Asking about the *first* match (table=inbox) must still extend the
    // span to line 5, or the second match's `LET` capture cannot be found again against a
    // line-4-only snippet.
    const rule = ruleNamed('db-read');
    const messagesText = readFileSync(join(SAMPLE_DIR, 'customers/messages.tl'), 'utf8');
    const found = computeMatchSpan(rule, ruleSet, messagesText, 4, 3);
    expect(found?.span).toEqual({ startLine: 4, endLine: 5 });
    expect(found?.sameRuleMatches.map((m) => m.captures.table)).toEqual(['inbox', 'LET']);
  });
});
