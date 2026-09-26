/**
 * `exportFiles` / `checkExportTarget` safety (WP-10 review round 1, F1) and
 * the CHANGELOG wording for a rule rejected in the new draft (F2).
 * D30 b, D31 a/b: one languageId + version means one content, and a version
 * never goes backwards.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuleSet } from '../../src/contract/index.js';
import { checkExportTarget, ExportError, exportFiles, exportRuleSet, findChangelogEntry } from '../../src/release/index.js';
import { fixtureDraft, fixtureRuleSet, io, readJson, runCli, tempDir, withRule } from './helpers.js';

function writeJson(path: string, value: unknown): string {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

/** A draft whose diff against the 1.0.0 fixture is a patch (db-read pattern tokens unchanged, confidence changed). */
function patchDraft(): RuleSet {
  return withRule(fixtureDraft(), 'db-read', (r) => ({ ...r, confidence: 'medium' }));
}

describe('F1: a stale --previous must not overwrite a newer export', () => {
  it('reproduction: --out holds 2.1.0, --previous is 1.0.0: lsc export exits 1 and leaves --out and the CHANGELOG untouched', async () => {
    const dir = tempDir();
    const out = writeJson(join(dir, 'toylang.ruleset.json'), { ...fixtureRuleSet(), version: '2.1.0' });
    const before = readFileSync(out, 'utf8');
    const previous = writeJson(join(tempDir(), 'old.ruleset.json'), fixtureRuleSet());
    const draft = writeJson(join(tempDir(), 'toylang.ruleset.draft.json'), patchDraft());

    io.err = [];
    expect(await runCli('export', draft, '--out', out, '--previous', previous)).toBe(1);
    expect(io.err.join('')).toMatch(/holds toylang 2\.1\.0, but --previous .* is toylang 1\.0\.0; .*stale --previous/);
    expect(readFileSync(out, 'utf8')).toBe(before);
    expect(existsSync(join(dir, 'CHANGELOG.md'))).toBe(false);
  });

  it('checkExportTarget: no --out yet is fine; an existing --out needs --previous', () => {
    const dir = tempDir();
    const out = join(dir, 'toylang.ruleset.json');
    expect(() => checkExportTarget(out)).not.toThrow();
    expect(() => checkExportTarget(out, join(dir, 'missing.json'))).not.toThrow();
    writeJson(out, fixtureRuleSet());
    expect(() => checkExportTarget(out)).toThrow(ExportError);
    expect(() => checkExportTarget(out)).toThrow(/already exists; pass --previous/);
  });

  it('checkExportTarget: --previous that is --out itself (also spelled differently) is fine', () => {
    const dir = tempDir();
    const out = writeJson(join(dir, 'toylang.ruleset.json'), { ...fixtureRuleSet(), version: '2.1.0' });
    expect(() => checkExportTarget(out, out)).not.toThrow();
    expect(() => checkExportTarget(out, join(dir, '.', 'toylang.ruleset.json'))).not.toThrow();
  });

  it('checkExportTarget: a separate --previous with the same content is fine (key order and whitespace ignored)', () => {
    const out = writeJson(join(tempDir(), 'toylang.ruleset.json'), fixtureRuleSet());
    const reordered = Object.fromEntries(Object.entries(fixtureRuleSet()).reverse());
    const previous = join(tempDir(), 'archive.json');
    writeFileSync(previous, JSON.stringify(reordered), 'utf8');
    expect(() => checkExportTarget(out, previous)).not.toThrow();
  });

  it('checkExportTarget: same version but different content is refused', () => {
    const out = writeJson(join(tempDir(), 'toylang.ruleset.json'), fixtureRuleSet());
    const previous = writeJson(join(tempDir(), 'archive.json'), withRule(fixtureRuleSet(), 'db-read', (r) => ({ ...r, confidence: 'medium' })));
    expect(() => checkExportTarget(out, previous)).toThrow(/holds toylang 1\.0\.0 with content different from --previous/);
  });

  it('checkExportTarget: another language in --out is refused', () => {
    const out = writeJson(join(tempDir(), 'toylang.ruleset.json'), { ...fixtureRuleSet(), languageId: 'other' });
    const previous = writeJson(join(tempDir(), 'archive.json'), fixtureRuleSet());
    expect(() => checkExportTarget(out, previous)).toThrow(/holds other 1\.0\.0, but --previous .* is toylang 1\.0\.0/);
  });

  it('checkExportTarget: an existing --out that is not a Rule Set is never overwritten', () => {
    const out = join(tempDir(), 'toylang.ruleset.json');
    writeFileSync(out, 'not json', 'utf8');
    const previous = writeJson(join(tempDir(), 'archive.json'), fixtureRuleSet());
    expect(() => checkExportTarget(out, previous)).toThrow(/already exists and is not a valid Rule Set/);
    expect(() => exportFiles({ draft: patchDraft(), outPath: out, previousPath: previous })).toThrow(ExportError);
    expect(readFileSync(out, 'utf8')).toBe('not json');
  });

  it('exportFiles with a separate --previous equal to --out exports normally', () => {
    const dir = tempDir();
    const out = writeJson(join(dir, 'toylang.ruleset.json'), fixtureRuleSet());
    const previous = writeJson(join(tempDir(), 'archive.json'), fixtureRuleSet());
    const result = exportFiles({ draft: patchDraft(), outPath: out, previousPath: previous });
    expect(result.version).toBe('1.0.1');
    expect(readJson<RuleSet>(out).version).toBe('1.0.1');
    expect(result.changelogUpdated).toBe(true);
  });
});

