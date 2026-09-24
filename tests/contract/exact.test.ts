import RE2 from 're2';
import { describe, expect, it } from 'vitest';
import { exactPlaceholderNames, exactToRegex, parseExactToken, quoteRegex } from '../../src/contract/index.js';

function matchAll(tokens: string[], caseSensitive: boolean, line: string) {
  const { pattern, flags } = exactToRegex({ tokens, caseSensitive });
  const re = new RE2(pattern, `${flags}g`);
  return [...line.matchAll(re as unknown as RegExp)].map((m) => ({ index: m.index, text: m[0], groups: { ...m.groups } }));
}

describe('exact engine definition (CONTRACT.md §6.4)', () => {
  it('parses placeholders only when the whole token is (?<name>)', () => {
    expect(parseExactToken('(?<callee>)')).toEqual({ kind: 'placeholder', name: 'callee' });
    expect(parseExactToken('x(?<callee>)')).toEqual({ kind: 'literal', text: 'x(?<callee>)' });
    expect(parseExactToken('(?<1bad>)')).toEqual({ kind: 'literal', text: '(?<1bad>)' });
    expect(exactPlaceholderNames(['CALL', '(?<a>)', '(', '(?<a>)'])).toEqual(['a', 'a']);
  });

  it('builds the documented equivalent regex', () => {
    expect(exactToRegex({ tokens: ['CALL', '(?<callee>)'], caseSensitive: false })).toEqual({
      pattern: '\\bCALL\\b[ \\t]*\\b(?<callee>[0-9A-Za-z_]+)\\b',
      flags: 'i',
    });
    expect(exactToRegex({ tokens: ['->', 'x.y'], caseSensitive: true })).toEqual({
      pattern: '->[ \\t]*\\bx\\.y\\b',
      flags: '',
    });
  });

  it('escapes every regex metacharacter in literals', () => {
    const text = '\\^$.*+?()[]{}|';
    expect(new RE2(`^${quoteRegex(text)}$`).test(text)).toBe(true);
  });

  it('captures the whole identifier after a keyword, stopping at punctuation', () => {
    expect(matchAll(['CALL', '(?<callee>)'], false, '  call apply_discount(order_id)')).toEqual([
      { index: 2, text: 'call apply_discount', groups: { callee: 'apply_discount' } },
    ]);
  });

  it('respects word boundaries: keywords inside identifiers do not match', () => {
    expect(matchAll(['CALL', '(?<callee>)'], false, 'RECALL_x = CALLER')).toEqual([]);
    expect(matchAll(['CALL', '(?<callee>)'], false, 'CALLx y')).toEqual([]);
  });

  it('allows zero separators between punctuation tokens but not between word tokens', () => {
    expect(matchAll(['FLAG', '('], true, 'FLAG("a") FLAG ("b")')).toHaveLength(2);
    expect(matchAll(['END', 'PROC'], true, 'ENDPROC')).toEqual([]);
    expect(matchAll(['END', 'PROC'], true, 'END \tPROC')).toHaveLength(1);
  });

  it('honours caseSensitive', () => {
    expect(matchAll(['CALL', '(?<c>)'], true, 'call x')).toEqual([]);
    expect(matchAll(['CALL', '(?<c>)'], true, 'CALL x')).toHaveLength(1);
  });
});
