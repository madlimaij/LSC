import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLoadError, loadSidecarExamples } from '../../src/examples/index.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/sidecar');

/** Loads one fixture directory and returns its errors with the fixture path stripped. */
function errorsOf(fixture: string): string[] {
  const dir = join(FIXTURES, fixture);
  return loadSidecarExamples(dir).errors.map((e) => formatLoadError(e).replace(`${dir}/`, ''));
}

/**
 * Every malformed sidecar fixture and the exact error(s) it must produce.
 * Each fixture breaks one rule; a fixture directory without an entry here
 * fails the "every fixture is checked" test.
 */
const MALFORMED: Record<string, string[]> = {
  'missing-expect': ['call/call-01.tl: missing expect file call-01.expect.yaml'],
  'missing-code': ['call/call-01.expect.yaml: missing code file call-01.<ext> for this expect file'],
  'two-code-files': ['call/call-01.tl: more than one code file for example "call-01": call-01.tl, call-01.txt'],
  'file-at-root': ['call-01.tl: sidecar files must be inside a construct directory: examples/<construct>/<id>.<ext>'],
  'bad-construct-dir': [
    'Proc_Def: construct directory name "Proc_Def" must be a kebab-case construct id, e.g. "proc-definition"',
  ],
  'bad-file-name': [
    'call/Call_01.tl: file name must be <id>.<ext> or <id>.expect.yaml with a kebab-case id, e.g. "proc-01.tl"',
  ],
  'expect-yml': [
    'call/call-01.expect.yml: expect files must be named <id>.expect.yaml',
    'call/call-01.tl: missing expect file call-01.expect.yaml',
  ],
  'no-extension': ['call/call-01: code file needs an extension: <id>.<ext>'],
  'nested-dir': ['call/more: nested directories are not allowed; put files directly in examples/call/'],
  'yaml-syntax': [
    'call/call-01.expect.yaml:5: invalid YAML: Flow sequence in block collection must be sufficiently indented and end with a ]',
  ],
  'yaml-duplicate-key': ['call/call-01.expect.yaml:2: invalid YAML: Map keys must be unique'],
  'empty-expect': ['call/call-01.expect.yaml: expect file is empty; it needs at least "polarity"'],
  'unknown-field': ['call/call-01.expect.yaml:2: description: unknown field "description"'],
  'bad-polarity': ['call/call-01.expect.yaml:1: polarity: must be "positive" or "negative"'],
  'missing-polarity': ['call/call-01.expect.yaml:1: polarity: is required'],
  'positive-without-expected': [
    'call/call-01.expect.yaml:1: expected: a positive example needs at least one expected match',
  ],
  'negative-with-expected': [
    'call/call-01.expect.yaml:3: expected: a negative example must not list expected matches (the rule must match nothing)',
  ],
  'line-out-of-range': ['call/call-01.expect.yaml:3: expected[0].line: line 3 is past the end of the code (1 line)'],
  'line-not-integer': ['call/call-01.expect.yaml:3: expected[0].line: must be a whole number'],
  'unknown-rule-type': [
    'call/call-01.expect.yaml:4: expected[0].type: must be a rule type: module_declaration, symbol_definition, call, include, db_read, db_write, config_ref, entry_point',
  ],
  'missing-required-capture': ['call/call-01.expect.yaml:5: expected[0].captures: type "call" requires capture "callee"'],
  'capture-role-not-allowed': [
    'call/call-01.expect.yaml:5: expected[0].captures.table: type "call" has no capture role "table" (allowed: callee, module)',
  ],
  'unknown-capture-role': ['call/call-01.expect.yaml:5: expected[0].captures.function: unknown capture role "function"'],
  'capture-not-string': [
    'call/call-01.expect.yaml:5: expected[0].captures.callee: must be a string (quote values YAML would read as a number, boolean or null)',
  ],
  'mixed-types': [
    'call/call-01.expect.yaml:7: expected[1].type: all expected matches of one example must have the same type (the construct\'s rule type); first is "call", this is "db_read"',
  ],
  'duplicate-expected': [
    'call/call-01.expect.yaml:6: expected[1]: duplicate expected match (same line, type and captures as an earlier entry)',
  ],
  'empty-code': ['call/call-01.tl: code: must not be empty'],
};

