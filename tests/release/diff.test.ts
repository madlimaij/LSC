/**
 * Rule Set diff and bump classification (WP-10, contract/CONTRACT.md §3).
 * Every row of the classification table in src/release/diff.ts has a test.
 */
import { describe, expect, it } from 'vitest';
import type { Rule, RuleSet } from '../../src/contract/index.js';
import { canonicalJson, diffRuleSets, maxBump, type ChangeKind } from '../../src/release/index.js';
import { fixtureRuleSet, ruleById, withRule } from './helpers.js';

function kinds(prev: RuleSet, next: RuleSet): ChangeKind[] {
  return diffRuleSets(prev, next).changes.map((c) => c.kind);
}

const regex = (rule: Rule): Extract<Rule, { engine: 'regex' }> => {
  if (rule.engine !== 'regex') throw new Error('expected a regex rule');
  return rule;
};

describe('diffRuleSets', () => {
  it('reports no change and bump none for identical content, ignoring compiledAt, compilerVersion, contractVersion, version and key order', () => {
    const prev = fixtureRuleSet();
    const next: RuleSet = {
      ...JSON.parse(canonicalJson(prev)),
      compiledAt: '2030-01-01T00:00:00Z',
      compilerVersion: '9.9.9',
      contractVersion: '1.0.3',
      version: '0.0.0-draft',
    };
    expect(diffRuleSets(prev, next)).toEqual({ changes: [], bump: 'none' });
  });

  it('first export (no previous): every validated rule is added, bump minor; rejected rules are not listed', () => {
    const next = withRule(fixtureRuleSet(), 'call-statement', (r) => ({ ...r, status: 'rejected' }));
    const diff = diffRuleSets(undefined, next);
    expect(diff.bump).toBe('minor');
    expect(diff.changes).toHaveLength(7);
    expect(diff.changes.every((c) => c.kind === 'rule-added')).toBe(true);
    expect(diff.changes.map((c) => c.ruleId)).not.toContain('call-statement');
  });

  it('a removed rule is major', () => {
    const prev = fixtureRuleSet();
    const next = { ...prev, rules: prev.rules.filter((r) => r.id !== 'config-flag') };
    const diff = diffRuleSets(prev, next);
    expect(diff.bump).toBe('major');
    expect(diff.changes).toEqual([expect.objectContaining({ kind: 'rule-removed', ruleId: 'config-flag', bump: 'major' })]);
  });

  it('a rule that is rejected in the new draft counts as removed (Navigator ignores rejected rules), major', () => {
    const prev = fixtureRuleSet();
    const next = withRule(prev, 'db-write', (r) => ({ ...r, status: 'rejected' }));
    const diff = diffRuleSets(prev, next);
    expect(diff.bump).toBe('major');
    expect(diff.changes[0]).toMatchObject({ kind: 'rule-removed', ruleId: 'db-write' });
    expect(diff.changes[0]?.summary).toContain('rejected');
  });

  it('an added rule is minor', () => {
    const next = fixtureRuleSet();
    const prev = { ...next, rules: next.rules.filter((r) => r.id !== 'entry-point') };
    const diff = diffRuleSets(prev, next);
    expect(diff.bump).toBe('minor');
    expect(diff.changes).toEqual([expect.objectContaining({ kind: 'rule-added', ruleId: 'entry-point' })]);
  });

  it('a pattern-only change is patch and names the old and new pattern', () => {
    const prev = fixtureRuleSet();
    const next = withRule(prev, 'db-read', (r) => ({ ...regex(r), regex: { ...regex(r).regex, pattern: `${regex(r).regex.pattern}\\b` } }));
    const diff = diffRuleSets(prev, next);
    expect(diff.bump).toBe('patch');
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({ kind: 'pattern-changed', ruleId: 'db-read', bump: 'patch' });
    expect(diff.changes[0]?.summary).toContain(regex(ruleById(next, 'db-read')).regex.pattern);
  });

  it.each([
    ['flags', (r: Rule): Rule => ({ ...regex(r), regex: { ...regex(r).regex, flags: '' } })],
    ['multiline', (r: Rule): Rule => ({ ...regex(r), regex: { ...regex(r).regex, multiline: !regex(r).regex.multiline } })],
    ['searchStrings', (r: Rule): Rule => ({ ...r, searchStrings: !(r.searchStrings ?? false) })],
    ['blockEnd', (r: Rule): Rule => ({ ...r, blockEnd: { pattern: '^\\s*END\\b', flags: 'i', multiline: false } })],
    [
      'engine',
      (r: Rule): Rule => {
        const { regex: _unused, ...rest } = regex(r);
        return { ...rest, engine: 'exact', exact: { tokens: ['WRITE', '(?<table>)'], caseSensitive: false } };
      },
    ],
  ])('a %s change alone is a patch (pattern refined)', (_label, update) => {
    const prev = fixtureRuleSet();
    const next = withRule(prev, 'db-write', update);
    expect(kinds(prev, next)).toEqual(['pattern-changed']);
    expect(diffRuleSets(prev, next).bump).toBe('patch');
  });

  it('searchStrings false and absent are the same (default false)', () => {
    const prev = withRule(fixtureRuleSet(), 'db-write', (r) => {
      const { searchStrings: _unused, ...rest } = r;
      return rest as Rule;
    });
    const next = withRule(prev, 'db-write', (r) => ({ ...r, searchStrings: false }));
    expect(diffRuleSets(prev, next).bump).toBe('none');
  });

  it('a type change is major', () => {
    const prev = fixtureRuleSet();
    const next = withRule(prev, 'db-write', (r) => ({ ...r, type: 'db_read' }));
    expect(kinds(prev, next)).toEqual(['type-changed']);
    expect(diffRuleSets(prev, next).bump).toBe('major');
  });

  it('capture roles added or removed are major', () => {
    const prev = fixtureRuleSet();
    const added = withRule(prev, 'call-statement', (r) => r);
    const removedRole = withRule(prev, 'call-statement', (r) => ({ ...r, captures: { callee: 'callee' } }));
    expect(kinds(removedRole, added)).toEqual(['captures-changed']);
    expect(diffRuleSets(removedRole, added).bump).toBe('major');
    expect(diffRuleSets(removedRole, added).changes[0]?.summary).toContain('role(s) added: module');
    expect(diffRuleSets(added, removedRole).changes[0]?.summary).toContain('role(s) removed: module');
  });

  it('capture groups renamed with the same roles are a patch (contract 1.0.5 §3, D33)', () => {
    const prev = fixtureRuleSet();
    const remapped = withRule(prev, 'call-statement', (r) => ({ ...r, captures: { callee: 'module', module: 'callee' } }));
    const diff = diffRuleSets(prev, remapped);
    expect(diff.bump).toBe('patch');
    expect(diff.changes).toEqual([expect.objectContaining({ kind: 'captures-changed', bump: 'patch', ruleId: 'call-statement' })]);
    expect(diff.changes[0]?.summary).toContain('capture group(s) renamed, roles unchanged');
    expect(diff.changes[0]?.summary).toContain('role callee remapped: group callee → module');

    // The usual shape: the regex groups and the captures renamed together; both changes are patches.
    const renamed = withRule(prev, 'call-statement', (r) => {
      const rr = regex(r);
      return {
        ...rr,
        regex: { ...rr.regex, pattern: rr.regex.pattern.replace('(?<callee>', '(?<proc>') },
        captures: { callee: 'proc', module: 'module' },
      };
    });
    const renamedDiff = diffRuleSets(prev, renamed);
    expect(renamedDiff.bump).toBe('patch');
    expect(renamedDiff.changes.map((c) => [c.kind, c.bump])).toEqual([
      ['captures-changed', 'patch'],
      ['pattern-changed', 'patch'],
    ]);
  });

  it('a group rename together with an added or removed role is still major', () => {
    const prev = withRule(fixtureRuleSet(), 'call-statement', (r) => ({ ...r, captures: { callee: 'callee' } }));
    const next = withRule(fixtureRuleSet(), 'call-statement', (r) => ({ ...r, captures: { callee: 'module', module: 'callee' } }));
    const diff = diffRuleSets(prev, next);
    expect(diff.bump).toBe('major');
    expect(diff.changes[0]).toMatchObject({ kind: 'captures-changed', bump: 'major' });
    expect(diff.changes[0]?.summary).toContain('role(s) added: module');
    expect(diff.changes[0]?.summary).toContain('role callee remapped: group callee → module');
    expect(diffRuleSets(next, prev).changes[0]).toMatchObject({ kind: 'captures-changed', bump: 'major' });
  });

  it('a renamed rule (same type and matcher, new id) is major and reported as one rename', () => {
    const prev = fixtureRuleSet();
    const next = withRule(prev, 'call-statement', (r) => ({ ...r, id: 'call' }));
    const diff = diffRuleSets(prev, next);
    expect(diff.bump).toBe('major');
    expect(diff.changes).toEqual([expect.objectContaining({ kind: 'rule-renamed', ruleId: 'call', previousRuleId: 'call-statement' })]);
  });

  it('a rename with a changed pattern pairs by Skill section and also lists the pattern change', () => {
    const prev = fixtureRuleSet();
    const next = withRule(prev, 'db-read', (r) => ({ ...regex(r), id: 'db-read-2', regex: { ...regex(r).regex, flags: '' } }));
    expect(kinds(prev, next)).toEqual(['rule-renamed', 'pattern-changed']);
  });

  it('confidence, provenance and test-result changes are patches', () => {
    const prev = fixtureRuleSet();
    const conf = withRule(prev, 'db-read', (r) => ({ ...r, confidence: 'low' }));
    expect(kinds(prev, conf)).toEqual(['confidence-changed']);
    const evid = withRule(prev, 'db-read', (r) => ({
      ...r,
      sourceEvidence: r.sourceEvidence.map((e, i) => (i === 0 ? { ...e, exampleIds: [...e.exampleIds, 'read-99'] } : e)),
    }));
    expect(kinds(prev, evid)).toEqual(['evidence-changed']);
    expect(diffRuleSets(prev, evid).changes[0]?.summary).toContain('examples added: read-99');
    const tests = withRule(prev, 'db-read', (r) => ({ ...r, tests: { ...r.tests, passed: r.tests.passed + 1 } }));
    expect(kinds(prev, tests)).toEqual(['tests-changed']);
    for (const next of [conf, evid, tests]) expect(diffRuleSets(prev, next).bump).toBe('patch');
  });

  it('a changed rule order alone is a patch', () => {
    const prev = fixtureRuleSet();
    const next = { ...prev, rules: [...prev.rules].reverse() };
    expect(kinds(prev, next)).toEqual(['rules-reordered']);
    expect(diffRuleSets(prev, next).bump).toBe('patch');
  });

  it('fileMatchers: a removed glob is major, an added glob minor (contract 1.0.4 §3)', () => {
    const prev = fixtureRuleSet();
    const more = { ...prev, fileMatchers: ['**/*.tl', '**/*.tli'] };
    expect(diffRuleSets(prev, more)).toMatchObject({ bump: 'minor', changes: [{ kind: 'file-matchers-changed' }] });
    expect(diffRuleSets(more, prev)).toMatchObject({ bump: 'major', changes: [{ kind: 'file-matchers-changed' }] });
  });

  it('comment and string markers changed are patches (contract 1.0.4 §3)', () => {
    const prev = fixtureRuleSet();
    const { blockComment: _b, ...noBlock } = prev;
    for (const next of [{ ...prev, lineComment: '//' }, noBlock as RuleSet, { ...prev, stringDelimiters: [{ start: "'", end: "'" }] }]) {
      expect(kinds(prev, next)).toEqual(['lexical-changed']);
      expect(diffRuleSets(prev, next).bump).toBe('patch');
    }
  });

  it('a Skill file edited, added or removed is a patch and named in the summary', () => {
    const prev = fixtureRuleSet();
    const next: RuleSet = {
      ...prev,
      sourceSkills: [
        ...prev.sourceSkills.filter((s) => s.path !== 'entry-point.md').map((s) => (s.path === 'db-write.md' ? { ...s, sha256: '0'.repeat(64) } : s)),
        { path: 'extra.md', sha256: '1'.repeat(64) },
      ],
    };
    const diff = diffRuleSets(prev, next);
    expect(diff.bump).toBe('patch');
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]?.summary).toBe('Skill files edited: db-write.md; added: extra.md; removed: entry-point.md');
  });

  it('the largest bump wins when several apply', () => {
    const prev = fixtureRuleSet();
    const next = withRule({ ...prev, rules: prev.rules.filter((r) => r.id !== 'entry-point') }, 'db-read', (r) => ({ ...r, confidence: 'low' }));
    const added = { ...next, rules: [...next.rules] };
    expect(diffRuleSets(prev, added).bump).toBe('major');
    expect(maxBump('patch', 'minor')).toBe('minor');
    expect(maxBump('major', 'minor')).toBe('major');
    expect(maxBump('none', 'none')).toBe('none');
  });

  it('refuses to compare two languages', () => {
    expect(() => diffRuleSets(fixtureRuleSet(), { ...fixtureRuleSet(), languageId: 'other' })).toThrow(/different languages/);
  });
});
