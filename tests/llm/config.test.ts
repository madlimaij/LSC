import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LlmConfigError, loadConfig, parseConfig } from '../../src/llm/index.js';
import { tempDir } from './helpers.js';

describe('lsc.config.json', () => {
  it('uses defaults when no file exists and none was requested', () => {
    const dir = tempDir();
    const cfg = loadConfig({ cwd: dir });
    expect(cfg.provider).toBeUndefined();
    expect(cfg.budgets).toEqual({ maxOutputTokensPerCall: 4096, maxTotalTokensPerCompile: 200_000, maxAttemptsPerConstruct: 3 });
    expect(cfg.log.dir).toBe(join(dir, '.lsc/logs'));
  });

  it('fails when an explicit config path does not exist', () => {
    expect(() => loadConfig({ cwd: tempDir(), path: 'nope.json' })).toThrow(/config file not found/);
  });

  it('loads an Anthropic config and resolves paths against the file location', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'lsc.config.json'),
      JSON.stringify({
        provider: { name: 'anthropic', model: 'some-model-id', baseUrl: 'https://llm.example.internal/' },
        budgets: { maxTotalTokensPerCompile: 50_000 },
        log: { dir: 'out/logs' },
        recording: { dir: 'fixtures/recordings/run1' },
      }),
    );
    const cfg = loadConfig({ cwd: dir });
    expect(cfg.provider).toEqual({
      name: 'anthropic',
      model: 'some-model-id',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      baseUrl: 'https://llm.example.internal/',
    });
    expect(cfg.budgets.maxTotalTokensPerCompile).toBe(50_000);
    expect(cfg.budgets.maxOutputTokensPerCall).toBe(4096);
    expect(cfg.log.dir).toBe(join(dir, 'out/logs'));
    expect(cfg.recording?.dir).toBe(join(dir, 'fixtures/recordings/run1'));
  });

  it('requires a model for the Anthropic provider (nothing hard-coded)', () => {
    expect(() => parseConfig({ provider: { name: 'anthropic' } }, '/')).toThrow(/provider\.model/);
  });

  it.each([
    ['unknown top-level key', { budget: {} }],
    ['misspelt budget key', { budgets: { maxTotalTokens: 5 } }],
    ['API key in the file', { provider: { name: 'anthropic', model: 'm', apiKey: 'sk-...' } }],
    ['unknown provider', { provider: { name: 'openai', model: 'm' } }],
    ['non-positive budget', { budgets: { maxTotalTokensPerCompile: 0 } }],
    ['per-call above total', { budgets: { maxOutputTokensPerCall: 10, maxTotalTokensPerCompile: 5 } }],
    ['recording with the fake provider', { provider: { name: 'fake', recordingsDir: 'r' }, recording: { dir: 'x' } }],
    ['invalid base URL', { provider: { name: 'anthropic', model: 'm', baseUrl: 'not a url' } }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseConfig(value, '/')).toThrow(LlmConfigError);
  });

  it('reports invalid JSON with the file path', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'lsc.config.json'), '{ "provider": ');
    expect(() => loadConfig({ cwd: dir })).toThrow(/lsc\.config\.json is not valid JSON/);
  });
});
