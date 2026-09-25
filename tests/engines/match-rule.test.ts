import { describe, expect, it } from 'vitest';
import type { ExactRule, RegexRule } from '../../src/contract/index.js';
import { matchRule, prepareFile } from '../../src/engines/index.js';

const toylangConfig = {
  lineComment: '--',
  blockComment: { start: '/*', end: '*/' },
  stringDelimiters: [{ start: '"', end: '"' }],
};

const identity = {
  confidence: 'high' as const,
  sourceEvidence: [{ skill: 's.md', anchor: 'a', exampleIds: ['x-01'] }],
  tests: { passed: 1, failed: 0, failingExampleIds: [] },
  status: 'validated' as const,
};

function exactRule(overrides: Partial<ExactRule> = {}): ExactRule {
  return {
    id: 'module-declaration',
    type: 'module_declaration',
    engine: 'exact',
    exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
    captures: { name: 'name' },
    ...identity,
    ...overrides,
  };
}

function regexRule(overrides: Partial<RegexRule> = {}): RegexRule {
  return {
    id: 'call-statement',
    type: 'call',
    engine: 'regex',
    regex: {
      pattern: '\\bCALL\\s+(?:(?<module>[A-Za-z_][A-Za-z0-9_]*)\\.)?(?<callee>[A-Za-z_][A-Za-z0-9_]*)\\s*\\(',
      flags: 'i',
      multiline: false,
    },
    captures: { callee: 'callee', module: 'module' },
    ...identity,
    ...overrides,
  };
}

describe('exact engine', () => {
  it('matches a token sequence with a capture placeholder, case-insensitively', () => {
    const file = prepareFile(toylangConfig, 'module billing\nPROC x()\nENDPROC');
    const matches = matchRule(exactRule(), file);
    expect(matches).toEqual([
      { ruleId: 'module-declaration', type: 'module_declaration', line: 1, column: 1, captures: { name: 'billing' } },
    ]);
  });

  it('respects caseSensitive: true', () => {
    const file = prepareFile(toylangConfig, 'module billing\nMODULE orders');
    const matches = matchRule(exactRule({ exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: true } }), file);
    expect(matches).toEqual([
      { ruleId: 'module-declaration', type: 'module_declaration', line: 2, column: 1, captures: { name: 'orders' } },
    ]);
  });

  it('finds every match on a line, left to right', () => {
    const rule = exactRule({
      id: 'entry-point',
      type: 'entry_point',
      exact: { tokens: ['ENTRY', '(?<name>)'], caseSensitive: false },
      captures: { name: 'name' },
    });
    const file = prepareFile(toylangConfig, 'ENTRY a  ENTRY b');
    const matches = matchRule(rule, file);
    expect(matches.map((m) => m.captures.name)).toEqual(['a', 'b']);
  });
});

describe('regex engine', () => {
  it('matches per line by default, reporting the correct column', () => {
    const file = prepareFile(toylangConfig, '  CALL tax.apply(order_id)');
    const matches = matchRule(regexRule(), file);
    expect(matches).toEqual([
      {
        ruleId: 'call-statement',
        type: 'call',
        line: 1,
        column: 3,
        captures: { callee: 'apply', module: 'tax' },
      },
    ]);
  });

  it('omits a capture role whose group did not take part in the match', () => {
    const file = prepareFile(toylangConfig, 'CALL apply_discount(order_id)');
    const matches = matchRule(regexRule(), file);
    expect(matches[0]?.captures).toEqual({ callee: 'apply_discount' });
    expect(matches[0]?.captures.module).toBeUndefined();
  });

  it('multiline: true runs once over the whole masked text and reports the match-start line', () => {
    const rule = regexRule({
      id: 'db-read',
      type: 'db_read',
      regex: { pattern: '\\bREAD\\s+(?:&\\s+)?(?<table>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: true },
      captures: { table: 'table' },
    });
    const file = prepareFile(toylangConfig, 'PROC p()\n  READ &\n      order_lines\nENDPROC');
    const matches = matchRule(rule, file);
    expect(matches).toEqual([
      { ruleId: 'db-read', type: 'db_read', line: 2, column: 3, captures: { table: 'order_lines' } },
    ]);
  });

  it('finds all non-overlapping matches and ignores zero-length matches', () => {
    const rule = regexRule({
      id: 'db-read',
      type: 'db_read',
      regex: { pattern: '\\bREAD\\s+(?<table>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      captures: { table: 'table' },
    });
    const file = prepareFile(toylangConfig, 'READ a; READ b');
    expect(matchRule(rule, file).map((m) => m.captures.table)).toEqual(['a', 'b']);

    const zeroLength = regexRule({
      id: 'zero',
      type: 'call',
      regex: { pattern: 'x*', flags: '', multiline: false },
      captures: {},
    });
    const zeroFile = prepareFile(toylangConfig, 'ab');
    // 'x*' matches an empty string at every position in 'ab'; all are zero-length and ignored.
    expect(matchRule(zeroLength, zeroFile)).toEqual([]);
  });

  it('a keyword inside a comment or string never matches (masking applied before matching)', () => {
    const rule = regexRule({
      id: 'db-write',
      type: 'db_write',
      regex: { pattern: '\\bWRITE\\s+(?<table>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      captures: { table: 'table' },
    });
    const file = prepareFile(
      toylangConfig,
      '-- WRITE ignored_table\nWRITE real_table\nMSG "WRITE also_ignored"',
    );
    expect(matchRule(rule, file).map((m) => m.captures.table)).toEqual(['real_table']);
  });

  it('searchStrings: true matches inside string literals using the comment-only mask', () => {
    const rule = regexRule({
      id: 'config-flag',
      type: 'config_ref',
      regex: { pattern: '\\bFLAG\\s*\\(\\s*"(?<key>[^"]+)"\\s*\\)', flags: 'i', multiline: false },
      captures: { key: 'key' },
      searchStrings: true,
    });
    const file = prepareFile(toylangConfig, 'IF FLAG("fast_shipping") THEN');
    expect(matchRule(rule, file).map((m) => m.captures.key)).toEqual(['fast_shipping']);
  });

  it('without searchStrings, a rule does not match inside a string literal', () => {
    const rule = regexRule({
      id: 'call-in-string',
      type: 'call',
      regex: { pattern: '\\bCALL\\s+(?<callee>[A-Za-z_][A-Za-z0-9_]*)\\s*\\(', flags: 'i', multiline: false },
      captures: { callee: 'callee' },
    });
    const file = prepareFile(toylangConfig, 'LET msg = "CALL fake(x)"');
    expect(matchRule(rule, file)).toEqual([]);
  });
});

describe('columns and lines stay exact after masking', () => {
  it('a match after a masked comment reports the same column it would without the comment', () => {
    const rule = regexRule({
      id: 'db-write',
      type: 'db_write',
      regex: { pattern: '\\bWRITE\\s+(?<table>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      captures: { table: 'table' },
    });
    const withoutComment = matchRule(rule, prepareFile(toylangConfig, '          WRITE t'));
    const withComment = matchRule(rule, prepareFile(toylangConfig, '/* note */WRITE t'));
    expect(withComment[0]?.column).toBe(withoutComment[0]?.column);
    expect(withComment[0]?.column).toBe(11);
  });
});
