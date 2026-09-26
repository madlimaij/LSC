import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Rule } from '../../src/contract/index.js';
import { loadReviews, parseReviews, stringifyReviews, type ReviewEntry } from '../../src/examples/index.js';
import { matchRule, prepareFile } from '../../src/engines/index.js';
import { diffExample } from '../../src/runner/index.js';
import {
  buildReviewEntry,
  collectUnreviewedMatches,
  deriveConstruct,
  makeIdGenerator,
  matchedLineText,
  runReviewSession,
} from '../../src/report/review-session.js';
import { loadFixtureRuleSet, loadSampleFiles, runFixture, SAMPLE_DIR } from './helpers.js';

function ruleNamed(ruleId: string): Rule {
  const rule = loadFixtureRuleSet().rules.find((r) => r.id === ruleId);
  if (rule === undefined) throw new Error(`no rule "${ruleId}" in the fixture`);
  return rule;
}

function sampleText(relativePath: string): string {
  return readFileSync(join(SAMPLE_DIR, relativePath), 'utf8');
}

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

describe('buildReviewEntry (real fixture rule + real sample file, so the span/re-match is genuine)', () => {
  const callRule = () => ruleNamed('call-statement');
  const dispatchText = () => sampleText('orders/dispatch.tl');

  // orders/dispatch.tl:8 — "  CALL common.log_event(\"dispatched\")" — the only call-statement match on
  // that line, so it has no "other same-rule match" complication.
  const item = {
    ruleId: 'call-statement',
    construct: 'call',
    match: {
      ruleId: 'call-statement',
      file: 'orders/dispatch.tl',
      line: 8,
      column: 3,
      captures: { callee: 'log_event', module: 'common' },
      snippet: [{ line: 8, text: '  CALL common.log_event("dispatched")' }],
    },
  };

  it('matchedLineText finds the exact matched line', () => {
    expect(matchedLineText(item.match)).toBe('  CALL common.log_event("dispatched")');
  });

  it('verdict correct: expected records the match\'s own captures on line 1 of a single-line span', () => {
    const result = buildReviewEntry(item, callRule(), loadFixtureRuleSet(), dispatchText(), 'correct', 'review-call-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry).toMatchObject({
      id: 'review-call-001',
      construct: 'call',
      ruleId: 'call-statement',
      verdict: 'correct',
      sampleFile: 'orders/dispatch.tl',
      sampleLine: 8,
      code: '  CALL common.log_event("dispatched")',
      expected: [{ line: 1, type: 'call', captures: { callee: 'log_event', module: 'common' } }],
    });
  });

  it('verdict false_positive: no expected field', () => {
    const result = buildReviewEntry(item, callRule(), loadFixtureRuleSet(), dispatchText(), 'false_positive', 'review-call-002');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.expected).toBeUndefined();
    expect(result.entry.verdict).toBe('false_positive');
  });

  it('a review entry round-trips through the WP-03 loader as a valid example (acceptance criterion)', () => {
    const correct = buildReviewEntry(item, callRule(), loadFixtureRuleSet(), dispatchText(), 'correct', 'review-call-001', {
      now: () => '2026-09-26T10:00:00Z',
    });
    const falsePositive = buildReviewEntry(item, callRule(), loadFixtureRuleSet(), dispatchText(), 'false_positive', 'review-call-002');
    expect(correct.ok).toBe(true);
    expect(falsePositive.ok).toBe(true);
    if (!correct.ok || !falsePositive.ok) return;

    const yaml = stringifyReviews([correct.entry, falsePositive.entry]);
    const loaded = parseReviews(yaml, 'reviews.yaml');
    expect(loaded.errors).toEqual([]);
    expect(loaded.examples).toHaveLength(2);
    const positive = loaded.examples.find((example) => example.id === 'review-call-001');
    expect(positive?.polarity).toBe('positive');
    expect(positive?.expected).toEqual([{ line: 1, type: 'call', captures: { callee: 'log_event', module: 'common' } }]);
    const negative = loaded.examples.find((example) => example.id === 'review-call-002');
    expect(negative?.polarity).toBe('negative');
    expect(negative?.expected).toEqual([]);
  });

  it('refuses to build an entry when the match cannot be found again (stale file or Rule Set)', () => {
    const staleItem = { ...item, match: { ...item.match, line: 999, column: 1 } };
    const result = buildReviewEntry(staleItem, callRule(), loadFixtureRuleSet(), dispatchText(), 'correct', 'review-call-003');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('no longer matches');
  });
});

