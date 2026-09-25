import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  LlmConfigError,
  ProviderError,
  RealProviderInTestError,
  createProvider,
  defaultAnthropicClientFactory,
  parseConfig,
  realProvidersForbidden,
  type AnthropicClientOptions,
  type AnthropicMessagesClient,
  type AnthropicProviderConfig,
} from '../../src/llm/index.js';

const CONFIG: AnthropicProviderConfig = {
  name: 'anthropic',
  model: 'configured-model',
  apiKeyEnv: 'LSC_TEST_KEY',
  baseUrl: 'https://llm.example.internal',
  maxRetries: 0,
};
const ENV = { LSC_TEST_KEY: 'dummy-key' };

/** In-process stand-in for the SDK client: records params, never touches the network. */
function stubClient(reply: () => unknown): {
  client: AnthropicMessagesClient;
  calls: Anthropic.MessageCreateParamsNonStreaming[];
  options: AnthropicClientOptions[];
  factory: (o: AnthropicClientOptions) => AnthropicMessagesClient;
} {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const options: AnthropicClientOptions[] = [];
  const client: AnthropicMessagesClient = {
    messages: {
      create: (params) => {
        calls.push(params);
        return Promise.resolve().then(() => reply() as Anthropic.Message);
      },
    },
  };
  return {
    client,
    calls,
    options,
    factory: (o) => {
      options.push(o);
      return client;
    },
  };
}

const MESSAGE = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'answered-model',
  content: [
    { type: 'text', text: '{"rules": ', citations: null },
    { type: 'text', text: '[]}', citations: null },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 7, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 },
};

describe('real provider guard (D7)', () => {
  it('the test runner is detected', () => {
    expect(realProvidersForbidden()).toBe(true);
    expect(realProvidersForbidden({})).toBe(false);
    expect(realProvidersForbidden({ LSC_FORBID_REAL_PROVIDER: '1' })).toBe(true);
  });

  it('constructing the real Anthropic client during npm test throws', () => {
    expect(() => new AnthropicProvider(CONFIG, { env: ENV })).toThrow(RealProviderInTestError);
    expect(() => defaultAnthropicClientFactory({ apiKey: 'x' })).toThrow(RealProviderInTestError);
    expect(() =>
      createProvider(parseConfig({ provider: { ...CONFIG } }, '/'), { env: ENV }),
    ).toThrow(RealProviderInTestError);
  });

  it('only src/llm/anthropic.ts imports the Anthropic SDK', () => {
    const srcRoot = fileURLToPath(new URL('../../src/', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.[cm]?ts$/.test(name) && /['"]@anthropic-ai\/sdk/.test(readFileSync(p, 'utf8'))) {
          offenders.push(relative(srcRoot, p).split('\\').join('/'));
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual(['llm/anthropic.ts']);
  });
});

describe('AnthropicProvider (stubbed client)', () => {
  it('fails with a config error when the API key variable is unset', () => {
    expect(() => new AnthropicProvider(CONFIG, { env: {}, createClient: stubClient(() => MESSAGE).factory })).toThrow(
      LlmConfigError,
    );
    expect(() => new AnthropicProvider(CONFIG, { env: {}, createClient: stubClient(() => MESSAGE).factory })).toThrow(
      /LSC_TEST_KEY/,
    );
  });

  it('passes model, key and base URL from configuration and maps the response', async () => {
    const stub = stubClient(() => MESSAGE);
    const provider = new AnthropicProvider(CONFIG, { env: ENV, createClient: stub.factory });
    expect(stub.options).toEqual([{ apiKey: 'dummy-key', baseURL: 'https://llm.example.internal', maxRetries: 0 }]);
    const res = await provider.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'MODULE billing' }],
      maxOutputTokens: 300,
    });
    expect(stub.calls).toEqual([
      { model: 'configured-model', max_tokens: 300, system: 'sys', messages: [{ role: 'user', content: 'MODULE billing' }] },
    ]);
    expect(res).toEqual({
      text: '{"rules": []}',
      usage: { inputTokens: 115, outputTokens: 7 },
      stopReason: 'end',
      rawStopReason: 'end_turn',
      model: 'answered-model',
    });
  });

  it('omits an empty system prompt and maps max_tokens and other stop reasons', async () => {
    let stop = 'max_tokens';
    const stub = stubClient(() => ({ ...MESSAGE, stop_reason: stop }));
    const provider = new AnthropicProvider(CONFIG, { env: ENV, createClient: stub.factory });
    const req = { system: '', messages: [{ role: 'user' as const, content: 'x' }], maxOutputTokens: 5 };
    expect((await provider.complete(req)).stopReason).toBe('max_tokens');
    stop = 'refusal';
    const res = await provider.complete(req);
    expect([res.stopReason, res.rawStopReason]).toEqual(['other', 'refusal']);
    expect(stub.calls[0]).not.toHaveProperty('system');
  });

  it('wraps SDK errors in ProviderError with the HTTP status', async () => {
    const stub = stubClient(() => {
      throw new Anthropic.APIError(429, undefined, 'rate limited', undefined);
    });
    const provider = new AnthropicProvider(CONFIG, { env: ENV, createClient: stub.factory });
    const err = await provider
      .complete({ system: '', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 5 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(429);
    expect((err as Error).message).toMatch(/HTTP 429/);
  });

  it('rejects an unexpected response shape', async () => {
    const stub = stubClient(() => ({ nope: true }));
    const provider = new AnthropicProvider(CONFIG, { env: ENV, createClient: stub.factory });
    await expect(
      provider.complete({ system: '', messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 5 }),
    ).rejects.toThrow(/unexpected response shape/);
  });
});
