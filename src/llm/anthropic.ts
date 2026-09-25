import Anthropic from '@anthropic-ai/sdk';
import type { AnthropicProviderConfig } from './config.js';
import { LlmConfigError, ProviderError, RealProviderInTestError } from './errors.js';
import type { LlmProvider, LlmRequest, LlmResponse, LlmStopReason } from './types.js';

/** The part of the Anthropic client this provider uses; injectable for unit tests. */
export interface AnthropicMessagesClient {
  readonly messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Anthropic.Message>;
  };
}

export interface AnthropicClientOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  readonly timeout?: number;
  readonly maxRetries?: number;
}

export type AnthropicClientFactory = (options: AnthropicClientOptions) => AnthropicMessagesClient;

/**
 * True inside the test runner. Vitest sets `VITEST` in every worker;
 * `LSC_FORBID_REAL_PROVIDER=1` lets any other environment opt in (D7).
 */
export function realProvidersForbidden(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['VITEST'] !== undefined && env['VITEST'] !== '') || env['LSC_FORBID_REAL_PROVIDER'] === '1';
}

/** Constructs the real SDK client. Throws `RealProviderInTestError` under test (D7). */
export const defaultAnthropicClientFactory: AnthropicClientFactory = (options) => {
  if (realProvidersForbidden()) {
    throw new RealProviderInTestError(
      'refusing to construct the Anthropic client inside the test runner: tests must use FakeProvider (D7)',
    );
  }
  return new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
};

export interface AnthropicProviderDeps {
  /** Environment to read the API key from. Default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Client factory. Default constructs the real SDK client. */
  readonly createClient?: AnthropicClientFactory;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: AnthropicMessagesClient;
  private readonly temperature: number | undefined;

  constructor(config: AnthropicProviderConfig, deps: AnthropicProviderDeps = {}) {
    const env = deps.env ?? process.env;
    const apiKey = env[config.apiKeyEnv];
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new LlmConfigError(
        `Anthropic provider: environment variable ${config.apiKeyEnv} (provider.apiKeyEnv) is not set`,
      );
    }
    this.model = config.model;
    this.temperature = config.temperature;
    this.client = (deps.createClient ?? defaultAnthropicClientFactory)({
      apiKey,
      ...(config.baseUrl !== undefined ? { baseURL: config.baseUrl } : {}),
      ...(config.timeoutMs !== undefined ? { timeout: config.timeoutMs } : {}),
      ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    });
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    let message: Anthropic.Message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxOutputTokens,
        ...(request.system !== '' ? { system: request.system } : {}),
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      });
    } catch (err) {
      const status = err instanceof Anthropic.APIError && typeof err.status === 'number' ? err.status : undefined;
      throw new ProviderError(
        this.name,
        `Anthropic request failed${status !== undefined ? ` (HTTP ${status})` : ''}: ${(err as Error).message}`,
        status,
        { cause: err },
      );
    }
    return toLlmResponse(message);
  }
}

/** Maps an Anthropic `Message` to the provider-neutral response. Exported for tests. */
export function toLlmResponse(message: Anthropic.Message): LlmResponse {
  if (!Array.isArray(message.content) || typeof message.usage?.input_tokens !== 'number') {
    throw new ProviderError('anthropic', 'unexpected response shape from Anthropic Messages API');
  }
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
  const u = message.usage;
  const inputTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const raw = message.stop_reason ?? 'unknown';
  return {
    text,
    usage: { inputTokens, outputTokens: u.output_tokens },
    stopReason: mapStopReason(message.stop_reason),
    rawStopReason: raw,
    model: message.model,
  };
}

function mapStopReason(reason: Anthropic.StopReason | null): LlmStopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'other';
  }
}
