import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';
import { INVALID_DIR, VALID_FIXTURE } from './helpers.js';

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
  tmp = mkdtempSync(join(tmpdir(), 'lsc-validate-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(tmp, { recursive: true, force: true });
});

async function runCli(...args: string[]): Promise<number> {
  const program = await createProgram();
  await program.parseAsync(['node', 'lsc', 'validate-ruleset', ...args]);
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return code;
}

describe('lsc validate-ruleset', () => {
  it('reports a valid Rule Set with exit code 0', async () => {
    expect(await runCli(VALID_FIXTURE)).toBe(0);
    expect(out.join('')).toMatch(/^OK: .*toylang\.ruleset\.json is a valid Rule Set \(contract 1\.0\.1, 8 rules\)\n$/);
    expect(err).toEqual([]);
  });

  it('prints JSON path, rule code and message for each problem, exit code 1', async () => {
    const file = resolve(INVALID_DIR, 'captures-required-roles--call-without-callee.json');
    expect(await runCli(file)).toBe(1);
    expect(err.join('')).toBe(
      `INVALID: ${file} (1 problem)\n` +
        '  $.rules[2].captures: [captures-required-roles] type "call" requires capture role "callee"\n',
    );
  });

  it('supports --json output', async () => {
    const file = resolve(INVALID_DIR, 'duplicate-rule-id--two-rules-same-id.json');
    expect(await runCli(file, '--json')).toBe(1);
    expect(JSON.parse(out.join(''))).toEqual({
      valid: false,
      file,
      contractVersion: '1.0.1',
      issues: [
        {
          rule: 'duplicate-rule-id',
          path: '$.rules[5].id',
          message: 'rule id "db-read" is already used by rules[4]',
        },
      ],
    });
  });

  it('reports unreadable files and invalid JSON readably', async () => {
    expect(await runCli(join(tmp, 'missing.json'))).toBe(1);
    expect(err.join('')).toMatch(/^ERROR: cannot read .*missing\.json/);
    err.length = 0;
    const broken = join(tmp, 'broken.json');
    writeFileSync(broken, '{ "contractVersion": ');
    expect(await runCli(broken)).toBe(1);
    expect(err.join('')).toMatch(/^ERROR: .*broken\.json is not valid JSON/);
  });
});