describe('buildReviewEntry: the reviewer\'s db-read reproduction (order_lines.tl)', () => {
  const dbReadRule = () => ruleNamed('db-read');
  const orderLinesText = () => sampleText('orders/order_lines.tl');
  const ruleSet = loadFixtureRuleSet();

  // orders/order_lines.tl:
  //   4   READ &                                                 <- continues onto line 5 (multiline span)
  //   5       order_lines WHERE order_id = oid
  //   6   READ products WHERE id = line_product; READ stock_levels WHERE product = line_product  <- two matches, one line

  function matchAt(line: number, column: number, table: string) {
    return { ruleId: 'db-read', file: 'orders/order_lines.tl', line, column, captures: { table }, snippet: [] };
  }

  it('a multiline match (READ & continued on the next line) spans both lines, with no other same-rule match on them', () => {
    const item = { ruleId: 'db-read', construct: 'db-read', match: matchAt(4, 3, 'order_lines') };
    const result = buildReviewEntry(item, dbReadRule(), ruleSet, orderLinesText(), 'correct', 'review-db-read-001');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.code).toBe('  READ &\n      order_lines WHERE order_id = oid');
    expect(result.entry.expected).toEqual([{ line: 1, type: 'db_read', captures: { table: 'order_lines' } }]);
  });

  it('verdict correct on one of two same-line matches lists both in `expected` (README §4)', () => {
    const item = { ruleId: 'db-read', construct: 'db-read', match: matchAt(6, 3, 'products') };
    const result = buildReviewEntry(item, dbReadRule(), ruleSet, orderLinesText(), 'correct', 'review-db-read-002');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.code).toBe('  READ products WHERE id = line_product; READ stock_levels WHERE product = line_product');
    expect(result.entry.expected).toEqual([
      { line: 1, type: 'db_read', captures: { table: 'products' } },
      { line: 1, type: 'db_read', captures: { table: 'stock_levels' } },
    ]);
  });

  it('verdict false_positive on one of two same-line matches refuses (the other match is genuine, D16 h)', () => {
    const item = { ruleId: 'db-read', construct: 'db-read', match: matchAt(6, 3, 'products') };
    const result = buildReviewEntry(item, dbReadRule(), ruleSet, orderLinesText(), 'false_positive', 'review-db-read-003');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('also matched by rule "db-read"');
  });

  it('verdict false_positive on the multiline match (no other same-rule match on those lines) is written', () => {
    const item = { ruleId: 'db-read', construct: 'db-read', match: matchAt(4, 3, 'order_lines') };
    const result = buildReviewEntry(item, dbReadRule(), ruleSet, orderLinesText(), 'false_positive', 'review-db-read-004');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.expected).toBeUndefined();
  });

  it("end to end: building entries for all three sample matches as `correct`, loading them back, and running db-read against them gives 0 failures (the reviewer's reproduction)", () => {
    const results = runFixture(ruleSet, loadSampleFiles());
    const dbRead = results.rules.find((r) => r.ruleId === 'db-read');
    const sampleMatches = dbRead?.sampleMatches.filter((m) => m.file === 'orders/order_lines.tl') ?? [];
    expect(sampleMatches).toHaveLength(3); // one multiline match (lines 4-5) + two matches on line 6

    const nextId = makeIdGenerator([]);
    const entries: ReviewEntry[] = [];
    for (const match of sampleMatches) {
      const item = { ruleId: 'db-read', construct: 'db-read', match };
      const built = buildReviewEntry(item, dbReadRule(), ruleSet, orderLinesText(), 'correct', nextId('db-read'));
      expect(built.ok).toBe(true);
      if (built.ok) entries.push(built.entry);
    }

    const yaml = stringifyReviews(entries);
    const loaded = parseReviews(yaml, 'reviews.yaml');
    expect(loaded.errors).toEqual([]);
    expect(loaded.examples).toHaveLength(3);

    const rule = dbReadRule();
    let failed = 0;
    for (const example of loaded.examples) {
      const prepared = prepareFile(ruleSet, example.code);
      const actual = matchRule(rule, prepared);
      const diff = diffExample(example.expected, actual);
      if (!diff.passed) failed += 1;
    }
    expect(failed).toBe(0); // was 3 failed under the old single-line `code` (per the reviewer's finding)
  });
});

