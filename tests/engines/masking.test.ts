import { describe, expect, it } from 'vitest';
import { maskText, type CommentStringConfig } from '../../src/engines/index.js';

const toylang: CommentStringConfig = {
  lineComment: '--',
  blockComment: { start: '/*', end: '*/' },
  stringDelimiters: [{ start: '"', end: '"' }],
};

describe('masking (contract/CONTRACT.md §6.3)', () => {
  it('blanks a line comment to end of line, keeping the newline', () => {
    const text = 'CALL x() -- CALL y()\nCALL z()';
    const masked = maskText(text, toylang, true);
    expect(masked).toBe('CALL x() ' + ' '.repeat('-- CALL y()'.length) + '\nCALL z()');
    expect(masked.length).toBe(text.length);
    expect(masked.split('\n')).toHaveLength(2);
  });

  it('blanks a block comment across lines, keeping every newline', () => {
    const text = 'A /* c1\nc2\nc3 */ B';
    const masked = maskText(text, toylang, true);
    expect(masked.split('\n')).toEqual(['A      ', '  ', '      B']);
    expect(masked.length).toBe(text.length);
  });

  it('treats an unterminated block comment as running to end of file', () => {
    const text = 'A /* never closed\nsecond line';
    const masked = maskText(text, toylang, true);
    expect(masked).toBe('A ' + ' '.repeat('/* never closed'.length) + '\n' + ' '.repeat('second line'.length));
  });

  it('blanks a string literal on the same line only', () => {
    const text = 'INCLUDE "a.tl"\nCALL x()';
    const masked = maskText(text, toylang, true);
    expect(masked).toBe('INCLUDE ' + ' '.repeat('"a.tl"'.length) + '\nCALL x()');
  });

  it('treats a string unterminated on its line as running to end of that line only', () => {
    const text = 'LET x = "never closed\nCALL y()';
    const masked = maskText(text, toylang, true);
    const lines = masked.split('\n');
    expect(lines[0]).toBe('LET x = ' + ' '.repeat('"never closed'.length));
    expect(lines[1]).toBe('CALL y()');
  });

  it('does not recognise delimiters inside a comment or a string', () => {
    // A `"` inside a block comment does not start a string; `--` inside a string is not a comment.
    const text = 'A /* has " quote */ B\nMSG "has -- dashes"';
    const masked = maskText(text, toylang, true);
    const lines = masked.split('\n');
    expect(lines[0]).toBe('A ' + ' '.repeat('/* has " quote */'.length) + ' B');
    expect(lines[1]).toBe('MSG ' + ' '.repeat('"has -- dashes"'.length));
  });

  it('comment mask blanks only comments, keeping strings verbatim', () => {
    const text = 'FLAG("fast_shipping") -- a note';
    const masked = maskText(text, toylang, false);
    expect(masked).toBe('FLAG("fast_shipping") ' + ' '.repeat('-- a note'.length));
  });

  it('the longest delimiter starting at a position wins; ties break block > line > string order', () => {
    // stringDelimiters includes both `"` and `""`: the longer one must win when both start here.
    const config: CommentStringConfig = {
      stringDelimiters: [{ start: '"', end: '"' }, { start: '""', end: '""' }],
    };
    const text = 'X ""a"" Y';
    const masked = maskText(text, config, true);
    // `""` (length 2) wins over `"` (length 1) at position 2: string runs from `""` to the next `""`.
    expect(masked).toBe('X ' + ' '.repeat('""a""'.length) + ' Y');
  });

  it('a keyword inside a comment or string never matches when masking is configured', () => {
    const text = '-- WRITE ignored\nWRITE real_table\nMSG "WRITE also_ignored"';
    const masked = maskText(text, toylang, true);
    expect(masked).not.toContain('WRITE ignored');
    expect(masked).toContain('WRITE real_table');
    expect(masked).not.toContain('WRITE also_ignored');
  });

  it('a Rule Set with no masking fields leaves the text unchanged', () => {
    expect(maskText('-- not a comment here\n"not a string"', {}, true)).toBe('-- not a comment here\n"not a string"');
  });

  it('leaves plain text outside comments and strings untouched', () => {
    const text = 'PROC load_customer(id)\n  READ customers\nENDPROC';
    expect(maskText(text, toylang, true)).toBe(text);
  });
});
