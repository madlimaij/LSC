/**
 * Shared fixture loading for src/report tests. Reads the toylang fixture
 * (contract-architect's, read-only) the same way `tests/runner/*.test.ts`
 * does; WP-07 does not own `fixtures/toylang/` or `contract/fixtures/`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import FastGlob from 'fast-glob';
import type { RuleSet } from '../../src/contract/index.js';
import { loadRuleSetFile } from '../../src/contract/load.js';
import { indexExamplesById } from '../../src/report/example-location.js';
import { ingestSkills } from '../../src/ingest/index.js';
import { runRules, type Results, type SampleFile } from '../../src/runner/index.js';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
export const RULESET_PATH = join(REPO_ROOT, 'contract/fixtures/toylang.ruleset.json');
export const SKILLS_DIR = join(REPO_ROOT, 'fixtures/toylang/skills');
export const SAMPLE_DIR = join(REPO_ROOT, 'fixtures/toylang/sample-repo');

export function loadFixtureRuleSet(): RuleSet {
  const loaded = loadRuleSetFile(RULESET_PATH);
  if (!loaded.ok) throw new Error('fixture Rule Set is invalid');
  return loaded.ruleSet;
}

export function cloneRuleSet(ruleSet: RuleSet = loadFixtureRuleSet()): RuleSet {
  return JSON.parse(JSON.stringify(ruleSet)) as RuleSet;
}

export function fixtureExamples() {
  return ingestSkills(SKILLS_DIR).constructs.flatMap((construct) => construct.examples);
}

export function fixtureExamplesById() {
  return indexExamplesById(fixtureExamples());
}

export function loadSampleFiles(dir: string = SAMPLE_DIR): SampleFile[] {
  const files = FastGlob.sync('**/*', { cwd: dir, onlyFiles: true, dot: false }).sort();
  return files.map((relPath) => ({
    path: relPath.split(sep).join('/'),
    content: readFileSync(join(dir, relPath), 'utf8'),
  }));
}

/** A deterministic `now` for reproducible `Results.generatedAt` in snapshots. */
export const FIXED_NOW = (): string => '2026-09-26T00:00:00.000Z';

export function runFixture(ruleSet: RuleSet = loadFixtureRuleSet(), sampleFiles: SampleFile[] = []): Results {
  return runRules(ruleSet, fixtureExamples(), sampleFiles, { now: FIXED_NOW, compilerVersion: '0.1.0' });
}
