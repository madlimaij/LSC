/**
 * D19 d: `lsc compile` refuses recording mode when LSC_REAL_INPUTS is set or
 * any input lies outside fixtures/toylang/.
 */
import { existsSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertRecordingAllowed, isInside, RecordingRefusedError, TOYLANG_ROOT } from '../../src/synth/index.js';
import { copyToylang, io, runCli, tempDir, writeConfig } from './helpers.js';
import { TOYLANG_SAMPLE, TOYLANG_SKILLS } from './wp09-recordings.js';

function recordingConfig(): { config: string; logDir: string; recordingDir: string } {
  const recordingDir = join(tempDir(), 'recordings');
  const { config, logDir } = writeConfig({
    provider: { name: 'anthropic', model: 'any-model', apiKeyEnv: 'LSC_TEST_NO_SUCH_KEY' },
    recording: { dir: recordingDir },
  });
  return { config, logDir, recordingDir };
}

function nothingSent(logDir: string, recordingDir: string): void {
  expect(existsSync(logDir) ? readdirSync(logDir) : []).toEqual([]);
  expect(existsSync(recordingDir)).toBe(false);
}

describe('recording guard in lsc compile (D19 d)', () => {
  it('refuses recording mode when LSC_REAL_INPUTS is set, even for toylang inputs', async () => {
    vi.stubEnv('LSC_REAL_INPUTS', '/somewhere/outside');
    const { config, logDir, recordingDir } = recordingConfig();
    const code = await runCli('compile', TOYLANG_SKILLS, '--sample', TOYLANG_SAMPLE, '--config', config, '--out', join(tempDir(), 'o'));
    expect(code).toBe(1);
    expect(io.err.join('')).toContain('recording mode refused: LSC_REAL_INPUTS is set');
    nothingSent(logDir, recordingDir);
  });

  it('refuses recording mode when the Skill directory lies outside fixtures/toylang/', async () => {
    const { skillsDir } = copyToylang();
    const { config, logDir, recordingDir } = recordingConfig();
    const code = await runCli('compile', skillsDir, '--config', config, '--out', join(tempDir(), 'o'));
    expect(code).toBe(1);
    expect(io.err.join('')).toContain('recording mode refused: input(s) outside');
    expect(io.err.join('')).toContain(skillsDir);
    nothingSent(logDir, recordingDir);
  });

  it('refuses recording mode when only the sample lies outside fixtures/toylang/', async () => {
    const { config, logDir, recordingDir } = recordingConfig();
    const sample = tempDir();
    const code = await runCli('compile', TOYLANG_SKILLS, '--sample', sample, '--config', config, '--out', join(tempDir(), 'o'));
    expect(code).toBe(1);
    expect(io.err.join('')).toContain(sample);
    nothingSent(logDir, recordingDir);
  });

  it('lets toylang inputs through to the provider (which then refuses to run inside Vitest)', async () => {
    vi.stubEnv('LSC_TEST_NO_SUCH_KEY', 'dummy-not-a-key');
    const { config } = recordingConfig();
    await expect(runCli('compile', TOYLANG_SKILLS, '--sample', TOYLANG_SAMPLE, '--config', config, '--out', join(tempDir(), 'o'))).rejects.toThrow(
      /refusing to construct the Anthropic client inside the test runner/,
    );
    expect(io.err.join('')).not.toContain('recording mode refused');
  });
});

describe('assertRecordingAllowed', () => {
  const inputs = [TOYLANG_SKILLS, join(TOYLANG_ROOT, 'examples'), join(TOYLANG_ROOT, 'reviews.yaml'), TOYLANG_SAMPLE];

  it('is a no-op when recording is off, whatever the inputs or environment', () => {
    expect(() => assertRecordingAllowed({ recording: false, inputs: ['/etc'], env: { LSC_REAL_INPUTS: '/x' } })).not.toThrow();
  });

  it('accepts toylang inputs, including a reviews.yaml that does not exist yet', () => {
    expect(() => assertRecordingAllowed({ recording: true, inputs, env: {} })).not.toThrow();
  });

  it('refuses when LSC_REAL_INPUTS is set to anything, even empty', () => {
    expect(() => assertRecordingAllowed({ recording: true, inputs, env: { LSC_REAL_INPUTS: '' } })).toThrow(RecordingRefusedError);
  });

  it('refuses a path that only looks inside (../ escape, sibling prefix)', () => {
    expect(() => assertRecordingAllowed({ recording: true, inputs: [join(TOYLANG_ROOT, '..', 'recordings')], env: {} })).toThrow(RecordingRefusedError);
    expect(isInside(`${TOYLANG_ROOT.replace(/\/$/, '')}-real/skills`, TOYLANG_ROOT)).toBe(false);
  });

  it('follows symlinks: a link inside the fixture tree pointing outside is outside', () => {
    const outside = tempDir();
    const root = tempDir();
    const link = join(root, 'skills');
    symlinkSync(outside, link);
    expect(isInside(link, root)).toBe(false);
    expect(isInside(join(root, 'plain'), root)).toBe(true);
  });
});
