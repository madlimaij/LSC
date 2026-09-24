import { describe, expect, it } from 'vitest';
import { scanNamedGroups } from '../../src/contract/index.js';

describe('scanNamedGroups', () => {
  it('finds (?<name>...) groups in order', () => {
    expect(scanNamedGroups('^(?<kind>PROC|FUNC)\\s+(?<name>\\w+)').names).toEqual(['kind', 'name']);
  });

  it('ignores escaped parentheses and character classes', () => {
    expect(scanNamedGroups('\\(?<a>x)').names).toEqual([]);
    expect(scanNamedGroups('[(?<a>)](?<b>x)').names).toEqual(['b']);
    expect(scanNamedGroups('[]a(?<x>](?<b>x)').names).toEqual(['b']);
    expect(scanNamedGroups('[^]a(?<x>](?<b>x)').names).toEqual(['b']);
    expect(scanNamedGroups('[[:alpha:](?<x>](?<b>x)').names).toEqual(['b']);
    expect(scanNamedGroups('[\\](?<x>](?<b>x)').names).toEqual(['b']);
  });

  it('ignores unnamed and non-capturing groups', () => {
    expect(scanNamedGroups('(a)(?:b)(?i:c)').names).toEqual([]);
  });

  it('reports Python-style (?P<name>...) groups separately', () => {
    expect(scanNamedGroups('(?P<t>\\w+)(?<u>x)')).toEqual({ names: ['u'], pythonStyleNames: ['t'] });
  });
});