describe('F1: a CHANGELOG entry for the computed version with other content is refused, not skipped', () => {
  it('re-deriving 2.0.0 from a restored 1.0.0 with different rules is refused; re-exporting the same 2.0.0 is idempotent', () => {
    const dir = tempDir();
    const out = join(dir, 'toylang.ruleset.json');
    const changelog = join(dir, 'CHANGELOG.md');
    const v1Copy = join(tempDir(), 'v1.json');

    expect(exportFiles({ draft: fixtureDraft(), outPath: out }).version).toBe('1.0.0');
    copyFileSync(out, v1Copy);

    const withoutConfigFlag: RuleSet = { ...fixtureDraft(), rules: fixtureDraft().rules.filter((r) => r.id !== 'config-flag') };
    expect(exportFiles({ draft: withoutConfigFlag, outPath: out, previousPath: out }).version).toBe('2.0.0');
    const v2Bytes = readFileSync(out, 'utf8');
    const changelogAfterV2 = readFileSync(changelog, 'utf8');

    // Someone restores the 1.0.0 file (e.g. from version control) and exports a different draft: it would also be 2.0.0.
    copyFileSync(v1Copy, out);
    const withoutEntryPoint: RuleSet = { ...fixtureDraft(), rules: fixtureDraft().rules.filter((r) => r.id !== 'entry-point') };
    expect(() => exportFiles({ draft: withoutEntryPoint, outPath: out, previousPath: out })).toThrow(
      /already has an entry for toylang 2\.0\.0 with different content/,
    );
    // Nothing was written: --out still holds the restored 1.0.0, the CHANGELOG is as it was.
    expect(readFileSync(out, 'utf8')).toBe(readFileSync(v1Copy, 'utf8'));
    expect(readFileSync(changelog, 'utf8')).toBe(changelogAfterV2);

    // The same 2.0.0 again: identical entry, so it is fine and the CHANGELOG is not touched.
    const again = exportFiles({ draft: withoutConfigFlag, outPath: out, previousPath: out });
    expect(again.version).toBe('2.0.0');
    expect(again.changelogUpdated).toBe(false);
    expect(readFileSync(out, 'utf8')).toBe(v2Bytes);
    expect(readFileSync(changelog, 'utf8')).toBe(changelogAfterV2);
  });

  it('findChangelogEntry returns the entry up to the next heading, or undefined', () => {
    const text = '# Changelog\n\n## toylang 1.1.0 (2026-09-27)\n\nMinor.\n\n## toylang 1.0.0 (2026-09-26)\n\nFirst.\n';
    expect(findChangelogEntry(text, '## toylang 1.1.0')).toBe('## toylang 1.1.0 (2026-09-27)\n\nMinor.\n');
    expect(findChangelogEntry(text, '## toylang 1.0.0')).toBe('## toylang 1.0.0 (2026-09-26)\n\nFirst.\n');
    expect(findChangelogEntry(text, '## toylang 1.1')).toBeUndefined();
    expect(findChangelogEntry(undefined, '## toylang 1.0.0')).toBeUndefined();
  });
});

describe('F2: a rule rejected in the new draft is reported as such in the export', () => {
  it('exportRuleSet: the CHANGELOG says the removed rule was rejected in the new draft', () => {
    const previous = exportRuleSet({ draft: fixtureDraft() }).ruleSet;
    const draft = withRule(fixtureDraft(), 'call-statement', (r) => ({ ...r, status: 'rejected' }));
    const result = exportRuleSet({ draft, previous });
    expect(result.version).toBe('2.0.0');
    expect(result.ruleSet.rules.map((r) => r.id)).not.toContain('call-statement');
    expect(result.changelogEntry).toContain('### Breaking (major)\n\n- `call-statement`: removed (rejected in the new draft; call)\n');
  });

  it('exportFiles: the written CHANGELOG carries the same wording', () => {
    const dir = tempDir();
    const out = join(dir, 'toylang.ruleset.json');
    exportFiles({ draft: fixtureDraft(), outPath: out });
    exportFiles({ draft: withRule(fixtureDraft(), 'call-statement', (r) => ({ ...r, status: 'rejected' })), outPath: out, previousPath: out });
    expect(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8')).toContain('- `call-statement`: removed (rejected in the new draft; call)');
  });
});
