/**
 * Skill-change scenarios shared by the WP-10 tests (toylang only, temp
 * copies; nothing under fixtures/ is changed).
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildRecording,
  FakeProvider,
  loadRecordings,
  requestHash,
  writeRecording,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../../src/llm/index.js';
import { compileLanguage, DEFAULT_MAX_OUTPUT_TOKENS } from '../../src/synth/index.js';
import { recordingsDir, targetOf, tempDir } from './helpers.js';

/** A db-write answer with the same meaning as the wp09 one (exact `WRITE (?<table>)`), written as a regex: a pattern-only change. */
export const DB_WRITE_REGEX = JSON.stringify({
  rules: [
    {
      engine: 'regex',
      regex: { pattern: '\\bWRITE[ \\t]+(?<table>[0-9A-Za-z_]+)\\b', flags: 'i', multiline: false },
      captures: { table: 'table' },
      rationale: 'The table is the identifier after WRITE and spaces or tabs; keywords are case-insensitive. (Hand-written WP-10 test answer.)',
    },
  ],
});

/** Appends a sentence to the `## Writing a table` section of db-write.md (inside the construct's prose). */
export function editDbWriteSkill(skillsDir: string): void {
  const path = join(skillsDir, 'db-write.md');
  const text = readFileSync(path, 'utf8');
  const marker = 'What to report: the table name right after `WRITE`, exactly as written.\n';
  if (!text.includes(marker)) throw new Error('db-write.md changed; update the WP-10 test edit');
  writeFileSync(path, text.replace(marker, `${marker}\nThe table name is never quoted.\n`));
}

/** Removes the `config-flag` construct: its Skill file and its sidecar examples. */
export function removeConfigFlag(languageDir: string): void {
  rmSync(join(languageDir, 'skills', 'config-flag.md'));
  rmSync(join(languageDir, 'examples', 'config-flag'), { recursive: true });
}

/**
 * wp09 recordings plus a hand-written recording for every request of a
 * compile over `skillsDir` that wp09 does not cover, answered from
 * `answers[target][attempt - 1]`. Returns the new recordings directory.
 */
export async function recordingsFor(skillsDir: string, answers: Record<string, string[]>): Promise<string> {
  const dir = join(tempDir(), 'recordings');
  cpSync(recordingsDir('wp09'), dir, { recursive: true });
  const replay = new FakeProvider(loadRecordings(dir), dir);
  const provider: LlmProvider = {
    name: 'hand-written',
    model: 'hand-written',
    complete(request: LlmRequest): Promise<LlmResponse> {
      if (replay.has(request)) return replay.complete(request);
      const { target, attempt } = targetOf(request);
      const text = answers[target]?.[attempt - 1];
      if (text === undefined) return Promise.reject(new Error(`no WP-10 test answer for ${target} attempt ${String(attempt)} (${requestHash(request)})`));
      const response: LlmResponse = { text, usage: { inputTokens: 1000, outputTokens: 100 }, stopReason: 'end', rawStopReason: 'end_turn' };
      writeRecording(
        dir,
        buildRecording({
          origin: 'hand-written',
          provider: 'hand-written',
          model: 'hand-written',
          note: `WP-10 test: ${target}, attempt ${String(attempt)} (hand-written answer; usage made up)`,
          request,
          response,
          recordedAt: new Date('2026-09-26T00:00:00.000Z'),
        }),
      );
      return Promise.resolve(response);
    },
  };
  await compileLanguage({ skillsDir, languageId: 'toylang', provider, maxAttempts: 3, maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS, compilerVersion: '0.0.0-test' });
  return dir;
}
