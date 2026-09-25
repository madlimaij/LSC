import { describe, expect, it } from 'vitest';
import { ruleTypeHintOf, sectionText, truncateProse } from '../../src/ingest/index.js';
import type { HeadingInfo } from '../../src/ingest/index.js';
import type { Example } from '../../src/examples/index.js';

describe('sectionText', () => {
  const text = 'X'.repeat(3) + '## A\nbody a\n### Sub\nbody sub\n## B\nbody b\n';
  const headings: HeadingInfo[] = [
    { depth: 2, text: 'A', slug: 'a', line: 1, offset: 3 },
    { depth: 3, text: 'Sub', slug: 'sub', line: 3, offset: 3 + '## A\nbody a\n'.length },
    { depth: 2, text: 'B', slug: 'b', line: 5, offset: text.indexOf('## B') },
  ];

  it('includes a nested subsection (a later, deeper heading) in the owning section', () => {
    const section = sectionText(text, headings, 0);
    expect(section).toContain('## A');
    expect(section).toContain('### Sub');
    expect(section).not.toContain('## B');
  });

  it('stops at the next heading of the same or a shallower depth', () => {
    const section = sectionText(text, headings, 1);
    expect(section).toContain('### Sub');
    expect(section).not.toContain('## B');
  });

  it('runs to the end of the file for the last heading', () => {
    const section = sectionText(text, headings, 2);
    expect(section.endsWith('body b\n')).toBe(true);
  });

  it('returns an empty string for an out-of-range index', () => {
    expect(sectionText(text, headings, 99)).toBe('');
  });
});

describe('truncateProse', () => {
  it('returns the text unchanged when within the limit', () => {
    expect(truncateProse('short', 10)).toBe('short');
  });

  it('cuts the text and appends a truncation marker when over the limit', () => {
    const result = truncateProse('0123456789', 4);
    expect(result.startsWith('0123')).toBe(true);
    expect(result).toContain('truncated');
  });
});

describe('ruleTypeHintOf', () => {
  function example(polarity: 'positive' | 'negative', type?: 'call' | 'db_read'): Pick<Example, 'polarity' | 'expected'> {
    return {
      polarity,
      expected: type === undefined ? [] : [{ line: 1, type, captures: type === 'call' ? { callee: 'x' } : { table: 'x' } }],
    };
  }

  it('is undefined with no positive examples', () => {
    const { type, conflicting } = ruleTypeHintOf([example('negative') as Example]);
    expect(type).toBeUndefined();
    expect(conflicting).toEqual([]);
  });

  it('is the shared type when every positive example agrees', () => {
    const { type, conflicting } = ruleTypeHintOf([example('positive', 'call') as Example, example('positive', 'call') as Example]);
    expect(type).toBe('call');
    expect(conflicting).toEqual([]);
  });

  it('lists a conflicting type found after the first', () => {
    const { type, conflicting } = ruleTypeHintOf([example('positive', 'call') as Example, example('positive', 'db_read') as Example]);
    expect(type).toBe('call');
    expect(conflicting).toEqual(['db_read']);
  });
});
