import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});