describe('loadSidecarExamples: valid directory', () => {
  const result = loadSidecarExamples(join(FIXTURES, 'valid'));

  it('loads every pair without errors, ignoring dot files', () => {
    expect(result.errors).toEqual([]);
    expect(result.examples.map((e) => e.id)).toEqual(['call-01', 'call-neg-01', 'read-01', 'read-neg-01']);
  });

  it('produces complete Example records', () => {
    expect(result.examples[0]).toEqual({
      id: 'call-01',
      construct: 'call',
      polarity: 'positive',
      code: 'CALL apply_discount(order_id)\n',
      expected: [{ line: 1, type: 'call', captures: { callee: 'apply_discount' } }],
      source: { kind: 'sidecar', file: 'call/call-01.tl', expectFile: 'call/call-01.expect.yaml' },
    });
  });

  it('accepts a negative example with no expected key and with expected: []', () => {
    const negatives = result.examples.filter((e) => e.polarity === 'negative');
    expect(negatives.map((e) => e.expected)).toEqual([[], []]);
  });
});

describe('loadSidecarExamples: malformed files give readable errors', () => {
  it('every fixture directory is checked by a test', () => {
    const dirs = readdirSync(FIXTURES).filter((d) => d !== 'valid' && d !== 'duplicate-id').sort();
    expect(dirs).toEqual(Object.keys(MALFORMED).sort());
  });

  it.each(Object.entries(MALFORMED))('%s', (fixture, expected) => {
    const result = loadSidecarExamples(join(FIXTURES, fixture));
    expect(result.examples).toEqual([]);
    expect(errorsOf(fixture)).toEqual(expected);
  });

  it('duplicate-id: an id used in two construct directories is reported and both are dropped', () => {
    const dir = join(FIXTURES, 'duplicate-id');
    const result = loadSidecarExamples(dir);
    expect(result.examples).toEqual([]);
    expect(result.errors.map(formatLoadError)).toEqual([
      `${dir}: example id "shared-01" is used more than once (call/shared-01.tl, db-read/shared-01.tl); ids must be unique across constructs`,
    ]);
  });

  it('a missing directory is an error unless allowMissing is set', () => {
    const dir = join(FIXTURES, 'does-not-exist');
    expect(loadSidecarExamples(dir).errors.map(formatLoadError)).toEqual([
      `${dir}: examples directory does not exist or cannot be read`,
    ]);
    expect(loadSidecarExamples(dir, { allowMissing: true })).toEqual({ examples: [], errors: [] });
  });
});

describe('loadSidecarExamples: normalisation and partial loading', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function makeDir(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'lsc-sidecar-'));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  }

  it('removes a byte order mark and converts CRLF to LF in code and expect files', () => {
    dir = makeDir({
      'call/call-01.tl': '﻿LET a = 1\r\nCALL b()\r\n',
      'call/call-01.expect.yaml': '﻿polarity: positive\r\nexpected:\r\n  - { line: 2, type: call, captures: { callee: b } }\r\n',
    });
    const result = loadSidecarExamples(dir);
    expect(result.errors).toEqual([]);
    expect(result.examples[0]?.code).toBe('LET a = 1\nCALL b()\n');
  });

  it('keeps valid examples when another file in the same directory is broken', () => {
    dir = makeDir({
      'call/call-01.tl': 'CALL a()\n',
      'call/call-01.expect.yaml': 'polarity: positive\nexpected:\n  - { line: 1, type: call, captures: { callee: a } }\n',
      'call/call-02.tl': 'CALL b()\n',
      'call/call-02.expect.yaml': 'polarity: sideways\n',
    });
    const result = loadSidecarExamples(dir);
    expect(result.examples.map((e) => e.id)).toEqual(['call-01']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toBe(join(dir, 'call/call-02.expect.yaml'));
  });
});
