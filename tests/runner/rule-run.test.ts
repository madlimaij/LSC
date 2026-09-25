import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/contract/index.js';
import type { Example } from '../../src/examples/index.js';
import { ownExampleIdsOf, runRuleAgainstExamples } from '../../src/runner/index.js';

const callRule: Rule = {
  id: 'call-statement',
  type: 'call',
  engine: 'regex',
  regex: { pattern: '\\bCALL\\s+(?<callee>[A-Za-z_][A-Za-z0-9_]*)\\s*\\(', flags: 'i', multiline: false },
  captures: { callee: 'callee' },
  confidence: 'high',
  sourceEvidence: [{ skill: 'skills/call.md', anchor: 'calling-a-procedure', exampleIds: ['call-01', 'call-02'] }],
  tests: { passed: 0, failed: 0, failingExampleIds: [] },
  status: 'validated',
};

function positiveExample(id: string, code: string, line: number, callee: string): Example {
  return {
    id,
    construct: 'call',
    polarity: 'positive',
    code,
    expected: [{ line, type: 'call', captures: { callee } }],
    source: { kind: 'inline', skill: 'skills/call.md', line: 1 },
  };
}

function negativeExample(id: string, construct: string, code: string): Example {
  return {
    id,
    construct,
    polarity: 'negative',
    code,
    expected: [],
    source: { kind: 'inline', skill: 'skills/other.md', line: 1 },
  };
}

describe('ownExampleIdsOf', () => {
  it('deduplicates ids across several sourceEvidence entries, first-seen order', () => {
    const rule: Rule = {
      ...callRule,
      sourceEvidence: [
        { skill: 'a.md', anchor: 'x', exampleIds: ['call-01', 'call-02'] },
        { skill: 'b.md', anchor: 'y', exampleIds: ['call-02', 'call-03'] },
      ],
    };
    expect(ownExampleIdsOf(rule)).toEqual(['call-01', 'call-02', 'call-03']);
  });
});

describe('runRuleAgainstExamples', () => {
  it('passes a rule whose own examples all pass and which matches no cross-construct negative', () => {
    const examples: Example[] = [
      positiveExample('call-01', 'CALL apply_discount(x)\n', 1, 'apply_discount'),
      positiveExample('call-02', 'CALL log_event(y)\n', 1, 'log_event'),
      negativeExample('read-neg-01', 'db-read', 'READ orders\n'),
    ];
    const result = runRuleAgainstExamples(callRule, {}, examples);
    expect(result.tests).toEqual({ passed: 3, failed: 0, failingExampleIds: [] });
    expect(result.computedConfidence).toBe('low'); // only 2 positive examples
    expect(result.confidenceMatchesDeclared).toBe(false); // rule declares "high"
    expect(result.missingExampleIds).toEqual([]);
    expect(result.examples.map((e) => e.role)).toEqual(['own', 'own', 'cross-negative']);
  });

  it('fails against a cross-construct negative example that happens to match the rule text', () => {
    const examples: Example[] = [
      positiveExample('call-01', 'CALL apply_discount(x)\n', 1, 'apply_discount'),
      positiveExample('call-02', 'CALL log_event(y)\n', 1, 'log_event'),
      // A negative example of another construct whose code, by construction, contains a real CALL.
      negativeExample('flag-neg-01', 'config-flag', 'CALL sneaky(x)\n'),
    ];
    const result = runRuleAgainstExamples(callRule, {}, examples);
    expect(result.tests.failed).toBe(1);
    expect(result.tests.failingExampleIds).toEqual(['flag-neg-01']);
    const crossResult = result.examples.find((e) => e.exampleId === 'flag-neg-01');
    expect(crossResult?.passed).toBe(false);
    expect(crossResult?.unexpected).toHaveLength(1);
  });

  it('reports a missing example id referenced by sourceEvidence but not supplied', () => {
    const result = runRuleAgainstExamples(callRule, {}, []);
    expect(result.missingExampleIds).toEqual(['call-01', 'call-02']);
    expect(result.tests).toEqual({ passed: 0, failed: 0, failingExampleIds: [] });
    expect(result.computedConfidence).toBeUndefined();
  });

  it('masks comments and strings using the Rule Set masking config before matching', () => {
    const examples: Example[] = [negativeExample('call-neg-01', 'call', '-- CALL fake(x)\nLOG "CALL fake(x)"\n')];
    const result = runRuleAgainstExamples(callRule, { lineComment: '--', stringDelimiters: [{ start: '"', end: '"' }] }, examples);
    expect(result.tests).toEqual({ passed: 1, failed: 0, failingExampleIds: [] });
  });
});
