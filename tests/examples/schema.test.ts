import { describe, expect, it } from 'vitest';
import {
  buildExample,
  codeLineCount,
  compareExamples,
  describePathIssue,
  exampleLocations,
  ExampleSchema,
  exampleRuleType,
  formatLoadError,
  normalizeCode,
  parseExpectBlock,
} from '../../src/examples/index.js';

const base = {
  id: 'call-01',
  construct: 'call',
  polarity: 'positive',
  code: 'LET a = 1\nCALL b()\n',
  expected: [{ line: 2, type: 'call', captures: { callee: 'b' } }],
  source: { kind: 'inline', skill: 'call.md', line: 12 },
};

function issuesOf(input: unknown): string[] {
  const result = buildExample(input);
  return result.ok ? [] : result.issues.map(describePathIssue);
}

describe('ExampleSchema', () => {
  it('accepts a positive example from each source kind', () => {
    expect(issuesOf(base)).toEqual([]);
    expect(issuesOf({ ...base, source: { kind: 'sidecar', file: 'call/call-01.tl', expectFile: 'call/call-01.expect.yaml' } })).toEqual([]);
    expect(
      issuesOf({
        ...base,
        source: {
          kind: 'review',
          file: 'reviews.yaml',
          entry: 0,
          ruleId: 'call-statement',
          sampleFile: 'a/b.tl',
          sampleLine: 3,
          verdict: 'correct',
        },
      }),
    ).toEqual([]);
  });

  it('accepts optional capture roles and several matches of one type', () => {
    expect(
      issuesOf({
        ...base,
        code: 'CALL m.a(); CALL b()',
        expected: [
          { line: 1, type: 'call', captures: { module: 'm', callee: 'a' } },
          { line: 1, type: 'call', captures: { callee: 'b' } },
        ],
      }),
    ).toEqual([]);
  });

  // One case per invariant; each must fail with a message naming the problem.
  const invalid: [string, Record<string, unknown>, string[]][] = [
    ['id not kebab-case', { id: 'Call_01' }, ['id: must be a kebab-case example id, e.g. "proc-01"']],
    ['construct not kebab-case', { construct: 'Call' }, ['construct: must be a kebab-case construct id, e.g. "proc-definition"']],
    ['unknown polarity', { polarity: 'neutral' }, ['polarity: must be "positive" or "negative"']],
    ['blank code', { code: ' \n\t\n' }, ['code: must not be empty']],
    ['CRLF code', { code: 'LET a = 1\r\nCALL b()\r\n' }, ['code: must use \\n line endings and no byte order mark (normalise it with normalizeCode)']],
    ['positive without matches', { expected: [] }, ['expected: a positive example needs at least one expected match']],
    ['negative with matches', { polarity: 'negative' }, ['expected: a negative example must not list expected matches (the rule must match nothing)']],
    ['line past the end', { expected: [{ line: 3, type: 'call', captures: { callee: 'b' } }] }, ['expected[0].line: line 3 is past the end of the code (2 lines)']],
    ['line zero', { expected: [{ line: 0, type: 'call', captures: { callee: 'b' } }] }, ['expected[0].line: must be 1 or greater']],
    [
      'mixed types',
      { expected: [{ line: 2, type: 'call', captures: { callee: 'b' } }, { line: 1, type: 'db_read', captures: { table: 't' } }] },
      ['expected[1].type: all expected matches of one example must have the same type (the construct\'s rule type); first is "call", this is "db_read"'],
    ],
    ['required role missing', { expected: [{ line: 2, type: 'call', captures: {} }] }, ['expected[0].captures: type "call" requires capture "callee"']],
    [
      'role not allowed for type',
      { expected: [{ line: 2, type: 'call', captures: { callee: 'b', name: 'x' } }] },
      ['expected[0].captures.name: type "call" has no capture role "name" (allowed: callee, module)'],
    ],
    ['unknown role', { expected: [{ line: 2, type: 'call', captures: { callee: 'b', proc: 'x' } }] }, ['expected[0].captures.proc: unknown capture role "proc"']],
    ['empty capture value', { expected: [{ line: 2, type: 'call', captures: { callee: '' } }] }, ['expected[0].captures.callee: must not be empty']],
    [
      'duplicate match',
      { expected: [{ line: 2, type: 'call', captures: { callee: 'b' } }, { line: 2, type: 'call', captures: { callee: 'b' } }] },
      ['expected[1]: duplicate expected match (same line, type and captures as an earlier entry)'],
    ],
    ['unknown field', { comment: 'x' }, ['comment: unknown field "comment"']],
    ['missing source', { source: undefined }, ['source: is required']],
    ['bad source kind', { source: { kind: 'wiki', skill: 'x' } }, ["source.kind: Invalid discriminator value. Expected 'inline' | 'sidecar' | 'review'"]],
  ];

  it.each(invalid)('rejects: %s', (_name, patch, expected) => {
    const input = Object.fromEntries(Object.entries({ ...base, ...patch }).filter(([, v]) => v !== undefined));
    expect(issuesOf(input)).toEqual(expected);
  });

  it('parsed examples are plain JSON (round-trip through JSON.stringify)', () => {
    const parsed = ExampleSchema.parse(base);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });
});

