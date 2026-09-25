import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FakeProvider,
  LlmConfigError,
  RecordingProvider,
  createProvider,
  createSession,
  loadConfig,
  parseConfig,
  readSnippetLog,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../../src/llm/index.js';
import { FIXED_NOW, tempDir } from './helpers.js';
import { WP08_RECORDINGS_DIR, requests } from './wp08-recordings.js';

/** Deterministic in-process provider standing in for a real one in recording tests. Not a model. */
class EchoProvider implements LlmProvider {
  readonly name = 'echo';
  readonly model = 'echo-1';
  complete(request: LlmRequest): Promise<LlmResponse> {
    const last = request.messages.at(-1)?.content ?? '';
    return Promise.resolve({
      text: JSON.stringify({ echoed: last }),
      usage: { inputTokens: last.length, outputTokens: 3 },
      stopReason: 'end',
      rawStopReason: 'end_turn',
    });
  }
}

describe('createProvider / createSession', () => {
  it('fails clearly when no provider is configured', () => {
    expect(() => createProvider(parseConfig({}, '/'))).toThrow(LlmConfigError);
    expect(() => createProvider(parseConfig({}, '/'))).toThrow(/set "provider" in lsc\.config\.json/);
  });

  it('builds a FakeProvider from lsc.config.json and logs to the configured directory', async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'lsc.config.json'),
      JSON.stringify({ provider: { name: 'fake', recordingsDir: WP08_RECORDINGS_DIR }, log: { dir: 'logs' } }),
    );
    const session = createSession(loadConfig({ cwd: dir }), { runId: 'cfg-run', now: FIXED_NOW });
    expect(session.provider.inner).toBeInstanceOf(FakeProvider);
    await session.provider.complete(requests.validBare);
    expect(session.log.path).toBe(join(dir, 'logs', 'cfg-run.jsonl'));
    expect(readSnippetLog(session.log.path)).toHaveLength(1);
  });

  it('wraps a real provider in RecordingProvider when recording is configured', () => {
    const cfg = parseConfig(
      { provider: { name: 'anthropic', model: 'm', apiKeyEnv: 'K' }, recording: { dir: 'rec' } },
      tempDir(),
    );
    const provider = createProvider(cfg, {
      env: { K: 'k' },
      createClient: () => ({ messages: { create: () => Promise.reject(new Error('not called')) } }),
    });
    expect(provider).toBeInstanceOf(RecordingProvider);
  });
});

describe('recording mode', () => {
  it('saves request/response pairs that FakeProvider replays identically', async () => {
    const dir = join(tempDir(), 'recordings');
    const recorder = new RecordingProvider(new EchoProvider(), dir, FIXED_NOW);
    const req: LlmRequest = {
      system: 'toylang rules',
      messages: [{ role: 'user', content: 'CALL billing.apply_discount(order_id)' }],
      maxOutputTokens: 50,
    };
    const live = await recorder.complete(req);
    expect(recorder.written).toHaveLength(1);

    const replay = await FakeProvider.fromDirectory(dir).complete(req);
    expect(replay.text).toBe(live.text);
    expect(replay.usage).toEqual(live.usage);
    expect(replay.stopReason).toBe(live.stopReason);
    expect(replay.model).toBe('echo-1');
  });
});
