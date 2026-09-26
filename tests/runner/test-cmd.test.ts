import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const RULESET = join(REPO_ROOT, 'contract/fixtures/toylang.ruleset.json');
const SKILLS_DIR = join(REPO_ROOT, 'fixtures/toylang/skills');
const SAMPLE_DIR = join(REPO_ROOT, 'fixtures/toylang/sample-repo');

let out: string[];
let err: string[];
let tmp: string;

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
  tmp = mkdtempSync(join(tmpdir(), 'lsc-test-cmd-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function runCli(...args: string[]): Promise<number> {
  const program = await createProgram();
  await program.parseAsync(['node', 'lsc', 'test', ...args]);
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return code;
}

describe('lsc test', () => {
  it('passes the toylang fixture against its examples, exit code 0', async () => {
    expect(await runCli(RULESET, SKILLS_DIR)).toBe(0);
    expect(out.join('')).toContain('OK: every rule passed its examples');
    expect(out.join('')).toContain('PASS  module-declaration');
    expect(err).toEqual([]);
  });

  it('--out writes a Results JSON file that matches the schema and the printed summary', async () => {
    const resultsFile = join(tmp, 'results.json');
    expect(await runCli(RULESET, SKILLS_DIR, '--out', resultsFile)).toBe(0);
    const results = JSON.parse(readFileSync(resultsFile, 'utf8')) as { ok: boolean; rules: { ruleId: string }[] };
    expect(results.ok).toBe(true);
    expect(results.rules.map((r) => r.ruleId)).toContain('call-statement');
  });

  it('--sample scans the repository sample and reports rule-level sample matches', async () => {
    expect(await runCli(RULESET, SKILLS_DIR, '--sample', SAMPLE_DIR)).toBe(0);
    expect(out.join('')).toContain('sample matches');
  });

  it('a Rule Set that fails an example exits with code 1 and prints the failing example id', async () => {
    const broken = join(tmp, 'broken.ruleset.json');
    const ruleSet: { rules: { id: string; regex?: { multiline: boolean } }[] } = JSON.parse(readFileSync(RULESET, 'utf8'));
    const dbRead = ruleSet.rules.find((r) => r.id === 'db-read');
    if (dbRead?.regex === undefined) throw new Error('expected db-read to have a regex config');
    dbRead.regex.multiline = false;
    writeFileSync(broken, JSON.stringify(ruleSet));

    expect(await runCli(broken, SKILLS_DIR)).toBe(1);
    const text = out.join('');
    expect(text).toContain('FAIL  db-read');
    expect(text).toContain('failing example: read-03');
    expect(text).toContain('FAILED: at least one rule failed an example');
  });

  it('an invalid Rule Set file reports issues and exits with code 1', async () => {
    expect(await runCli(join(REPO_ROOT, 'contract/fixtures/invalid/duplicate-rule-id--two-rules-same-id.json'), SKILLS_DIR)).toBe(1);
    expect(err.join('')).toContain('duplicate-rule-id');
  });

  it('an unreadable Rule Set file is reported readably', async () => {
    expect(await runCli(join(tmp, 'missing.json'), SKILLS_DIR)).toBe(1);
    expect(err.join('')).toMatch(/^ERROR: cannot read .*missing\.json/);
  });

  it('a cross-construct negative match fails the run: exit 1, prints FAIL and "cross-construct negative matched: <id>", even though the rule\'s own examples all pass', async () => {
    // A minimal, self-contained Rule Set and skills dir (not the toylang fixture): one `call` rule
    // whose pattern is deliberately broad enough to also match a `config-flag` negative example.
    const rulesetPath = join(tmp, 'cross-negative.ruleset.json');
    const ruleSet = {
      contractVersion: '1.0.2',
      languageId: 'cross-negative-fixture',
      version: '1.0.0',
      compiledAt: '2026-09-26T00:00:00Z',
      compilerVersion: '0.0.0-dev',
      sourceSkills: [],
      fileMatchers: ['**/*.tl'],
      rules: [
        {
          id: 'call-statement',
          type: 'call',
          engine: 'regex',
          regex: { pattern: '\\bCALL\\s+(?<callee>[A-Za-z_][A-Za-z0-9_]*)\\s*\\(', flags: 'i', multiline: false },
          captures: { callee: 'callee' },
          confidence: 'high',
          sourceEvidence: [{ skill: 'rules.md', anchor: 'calling', exampleIds: ['call-01', 'call-02', 'call-03', 'call-04', 'call-05'] }],
          tests: { passed: 0, failed: 0, failingExampleIds: [] },
          status: 'validated',
        },
      ],
    };
    writeFileSync(rulesetPath, JSON.stringify(ruleSet));

    const skillsDir = join(tmp, 'cross-negative-skills');
    mkdirSync(skillsDir, { recursive: true });
    const positiveExamples = Array.from({ length: 5 }, (_, i) =>
      [
        `\`\`\`toylang example=positive construct=call id=call-0${String(i + 1)}`,
        `CALL fn_${String(i)}(x)`,
        '```',
        '',
        '```yaml expect',
        '- line: 1',
        '  type: call',
        `  captures: { callee: fn_${String(i)} }`,
        '```',
        '',
      ].join('\n'),
    ).join('\n');
    writeFileSync(
      join(skillsDir, 'rules.md'),
      [
        '# Calls',
        '',
        '## Calling',
        '',
        positiveExamples,
        '# Config flags',
        '',
        '## Setting a flag',
        '',
        '```toylang example=negative construct=config-flag id=flag-neg-01',
        'CALL something(x)',
        '```',
        '',
      ].join('\n'),
    );

    expect(await runCli(rulesetPath, skillsDir)).toBe(1);
    const text = out.join('');
    expect(text).toContain('FAIL  call-statement');
    expect(text).toContain('cross-construct negative matched: flag-neg-01');
    expect(text).toContain('FAILED: at least one rule failed an example');
    expect(text).not.toContain('failing example: call-01'); // its own examples all pass
  });

  it('an empty skills dir (no examples for any rule) fails every rule and exits with code 1', async () => {
    const emptySkillsDir = join(tmp, 'empty-skills');
    expect(await runCli(RULESET, emptySkillsDir)).toBe(1);
    const text = out.join('');
    expect(text).toContain('FAILED: at least one rule failed an example');
    expect(text).not.toContain('OK: every rule passed its examples');
    expect(text).not.toMatch(/^ {2}PASS/m);
    expect(text).toContain('none (passes no positive example: rejected)');
  });
});
