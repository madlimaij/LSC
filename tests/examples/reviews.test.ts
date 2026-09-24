import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatLoadError,
  loadReviews,
  parseReviews,
  stringifyReviews,
  type ReviewEntry,
} from '../../src/examples/index.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/reviews');

function errorsOf(name: string): string[] {
  const file = join(FIXTURES, `${name}.yaml`);
  return loadReviews(file).errors.map((e) => formatLoadError(e).replace(`${FIXTURES}/`, ''));
}

/** Every malformed reviews fixture and the exact error(s) it must produce. */
const MALFORMED: Record<string, string[]> = {
  'yaml-syntax': ['yaml-syntax.yaml:4: invalid YAML: Missing closing "quote'],
  'root-is-list': [
    'root-is-list.yaml:1: a reviews file must be a mapping with one key, "reviews", holding a list of entries',
  ],
  'unknown-top-key': ['unknown-top-key.yaml:2: version: unknown field "version"'],
  'reviews-not-list': ['reviews-not-list.yaml:1: reviews: must be a list of review entries'],
  'missing-field': ['missing-field.yaml:2: reviews[0].ruleId: is required'],
  'bad-verdict': ['bad-verdict.yaml:5: reviews[0].verdict: must be "correct" or "false_positive"'],
  'correct-without-expected': [
    'correct-without-expected.yaml:2: reviews[0].expected: verdict "correct" needs at least one expected match',
  ],
  'false-positive-with-expected': [
    'false-positive-with-expected.yaml:12: reviews[0].expected: verdict "false_positive" must not list expected matches',
  ],
  'absolute-sample-file': [
    'absolute-sample-file.yaml:6: reviews[0].sampleFile: must be relative to the sample directory and use / separators',
  ],
  'line-out-of-range': [
    'line-out-of-range.yaml:12: reviews[0].expected[0].line: line 5 is past the end of the code (2 lines)',
  ],
  'bad-reviewed-at': [
    'bad-reviewed-at.yaml:10: reviews[0].reviewedAt: must be an ISO 8601 date-time in UTC, e.g. 2026-09-24T10:00:00Z',
  ],
};

/** Fixtures where some entries are valid: expected errors and ids still loaded. */
const PARTIAL: Record<string, { errors: string[]; ids: string[] }> = {
  'duplicate-id': {
    errors: ['duplicate-id.yaml:12: reviews[1].id: duplicate id "review-call-001" (first used by reviews[0])'],
    ids: ['review-call-001'],
  },
  'one-bad-one-good': {
    errors: [
      'one-bad-one-good.yaml:3: reviews[0].construct: must be a kebab-case construct id, e.g. "proc-definition"',
    ],
    ids: ['review-db-read-001'],
  },
};

const VALID = ['valid', 'empty', 'empty-list'];

describe('loadReviews: valid file', () => {
  const file = join(FIXTURES, 'valid.yaml');
  const result = loadReviews(file);

  it('loads without errors', () => {
    expect(result.errors).toEqual([]);
    expect(result.entries.map((e) => e.id)).toEqual(['review-call-001', 'review-db-read-001']);
  });

  it('turns verdict false_positive into a negative example', () => {
    expect(result.examples.find((e) => e.id === 'review-call-001')).toEqual({
      id: 'review-call-001',
      construct: 'call',
      polarity: 'negative',
      code: 'CALL DYNAMIC handler_name(order_id)\n',
      expected: [],
      source: {
        kind: 'review',
        file,
        entry: 0,
        ruleId: 'call-statement',
        sampleFile: 'orders/dispatch.tl',
        sampleLine: 7,
        verdict: 'false_positive',
      },
    });
  });

  it('turns verdict correct into a positive example with its expected matches', () => {
    const example = result.examples.find((e) => e.id === 'review-db-read-001');
    expect(example?.polarity).toBe('positive');
    expect(example?.code).toBe('READ &\n    order_lines WHERE order_id = oid\n');
    expect(example?.expected).toEqual([{ line: 1, type: 'db_read', captures: { table: 'order_lines' } }]);
    expect(example?.source).toMatchObject({ kind: 'review', entry: 1, verdict: 'correct' });
  });

  it('an empty file and an empty list give no examples and no errors', () => {
    for (const name of ['empty', 'empty-list']) {
      expect(loadReviews(join(FIXTURES, `${name}.yaml`))).toEqual({ examples: [], entries: [], errors: [] });
    }
  });
});

