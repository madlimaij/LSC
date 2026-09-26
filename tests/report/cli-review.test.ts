import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';
import { loadReviews } from '../../src/examples/index.js';
import { runRules } from '../../src/runner/index.js';
import { fixtureExamples, loadFixtureRuleSet, loadSampleFiles, RULESET_PATH, SAMPLE_DIR, SKILLS_DIR } from './helpers.js';

// `lsc review` is interactive (node:readline/promises); replacing the whole module (hoisted, so the
// mock is in place before src/cli/commands/review.ts imports it) drives the real command with
// scripted answers instead of a real terminal, without racing stdin timing.
const { createInterfaceMock } = vi.hoisted(() => ({ createInterfaceMock: vi.fn() }));
vi.mock('node:readline/promises', () => ({ createInterface: createInterfaceMock }));

let out: string[];
let err: string[];
let tmp: string;
let resultsFile: string;
let skillsDir: string;

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
  tmp = mkdtempSync(join(tmpdir(), 'lsc-review-cmd-'));
  resultsFile = join(tmp, 'results.json');
  const results = runRules(loadFixtureRuleSet(), fixtureExamples(), loadSampleFiles(), {
    now: () => '2026-09-26T00:00:00.000Z',
    compilerVersion: '0.1.0',
  });
  writeFileSync(resultsFile, JSON.stringify(results));
  // A separate, writable copy of the Skill directory's sibling so reviews.yaml never touches fixtures/toylang/.
  skillsDir = join(tmp, 'toylang-skills');
  cpSync(SKILLS_DIR, skillsDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Feeds `answers` to every `rl.question()` call the command makes, in
 * order, via the mocked `createInterface`. This drives the exact same
 * interactive path the real CLI takes (not a bypass of it), without
 * racing real terminal input.
 */
async function runCli(answers: string[], ...args: string[]): Promise<number> {
  const remaining = [...answers];
  createInterfaceMock.mockReturnValue({
    question: vi.fn(async () => remaining.shift() ?? 'q'),
    close: vi.fn(),
  });

  const program = await createProgram();
  await program.parseAsync(['node', 'lsc', 'review', ...args]);
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return code;
}

/** `runCli`, always with `--ruleset`/`--sample` (the ones the fixture results were produced from). */
async function runCliWithRulesetAndSample(answers: string[], ...args: string[]): Promise<number> {
  return runCli(answers, ...args, '--ruleset', RULESET_PATH, '--sample', SAMPLE_DIR);
}

describe('lsc review', () => {
  it('without --skills-dir or --reviews-file, fails readably', async () => {
    expect(await runCli([], resultsFile)).toBe(1);
    expect(err.join('')).toContain('--skills-dir');
  });

  it('without --ruleset or --sample, fails readably', async () => {
    expect(await runCli([], resultsFile, '--skills-dir', skillsDir)).toBe(1);
    expect(err.join('')).toContain('--ruleset');
  });

  it('records "correct" and "false positive" verdicts into reviews.yaml, which loads back with no errors', async () => {
    const reviewsFile = join(tmp, 'toylang-reviews.yaml');
    const code = await runCliWithRulesetAndSample(['c', 'f', 'q'], resultsFile, '--reviews-file', reviewsFile);
    expect(code).toBe(0);
    expect(existsSync(reviewsFile)).toBe(true);

    const loaded = loadReviews(reviewsFile);
    expect(loaded.errors).toEqual([]);
    expect(loaded.entries).toHaveLength(2);
    expect(loaded.entries[0]?.verdict).toBe('correct');
    expect(loaded.entries[0]?.expected?.length).toBeGreaterThan(0);
    expect(loaded.entries[1]?.verdict).toBe('false_positive');
    expect(loaded.entries[1]?.expected ?? []).toEqual([]);
    expect(out.join('')).toContain('Done: 1 correct, 1 false positive');
  });

  it('"skip" records nothing for that match, and an unrecognised answer is treated as skip', async () => {
    const reviewsFile = join(tmp, 'toylang-reviews.yaml');
    const code = await runCliWithRulesetAndSample(['s', 'nonsense', 'q'], resultsFile, '--reviews-file', reviewsFile);
    expect(code).toBe(0);
    expect(out.join('')).toContain('Done: 0 correct, 0 false positive, 2 skipped');
    expect(existsSync(reviewsFile)).toBe(false); // nothing recorded, nothing written
  });

  it('--skills-dir derives reviews.yaml as its sibling (D15)', async () => {
    const code = await runCliWithRulesetAndSample(['c', 'q'], resultsFile, '--skills-dir', skillsDir);
    expect(code).toBe(0);
    const reviewsFile = join(tmp, 'reviews.yaml');
    expect(existsSync(reviewsFile)).toBe(true);
    expect(loadReviews(reviewsFile).entries).toHaveLength(1);
  });

  it("a second session appends without losing the first session's entries", async () => {
    const reviewsFile = join(tmp, 'toylang-reviews.yaml');
    expect(await runCliWithRulesetAndSample(['c', 'q'], resultsFile, '--reviews-file', reviewsFile)).toBe(0);
    expect(loadReviews(reviewsFile).entries).toHaveLength(1);

    expect(await runCliWithRulesetAndSample(['f', 'q'], resultsFile, '--reviews-file', reviewsFile)).toBe(0);
    const loaded = loadReviews(reviewsFile);
    expect(loaded.errors).toEqual([]);
    expect(loaded.entries).toHaveLength(2);
    expect(new Set(loaded.entries.map((e) => e.id)).size).toBe(2); // ids do not collide
  });

  it('no unreviewed sample matches: says so, exits 0, and never opens a terminal prompt', async () => {
    const emptyResultsFile = join(tmp, 'empty-results.json');
    const results = runRules(loadFixtureRuleSet(), fixtureExamples(), [], {
      now: () => '2026-09-26T00:00:00.000Z',
      compilerVersion: '0.1.0',
    });
    writeFileSync(emptyResultsFile, JSON.stringify(results));
    expect(await runCliWithRulesetAndSample([], emptyResultsFile, '--skills-dir', skillsDir)).toBe(0);
    expect(out.join('')).toContain('No unreviewed sample matches.');
  });

  it('refuses to add reviews when reviews.yaml already has an invalid entry, without touching the file', async () => {
    const reviewsFile = join(tmp, 'toylang-reviews.yaml');
    writeFileSync(reviewsFile, 'reviews:\n  - id: not-kebab-CASE\n    construct: call\n');
    const before = existsSync(reviewsFile);
    expect(await runCliWithRulesetAndSample(['c', 'q'], resultsFile, '--reviews-file', reviewsFile)).toBe(1);
    expect(err.join('')).toContain('has existing errors');
    expect(existsSync(reviewsFile)).toBe(before);
  });
});
