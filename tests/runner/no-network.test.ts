/**
 * WP-05 acceptance criterion: "The run makes no network calls." The runner
 * (and the `lsc test` command) must work fully offline and must not import
 * `src/llm` (the only module that talks to a model provider, D7).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRuleSetFile } from '../../src/contract/load.js';
import { ingestSkills } from '../../src/ingest/index.js';
import { runRules } from '../../src/runner/index.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('src/runner and the test command never import src/llm', () => {
  const files = [...sourceFiles(join(REPO_ROOT, 'src/runner')), join(REPO_ROOT, 'src/cli/commands/test.ts')];

  it.each(files)('%s has no import from src/llm', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/from ['"][^'"]*\/llm\//);
  });
});

describe('runRules makes no network calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs the toylang fixture with global fetch disabled', () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('runRules must not make network calls');
    });

    const loaded = loadRuleSetFile(join(REPO_ROOT, 'contract/fixtures/toylang.ruleset.json'));
    if (!loaded.ok) throw new Error('fixture Rule Set is invalid');
    const examples = ingestSkills(join(REPO_ROOT, 'fixtures/toylang/skills')).constructs.flatMap((c) => c.examples);

    const results = runRules(loaded.ruleSet, examples, []);
    expect(results.ok).toBe(true);
  });
});
