import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/contract/index.js';
import { mapMatches, type Match } from '../../src/engines/index.js';

const identity = {
  sourceEvidence: [{ skill: 's.md', anchor: 'a', exampleIds: ['x-01'] }],
  tests: { passed: 1, failed: 0, failingExampleIds: [] },
  status: 'validated' as const,
};

function callRule(confidence: 'high' | 'medium' | 'low' = 'high'): Rule {
  return {
    id: 'call-statement',
    type: 'call',
    engine: 'regex',
    regex: { pattern: 'x', flags: '', multiline: false },
    captures: { callee: 'callee', module: 'module' },
    confidence,
    ...identity,
  };
}

function match(overrides: Partial<Match> = {}): Match {
  return { ruleId: 'call-statement', type: 'call', line: 1, column: 1, captures: {}, ...overrides };
}

describe('Match → Navigator mapping (contract/CONTRACT.md §4)', () => {
  it('maps each rule type to its Navigator record', () => {
    const rules: Rule[] = [
      {
        id: 'module-declaration',
        type: 'module_declaration',
        engine: 'exact',
        exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
        captures: { name: 'name' },
        confidence: 'high',
        ...identity,
      },
      {
        id: 'proc-definition',
        type: 'symbol_definition',
        engine: 'regex',
        regex: { pattern: 'x', flags: '', multiline: false },
        captures: { name: 'name', kind: 'kind' },
        confidence: 'high',
        ...identity,
      },
      callRule(),
      {
        id: 'include-directive',
        type: 'include',
        engine: 'regex',
        regex: { pattern: 'x', flags: '', multiline: false },
        captures: { target: 'target' },
        confidence: 'high',
        ...identity,
      },
      {
        id: 'db-read',
        type: 'db_read',
        engine: 'regex',
        regex: { pattern: 'x', flags: '', multiline: false },
        captures: { table: 'table' },
        confidence: 'high',
        ...identity,
      },
      {
        id: 'db-write',
        type: 'db_write',
        engine: 'regex',
        regex: { pattern: 'x', flags: '', multiline: false },
        captures: { table: 'table' },
        confidence: 'high',
        ...identity,
      },
      {
        id: 'config-flag',
        type: 'config_ref',
        engine: 'regex',
        regex: { pattern: 'x', flags: '', multiline: false },
        captures: { key: 'key' },
        confidence: 'high',
        ...identity,
      },
      {
        id: 'entry-point',
        type: 'entry_point',
        engine: 'exact',
        exact: { tokens: ['ENTRY', '(?<name>)'], caseSensitive: false },
        captures: { name: 'name', kind: 'kind' },
        confidence: 'high',
        ...identity,
      },
    ];

    const matches: Match[] = [
      match({ ruleId: 'module-declaration', type: 'module_declaration', captures: { name: 'billing' } }),
      match({
        ruleId: 'proc-definition',
        type: 'symbol_definition',
        captures: { name: 'calc_total', kind: 'FUNC' },
      }),
      match({
        ruleId: 'call-statement',
        type: 'call',
        captures: { callee: 'apply', module: 'tax' },
        enclosingSymbol: 'calc_total',
      }),
      match({ ruleId: 'include-directive', type: 'include', captures: { target: 'common.tl' }, enclosingSymbol: 'calc_total' }),
      match({ ruleId: 'db-read', type: 'db_read', captures: { table: 'orders' }, enclosingSymbol: 'calc_total' }),
      match({ ruleId: 'db-write', type: 'db_write', captures: { table: 'totals' }, enclosingSymbol: 'calc_total' }),
      match({ ruleId: 'config-flag', type: 'config_ref', captures: { key: 'fast_shipping' }, enclosingSymbol: 'calc_total' }),
      match({ ruleId: 'entry-point', type: 'entry_point', captures: { name: 'run_billing' } }),
    ];

    const analysis = mapMatches(matches, rules, 'billing.tl');
    expect(analysis.symbols).toEqual([
      { kind: 'module', name: 'billing', line: 1, ruleId: 'module-declaration' },
      { kind: 'function', name: 'calc_total', line: 1, ruleId: 'proc-definition' },
    ]);
    expect(analysis.relations).toEqual([
      { kind: 'calls', source: 'calc_total', callee: 'apply', module: 'tax', line: 1, ruleId: 'call-statement' },
      { kind: 'includes', source: 'calc_total', target: 'common.tl', line: 1, ruleId: 'include-directive' },
    ]);
    expect(analysis.dbAccesses).toEqual([
      { mode: 'read', source: 'calc_total', table: 'orders', line: 1, ruleId: 'db-read' },
      { mode: 'write', source: 'calc_total', table: 'totals', line: 1, ruleId: 'db-write' },
    ]);
    expect(analysis.configRefs).toEqual([{ source: 'calc_total', key: 'fast_shipping', line: 1, ruleId: 'config-flag' }]);
    expect(analysis.entryPoints).toEqual([{ name: 'run_billing', line: 1, ruleId: 'entry-point' }]);
    expect(analysis.uncertainties).toEqual([]);
  });

  it('defaults symbol_definition kind to procedure when the kind capture is absent or unrecognised', () => {
    const rules: Rule[] = [
      {
        id: 'proc-definition',
        type: 'symbol_definition',
        engine: 'regex',
        regex: { pattern: 'x', flags: '', multiline: false },
        captures: { name: 'name', kind: 'kind' },
        confidence: 'high',
        ...identity,
      },
    ];
    const analysis = mapMatches(
      [
        match({ ruleId: 'proc-definition', type: 'symbol_definition', captures: { name: 'a' } }),
        match({ ruleId: 'proc-definition', type: 'symbol_definition', captures: { name: 'b', kind: 'PROC' } }),
      ],
      rules,
      'f.tl',
    );
    expect(analysis.symbols.map((s) => s.kind)).toEqual(['procedure', 'procedure']);
  });

  it('a match whose rule has confidence "low" also produces an uncertainty, alongside the primary record', () => {
    const analysis = mapMatches(
      [match({ captures: { callee: 'x' }, enclosingSymbol: 's' })],
      [callRule('low')],
      'f.tl',
    );
    expect(analysis.relations).toHaveLength(1);
    expect(analysis.uncertainties).toEqual([
      { ruleId: 'call-statement', type: 'call', line: 1, reason: 'low-confidence', captures: { callee: 'x' } },
    ]);
  });

  it('a missing required capture role produces only an uncertainty, no primary record', () => {
    const analysis = mapMatches([match({ captures: {}, enclosingSymbol: 's' })], [callRule()], 'f.tl');
    expect(analysis.relations).toEqual([]);
    expect(analysis.uncertainties).toEqual([
      { ruleId: 'call-statement', type: 'call', line: 1, reason: 'ambiguous-capture', captures: {} },
    ]);
  });

  it('an empty required capture role is treated as missing, same as absent (D19 c, contract §6.5)', () => {
    const analysis = mapMatches([match({ captures: { callee: '' }, enclosingSymbol: 's' })], [callRule()], 'f.tl');
    expect(analysis.relations).toEqual([]);
    expect(analysis.uncertainties).toEqual([
      { ruleId: 'call-statement', type: 'call', line: 1, reason: 'ambiguous-capture', captures: { callee: '' } },
    ]);
  });

  it('a relation/dbAccess/configRef match with no enclosing scope falls back to the last named module_declaration match, or the file itself (D19 b, §4.1 item 4)', () => {
    const moduleRule: Rule = {
      id: 'module-declaration',
      type: 'module_declaration',
      engine: 'exact',
      exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
      captures: { name: 'name' },
      confidence: 'high',
      ...identity,
    };

    const withModule = mapMatches(
      [
        match({ ruleId: 'module-declaration', type: 'module_declaration', line: 1, column: 1, captures: { name: 'billing' } }),
        match({ line: 2, column: 1, captures: { callee: 'x' } }),
      ],
      [moduleRule, callRule()],
      'billing.tl',
    );
    expect(withModule.relations).toEqual([{ kind: 'calls', source: 'billing', callee: 'x', line: 2, ruleId: 'call-statement' }]);
    expect(withModule.uncertainties).toEqual([]);

    const withoutModule = mapMatches([match({ captures: { callee: 'x' } })], [callRule()], 'orphan/file.tl');
    expect(withoutModule.relations).toEqual([
      { kind: 'calls', source: 'orphan/file.tl', callee: 'x', line: 1, ruleId: 'call-statement' },
    ]);
    expect(withoutModule.uncertainties).toEqual([]);

    // An unnamed module_declaration (empty name) does not count as the fallback source (§4.1 item 2/4).
    const unnamedModule = mapMatches(
      [
        match({ ruleId: 'module-declaration', type: 'module_declaration', captures: { name: '' } }),
        match({ captures: { callee: 'x' } }),
      ],
      [moduleRule, callRule()],
      'orphan2.tl',
    );
    const callRelation = unnamedModule.relations.find((r) => r.kind === 'calls');
    expect(callRelation).toMatchObject({ source: 'orphan2.tl' });
  });

  it('a module_declaration at the same (line, column) as the match it would otherwise source is not "before" it, so the file is the fallback source (§4.1 item 4)', () => {
    const moduleRule: Rule = {
      id: 'module-declaration',
      type: 'module_declaration',
      engine: 'exact',
      exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
      captures: { name: 'name' },
      confidence: 'high',
      ...identity,
    };

    const samePosition = mapMatches(
      [
        match({ ruleId: 'module-declaration', type: 'module_declaration', line: 3, column: 5, captures: { name: 'billing' } }),
        match({ line: 3, column: 5, captures: { callee: 'x' } }),
      ],
      [moduleRule, callRule()],
      'same-position.tl',
    );
    expect(samePosition.relations).toEqual([
      { kind: 'calls', source: 'same-position.tl', callee: 'x', line: 3, ruleId: 'call-statement' },
    ]);
  });

  it('picks the last named module_declaration strictly before the match, not overwritten by a later module_declaration at (or after) the match\'s position, regardless of array order (§4.1 item 4)', () => {
    const moduleRule: Rule = {
      id: 'module-declaration',
      type: 'module_declaration',
      engine: 'exact',
      exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
      captures: { name: 'name' },
      confidence: 'high',
      ...identity,
    };

    // module a (1,1); module b (3,5); call x (3,5) -- module b is not "before" the call (same
    // position), so the call's fallback source must be the earlier module, "a", not the file.
    const inOrder = mapMatches(
      [
        match({ ruleId: 'module-declaration', type: 'module_declaration', line: 1, column: 1, captures: { name: 'a' } }),
        match({ ruleId: 'module-declaration', type: 'module_declaration', line: 3, column: 5, captures: { name: 'b' } }),
        match({ line: 3, column: 5, captures: { callee: 'x' } }),
      ],
      [moduleRule, callRule()],
      'f.tl',
    );
    expect(inOrder.relations).toEqual([{ kind: 'calls', source: 'a', callee: 'x', line: 3, ruleId: 'call-statement' }]);

    // Same positions, but the call comes before "module b" in the matches array: the result must
    // not depend on the order of matches at the same position.
    const callFirst = mapMatches(
      [
        match({ ruleId: 'module-declaration', type: 'module_declaration', line: 1, column: 1, captures: { name: 'a' } }),
        match({ line: 3, column: 5, captures: { callee: 'x' } }),
        match({ ruleId: 'module-declaration', type: 'module_declaration', line: 3, column: 5, captures: { name: 'b' } }),
      ],
      [moduleRule, callRule()],
      'f.tl',
    );
    expect(callFirst.relations).toEqual([{ kind: 'calls', source: 'a', callee: 'x', line: 3, ruleId: 'call-statement' }]);
  });

  it('an empty optional "module" capture on a call is left out of the record, same as absent (§4.1 item 2, §6.5)', () => {
    const analysis = mapMatches(
      [match({ captures: { callee: 'x', module: '' }, enclosingSymbol: 's' })],
      [callRule()],
      'f.tl',
    );
    expect(analysis.relations).toEqual([{ kind: 'calls', source: 's', callee: 'x', line: 1, ruleId: 'call-statement' }]);
    expect('module' in (analysis.relations[0] ?? {})).toBe(false);
  });

  it('an empty optional "kind" capture on an entry_point is left out of the record, same as absent (§4.1 item 2, §6.5)', () => {
    const entryRule: Rule = {
      id: 'entry-point',
      type: 'entry_point',
      engine: 'exact',
      exact: { tokens: ['ENTRY', '(?<name>)'], caseSensitive: false },
      captures: { name: 'name', kind: 'kind' },
      confidence: 'high',
      ...identity,
    };
    const analysis = mapMatches(
      [match({ ruleId: 'entry-point', type: 'entry_point', captures: { name: 'run', kind: '' } })],
      [entryRule],
      'f.tl',
    );
    expect(analysis.entryPoints).toEqual([{ name: 'run', line: 1, ruleId: 'entry-point' }]);
    expect('kind' in (analysis.entryPoints[0] ?? {})).toBe(false);
  });

  it('a match for a rule not passed in is skipped defensively', () => {
    const analysis = mapMatches([match()], [], 'f.tl');
    expect(analysis.relations).toEqual([]);
    expect(analysis.uncertainties).toEqual([]);
  });
});
