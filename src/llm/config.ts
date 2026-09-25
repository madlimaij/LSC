import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { LlmConfigError } from './errors.js';

/** Default file name, looked up in the working directory. */
export const CONFIG_FILE_NAME = 'lsc.config.json';

const nonEmpty = z.string().trim().min(1);

/**
 * Anthropic provider. The model and base URL come from here, the API key from
 * the environment variable named in `apiKeyEnv` (secrets never go into a file
 * that may be committed). Nothing is hard-coded: `model` is required.
 */
export const AnthropicProviderConfigSchema = z.strictObject({
  name: z.literal('anthropic'),
  model: nonEmpty,
  apiKeyEnv: nonEmpty.default('ANTHROPIC_API_KEY'),
  /** Omit to use the SDK default (which honours `ANTHROPIC_BASE_URL`). */
  baseUrl: z.url().optional(),
  timeoutMs: z.number().int().positive().optional(),
  /** SDK-level retries of failed HTTP calls. Default 2 (SDK default). */
  maxRetries: z.number().int().min(0).max(10).optional(),
  temperature: z.number().min(0).max(1).optional(),
});

/** Replays recordings (D7). Used by tests and offline runs. */
export const FakeProviderConfigSchema = z.strictObject({
  name: z.literal('fake'),
  recordingsDir: nonEmpty,
});

export const ProviderConfigSchema = z.discriminatedUnion('name', [
  AnthropicProviderConfigSchema,
  FakeProviderConfigSchema,
]);

export const BudgetConfigSchema = z.strictObject({
  /** Upper bound for `maxOutputTokens` of any single call. */
  maxOutputTokensPerCall: z.number().int().positive().default(4096),
  /** Upper bound for input + output tokens over one compile run. */
  maxTotalTokensPerCompile: z.number().int().positive().default(200_000),
  /** Proposal + refinement attempts per construct (plan §8 step 5). Used by WP-09. */
  maxAttemptsPerConstruct: z.number().int().min(1).max(10).default(3),
});

export const LlmConfigSchema = z
  .strictObject({
    /** Absent means no provider is configured; `createProvider` then fails with a clear error. */
    provider: ProviderConfigSchema.optional(),
    budgets: BudgetConfigSchema.prefault({}),
    log: z.strictObject({ dir: nonEmpty.default('.lsc/logs') }).prefault({}),
    /** When set, every real-provider call is saved as a recording in `dir` (toylang only!). */
    recording: z.strictObject({ dir: nonEmpty }).optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.recording !== undefined && cfg.provider?.name === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['recording'],
        message: 'recording requires a real provider; the fake provider only replays',
      });
    }
    if (cfg.budgets.maxOutputTokensPerCall > cfg.budgets.maxTotalTokensPerCompile) {
      ctx.addIssue({
        code: 'custom',
        path: ['budgets', 'maxOutputTokensPerCall'],
        message: 'must not exceed maxTotalTokensPerCompile',
      });
    }
  });

export type LlmConfig = z.output<typeof LlmConfigSchema>;
export type LlmConfigInput = z.input<typeof LlmConfigSchema>;
export type ProviderConfig = z.output<typeof ProviderConfigSchema>;
export type AnthropicProviderConfig = z.output<typeof AnthropicProviderConfigSchema>;
export type BudgetConfig = z.output<typeof BudgetConfigSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `  ${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

/**
 * Validates a config object. Relative paths (`log.dir`, `recording.dir`,
 * `provider.recordingsDir`) are resolved against `baseDir`.
 */
export function parseConfig(value: unknown, baseDir: string, source = 'configuration'): LlmConfig {
  const parsed = LlmConfigSchema.safeParse(value);
  if (!parsed.success) {
    throw new LlmConfigError(`${source} is invalid:\n${formatIssues(parsed.error)}`);
  }
  const cfg = parsed.data;
  const abs = (p: string): string => (isAbsolute(p) ? p : resolve(baseDir, p));
  return {
    ...cfg,
    log: { dir: abs(cfg.log.dir) },
    ...(cfg.recording ? { recording: { dir: abs(cfg.recording.dir) } } : {}),
    ...(cfg.provider?.name === 'fake'
      ? { provider: { ...cfg.provider, recordingsDir: abs(cfg.provider.recordingsDir) } }
      : {}),
  };
}

export interface LoadConfigOptions {
  /** Explicit config path. When given, the file must exist. */
  readonly path?: string;
  /** Directory to look for `lsc.config.json` in when `path` is not given. Default: `process.cwd()`. */
  readonly cwd?: string;
}

/**
 * Loads `lsc.config.json`. Without an explicit path, a missing file yields the
 * defaults (no provider, default budgets, logs in `.lsc/logs`).
 */
export function loadConfig(options: LoadConfigOptions = {}): LlmConfig {
  const cwd = options.cwd ?? process.cwd();
  const path = options.path !== undefined ? resolve(cwd, options.path) : resolve(cwd, CONFIG_FILE_NAME);
  if (!existsSync(path)) {
    if (options.path !== undefined) {
      throw new LlmConfigError(`config file not found: ${path}`);
    }
    return parseConfig({}, cwd, 'default configuration');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new LlmConfigError(`${path} is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
  return parseConfig(raw, dirname(path), path);
}
