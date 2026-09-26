import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadReviews, parseReviews, stringifyReviews, type ReviewEntry } from '../../src/examples/index.js';
import {
  buildReviewEntry,
  collectUnreviewedMatches,
  deriveConstruct,
  makeIdGenerator,
  matchedLineText,
  runReviewSession,
} from '../../src/report/review-session.js';
import { loadFixtureRuleSet, loadSampleFiles, runFixture } from './helpers.js';

describe('collectUnreviewedMatches / deriveConstruct', () => {
  it('lists every rule\'s sample matches, filed under the construct its own examples belong to', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const items = collectUnreviewedMatches(results);
    expect(items.length).toBeGreaterThan(0);
    const moduleItem = items.find((item) => item.ruleId === 'module-declaration');
    expect(moduleItem?.construct).toBe('module-declaration');
  });

  it('falls back to the rule type (kebab-case) when a rule has no own examples', () => {
    expect(
      deriveConstruct({
        type: 'db_read',
        examples: [{ exampleId: 'x', construct: 'y', polarity: 'negative', role: 'cross-negative', passed: true, missed: [], unexpected: [], wrongCaptures: [] }],
      }),
    ).toBe('db-read');
  });
});

describe('makeIdGenerator', () => {
  it('starts at 001 per construct with no existing entries', () => {
    const nextId = makeIdGenerator([]);
    expect(nextId('call')).toBe('review-call-001');
    expect(nextId('call')).toBe('review-call-002');
    expect(nextId('db-read')).toBe('review-db-read-001');
  });

  it('continues after the highest existing id for that construct', () => {
    const existing = [{ id: 'review-call-003' } as ReviewEntry, { id: 'review-call-001' } as ReviewEntry];
    const nextId = makeIdGenerator(existing);
    expect(nextId('call')).toBe('review-call-004');
  });
});

describe('buildReviewEntry / matchedLineText', () => {
  const item = {
    ruleId: 'call-statement',
    construct: 'call',
    match: {
      ruleId: 'call-statement',
      file: 'orders/dispatch.tl',
      line: 7,
      column: 1,
      captures: { callee: 'handler_name' },
      snippet: [
        { line: 6, text: '-- dispatch' },
        { line: 7, text: 'CALL DYNAMIC handler_name(order_id)' },
        { line: 8, text: 'ENDPROC' },
      ],
    },
  };

  it('matchedLineText finds the exact matched line', () => {
    expect(matchedLineText(item.match)).toBe('CALL DYNAMIC handler_name(order_id)');
  });

  it('verdict correct: expected records the match\'s own captures on line 1', () => {
    const entry = buildReviewEntry(item, 'call', 'correct', 'review-call-001');
    expect(entry).toMatchObject({
      id: 'review-call-001',
      construct: 'call',
      ruleId: 'call-statement',
      verdict: 'correct',
      sampleFile: 'orders/dispatch.tl',
      sampleLine: 7,
      code: 'CALL DYNAMIC handler_name(order_id)',
      expected: [{ line: 1, type: 'call', captures: { callee: 'handler_name' } }],
    });
  });

  it('verdict false_positive: no expected field', () => {
    const entry = buildReviewEntry(item, 'call', 'false_positive', 'review-call-002');
    expect(entry.expected).toBeUndefined();
    expect(entry.verdict).toBe('false_positive');
  });

  it('a review entry round-trips through the WP-03 loader as a valid example (acceptance criterion)', () => {
    const correct = buildReviewEntry(item, 'call', 'correct', 'review-call-001', { now: () => '2026-09-26T10:00:00Z' });
    const falsePositive = buildReviewEntry(
      { ...item, match: { ...item.match, line: 12, snippet: [{ line: 12, text: 'CALL something(x)' }] } },
      'call',
      'false_positive',
      'review-call-002',
    );
    const yaml = stringifyReviews([correct, falsePositive]);
    const loaded = parseReviews(yaml, 'reviews.yaml');
    expect(loaded.errors).toEqual([]);
    expect(loaded.examples).toHaveLength(2);
    const positive = loaded.examples.find((example) => example.id === 'review-call-001');
    expect(positive?.polarity).toBe('positive');
    expect(positive?.expected).toEqual([{ line: 1, type: 'call', captures: { callee: 'handler_name' } }]);
    const negative = loaded.examples.find((example) => example.id === 'review-call-002');
    expect(negative?.polarity).toBe('negative');
    expect(negative?.expected).toEqual([]);
  });
});

