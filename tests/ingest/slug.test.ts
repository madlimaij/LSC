import { describe, expect, it } from 'vitest';
import { slugify, SlugCounter } from '../../src/ingest/index.js';

describe('slugify', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('Defining a procedure')).toBe('defining-a-procedure');
  });

  it('strips punctuation but keeps word characters and hyphens', () => {
    expect(slugify('READ: table, WHERE clause?')).toBe('read-table-where-clause');
  });

  it('collapses repeated whitespace and trims', () => {
    expect(slugify('  Feature   flags  ')).toBe('feature-flags');
  });

  it('the same heading text always produces the same slug', () => {
    expect(slugify('Calling a procedure')).toBe(slugify('Calling a procedure'));
  });
});

describe('SlugCounter', () => {
  it('gives the first occurrence of a heading text the plain slug', () => {
    const counter = new SlugCounter();
    expect(counter.next('Traps')).toBe('traps');
  });

  it('appends -1, -2, ... to later headings with the same text, so anchors stay unique', () => {
    const counter = new SlugCounter();
    expect(counter.next('Traps')).toBe('traps');
    expect(counter.next('Traps')).toBe('traps-1');
    expect(counter.next('Traps')).toBe('traps-2');
  });

  it('never produces an empty slug', () => {
    const counter = new SlugCounter();
    expect(counter.next('---')).toBe('section');
  });
});
