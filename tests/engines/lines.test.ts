import { describe, expect, it } from 'vitest';
import { computeLineStarts, normalizeLineEndings, offsetToLineColumn, splitLines } from '../../src/engines/index.js';

describe('line handling (contract/CONTRACT.md §6.2)', () => {
  it('turns CRLF into LF and leaves LF-only text alone', () => {
    expect(normalizeLineEndings('a\r\nb\r\nc')).toBe('a\nb\nc');
    expect(normalizeLineEndings('a\nb')).toBe('a\nb');
  });

  it('strips a trailing \\r on the last line when the file has no final newline', () => {
    expect(normalizeLineEndings('MODULE a\r')).toBe('MODULE a');
    expect(normalizeLineEndings('a\r\nb\r')).toBe('a\nb');
  });

  it('splits into lines and computes line-start offsets consistently', () => {
    const text = 'aa\nbbb\n\nc';
    expect(splitLines(text)).toEqual(['aa', 'bbb', '', 'c']);
    expect(computeLineStarts(text)).toEqual([0, 3, 7, 8]);
  });

  it('handles an empty file as one empty line', () => {
    expect(splitLines('')).toEqual(['']);
    expect(computeLineStarts('')).toEqual([0]);
  });

  it('converts an offset to 1-based line and column', () => {
    const text = 'aa\nbbb\n\nc';
    const starts = computeLineStarts(text);
    expect(offsetToLineColumn(0, starts)).toEqual({ line: 1, column: 1 });
    expect(offsetToLineColumn(2, starts)).toEqual({ line: 1, column: 3 });
    expect(offsetToLineColumn(3, starts)).toEqual({ line: 2, column: 1 });
    expect(offsetToLineColumn(5, starts)).toEqual({ line: 2, column: 3 });
    expect(offsetToLineColumn(7, starts)).toEqual({ line: 3, column: 1 });
    expect(offsetToLineColumn(8, starts)).toEqual({ line: 4, column: 1 });
  });

  it('reports the last line for a match at end of file with no trailing newline', () => {
    const text = 'PROC x';
    const starts = computeLineStarts(text);
    expect(offsetToLineColumn(text.length, starts)).toEqual({ line: 1, column: text.length + 1 });
  });
});
