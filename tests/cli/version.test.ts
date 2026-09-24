import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as {
  version: string;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lsc version', () => {
  it('prints the package.json version', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    const program = await createProgram();
    await program.parseAsync(['node', 'lsc', 'version']);
    expect(writes.join('')).toBe(`${pkg.version}\n`);
  });

  it('prints the version through the TypeScript entry point in a child process', () => {
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', '-e', "import('./src/cli/index.ts').then((m) => m.run(['node', 'lsc', 'version']))"],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(out).toBe(`${pkg.version}\n`);
  });
});
