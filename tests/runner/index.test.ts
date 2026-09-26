/**
 * WP-05 review round 3: `Results.ok` must be false when a rule's only
 * failure is a cross-construct negative match (a match on a negative
 * example that belongs to a *different* construct, D19 a) — not just when
 * its own examples fail.
 */
import { describe, expect, it } from 'vitest';
import type { Rule, RuleSet } from '../../src/contract/index.js';
import type { Example } from '../../src/examples/index.js';
import { runRules } from '../../src/runner/index.js';

const identity = {
  sourceEvidence: [{ skill: 's.md', anchor: 'a', exampleIds: ['call-01', 'call-02', 'call-03', 'call-04', 'call-05'] }],
  tests: { passed: 0, failed: 0, failingExampleIds: [] },
  status: 'validated' as const,
};

// Deliberately broad: matches its own CALL examples *and* the other construct's negative example
// below (which happens to contain the text "CALL something(...)").
const callRule: Rule = {
  id: 'call-statement',
  type: 'call',
  engine: 'regex',
  regex: { pattern: '\\bCALL\\s+(?<callee>[A-Za-z_][A-Za-z0-9_]*)\\s*\\(', flags: 'i', multiline: false },
  captures: { callee: 'callee' },
  confidence: 'high',
  ...identity,
};

const ruleSet: RuleSet = {
  contractVersion: '1.0.2',
  languageId: 'toylang-fixture',
  version: '1.0.0',
  compiledAt: '2026-09-26T00:00:00Z',
  compilerVersion: '0.0.0-dev',
  sourceSkills: [],
  fileMatchers: ['**/*.tl'],
  rules: [callRule],
};

const positives: Example[] = Array.from({ length: 5 }, (_, i) => ({
  id: `call-0${String(i + 1)}`,
  construct: 'call',
  polarity: 'positive',
  code: `CALL fn_${String(i)}(x)\n`,
  expected: [{ line: 1, type: 'call', captures: { callee: `fn_${String(i)}` } }],
  source: { kind: 'inline', skill: 's.md', line: 1 },
}));

// A negative example of a *different* construct that this rule's overly broad pattern still matches.
const crossConstructNegative: Example = {
  id: 'flag-neg-01',
  construct: 'config-flag',
  polarity: 'negative',
  code: 'CALL something(x)\n',
  expected: [],
  source: { kind: 'inline', skill: 'other.md', line: 1 },
};

describe('runRules: Results.ok and a cross-construct negative match', () => {
  it('is false when the only failure is a cross-construct negative match, even though every own example passes', () => {
    const results = runRules(ruleSet, [...positives, crossConstructNegative]);
    const rule = results.rules.find((r) => r.ruleId === 'call-statement');
    expect(rule?.tests).toEqual({ passed: 5, failed: 0, failingExampleIds: [] });
    expect(rule?.crossNegativeFailures).toEqual(['flag-neg-01']);
    expect(results.ok).toBe(false);
  });

  it('is true once the cross-construct negative is removed (own examples alone all pass)', () => {
    const results = runRules(ruleSet, positives);
    expect(results.ok).toBe(true);
  });
});
