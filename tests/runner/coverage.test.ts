import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/contract/index.js';
import type { Example } from '../../src/examples/index.js';
import { computeCoverage } from '../../src/runner/index.js';

function rule(id: string, type: Rule['type'], status: Rule['status']): Rule {
  return {
    id,
    type,
    engine: 'exact',
    exact: { tokens: [id.toUpperCase(), '(?<name>)'], caseSensitive: false },
    captures: { name: 'name' },
    confidence: 'high',
    sourceEvidence: [{ skill: 'skills/x.md', anchor: 'x', exampleIds: [] }],
    tests: { passed: 0, failed: 0, failingExampleIds: [] },
    status,
  };
}

function example(id: string, construct: string, polarity: Example['polarity']): Example {
  return {
    id,
    construct,
    polarity,
    code: 'X\n',
    expected: polarity === 'positive' ? [{ line: 1, type: 'module_declaration', captures: { name: 'x' } }] : [],
    source: { kind: 'inline', skill: 'skills/x.md', line: 1 },
  };
}

describe('computeCoverage (WP-05 brief)', () => {
  it('lists rule types with a validated rule, separately from rejected ones', () => {
    const coverage = computeCoverage(
      [rule('a', 'module_declaration', 'validated'), rule('b', 'call', 'rejected')],
      [],
    );
    expect(coverage.ruleTypesCovered).toEqual(['module_declaration']);
    expect(coverage.ruleTypesMissing).toContain('call');
    expect(coverage.ruleTypesMissing).not.toContain('module_declaration');
  });

  it('flags constructs below the high-confidence example threshold (5 positive, 2 negative)', () => {
    const examples = [
      example('p1', 'proc-definition', 'positive'),
      example('p2', 'proc-definition', 'positive'),
      example('n1', 'proc-definition', 'negative'),
      example('n2', 'proc-definition', 'negative'),
      ...Array.from({ length: 5 }, (_, i) => example(`m${String(i)}`, 'module-declaration', 'positive')),
      example('mn1', 'module-declaration', 'negative'),
      example('mn2', 'module-declaration', 'negative'),
    ];
    const coverage = computeCoverage([], examples);
    const proc = coverage.constructs.find((c) => c.construct === 'proc-definition');
    const module = coverage.constructs.find((c) => c.construct === 'module-declaration');
    expect(proc).toEqual({ construct: 'proc-definition', positive: 2, negative: 2, meetsHighThreshold: false });
    expect(module).toEqual({ construct: 'module-declaration', positive: 5, negative: 2, meetsHighThreshold: true });
  });

  it('sorts constructs deterministically', () => {
    const coverage = computeCoverage([], [example('b1', 'b-construct', 'positive'), example('a1', 'a-construct', 'positive')]);
    expect(coverage.constructs.map((c) => c.construct)).toEqual(['a-construct', 'b-construct']);
  });
});
