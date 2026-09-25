import { describe, expect, it } from 'vitest';
import type { Rule } from '../../src/contract/index.js';
import { reviewedMatchKey, scanSampleFiles, type SampleFile } from '../../src/runner/index.js';

const moduleRule: Rule = {
  id: 'module-declaration',
  type: 'module_declaration',
  engine: 'exact',
  exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
  captures: { name: 'name' },
  confidence: 'high',
  sourceEvidence: [{ skill: 'skills/module.md', anchor: 'x', exampleIds: [] }],
  tests: { passed: 0, failed: 0, failingExampleIds: [] },
  status: 'validated',
};

describe('scanSampleFiles', () => {
  it('scans only files matching fileMatchers (contract/CONTRACT.md §6.1)', () => {
    const files: SampleFile[] = [
      { path: 'orders/dispatch.tl', content: 'MODULE dispatch\n' },
      { path: 'docs/notes.txt', content: 'MODULE notreal\n' },
    ];
    const result = scanSampleFiles([moduleRule], ['**/*.tl'], {}, files, new Set());
    expect(result.filesScanned).toEqual(['orders/dispatch.tl']);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.file).toBe('orders/dispatch.tl');
  });

  it('produces a +-3 line snippet around the match, clamped to file bounds', () => {
    const content = ['MODULE x', '-- 1', '-- 2', '-- 3', '-- 4'].join('\n') + '\n';
    const files: SampleFile[] = [{ path: 'a.tl', content }];
    const result = scanSampleFiles([moduleRule], ['**/*.tl'], {}, files, new Set());
    const match = result.matches[0];
    expect(match?.line).toBe(1);
    expect(match?.snippet.map((s) => s.line)).toEqual([1, 2, 3, 4]);
    expect(match?.snippet[0]).toEqual({ line: 1, text: 'MODULE x' });
  });

  it('excludes matches already recorded in reviews.yaml (D9)', () => {
    const files: SampleFile[] = [{ path: 'a.tl', content: 'MODULE x\n' }];
    const key = reviewedMatchKey('module-declaration', 'a.tl', 1);
    const result = scanSampleFiles([moduleRule], ['**/*.tl'], {}, files, new Set([key]));
    expect(result.matches).toEqual([]);
  });

  it('reports block-tracking warnings with the file path attached', () => {
    const procRule: Rule = {
      id: 'proc-definition',
      type: 'symbol_definition',
      engine: 'regex',
      regex: { pattern: '^PROC\\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)', flags: 'i', multiline: false },
      captures: { name: 'name' },
      blockEnd: { pattern: '^ENDPROC\\b', flags: 'i', multiline: false },
      confidence: 'high',
      sourceEvidence: [{ skill: 'skills/procedure.md', anchor: 'x', exampleIds: [] }],
      tests: { passed: 0, failed: 0, failingExampleIds: [] },
      status: 'validated',
    };
    const files: SampleFile[] = [{ path: 'unclosed.tl', content: 'PROC never_ends\nLOG 1\n' }];
    const result = scanSampleFiles([procRule], ['**/*.tl'], {}, files, new Set());
    expect(result.warnings).toEqual([
      {
        kind: 'unclosed-block',
        ruleId: 'proc-definition',
        file: 'unclosed.tl',
        line: 1,
        column: 1,
        message: 'scope opened by rule "proc-definition" at line 1 is never closed (end of file)',
      },
    ]);
  });
});
