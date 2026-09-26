import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';
import { ingestSkills } from '../../src/ingest/index.js';
import { runRules } from '../../src/runner/index.js';
import type { SynthesisReport } from '../../src/synth/index.js';
import { cloneRuleSet, fixtureExamples, loadFixtureRuleSet, loadSampleFiles, RULESET_PATH, SKILLS_DIR } from './helpers.js';

function fakeSynthesis(): SynthesisReport {
  return {
    languageId: 'toylang',
    compilerVersion: '0.1.0',
    generatedAt: '2026-09-26T00:00:00.000Z',
    status: 'completed',
    maxAttemptsPerConstruct: 3,
    lexical: { status: 'accepted', attempts: [] },
    constructs: [{ constructId: 'db-read', ruleType: 'db_read', status: 'validated', ruleId: 'db-read', attempts: [] }],
    summary: { constructs: 1, validated: 1, rejected: 0, notJustified: 0, skipped: 0, notAttempted: 0 },
    usage: { inputTokens: 1, outputTokens: 1, calls: 1 },
    ingestDiagnostics: [],
  };
}

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

  it('--synthesis adds each construct\'s synthesis outcome and reasons', async () => {
    const synthesisFile = join(tmp, 'synthesis.json');
    writeFileSync(synthesisFile, JSON.stringify(fakeSynthesis()));
    expect(await runCli(resultsFile, '--synthesis', synthesisFile)).toBe(0);
    const text = out.join('');
    expect(text).toContain('## Synthesis');
    expect(text).toContain('db-read');
    expect(text).toMatch(/does not record provider, model or recording origin/);
  });

  it('an invalid --synthesis file is rejected with a readable error', async () => {
    const synthesisFile = join(tmp, 'synthesis.json');
    writeFileSync(synthesisFile, JSON.stringify({ not: 'a synthesis report' }));
    expect(await runCli(resultsFile, '--synthesis', synthesisFile)).toBe(1);
    expect(err.join('')).toContain('is not a valid synthesis.json');
  });

  // The frozen fixture Rule Set's own `sourceSkills` paths are prefixed "skills/" (contract/fixtures/toylang.ruleset.json),
  // while `ingestSkills(skillsDir).sourceSkills` — and contract/CONTRACT.md's definition ("relative to the Skill
  // directory", i.e. --skills-dir itself) — give bare names ("module.md"). That mismatch is a pre-existing
  // inconsistency in a frozen, contract-architect-owned fixture (see this package's WP-07 completion note, open
  // question), not something to paper over here: these two tests build a Rule Set whose `sourceSkills` follow the
  // documented convention instead, so the check is exercised the way `lsc compile`'s own output would be.
  function ruleSetWithRealSourceSkillPaths() {
    const ruleSet = cloneRuleSet();
    ruleSet.sourceSkills = ingestSkills(SKILLS_DIR).sourceSkills;
    return ruleSet;
  }

  it('--ruleset + --skills-dir warns (stderr and report) when a Skill file hash has drifted from the Rule Set', async () => {
    const rulesetFile = join(tmp, 'toylang.ruleset.json');
    writeFileSync(rulesetFile, JSON.stringify(ruleSetWithRealSourceSkillPaths()));
    const skillsDir = join(tmp, 'toylang-skills');
    cpSync(SKILLS_DIR, skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, 'module.md'), '# edited after the Rule Set was compiled\n');

    expect(await runCli(resultsFile, '--ruleset', rulesetFile, '--skills-dir', skillsDir)).toBe(0);
    expect(err.join('')).toContain('WARNING');
    expect(err.join('')).toMatch(/module\.md/);
    expect(out.join('')).toMatch(/module\.md/); // also visible in the rendered report, not stderr-only
  });

  it('--ruleset + --skills-dir with unchanged Skill files warns of nothing', async () => {
    const rulesetFile = join(tmp, 'toylang.ruleset.json');
    writeFileSync(rulesetFile, JSON.stringify(ruleSetWithRealSourceSkillPaths()));
    expect(await runCli(resultsFile, '--ruleset', rulesetFile, '--skills-dir', SKILLS_DIR)).toBe(0);
    expect(err.join('')).not.toContain('WARNING');
    expect(out.join('')).toContain('every Skill file hash still matches');
  });
});
