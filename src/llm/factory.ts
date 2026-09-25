import { AnthropicProvider, type AnthropicProviderDeps } from './anthropic.js';
import { TokenBudget } from './budget.js';
import type { LlmConfig } from './config.js';
import { LlmConfigError } from './errors.js';
import { FakeProvider } from './fake.js';
import { GuardedProvider } from './guarded.js';
import { RecordingProvider } from './recording-provider.js';
import { SnippetLog } from './snippet-log.js';
import type { LlmProvider } from './types.js';

export type ProviderDeps = AnthropicProviderDeps;

/**
 * Builds the configured base provider (unguarded). With `config.recording`
 * set, a real provider is wrapped in `RecordingProvider`.
 * To add a provider at G4: one class implementing `LlmProvider`, one config
 * schema variant in config.ts, one case here.
 */
export function createProvider(config: LlmConfig, deps: ProviderDeps = {}): LlmProvider {
  const pc = config.provider;
  if (pc === undefined) {
    throw new LlmConfigError('no model provider configured: set "provider" in lsc.config.json');
  }
  let provider: LlmProvider;
  switch (pc.name) {
    case 'fake':
      return FakeProvider.fromDirectory(pc.recordingsDir);
    case 'anthropic':
      provider = new AnthropicProvider(pc, deps);
      break;
  }
  return config.recording ? new RecordingProvider(provider, config.recording.dir) : provider;
}

export interface LlmSession {
  /** Use this for every call of the run: it enforces budgets and writes the snippet log. */
  readonly provider: GuardedProvider;
  readonly budget: TokenBudget;
  readonly log: SnippetLog;
  readonly config: LlmConfig;
}

export interface CreateSessionOptions {
  /** Base provider; default `createProvider(config)`. */
  readonly provider?: LlmProvider;
  readonly runId?: string;
  readonly now?: () => Date;
  readonly deps?: ProviderDeps;
}

/** One compile run: one budget, one snippet-log file, one guarded provider. */
export function createSession(config: LlmConfig, options: CreateSessionOptions = {}): LlmSession {
  const base = options.provider ?? createProvider(config, options.deps);
  const budget = new TokenBudget({
    maxOutputTokensPerCall: config.budgets.maxOutputTokensPerCall,
    maxTotalTokensPerCompile: config.budgets.maxTotalTokensPerCompile,
  });
  const log = new SnippetLog({
    dir: config.log.dir,
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  return { provider: new GuardedProvider(base, budget, log), budget, log, config };
}