describe('helpers', () => {
  it('normalizeCode removes a BOM and converts CRLF only', () => {
    expect(normalizeCode('﻿a\r\nb\r\n  c\n')).toBe('a\nb\n  c\n');
  });

  it('codeLineCount ignores one final newline', () => {
    expect(codeLineCount('a')).toBe(1);
    expect(codeLineCount('a\n')).toBe(1);
    expect(codeLineCount('a\nb')).toBe(2);
    expect(codeLineCount('a\n\n')).toBe(2);
  });

  it('compareExamples sorts by construct, then id, by code unit', () => {
    const list = [
      { construct: 'db-read', id: 'read-01' },
      { construct: 'call', id: 'call-10' },
      { construct: 'call', id: 'call-02' },
    ];
    expect([...list].sort(compareExamples).map((e) => e.id)).toEqual(['call-02', 'call-10', 'read-01']);
  });

  it('exampleRuleType gives the type of the expected matches', () => {
    expect(exampleRuleType(ExampleSchema.parse(base))).toBe('call');
    expect(exampleRuleType({ expected: [] })).toBeUndefined();
  });

  it('formatLoadError prints file:line: message', () => {
    expect(formatLoadError({ file: 'a.yaml', line: 3, message: 'bad' })).toBe('a.yaml:3: bad');
    expect(formatLoadError({ file: 'a.yaml', message: 'bad' })).toBe('a.yaml: bad');
  });

  it('exampleLocations: examples/ and reviews.yaml are siblings of the Skill directory', () => {
    expect(exampleLocations('/lang/toylang/skills')).toEqual({
      examplesDir: '/lang/toylang/examples',
      reviewsFile: '/lang/toylang/reviews.yaml',
    });
    expect(exampleLocations('/lang/toylang/skills/')).toEqual(exampleLocations('/lang/toylang/skills'));
  });
});

describe('parseExpectBlock (inline `yaml expect` blocks, used by WP-06)', () => {
  it('parses a list of matches', () => {
    const result = parseExpectBlock('- line: 1\n  type: call\n  captures: { callee: a }\n', 'call.md', 20);
    expect(result).toEqual({ ok: true, expected: [{ line: 1, type: 'call', captures: { callee: 'a' } }] });
  });

  it('an empty block is an empty list', () => {
    expect(parseExpectBlock('', 'call.md')).toEqual({ ok: true, expected: [] });
  });

  it('reports errors with lines in the Skill file (offset by the fence line)', () => {
    const result = parseExpectBlock('- line: 1\n  type: call\n  captures: { callee: 7 }\n', 'skills/call.md', 40);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map(formatLoadError)).toEqual([
      'skills/call.md:43: [0].captures.callee: must be a string (quote values YAML would read as a number, boolean or null)',
    ]);
  });

  it('reports a mapping instead of a list', () => {
    const result = parseExpectBlock('line: 1\n', 'call.md', 5);
    expect(result.ok ? [] : result.errors.map(formatLoadError)).toEqual([
      'call.md:6: must be a list of expected matches',
    ]);
  });

  it('reports YAML syntax errors with the Skill file line', () => {
    const result = parseExpectBlock('- line: 1\n  captures: { callee: a\n', 'call.md', 10);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.line).toBeGreaterThan(10);
    expect(result.errors[0]?.message).toMatch(/^invalid YAML: /);
  });
});
