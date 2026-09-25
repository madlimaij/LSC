/**
 * WP-05 acceptance criterion: "A deliberately broken copy of the fixture
 * produces the expected misses, false positives, and wrong-capture entries
 * (tested)."
 *
 * Each test mutates exactly one field of one rule in a clone of
 * `contract/fixtures/toylang.ruleset.json` and checks that `runRules`
 * reports the specific, predictable breakage while every other rule keeps
 * passing.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuleSet } from '../../src/contract/index.js';
import { loadRuleSetFile } from '../../src/contract/load.js';
import { ingestSkills } from '../../src/ingest/index.js';
import { runRules } from '../../src/runner/index.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const RULESET_PATH = join(REPO_ROOT, 'contract/fixtures/toylang.ruleset.json');
const SKILLS_DIR = join(REPO_ROOT, 'fixtures/toylang/skills');

function loadFixtureRuleSet(): RuleSet {
  const loaded = loadRuleSetFile(RULESET_PATH);
  if (!loaded.ok) throw new Error('fixture Rule Set is invalid');
  return loaded.ruleSet;
}

const EXAMPLES = ingestSkills(SKILLS_DIR).constructs.flatMap((c) => c.examples);

function cloneRuleSet(): RuleSet {
  return JSON.parse(JSON.stringify(loadFixtureRuleSet())) as RuleSet;
}

function ruleNamed(ruleSet: RuleSet, id: string) {
  const rule = ruleSet.rules.find((r) => r.id === id);
  if (rule === undefined) throw new Error(`no rule "${id}" in the fixture`);
  return rule;
}

describe('a deliberately broken copy of the fixture', () => {
  it('produces a missed match: db-read forced per-line breaks trap T8 (statement continued right after the keyword)', () => {
    const ruleSet = cloneRuleSet();
    const rule = ruleNamed(ruleSet, 'db-read');
    if (rule.engine !== 'regex') throw new Error('expected db-read to be a regex rule');
    rule.regex = { ...rule.regex, multiline: false };

    const results = runRules(ruleSet, EXAMPLES, []);
    const dbRead = results.rules.find((r) => r.ruleId === 'db-read');
    expect(dbRead?.tests.failingExampleIds).toEqual(['read-03']);
    const failing = dbRead?.examples.find((e) => e.exampleId === 'read-03');
    expect(failing?.missed).toEqual([{ line: 1, type: 'db_read', captures: { table: 'order_lines' } }]);
    expect(failing?.unexpected).toEqual([]);
    expect(failing?.wrongCaptures).toEqual([]);

    // Every other rule is unaffected by this single-field change.
    for (const other of results.rules.filter((r) => r.ruleId !== 'db-read')) {
      expect(other.tests.failed, other.ruleId).toBe(0);
    }
  });

  it('produces a false positive: a loosened db-write pattern matches inside identifiers (trap T4, write-neg-01)', () => {
    const ruleSet = cloneRuleSet();
    const rule = ruleNamed(ruleSet, 'db-write');
    if (rule.engine !== 'regex') throw new Error('expected db-write to be a regex rule');
    rule.regex = { ...rule.regex, pattern: 'WRITE\\s*(?<table>[A-Za-z_][A-Za-z0-9_]*)' };

    const results = runRules(ruleSet, EXAMPLES, []);
    const dbWrite = results.rules.find((r) => r.ruleId === 'db-write');
    expect(dbWrite?.tests.failingExampleIds).toEqual(['write-neg-01']);
    const failing = dbWrite?.examples.find((e) => e.exampleId === 'write-neg-01');
    expect(failing?.passed).toBe(false);
    expect(failing?.missed).toEqual([]);
    expect(failing?.wrongCaptures).toEqual([]);
    expect(failing?.unexpected).toEqual([
      { line: 1, column: 7, captures: { table: '_count' } },
      { line: 2, column: 5, captures: { table: '_mode' } },
    ]);

    for (const other of results.rules.filter((r) => r.ruleId !== 'db-write')) {
      expect(other.tests.failed, other.ruleId).toBe(0);
    }
  });

  it('produces wrong-capture entries: swapping the name/kind captures on proc-definition mislabels every match', () => {
    const ruleSet = cloneRuleSet();
    const rule = ruleNamed(ruleSet, 'proc-definition');
    rule.captures = { name: 'kind', kind: 'name' };

    const results = runRules(ruleSet, EXAMPLES, []);
    const proc = results.rules.find((r) => r.ruleId === 'proc-definition');
    expect(proc?.tests.failed).toBeGreaterThan(0);
    const failing = proc?.examples.find((e) => e.exampleId === 'proc-01');
    expect(failing?.missed).toEqual([]);
    expect(failing?.unexpected).toEqual([]);
    expect(failing?.wrongCaptures).toHaveLength(1);
    expect(failing?.wrongCaptures[0]).toMatchObject({
      expectedCaptures: { name: 'calc_total', kind: 'PROC' },
      actualCaptures: { name: 'PROC', kind: 'calc_total' },
    });

    for (const other of results.rules.filter((r) => r.ruleId !== 'proc-definition')) {
      expect(other.tests.failed, other.ruleId).toBe(0);
    }
  });
});
