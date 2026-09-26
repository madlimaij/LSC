import { describe, expect, it } from 'vitest';
import type { ExactRule, RegexRule } from '../../src/contract/index.js';
import { matchRule, prepareFile, scanFile } from '../../src/engines/index.js';

const config = { lineComment: '--' };

const identity = {
  confidence: 'high' as const,
  sourceEvidence: [{ skill: 's.md', anchor: 'a', exampleIds: ['x-01'] }],
  tests: { passed: 1, failed: 0, failingExampleIds: [] },
  status: 'validated' as const,
};

const callRule: RegexRule = {
  id: 'call-statement',
  type: 'call',
  engine: 'regex',
  regex: { pattern: '\\bCALL\\s+(?<callee>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
  captures: { callee: 'callee' },
  ...identity,
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

const moduleRule: ExactRule = {
  id: 'module-declaration',
  type: 'module_declaration',
  engine: 'exact',
  exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
  captures: { name: 'name' },
  ...identity,
};

describe('edge cases', () => {
  it('an empty file produces no matches and no warnings', () => {
    const file = prepareFile(config, '');
    expect(matchRule(callRule, file)).toEqual([]);
    expect(scanFile([callRule, procRule], file)).toEqual({ matches: [], warnings: [] });
  });

  it('CRLF line endings: line numbers match the LF-normalised count and \\r is not part of any capture', () => {
    const text = 'MODULE a\r\nPROC p()\r\n  CALL x()\r\nENDPROC\r\n';
    const file = prepareFile(config, text);
    const matches = matchRule(callRule, file);
    expect(matches).toEqual([{ ruleId: 'call-statement', type: 'call', line: 3, column: 3, captures: { callee: 'x' } }]);
    expect(matches[0]?.captures.callee).not.toContain('\r');
  });

  it('the last line keeps no trailing \\r when the file ends without a final newline (CONTRACT.md §6.2)', () => {
    const text = 'MODULE a\r';
    const file = prepareFile(config, text);
    const matches = matchRule(moduleRule, file);
    expect(matches).toEqual([
      { ruleId: 'module-declaration', type: 'module_declaration', line: 1, column: 1, captures: { name: 'a' } },
    ]);
    expect(matches[0]?.captures.name).not.toContain('\r');
    // Column numbers stay exact: "a" ends right where the (stripped) line ends.
    expect(file.normalizedText).toBe('MODULE a');
  });

  it('tabs count as separators for the exact engine and as ordinary characters for regex columns', () => {
    const file = prepareFile(config, 'MODULE\ttabbed');
    expect(matchRule(moduleRule, file)).toEqual([
      { ruleId: 'module-declaration', type: 'module_declaration', line: 1, column: 1, captures: { name: 'tabbed' } },
    ]);
  });

  it('a match at the very end of the file (no trailing newline) is still found', () => {
    const file = prepareFile(config, 'PROC p()\n  CALL last_call');
    const matches = matchRule(callRule, file);
    expect(matches).toEqual([
      { ruleId: 'call-statement', type: 'call', line: 2, column: 3, captures: { callee: 'last_call' } },
    ]);
  });

  it('nested unclosed blocks at end of file are all reported as warnings, not errors', () => {
    const inner: RegexRule = {
      ...procRule,
      id: 'inner-def',
      regex: { pattern: '^\\s*INNER\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      blockEnd: { pattern: '^\\s*ENDINNER\\b', flags: 'i', multiline: false },
    };
    const text = ['PROC outer()', '  INNER thing', '    CALL x()'].join('\n');
    const file = prepareFile(config, text);
    const { matches, warnings } = scanFile([procRule, inner, callRule], file);
    expect(matches.find((m) => m.type === 'call')?.enclosingSymbol).toBe('thing');
    expect(warnings).toHaveLength(2);
    expect(warnings.every((w) => w.kind === 'unclosed-block')).toBe(true);
    expect(warnings.map((w) => w.ruleId).sort()).toEqual(['inner-def', 'proc-definition']);
  });

  it('an unclosed block followed by matches still assigns them the open scope', () => {
    const text = ['PROC p()', '  CALL a()', '  CALL b()'].join('\n');
    const { matches } = scanFile([procRule, callRule], prepareFile(config, text));
    const calls = matches.filter((m) => m.type === 'call');
    expect(calls.map((m) => m.enclosingSymbol)).toEqual(['p', 'p']);
  });
});
