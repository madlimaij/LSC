import { describe, expect, it } from 'vitest';
import { matchesAnyGlob, matchesGlob } from '../../src/runner/index.js';

describe('matchesGlob (contract/CONTRACT.md §6.1)', () => {
  it('"**/*.tl" matches files at any depth, including the top level', () => {
    expect(matchesGlob('orders/dispatch.tl', '**/*.tl')).toBe(true);
    expect(matchesGlob('dispatch.tl', '**/*.tl')).toBe(true);
    expect(matchesGlob('a/b/c/dispatch.tl', '**/*.tl')).toBe(true);
  });

  it('rejects files that do not match the extension', () => {
    expect(matchesGlob('docs/notes.txt', '**/*.tl')).toBe(false);
  });

  it('"*" does not cross a "/" boundary', () => {
    expect(matchesGlob('a/b.tl', '*.tl')).toBe(false);
    expect(matchesGlob('b.tl', '*.tl')).toBe(true);
  });

  it('"?" matches exactly one character, not "/"', () => {
    expect(matchesGlob('ab.tl', 'a?.tl')).toBe(true);
    expect(matchesGlob('a.tl', 'a?.tl')).toBe(false);
    expect(matchesGlob('a/.tl', 'a?.tl')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(matchesGlob('Orders/Dispatch.TL', '**/*.tl')).toBe(false);
  });

  it('matchesAnyGlob is true when at least one pattern matches', () => {
    expect(matchesAnyGlob('src/a.ts', ['**/*.tl', '**/*.ts'])).toBe(true);
    expect(matchesAnyGlob('src/a.ts', ['**/*.tl', '**/*.js'])).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(matchesGlob('a+b.tl', '*.tl')).toBe(true);
    expect(matchesGlob('a(1).tl', 'a(1).tl')).toBe(true);
  });
});