describe('loadReviews: malformed files give readable errors', () => {
  it('every fixture file is checked by a test', () => {
    const files = readdirSync(FIXTURES)
      .map((f) => f.replace(/\.yaml$/, ''))
      .sort();
    expect(files).toEqual([...VALID, ...Object.keys(MALFORMED), ...Object.keys(PARTIAL)].sort());
  });

  it.each(Object.entries(MALFORMED))('%s', (name, expected) => {
    expect(loadReviews(join(FIXTURES, `${name}.yaml`)).examples).toEqual([]);
    expect(errorsOf(name)).toEqual(expected);
  });

  it.each(Object.entries(PARTIAL))('%s keeps the valid entries', (name, { errors, ids }) => {
    const result = loadReviews(join(FIXTURES, `${name}.yaml`));
    expect(errorsOf(name)).toEqual(errors);
    expect(result.examples.map((e) => e.id)).toEqual(ids);
    expect(result.entries.map((e) => e.id)).toEqual(ids);
  });

  it('a missing file is an error unless allowMissing is set', () => {
    const file = join(FIXTURES, 'missing.yaml');
    expect(loadReviews(file).errors.map(formatLoadError)).toEqual([`${file}: reviews file does not exist`]);
    expect(loadReviews(file, { allowMissing: true })).toEqual({ examples: [], entries: [], errors: [] });
  });
});

describe('stringifyReviews', () => {
  const entries: ReviewEntry[] = [
    {
      id: 'review-call-001',
      construct: 'call',
      ruleId: 'call-statement',
      verdict: 'false_positive',
      sampleFile: 'orders/dispatch.tl',
      sampleLine: 7,
      code: '  CALL DYNAMIC handler_name(order_id)   \n',
      reviewedAt: '2026-09-24T10:00:00Z',
      note: 'target: only known at run time # not a comment',
    },
    {
      id: 'review-db-read-002',
      construct: 'db-read',
      ruleId: 'db-read',
      verdict: 'correct',
      sampleFile: 'orders/order_lines.tl',
      sampleLine: 4,
      code: 'READ &\n    order_lines WHERE note = "-- x" # y\n  LET z = 1',
      expected: [{ line: 1, type: 'db_read', captures: { table: 'order_lines' } }],
    },
  ];

  it('writes a file that loads back to the same entries and examples', () => {
    const text = stringifyReviews(entries);
    const loaded = parseReviews(text, 'reviews.yaml');
    expect(loaded.errors).toEqual([]);
    expect(loaded.entries).toEqual(entries);
    expect(loaded.examples.map((e) => [e.id, e.polarity, e.code])).toEqual([
      ['review-call-001', 'negative', entries[0]?.code],
      ['review-db-read-002', 'positive', entries[1]?.code],
    ]);
  });

  it('round-trips through a file on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lsc-reviews-'));
    try {
      const file = join(dir, 'reviews.yaml');
      writeFileSync(file, stringifyReviews(entries));
      expect(loadReviews(file).entries).toEqual(entries);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes an empty list for no entries', () => {
    expect(parseReviews(stringifyReviews([]), 'r.yaml')).toEqual({ examples: [], entries: [], errors: [] });
  });

  it('refuses to write an invalid entry', () => {
    const bad = { ...entries[0], sampleLine: 0 } as ReviewEntry;
    expect(() => stringifyReviews([bad])).toThrow();
  });
});
