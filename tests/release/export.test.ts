/**
 * Content version assignment, CHANGELOG entries and `exportRuleSet` (WP-10;
 * D24 g, D25 item 5).
 */
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, validateRuleSet, type RuleSet } from '../../src/contract/index.js';
import {
  diffRuleSets,
  entryHeading,
  ExportError,
  exportRuleSet,
  FIRST_VERSION,
  isReleaseVersion,
  nextVersion,
  prependChangelogEntry,
  renderChangelogEntry,
  VersionError,
} from '../../src/release/index.js';
import { fixtureDraft, fixtureRuleSet, withRule } from './helpers.js';

describe('nextVersion', () => {
  it('first export is 1.0.0 whatever the bump', () => {
    expect(FIRST_VERSION).toBe('1.0.0');
    for (const bump of ['major', 'minor', 'patch', 'none'] as const) expect(nextVersion(undefined, bump)).toBe('1.0.0');
  });

  it('bumps major, minor, patch and keeps the version for none', () => {
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0');
    expect(nextVersion('1.4.2', 'minor')).toBe('1.5.0');
    expect(nextVersion('1.4.2', 'patch')).toBe('1.4.3');
    expect(nextVersion('1.4.2', 'none')).toBe('1.4.2');
  });

  it('refuses a draft or other non-release previous version', () => {
    for (const v of ['0.0.0-draft', '0.9.0', '1.0.0-rc.1', '1.0.0+build', '1.0']) {
      expect(isReleaseVersion(v)).toBe(false);
      expect(() => nextVersion(v, 'patch')).toThrow(VersionError);
    }
    expect(isReleaseVersion('10.20.30')).toBe(true);
  });
});

describe('CHANGELOG', () => {
  it('renders an entry grouped by bump, with the date of compiledAt and the rejected rules left out', () => {
    const prev = fixtureRuleSet();
    const next = withRule({ ...prev, rules: prev.rules.filter((r) => r.id !== 'entry-point') }, 'db-read', (r) => ({ ...r, confidence: 'medium' }));
    const entry = renderChangelogEntry({
      languageId: 'toylang',
      version: '2.0.0',
      previousVersion: '1.0.0',
      compiledAt: '2026-10-01T12:00:00Z',
      diff: diffRuleSets(prev, next),
      ruleCount: 7,
      droppedRejected: ['call'],
    });
    expect(entry).toBe(
      [
        '## toylang 2.0.0 (2026-10-01)',
        '',
        'Major: a rule was removed or renamed, or its output meaning changed. Review before adopting. Previous version: 1.0.0. 7 validated rule(s).',
        '',
        '### Breaking (major)',
        '',
        '- `entry-point`: removed (entry_point)',
        '',
        '### Refined (patch)',
        '',
        '- `db-read`: confidence high → medium',
        '',
        'Not exported (status `rejected` in the draft): `call`.',
        '',
      ].join('\n'),
    );
  });

  it('starts a new file, inserts newest first below the title, and never adds the same version twice', () => {
    const e1 = `${entryHeading('toylang', '1.0.0')} (2026-09-26)\n\nFirst export.\n`;
    const e2 = `${entryHeading('toylang', '1.1.0')} (2026-09-27)\n\nMinor.\n`;
    const first = prependChangelogEntry(undefined, e1, entryHeading('toylang', '1.0.0'));
    expect(first).toEqual({ text: `# Changelog\n\n${e1}`, added: true });
    const second = prependChangelogEntry(first.text, e2, entryHeading('toylang', '1.1.0'));
    expect(second.text).toBe(`# Changelog\n\n${e2}\n${e1}`);
    expect(prependChangelogEntry(second.text, e2, entryHeading('toylang', '1.1.0'))).toEqual({ text: second.text, added: false });
    // `toylang 1.1.0` must not be mistaken for `toylang 1.1.00` or `toylang 1.1.0-x`.
    expect(prependChangelogEntry(second.text, e1, entryHeading('toylang', '1.1')).added).toBe(true);
    // A file without the title keeps its text below the new entry.
    expect(prependChangelogEntry('Old notes\n', e1, entryHeading('toylang', '1.0.0')).text).toBe(`# Changelog\n\n${e1}\nOld notes\n`);
  });
});

