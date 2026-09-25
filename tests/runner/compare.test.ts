import { describe, expect, it } from 'vitest';
import type { Match } from '../../src/engines/index.js';
import type { ExpectedMatch } from '../../src/examples/index.js';
import { diffExample } from '../../src/runner/index.js';

function match(line: number, column: number, captures: Match['captures']): Match {
  return { ruleId: 'r', type: 'call', line, column, captures };
}

function expected(line: number, captures: ExpectedMatch['captures']): ExpectedMatch {
  return { line, type: 'call', captures };
}

describe('diffExample (docs/PLAN.md §6.2)', () => {
  it('passes when every expected match is found with identical captures and nothing extra appears', () => {
    const diff = diffExample([expected(3, { callee: 'apply_discount' })], [match(3, 1, { callee: 'apply_discount' })]);
    expect(diff).toEqual({ passed: true, missed: [], unexpected: [], wrongCaptures: [] });
  });

  it('a negative example (no expected matches) passes only when the rule produces no match', () => {
    expect(diffExample([], [])).toEqual({ passed: true, missed: [], unexpected: [], wrongCaptures: [] });
    const diff = diffExample([], [match(2, 1, { callee: 'x' })]);
    expect(diff.passed).toBe(false);
    expect(diff.unexpected).toEqual([{ line: 2, column: 1, captures: { callee: 'x' } }]);
  });

  it('reports a missed expected match when nothing is found on its line', () => {
    const diff = diffExample([expected(5, { callee: 'apply_discount' })], []);
    expect(diff.passed).toBe(false);
    expect(diff.missed).toEqual([expected(5, { callee: 'apply_discount' })]);
    expect(diff.unexpected).toEqual([]);
    expect(diff.wrongCaptures).toEqual([]);
  });

  it('reports an unexpected match when the rule matches a line with no expectation', () => {
    const diff = diffExample([], [match(7, 1, { callee: 'extra' })]);
    expect(diff.passed).toBe(false);
    expect(diff.unexpected).toEqual([{ line: 7, column: 1, captures: { callee: 'extra' } }]);
  });

  it('reports a wrong-captures entry when the match is on the right line but captures differ', () => {
    const diff = diffExample(
      [expected(4, { callee: 'apply_discount', module: 'billing' })],
      [match(4, 1, { callee: 'apply_discount' })],
    );
    expect(diff.passed).toBe(false);
    expect(diff.missed).toEqual([]);
    expect(diff.unexpected).toEqual([]);
    expect(diff.wrongCaptures).toEqual([
      {
        line: 4,
        expectedCaptures: { callee: 'apply_discount', module: 'billing' },
        actualCaptures: { callee: 'apply_discount' },
        mismatches: [{ role: 'module', expected: 'billing' }],
      },
    ]);
  });

  it('pairs several matches on one line by exact captures, regardless of actual order (trap T10)', () => {
    const diff = diffExample(
      [expected(6, { callee: 'a' }), expected(6, { callee: 'b' })],
      // Actual order is reversed relative to expected.
      [match(6, 10, { callee: 'b' }), match(6, 1, { callee: 'a' })],
    );
    expect(diff).toEqual({ passed: true, missed: [], unexpected: [], wrongCaptures: [] });
  });

  it('an extra match on an already-fully-expected line is unexpected, not swallowed', () => {
    const diff = diffExample([expected(6, { callee: 'a' })], [match(6, 1, { callee: 'a' }), match(6, 5, { callee: 'b' })]);
    expect(diff.passed).toBe(false);
    expect(diff.missed).toEqual([]);
    expect(diff.unexpected).toEqual([{ line: 6, column: 5, captures: { callee: 'b' } }]);
  });
});
