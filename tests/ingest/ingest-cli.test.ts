import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';

const TOYLANG_SKILLS = resolve(import.meta.dirname, '../../fixtures/toylang/skills');
const BROKEN_SKILLS = resolve(import.meta.dirname, 'fixtures/no-positive-example/skills');

function captureStdout(): { writes: string[] } {
  const writes: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  return { writes };
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('lsc ingest', () => {
  it('prints every construct and "no diagnostics" for a clean Skill directory, exit code 0', async () => {
    const { writes } = captureStdout();
    const program = await createProgram();
    await program.parseAsync(['node', 'lsc', 'ingest', TOYLANG_SKILLS]);
    const out = writes.join('');
    expect(out).toContain('proc-definition  [symbol_definition]');
    expect(out).toContain('No diagnostics.');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints diagnostics and sets exit code 1 for a Skill directory with problems', async () => {
    const { writes } = captureStdout();
    const program = await createProgram();
    await program.parseAsync(['node', 'lsc', 'ingest', BROKEN_SKILLS]);
    const out = writes.join('');
    expect(out).toContain('Diagnostics (1):');
    expect(out).toContain('no positive example');
    expect(process.exitCode).toBe(1);
  });

  it('--json prints machine-readable constructs and diagnostics', async () => {
    const { writes } = captureStdout();
    const program = await createProgram();
    await program.parseAsync(['node', 'lsc', 'ingest', TOYLANG_SKILLS, '--json']);
    const payload = JSON.parse(writes.join('')) as { constructs: { id: string }[]; diagnostics: unknown[] };
    expect(payload.constructs.map((c) => c.id)).toContain('call');
    expect(payload.diagnostics).toEqual([]);
  });

  it('--prose-limit caps every construct\'s prose length, including the truncation marker', async () => {
    const { writes } = captureStdout();
    const program = await createProgram();
    await program.parseAsync(['node', 'lsc', 'ingest', TOYLANG_SKILLS, '--json', '--prose-limit', '50']);
    const payload = JSON.parse(writes.join('')) as { constructs: { proseLength: number }[] };
    expect(payload.constructs.length).toBeGreaterThan(0);
    // 50 kept characters + the truncation marker ("\n\n… [truncated]", 15 characters).
    for (const construct of payload.constructs) expect(construct.proseLength).toBe(50 + '\n\n… [truncated]'.length);
  });

  it('without --prose-limit, prose stays under the default cap and is not truncated', async () => {
    const { writes } = captureStdout();
    const program = await createProgram();
    await program.parseAsync(['node', 'lsc', 'ingest', TOYLANG_SKILLS, '--json']);
    const payload = JSON.parse(writes.join('')) as { constructs: { proseLength: number }[] };
    for (const construct of payload.constructs) expect(construct.proseLength).toBeLessThanOrEqual(4000);
  });
});