describe('runReviewSession', () => {
  it('answers every match in order, stops early on "quit", and calls onRecorded only for recorded verdicts', async () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const total = collectUnreviewedMatches(results).length;
    expect(total).toBeGreaterThan(2);

    const asked: number[] = [];
    const recordedSnapshots: number[] = [];
    const skippedReasons: string[] = [];

    const outcome = await runReviewSession(
      results,
      [],
      {
        ask: (_item, index) => {
          asked.push(index);
          if (index === 0) return Promise.resolve('correct');
          if (index === 1) return Promise.resolve('nonsense');
          return Promise.resolve('quit');
        },
        onRecorded: (entries) => recordedSnapshots.push(entries.length),
        onSkipped: (_item, reason) => skippedReasons.push(reason),
      },
      { now: () => '2026-09-26T00:00:00Z' },
    );

    expect(asked).toEqual([0, 1, 2]); // stopped after the 3rd (quit), never reached the rest
    expect(outcome.quit).toBe(true);
    expect(outcome.correct).toBe(1);
    expect(outcome.falsePositive).toBe(0);
    expect(outcome.skipped).toBe(1);
    expect(outcome.entries).toHaveLength(1);
    expect(recordedSnapshots).toEqual([1]);
    expect(skippedReasons).toEqual([expect.stringContaining('not understood')]);
  });

  it('running to completion (no quit) answers every match', async () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const total = collectUnreviewedMatches(results).length;

    const outcome = await runReviewSession(results, [], { ask: () => Promise.resolve('skip') });

    expect(outcome.quit).toBe(false);
    expect(outcome.skipped).toBe(total);
    expect(outcome.entries).toHaveLength(0);
  });

  it('continues numbering ids from existing entries and never collides across a session', async () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const existing = [{ id: 'review-module-declaration-001' } as ReviewEntry];

    const outcome = await runReviewSession(results, existing, { ask: () => Promise.resolve('correct') });
    const newEntries = outcome.entries.filter((entry) => !existing.includes(entry));

    const moduleIds = newEntries.filter((e) => e.id.startsWith('review-module-declaration-')).map((e) => e.id);
    expect(new Set(outcome.entries.map((e) => e.id)).size).toBe(outcome.entries.length); // no collisions
    expect(moduleIds).not.toContain('review-module-declaration-001'); // already used by `existing`
    expect(moduleIds).toContain('review-module-declaration-002');
  });
});

describe('a full session written to disk loads back with loadReviews', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lsc-review-session-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('writes reviews.yaml that loadReviews reads back with no errors, and a later append keeps earlier entries', () => {
    const item = {
      ruleId: 'config-flag',
      construct: 'config-flag',
      match: {
        ruleId: 'config-flag',
        file: 'admin/flags.tl',
        line: 3,
        column: 1,
        captures: { key: 'beta_enabled' },
        snippet: [{ line: 3, text: 'FLAG beta_enabled' }],
      },
    };
    const reviewsFile = join(tmp, 'reviews.yaml');
    const nextId = makeIdGenerator([]);
    const first = buildReviewEntry(item, 'config_ref', 'correct', nextId(item.construct));
    writeFileSync(reviewsFile, stringifyReviews([first]));

    const loadedOnce = loadReviews(reviewsFile);
    expect(loadedOnce.errors).toEqual([]);
    expect(loadedOnce.entries).toHaveLength(1);

    const nextId2 = makeIdGenerator(loadedOnce.entries);
    const second = buildReviewEntry(
      { ...item, match: { ...item.match, line: 9, snippet: [{ line: 9, text: 'FLAG maintenance_mode' }] } },
      'config_ref',
      'false_positive',
      nextId2(item.construct),
    );
    writeFileSync(reviewsFile, stringifyReviews([...loadedOnce.entries, second]));

    const loadedTwice = loadReviews(reviewsFile);
    expect(loadedTwice.errors).toEqual([]);
    expect(loadedTwice.entries.map((entry) => entry.id)).toEqual(['review-config-flag-001', 'review-config-flag-002']);
    expect(loadedTwice.examples.filter((example) => example.polarity === 'negative')).toHaveLength(1);
  });
});
