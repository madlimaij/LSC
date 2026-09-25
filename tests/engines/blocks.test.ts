import { describe, expect, it } from 'vitest';
import type { ExactRule, RegexRule, Rule } from '../../src/contract/index.js';
import { prepareFile, scanFile } from '../../src/engines/index.js';

const config = { lineComment: '--' };

const identity = {
  confidence: 'high' as const,
  sourceEvidence: [{ skill: 's.md', anchor: 'a', exampleIds: ['x-01'] }],
  tests: { passed: 1, failed: 0, failingExampleIds: [] },
  status: 'validated' as const,
};

const procRule: RegexRule = {
  id: 'proc-definition',
  type: 'symbol_definition',
  engine: 'regex',
  regex: { pattern: '^\\s*PROC\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
  captures: { name: 'name' },
  blockEnd: { pattern: '^\\s*ENDPROC\\b', flags: 'i', multiline: false },
  ...identity,
};

const moduleRuleNoBlockEnd: ExactRule = {
  id: 'module-declaration',
  type: 'module_declaration',
  engine: 'exact',
  exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
  captures: { name: 'name' },
  ...identity,
};

const callRule: RegexRule = {
  id: 'call-statement',
  type: 'call',
  engine: 'regex',
  regex: { pattern: '\\bCALL\\s+(?<callee>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
  captures: { callee: 'callee' },
  ...identity,
};

function scan(rules: readonly Rule[], text: string) {
  return scanFile(rules, prepareFile(config, text));
}

describe('block tracking (D4, contract/CONTRACT.md §6.6)', () => {
  it('assigns the innermost open definition as enclosingSymbol', () => {
    const text = ['PROC outer()', '  CALL a()', 'ENDPROC', 'CALL b()'].join('\n');
    const { matches, warnings } = scan([procRule, callRule], text);
    expect(warnings).toEqual([]);
    const calls = matches.filter((m) => m.type === 'call');
    expect(calls[0]).toMatchObject({ captures: { callee: 'a' }, enclosingSymbol: 'outer' });
    expect(calls[1]).toMatchObject({ captures: { callee: 'b' } });
    expect(calls[1]?.enclosingSymbol).toBeUndefined();
  });

  it('a definition does not enclose itself', () => {
    const { matches } = scan([procRule], 'PROC outer()\nENDPROC');
    const def = matches.find((m) => m.type === 'symbol_definition');
    expect(def?.enclosingSymbol).toBeUndefined();
  });

  it('nested blocks: an inner definition is enclosed by the outer one, closing the inner first', () => {
    // Two distinct definition rules (different keywords) so a nested-scope scenario can be built
    // without relying on toylang's own grammar (PROC does not nest in toylang).
    const outer: RegexRule = {
      ...procRule,
      id: 'outer-def',
      regex: { pattern: '^\\s*OUTER\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      blockEnd: { pattern: '^\\s*ENDOUTER\\b', flags: 'i', multiline: false },
    };
    const inner: RegexRule = {
      ...procRule,
      id: 'inner-def',
      regex: { pattern: '^\\s*INNER\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      blockEnd: { pattern: '^\\s*ENDINNER\\b', flags: 'i', multiline: false },
    };
    const text = [
      'OUTER outer',
      '  INNER inner',
      '    CALL deep()',
      '  ENDINNER',
      '  CALL mid()',
      'ENDOUTER',
    ].join('\n');
    const { matches, warnings } = scan([outer, inner, callRule], text);
    expect(warnings).toEqual([]);
    const calls = matches.filter((m) => m.type === 'call');
    expect(calls.find((m) => m.captures.callee === 'deep')?.enclosingSymbol).toBe('inner');
    expect(calls.find((m) => m.captures.callee === 'mid')?.enclosingSymbol).toBe('outer');
  });

  it('an unclosed block at end of file is a warning, not an error', () => {
    const { matches, warnings } = scan([procRule, callRule], 'PROC outer()\n  CALL a()');
    expect(matches.find((m) => m.type === 'call')?.enclosingSymbol).toBe('outer');
    expect(warnings).toEqual([
      expect.objectContaining({ kind: 'unclosed-block', ruleId: 'proc-definition', line: 1 }),
    ]);
  });

  it('a blockEnd match with no open scope of that rule is a warning, ignored otherwise', () => {
    const { matches, warnings } = scan([procRule], 'ENDPROC\nPROC x()\nENDPROC');
    expect(matches).toHaveLength(1);
    expect(warnings).toEqual([
      expect.objectContaining({ kind: 'unmatched-block-end', ruleId: 'proc-definition', line: 1 }),
    ]);
  });

  it('a definition rule without blockEnd opens no scope', () => {
    const text = ['MODULE billing', 'CALL a()'].join('\n');
    const { matches } = scan([moduleRuleNoBlockEnd, callRule], text);
    const call = matches.find((m) => m.type === 'call');
    expect(call?.enclosingSymbol).toBeUndefined();
  });

  it('closing an outer scope while an inner (different-rule) scope is still open only closes the outer one', () => {
    // MODULE (no blockEnd) never closes; only PROC/ENDPROC track scopes here, so nest via two proc-like rules
    // with independent blockEnd matching to prove closes are per-rule, not a single global stack.
    const a: RegexRule = {
      ...procRule,
      id: 'a-def',
      regex: { pattern: '^\\s*ADEF\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      blockEnd: { pattern: '^\\s*ENDA\\b', flags: 'i', multiline: false },
    };
    const b: RegexRule = {
      ...procRule,
      id: 'b-def',
      regex: { pattern: '^\\s*BDEF\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      blockEnd: { pattern: '^\\s*ENDB\\b', flags: 'i', multiline: false },
    };
    const text = ['ADEF outer', 'BDEF inner', 'ENDA', 'CALL after()', 'ENDB'].join('\n');
    const { matches, warnings } = scan([a, b, callRule], text);
    const call = matches.find((m) => m.type === 'call');
    // "inner" (BDEF) is still open when ENDA closes "outer"; "inner" remains innermost.
    expect(call?.enclosingSymbol).toBe('inner');
    expect(warnings).toEqual([]);
  });
});