describe('runReviewSession', () => {
  function context() {
    const ruleSet = loadFixtureRuleSet();
    const files = new Map(loadSampleFiles().map((f) => [f.path, f.content]));
    return { ruleSet, readSampleFile: (file: string) => files.get(file) };
  }

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
      context(),
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

    const outcome = await runReviewSession(results, [], context(), { ask: () => Promise.resolve('skip') });

    expect(outcome.quit).toBe(false);
    expect(outcome.skipped).toBe(total);
    expect(outcome.entries).toHaveLength(0);
  });

  it('continues numbering ids from existing entries and never collides across a session', async () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const existing = [{ id: 'review-module-declaration-001' } as ReviewEntry];

    const outcome = await runReviewSession(results, existing, context(), { ask: () => Promise.resolve('correct') });
    const newEntries = outcome.entries.filter((entry) => !existing.includes(entry));

    const moduleIds = newEntries.filter((e) => e.id.startsWith('review-module-declaration-')).map((e) => e.id);
    expect(new Set(outcome.entries.map((e) => e.id)).size).toBe(outcome.entries.length); // no collisions
    expect(moduleIds).not.toContain('review-module-declaration-001'); // already used by `existing`
    expect(moduleIds).toContain('review-module-declaration-002');
  });

  it('skips (with a reason) a match whose sample file cannot be read', async () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const skippedReasons: string[] = [];
    const outcome = await runReviewSession(
      results,
      [],
      { ruleSet: loadFixtureRuleSet(), readSampleFile: () => undefined },
      { ask: () => Promise.resolve('correct'), onSkipped: (_item, reason) => skippedReasons.push(reason) },
    );
    expect(outcome.entries).toHaveLength(0);
    expect(skippedReasons.length).toBeGreaterThan(0);
    expect(skippedReasons[0]).toContain('could not be read');
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
    const rule = ruleNamed('config-flag');
    const flagsText = sampleText('admin/flags.tl');
    // admin/flags.tl:7 `LET legacy = FLAG("legacy--mode")` and :8 `IF FLAG("audit") THEN ...` are two
    // separate, single-line config-flag matches (no other match shares either line).
    const legacyItem = {
      ruleId: 'config-flag',
      construct: 'config-flag',
      match: { ruleId: 'config-flag', file: 'admin/flags.tl', line: 7, column: 16, captures: { key: 'legacy--mode' }, snippet: [] },
    };
    const auditItem = {
      ruleId: 'config-flag',
      construct: 'config-flag',
      match: { ruleId: 'config-flag', file: 'admin/flags.tl', line: 8, column: 6, captures: { key: 'audit' }, snippet: [] },
    };
    const reviewsFile = join(tmp, 'reviews.yaml');
    const nextId = makeIdGenerator([]);
    const first = buildReviewEntry(legacyItem, rule, loadFixtureRuleSet(), flagsText, 'correct', nextId(legacyItem.construct));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    writeFileSync(reviewsFile, stringifyReviews([first.entry]));

    const loadedOnce = loadReviews(reviewsFile);
    expect(loadedOnce.errors).toEqual([]);
    expect(loadedOnce.entries).toHaveLength(1);

    const nextId2 = makeIdGenerator(loadedOnce.entries);
    const second = buildReviewEntry(auditItem, rule, loadFixtureRuleSet(), flagsText, 'false_positive', nextId2(auditItem.construct));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    writeFileSync(reviewsFile, stringifyReviews([...loadedOnce.entries, second.entry]));

    const loadedTwice = loadReviews(reviewsFile);
    expect(loadedTwice.errors).toEqual([]);
    expect(loadedTwice.entries.map((entry) => entry.id)).toEqual(['review-config-flag-001', 'review-config-flag-002']);
    expect(loadedTwice.examples.filter((example) => example.polarity === 'negative')).toHaveLength(1);
  });
});
