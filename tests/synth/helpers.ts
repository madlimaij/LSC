import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';
import { readSnippetLog, type SnippetLogEntry } from '../../src/llm/index.js';
import { REPO_ROOT } from './wp09-recordings.js';

const dirs: string[] = [];

export const io = { out: [] as string[], err: [] as string[] };

beforeEach(() => {
  io.out = [];
  io.err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    io.out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    io.err.push(String(chunk));
    return true;
  });
  // D19 d: never inherit a real-inputs marker from the environment running the tests.
  vi.stubEnv('LSC_REAL_INPUTS', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'lsc-synth-'));
  dirs.push(d);
  return d;
}

/** Writes an lsc.config.json into a new temp dir; logs go to `<dir>/logs`. */
export function writeConfig(extra: Record<string, unknown> = {}): { dir: string; config: string; logDir: string } {
  const dir = tempDir();
  const logDir = join(dir, 'logs');
  const config = join(dir, 'lsc.config.json');
  writeFileSync(config, JSON.stringify({ log: { dir: logDir }, ...extra }));
  return { dir, config, logDir };
}

export async function runCli(...args: string[]): Promise<number> {
  const program = await createProgram();
  await program.parseAsync(['node', 'lsc', ...args]);
  const code = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  return code;
}

/** Every snippet-log entry written into `logDir` (all runs). */
export function logEntries(logDir: string): SnippetLogEntry[] {
  let files: string[];
  try {
    files = readdirSync(logDir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return [];
  }
  return files.flatMap((f) => readSnippetLog(join(logDir, f)));
}

/** Copies fixtures/toylang/{skills,examples} into a temp language dir; returns its skills dir. */
export function copyToylang(): { languageDir: string; skillsDir: string } {
  const languageDir = join(tempDir(), 'toylang');
  cpSync(join(REPO_ROOT, 'fixtures/toylang/skills'), join(languageDir, 'skills'), { recursive: true });
  cpSync(join(REPO_ROOT, 'fixtures/toylang/examples'), join(languageDir, 'examples'), { recursive: true });
  return { languageDir, skillsDir: join(languageDir, 'skills') };
}
