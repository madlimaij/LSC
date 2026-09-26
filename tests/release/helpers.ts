/**
 * Shared helpers for tests/release. The CLI/temp-dir helpers of tests/synth
 * are reused (imported, not changed): they also install the stdout/stderr
 * capture and the LSC_REAL_INPUTS guard for every test in the importing file.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Rule, RuleSet } from '../../src/contract/index.js';

export { copyToylang, io, runCli, tempDir, writeConfig } from '../synth/helpers.js';
export { REPO_ROOT, TOYLANG_SAMPLE, TOYLANG_SKILLS, recordingsDir, targetOf } from '../synth/wp09-recordings.js';

export const FIXTURE_RULESET = resolve(import.meta.dirname, '../../contract/fixtures/toylang.ruleset.json');

/** A fresh deep copy of the contract fixture Rule Set (version 1.0.0, 8 validated rules). */
export function fixtureRuleSet(): RuleSet {
  return JSON.parse(readFileSync(FIXTURE_RULESET, 'utf8')) as RuleSet;
}

/** The fixture as a draft: `0.0.0-draft`, as `lsc compile` writes it (D24 g). */
export function fixtureDraft(): RuleSet {
  return { ...fixtureRuleSet(), version: '0.0.0-draft' };
}

export function ruleById(ruleSet: RuleSet, id: string): Rule {
  const rule = ruleSet.rules.find((r) => r.id === id);
  if (rule === undefined) throw new Error(`no rule ${id}`);
  return rule;
}

/** Replaces the rule with `id` by `update(rule)`. */
export function withRule(ruleSet: RuleSet, id: string, update: (rule: Rule) => Rule): RuleSet {
  return { ...ruleSet, rules: ruleSet.rules.map((r) => (r.id === id ? update(r) : r)) };
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
