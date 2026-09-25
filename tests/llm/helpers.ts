import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { parseConfig, type LlmConfig, type LlmConfigInput } from '../../src/llm/index.js';
import { WP08_RECORDINGS_DIR } from './wp08-recordings.js';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Temporary directory removed after the current test. */
export function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'lsc-llm-'));
  dirs.push(d);
  return d;
}

/** Config replaying the WP-08 recordings, logging into a temp dir. */
export function fakeConfig(overrides: Partial<LlmConfigInput> = {}): LlmConfig {
  const base = tempDir();
  return parseConfig(
    {
      provider: { name: 'fake', recordingsDir: WP08_RECORDINGS_DIR },
      log: { dir: join(base, 'logs') },
      ...overrides,
    },
    base,
  );
}

export const FIXED_NOW = (): Date => new Date('2026-09-25T12:00:00.000Z');
