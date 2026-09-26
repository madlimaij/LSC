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
    // tests.passed/failed count only the rule's own examples (D19 a): the two positives, not the
    // cross-construct negative (which still passes and is reported in crossNegativeFailures: none).
    expect(result.tests).toEqual({ passed: 2, failed: 0, failingExampleIds: [] });
    expect(result.crossNegativeFailures).toEqual([]);
    expect(result.computedConfidence).toBe('low'); // only 2 positive examples
    expect(result.confidenceMatchesDeclared).toBe(false); // rule declares "high"
    expect(result.missingExampleIds).toEqual([]);
    expect(result.examples.map((e) => e.role)).toEqual(['own', 'own', 'cross-negative']);
  });

  it('a cross-construct negative match fails the rule but is reported separately from tests.passed/failed (D19 a)', () => {
    const examples: Example[] = [
      positiveExample('call-01', 'CALL apply_discount(x)\n', 1, 'apply_discount'),
      positiveExample('call-02', 'CALL log_event(y)\n', 1, 'log_event'),
      // A negative example of another construct whose code, by construction, contains a real CALL.
      negativeExample('flag-neg-01', 'config-flag', 'CALL sneaky(x)\n'),
    ];
    const result = runRuleAgainstExamples(callRule, {}, examples);
    // tests.passed/failed count only the rule's own examples (2 positives, 0 own negatives): unaffected.
    expect(result.tests).toEqual({ passed: 2, failed: 0, failingExampleIds: [] });
    expect(result.crossNegativeFailures).toEqual(['flag-neg-01']);
    const crossResult = result.examples.find((e) => e.exampleId === 'flag-neg-01');
    expect(crossResult?.passed).toBe(false);
    expect(crossResult?.unexpected).toHaveLength(1);
    // Still not high/medium confidence, and not `ok` (see src/runner/index.ts's `ok` computation).
    expect(result.computedConfidence).toBe('low');
  });

  it("reviewer's case 1: 5 own positives + 0 own negatives + 21 cross-construct negatives (all passing) is not high (D19 a)", () => {
    const rule: Rule = {
      ...callRule,
      sourceEvidence: [
        { skill: 'skills/call.md', anchor: 'a', exampleIds: ['call-01', 'call-02', 'call-03', 'call-04', 'call-05'] },
      ],
    };
    const positives: Example[] = Array.from({ length: 5 }, (_, i) =>
      positiveExample(`call-0${String(i + 1)}`, `CALL fn_${String(i)}(x)\n`, 1, `fn_${String(i)}`),
    );
    const crossNegatives: Example[] = Array.from({ length: 21 }, (_, i) =>
      negativeExample(`other-neg-${String(i)}`, 'other-construct', `LOG "no call here ${String(i)}"\n`),
    );
    const result = runRuleAgainstExamples(rule, {}, [...positives, ...crossNegatives]);
    expect(result.tests).toEqual({ passed: 5, failed: 0, failingExampleIds: [] });
    expect(result.crossNegativeFailures).toEqual([]);
    // 5 of 5 own positives pass, 0 own negatives: fails the "high" threshold (needs >=2 own
    // negatives), but qualifies for "medium" (>=3 positives, 100% pass rate, no failing negative).
    expect(result.computedConfidence).toBe('medium');
  });

  it("reviewer's case 2: 3 own positives (2 passing) + 2 own negatives stays low regardless of cross-construct negatives (D19 a)", () => {
    const rule: Rule = {
      ...callRule,
      sourceEvidence: [
        { skill: 'skills/call.md', anchor: 'a', exampleIds: ['call-01', 'call-02', 'call-03', 'call-neg-01', 'call-neg-02'] },
      ],
    };
    const examples: Example[] = [
      positiveExample('call-01', 'CALL apply_discount(x)\n', 1, 'apply_discount'),
      positiveExample('call-02', 'CALL log_event(y)\n', 1, 'log_event'),
      // Does not match callRule's pattern at all: a failing positive example.
      positiveExample('call-03', 'DO_NOTHING()\n', 1, 'apply_discount'),
      negativeExample('call-neg-01', 'call', 'LOG "no call"\n'),
      negativeExample('call-neg-02', 'call', 'LOG "still no call"\n'),
      ...Array.from({ length: 21 }, (_, i) => negativeExample(`other-neg-${String(i)}`, 'other-construct', `LOG "x${String(i)}"\n`)),
    ];
    const result = runRuleAgainstExamples(rule, {}, examples);
    expect(result.tests.passed).toBe(4); // 2 own positives pass, 2 own negatives pass; 1 own positive fails
    expect(result.tests.failed).toBe(1);
    expect(result.crossNegativeFailures).toEqual([]);
    expect(result.computedConfidence).toBe('low');
  });

  it('reports a missing example id referenced by sourceEvidence but not supplied', () => {
    const result = runRuleAgainstExamples(callRule, {}, []);
    expect(result.missingExampleIds).toEqual(['call-01', 'call-02']);
    expect(result.tests).toEqual({ passed: 0, failed: 0, failingExampleIds: [] });
    expect(result.computedConfidence).toBeUndefined();
  });

  it('masks comments and strings using the Rule Set masking config before matching', () => {
    const rule: Rule = { ...callRule, sourceEvidence: [{ skill: 'skills/call.md', anchor: 'a', exampleIds: ['call-neg-01'] }] };
    const examples: Example[] = [negativeExample('call-neg-01', 'call', '-- CALL fake(x)\nLOG "CALL fake(x)"\n')];
    const result = runRuleAgainstExamples(rule, { lineComment: '--', stringDelimiters: [{ start: '"', end: '"' }] }, examples);
    expect(result.tests).toEqual({ passed: 1, failed: 0, failingExampleIds: [] });
    expect(result.crossNegativeFailures).toEqual([]);
  });
});
