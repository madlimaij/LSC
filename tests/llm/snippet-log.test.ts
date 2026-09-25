import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  FakeProvider,
  InvalidRequestError,
  SnippetLog,
  createSession,
  newRunId,
  readSnippetLog,
  requestHash,
  structured,
  type LlmRequest,
} from '../../src/llm/index.js';
import { FIXED_NOW, fakeConfig, tempDir } from './helpers.js';
import { WP08_RECORDINGS_DIR, requests } from './wp08-recordings.js';

describe('snippet log', () => {
  it('records every request of a run, including failed and refused ones, with full text and usage', async () => {
    const config = fakeConfig({ budgets: { maxOutputTokensPerCall: 512, maxTotalTokensPerCompile: 100_000 } });
    const session = createSession(config, {
      provider: FakeProvider.fromDirectory(WP08_RECORDINGS_DIR),
      runId: 'test-run',
      now: FIXED_NOW,
    });
    const sent: LlmRequest[] = [];
    const call = async (req: LlmRequest): Promise<void> => {
      sent.push(req);
      await structured(session.provider, z.unknown(), req).catch(() => undefined);
    };

    for (const req of Object.values(requests)) await call(req);
    await call({ ...requests.validBare, messages: [{ role: 'user', content: 'not recorded' }] }); // unknown
    await call({ ...requests.validBare, maxOutputTokens: 513 }); // over per-call cap

    expect(session.log.path).toBe(join(config.log.dir, 'test-run.jsonl'));
    const log = readSnippetLog(session.log.path);
    expect(log).toHaveLength(sent.length);
    expect(session.log.count).toBe(sent.length);
    log.forEach((entry, i) => {
      const req = sent[i];
      if (req === undefined) throw new Error('missing request');
      expect(entry.seq).toBe(i + 1);
      expect(entry.runId).toBe('test-run');
      expect(entry.timestamp).toBe('2026-09-25T12:00:00.000Z');
      expect(entry.provider).toBe('fake');
      expect(entry.requestHash).toBe(requestHash(req));
      expect(entry.request).toEqual({ system: req.system, messages: req.messages, maxOutputTokens: req.maxOutputTokens });
    });

    const byOutcome = log.map((e) => e.outcome);
    expect(byOutcome.slice(0, Object.keys(requests).length).every((o) => o === 'ok')).toBe(true);
    expect(byOutcome.slice(-2)).toEqual(['error', 'refused']);
    expect(log[0]?.model).toBe('hand-written');
    expect(log[0]?.usage).toEqual({ inputTokens: 420, outputTokens: 180 });
    expect(log.at(-2)?.error).toMatch(/no recording/);
    expect(log.at(-1)?.sent).toBe(false);
    expect(log.at(-1)?.budget.totalUsed).toBe(session.budget.totalUsed);
  });

  it('does not log (or send) a malformed request', async () => {
    const session = createSession(fakeConfig(), { provider: FakeProvider.fromDirectory(WP08_RECORDINGS_DIR) });
    await expect(
      session.provider.complete({ system: '', messages: [{ role: 'assistant', content: 'x' }], maxOutputTokens: 10 }),
    ).rejects.toBeInstanceOf(InvalidRequestError);
    await expect(session.provider.complete({ system: '', messages: [], maxOutputTokens: 10 })).rejects.toBeInstanceOf(
      InvalidRequestError,
    );
    expect(session.log.count).toBe(0);
  });

  it('writes one JSON object per line', () => {
    const log = new SnippetLog({ dir: tempDir(), runId: 'r1', now: FIXED_NOW });
    const record = {
      provider: 'fake',
      model: 'm',
      requestHash: requestHash(requests.validBare),
      sent: false,
      outcome: 'refused' as const,
      request: { ...requests.validBare, messages: [...requests.validBare.messages] },
      budget: { totalUsed: 0, maxTotalTokensPerCompile: 10 },
    };
    log.append(record);
    log.append(record);
    const lines = readFileSync(log.path, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => (JSON.parse(l) as { seq: number }).seq)).toEqual([1, 2]);
  });

  it('generates sortable run ids and rejects unsafe ones', () => {
    expect(newRunId(new Date('2026-09-25T10:15:30.123Z'))).toMatch(/^20260925T101530Z-[0-9a-f]{6}$/);
    expect(() => new SnippetLog({ dir: tempDir(), runId: '../escape' })).toThrow(RangeError);
  });
});