describe('exportRuleSet', () => {
  it('first export: version 1.0.0, only validated rules, current contract version, still valid (D25 item 5)', () => {
    const draft = withRule(fixtureDraft(), 'call-statement', (r) => ({ ...r, status: 'rejected' }));
    const result = exportRuleSet({ draft });
    expect(result.version).toBe('1.0.0');
    expect(result.ruleSet.version).toBe('1.0.0');
    expect(result.ruleSet.contractVersion).toBe(CONTRACT_VERSION);
    expect(result.ruleSet.rules.map((r) => r.id)).not.toContain('call-statement');
    expect(result.ruleSet.rules.every((r) => r.status === 'validated')).toBe(true);
    expect(result.droppedRejected).toEqual(['call-statement']);
    expect(result.ruleSet.compiledAt).toBe(draft.compiledAt);
    expect(validateRuleSet(result.ruleSet).ok).toBe(true);
    expect(result.changelogEntry).toContain('## toylang 1.0.0 (2026-09-24)');
    expect(result.changelogEntry).toContain('First export: 7 validated rule(s).');
    expect(result.changelogEntry).toContain('Not exported (status `rejected` in the draft): `call-statement`.');
  });

  it('never delivers the draft version: the exported version is always a release version', () => {
    const result = exportRuleSet({ draft: fixtureDraft() });
    expect(result.ruleSet.version).not.toBe('0.0.0-draft');
    expect(isReleaseVersion(result.ruleSet.version)).toBe(true);
  });

  it('derives the next version from the diff against the previous export', () => {
    const previous = exportRuleSet({ draft: fixtureDraft() }).ruleSet;
    const draft = { ...fixtureDraft(), rules: fixtureDraft().rules.filter((r) => r.id !== 'config-flag') };
    const result = exportRuleSet({ draft, previous });
    expect(result).toMatchObject({ version: '2.0.0', previousVersion: '1.0.0', unchanged: false });
    expect(result.diff.bump).toBe('major');
    expect(result.changelogEntry).toContain('`config-flag`: removed (config_ref)');
  });

  it('a draft whose only change is a capture-group rename is a patch: 1.0.0 → 1.0.1, named in the CHANGELOG (D32 item 3, D33)', () => {
    const previous = exportRuleSet({ draft: fixtureDraft() }).ruleSet;
    const draft = withRule(fixtureDraft(), 'call-statement', (r) => {
      if (r.engine !== 'regex') throw new Error('expected a regex rule');
      return {
        ...r,
        regex: { ...r.regex, pattern: r.regex.pattern.replace('(?<module>', '(?<mod>').replace('(?<callee>', '(?<proc>') },
        captures: { callee: 'proc', module: 'mod' },
      };
    });
    expect(validateRuleSet(draft).ok).toBe(true);
    const result = exportRuleSet({ draft, previous });
    expect(result).toMatchObject({ version: '1.0.1', previousVersion: '1.0.0', unchanged: false });
    expect(result.diff.bump).toBe('patch');
    expect(result.changelogEntry).toContain('## toylang 1.0.1');
    expect(result.changelogEntry).toContain('### Refined (patch)');
    expect(result.changelogEntry).not.toContain('### Breaking (major)');
    expect(result.changelogEntry).toContain(
      '`call-statement`: capture group(s) renamed, roles unchanged (role callee remapped: group callee → proc; role module remapped: group module → mod)',
    );
  });

  it('nothing changed: returns the previous Rule Set unchanged, keeps its version, no CHANGELOG entry', () => {
    const previous = exportRuleSet({ draft: fixtureDraft() }).ruleSet;
    const draft: RuleSet = { ...fixtureDraft(), compiledAt: '2031-01-01T00:00:00Z', compilerVersion: '0.2.0' };
    const result = exportRuleSet({ draft, previous });
    expect(result.unchanged).toBe(true);
    expect(result.ruleSet).toBe(previous);
    expect(result.version).toBe('1.0.0');
    expect(result.changelogEntry).toBeUndefined();
  });

  it('refuses a draft as the previous Rule Set, a previous with rejected rules, another language, and a draft without validated rules', () => {
    const draft = fixtureDraft();
    expect(() => exportRuleSet({ draft, previous: fixtureDraft() })).toThrow(/not an exported version/);
    expect(() => exportRuleSet({ draft, previous: withRule(fixtureRuleSet(), 'db-read', (r) => ({ ...r, status: 'rejected' })) })).toThrow(
      /rejected rules/,
    );
    expect(() => exportRuleSet({ draft, previous: { ...fixtureRuleSet(), languageId: 'other' } })).toThrow(/language other/);
    const allRejected = { ...draft, rules: draft.rules.map((r) => ({ ...r, status: 'rejected' as const })) };
    expect(() => exportRuleSet({ draft: allRejected })).toThrow(ExportError);
    expect(() => exportRuleSet({ draft: allRejected })).toThrow(/no validated rule/);
  });

  it('refuses an invalid draft or previous Rule Set with the validator messages', () => {
    const bad = { ...fixtureDraft(), rules: [...fixtureDraft().rules, fixtureDraft().rules[0]] } as RuleSet;
    expect(() => exportRuleSet({ draft: bad })).toThrow(/duplicate-rule-id/);
    expect(() => exportRuleSet({ draft: fixtureDraft(), previous: bad })).toThrow(/previous Rule Set is not valid/);
  });
});
