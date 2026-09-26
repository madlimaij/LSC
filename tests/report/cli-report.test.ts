import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';
import { runRules } from '../../src/runner/index.js';
import { cloneRuleSet, fixtureExamples, loadFixtureRuleSet, loadSampleFiles, RULESET_PATH, SKILLS_DIR } from './helpers.js';

let out: string[];
let err: string[];
let tmp: string;
let resultsFile: string;

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
  tmp = mkdtempSync(join(tmpdir(), 'lsc-report-cmd-'));
  resultsFile = join(tmp, 'results.json');
  const results = runRules(loadFixtureRuleSet(), fixtureExamples(), loadSampleFiles(), {
    now: () => '2026-09-26T00:00:00.000Z',
    compilerVersion: '0.1.0',
  });
  writeFileSync(resultsFile, JSON.stringify(results));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function runCli(...args: string[]): Promise<number> {
  const program = await createProgram();
  await program.parseAsync(['node', 'lsc', 'report', ...args]);
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return code;
}

describe('lsc report', () => {
  it('default format is Markdown, printed to stdout, exit code 0 on a validated Rule Set', async () => {
    expect(await runCli(resultsFile)).toBe(0);
    const text = out.join('');
    expect(text).toContain('# Rule Set report');
    expect(text).toContain('VALIDATED');
  });

  it('--format html renders a self-contained HTML document', async () => {
    expect(await runCli(resultsFile, '--format', 'html')).toBe(0);
    expect(out.join('')).toMatch(/^<!DOCTYPE html>/);
  });

  it('--format json renders the report model as JSON', async () => {
    expect(await runCli(resultsFile, '--format', 'json')).toBe(0);
    const report = JSON.parse(out.join('')) as { overall: { verdict: string } };
    expect(report.overall.verdict).toBe('validated');
  });

  it('--out writes the report to a file instead of stdout', async () => {
    const outFile = join(tmp, 'report.md');
    expect(await runCli(resultsFile, '--out', outFile)).toBe(0);
    expect(readFileSync(outFile, 'utf8')).toContain('# Rule Set report');
    expect(out.join('')).toContain(`Wrote md report to ${outFile}`);
  });

  it('--ruleset adds pattern, captures and provenance', async () => {
    expect(await runCli(resultsFile, '--ruleset', RULESET_PATH)).toBe(0);
    const text = out.join('');
    expect(text).toContain('Pattern: `exact: MODULE <token>');
    expect(text).toContain('Provenance');
  });

  it('--skills-dir adds source snippets to representative matches', async () => {
    expect(await runCli(resultsFile, '--skills-dir', SKILLS_DIR)).toBe(0);
    expect(out.join('')).toContain('location:');
  });

  it('an invalid --format is rejected with a readable error', async () => {
    expect(await runCli(resultsFile, '--format', 'xml')).toBe(1);
    expect(err.join('')).toContain('--format must be "md", "html" or "json"');
  });

  it('a broken Results file (unreadable JSON) is reported readably', async () => {
    const bad = join(tmp, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(await runCli(bad)).toBe(1);
    expect(err.join('')).toContain('is not valid JSON');
  });

  it('a broken Rule Set produces a report whose exit code is 1 (rejected verdict)', async () => {
    const ruleSet = cloneRuleSet();
    const dbRead = ruleSet.rules.find((r) => r.id === 'db-read');
    if (dbRead?.engine !== 'regex') throw new Error('expected db-read to be a regex rule');
    dbRead.regex = { ...dbRead.regex, multiline: false };
    const brokenResultsFile = join(tmp, 'broken-results.json');
    const results = runRules(ruleSet, fixtureExamples(), [], { now: () => '2026-09-26T00:00:00.000Z', compilerVersion: '0.1.0' });
    writeFileSync(brokenResultsFile, JSON.stringify(results));

    expect(await runCli(brokenResultsFile)).toBe(1);
    const text = out.join('');
    expect(text).toContain('REJECTED');
    expect(text).toContain('db-read');
    expect(text).toContain('read-03');
  });
});
