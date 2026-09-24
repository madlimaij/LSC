import { describe, expect, it } from 'vitest';
import {
  CONTRACT_VERSION,
  RULE_TYPES,
  VALIDATION_RULES,
  validateRuleSet,
} from '../../src/contract/index.js';
import { invalidFixtures, readJson, VALID_FIXTURE } from './helpers.js';

describe('valid fixture contract/fixtures/toylang.ruleset.json', () => {
  const result = validateRuleSet(readJson(VALID_FIXTURE));

  it('passes full validation', () => {
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('uses contractVersion 1.0.0', () => {
    expect(CONTRACT_VERSION).toBe('1.0.0');
    expect(result.ok && result.ruleSet.contractVersion).toBe('1.0.0');
  });

  it('covers every rule type and both engines', () => {
    if (!result.ok) throw new Error('fixture invalid');
    const types = new Set(result.ruleSet.rules.map((r) => r.type));
    expect([...types].sort()).toEqual([...RULE_TYPES].sort());
    const engines = new Set(result.ruleSet.rules.map((r) => r.engine));
    expect([...engines].sort()).toEqual(['exact', 'regex']);
  });

  it('exercises blockEnd and searchStrings', () => {
    if (!result.ok) throw new Error('fixture invalid');
    expect(result.ruleSet.rules.some((r) => r.blockEnd !== undefined)).toBe(true);
    expect(result.ruleSet.rules.some((r) => r.searchStrings === true)).toBe(true);
  });
});

describe('invalid fixtures contract/fixtures/invalid/*.json', () => {
  const fixtures = invalidFixtures();

  it('include at least one fixture per validation rule', () => {
    const covered = new Set(fixtures.map((f) => f.rule));
    for (const rule of VALIDATION_RULES) {
      expect(covered, `no invalid fixture for rule "${rule}"`).toContain(rule);
    }
  });

  it.each(fixtures.map((f) => [f.file, f] as const))(
    '%s fails only for the rule named in its file name',
    (_file, fixture) => {
      const result = validateRuleSet(readJson(fixture.path));
      expect(result.ok).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      for (const issue of result.issues) {
        expect(issue.rule).toBe(fixture.rule);
        expect(issue.message.length).toBeGreaterThan(0);
      }
      // Cross-field fixtures differ from the valid fixture in one place: exactly one issue.
      if (fixture.rule !== 'schema') expect(result.issues).toHaveLength(1);
    },
  );
});
