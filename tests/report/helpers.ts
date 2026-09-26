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

/**
 * A clone of the fixture Rule Set with all three of `tests/runner/broken-ruleset.test.ts`'s recipes
 * applied at once: a missed match (db-read forced per-line, breaks trap T8/read-03), a false
 * positive (a loosened db-write pattern matches write-neg-01) and wrong captures (proc-definition's
 * name/kind captures swapped, mislabels proc-01). Used by the report tests (reviewer finding 2) to
 * check that all three defects are visible at once, each inside its own rule's section.
 */
export function brokenRuleSetWithAllThreeDefects(): RuleSet {
  const ruleSet = cloneRuleSet();
  const dbRead = ruleSet.rules.find((r) => r.id === 'db-read');
  if (dbRead?.engine !== 'regex') throw new Error('expected db-read to be regex');
  dbRead.regex = { ...dbRead.regex, multiline: false };

  const dbWrite = ruleSet.rules.find((r) => r.id === 'db-write');
  if (dbWrite?.engine !== 'regex') throw new Error('expected db-write to be regex');
  dbWrite.regex = { ...dbWrite.regex, pattern: 'WRITE\\s*(?<table>[A-Za-z_][A-Za-z0-9_]*)' };

  const procDefinition = ruleSet.rules.find((r) => r.id === 'proc-definition');
  if (procDefinition === undefined) throw new Error('expected a proc-definition rule');
  procDefinition.captures = { name: 'kind', kind: 'name' };

  return ruleSet;
}

/**
 * The rendered Markdown text of one rule's own `### \`ruleId\`` section
 * (up to the next rule heading or the next `## ` section), so a test can
 * assert a defect appears *inside that rule's section* rather than
 * anywhere in the document (reviewer finding 2).
 */
export function markdownRuleSection(markdown: string, ruleId: string): string {
  const heading = `### \`${ruleId}\``;
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`no "${heading}" heading in the rendered Markdown`);
  const rest = markdown.slice(start + heading.length);
  const nextRuleAt = rest.search(/\n### `/);
  const nextSectionAt = rest.search(/\n## /);
  const boundaries = [nextRuleAt, nextSectionAt].filter((n) => n >= 0);
  const end = boundaries.length > 0 ? Math.min(...boundaries) : rest.length;
  return markdown.slice(start, start + heading.length + end);
}

/**
 * The rendered HTML of one rule's own `<section class="rule ...">...</section>`,
 * the same "inside its own section" check as `markdownRuleSection`, for the HTML renderer.
 */
export function htmlRuleSection(html: string, ruleId: string): string {
  // The rule's own <h3>, not the Coverage table's link to it (which also contains `<code>ruleId</code>`).
  const marker = `<h3><code>${ruleId}</code>`;
  const markerAt = html.indexOf(marker);
  if (markerAt === -1) throw new Error(`no rule section for "${ruleId}" in the rendered HTML`);
  const start = html.lastIndexOf('<section class="rule', markerAt);
  const end = html.indexOf('</section>', markerAt);
  if (start === -1 || end === -1) throw new Error(`could not bound the <section> for "${ruleId}"`);
  return html.slice(start, end + '</section>'.length);
}
