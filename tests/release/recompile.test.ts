/**
 * WP-10 acceptance, end to end through the CLI and offline: `lsc compile`
 * (FakeProvider replaying recordings) → `lsc export` → change the Skill
 * files → `lsc compile` again → `lsc export --previous`.
 *
 * Recordings: fixtures/recordings/wp09 (hand-written, see
 * tests/synth/wp09-recordings.ts). When a Skill change alters a prompt, the
 * test writes one extra hand-written recording for that prompt into a temp
 * directory (`recordingsFor`), exactly as tests/synth/wp09-recordings.ts
 * builds the committed ones: the request comes from the real pipeline, only
 * the answer is scripted. Nothing is written under fixtures/.
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRuleSet, type RuleSet } from '../../src/contract/index.js';
import { loadRecordings } from '../../src/llm/index.js';
import { copyToylang, io, readJson, recordingsDir, runCli, tempDir, TOYLANG_SAMPLE, writeConfig } from './helpers.js';
import { DB_WRITE_REGEX, editDbWriteSkill, recordingsFor, removeConfigFlag } from './scenarios.js';

interface Compiled {
  readonly out: string;
  readonly draftPath: string;
  readonly draft: RuleSet;
}

async function compile(skillsDir: string, recordings: string, ...extra: string[]): Promise<Compiled> {
  const { config } = writeConfig();
  const out = join(tempDir(), 'out');
  const code = await runCli('compile', skillsDir, '--provider', 'fake', '--recordings', recordings, '--config', config, '--out', out, ...extra);
  expect([0, 2]).toContain(code);
  const draftPath = join(out, 'toylang.ruleset.draft.json');
  return { out, draftPath, draft: readJson<RuleSet>(draftPath) };
}

interface Exported {
  readonly code: number;
  readonly ruleSet: RuleSet;
  readonly changelog: string;
  readonly stdout: string;
}

async function exportDraft(draftPath: string, outPath: string, previous?: string): Promise<Exported> {
  io.out = [];
  const code = await runCli('export', draftPath, '--out', outPath, ...(previous !== undefined ? ['--previous', previous] : []));
  return {
    code,
    ruleSet: readJson<RuleSet>(outPath),
    changelog: readFileSync(join(outPath, '..', 'CHANGELOG.md'), 'utf8'),
    stdout: io.out.join(''),
  };
}

describe('WP-10 acceptance: recompile after a Skill change produces a new version', () => {
  it('changing one Skill file (db-write.md) and recompiling via recordings gives a new version, and the CHANGELOG names the change', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'release', 'toylang.ruleset.json');

    const first = await compile(skillsDir, recordingsDir('wp09'));
    const v1 = await exportDraft(first.draftPath, release);
    expect(v1.code).toBe(0);
    expect(v1.ruleSet.version).toBe('1.0.0');

    editDbWriteSkill(skillsDir);
    const recordings = await recordingsFor(skillsDir, { 'db-write': [DB_WRITE_REGEX] });
    // Only the db-write prompt changed, so exactly one new recording was needed.
    expect(loadRecordings(recordings)).toHaveLength(loadRecordings(recordingsDir('wp09')).length + 1);

    const second = await compile(skillsDir, recordings);
    expect(second.draft.version).toBe('0.0.0-draft');
    const v2 = await exportDraft(second.draftPath, release, release);
    expect(v2.code).toBe(0);
    expect(v2.ruleSet.version).toBe('1.0.1');
    expect(v2.stdout).toContain('Export toylang 1.0.0 → 1.0.1 (patch)');
    expect(v2.changelog).toMatch(/^# Changelog\n\n## toylang 1\.0\.1 \(\d{4}-\d{2}-\d{2}\)\n/);
    const entry = v2.changelog.slice(0, v2.changelog.indexOf('## toylang 1.0.0'));
    expect(entry).toContain('Patch: patterns, settings or provenance were refined; no change in meaning.');
    expect(entry).toContain('- `db-write`: pattern changed (engine exact → regex)');
    expect(entry).toContain('- Skill files edited: db-write.md');
    // Nothing else changed.
    expect(entry.match(/^- /gm)).toHaveLength(2);
  });

  it('removing a construct produces a major bump', async () => {
    const { languageDir, skillsDir } = copyToylang();
    const release = join(tempDir(), 'toylang.ruleset.json');
    const v1 = await exportDraft((await compile(skillsDir, recordingsDir('wp09'))).draftPath, release);
    expect(v1.ruleSet.rules.map((r) => r.id)).toContain('config-flag');

    removeConfigFlag(languageDir);
    const v2 = await exportDraft((await compile(skillsDir, recordingsDir('wp09'))).draftPath, release, release);
    expect(v2.ruleSet.version).toBe('2.0.0');
    expect(v2.ruleSet.rules.map((r) => r.id)).not.toContain('config-flag');
    expect(v2.changelog).toContain('## toylang 2.0.0');
    expect(v2.changelog).toContain('### Breaking (major)\n\n- `config-flag`: removed (config_ref)');
  });

  it('adding a construct produces a minor bump', async () => {
    const { languageDir, skillsDir } = copyToylang();
    // The directory must be called toylang: the default language id (and so every prompt) comes from it.
    const without = join(tempDir(), 'toylang');
    cpSync(languageDir, without, { recursive: true });
    removeConfigFlag(without);
    const release = join(tempDir(), 'toylang.ruleset.json');
    const v1 = await exportDraft((await compile(join(without, 'skills'), recordingsDir('wp09'))).draftPath, release);
    expect(v1.ruleSet.version).toBe('1.0.0');

    const v2 = await exportDraft((await compile(skillsDir, recordingsDir('wp09'))).draftPath, release, release);
    expect(v2.ruleSet.version).toBe('1.1.0');
    expect(v2.changelog).toContain('### Added (minor)\n\n- `config-flag`: added (config_ref, regex, confidence high)');
    expect(v2.changelog).not.toContain('Breaking');
  });

  it('a rule rejected in the draft is not exported; the next compile that validates it is a minor bump', async () => {
    const release = join(tempDir(), 'toylang.ruleset.json');
    const rejectDraft = await compile(copyToylang().skillsDir, recordingsDir('wp09-reject'));
    expect(rejectDraft.draft.rules.find((r) => r.id === 'call')?.status).toBe('rejected');
    const v1 = await exportDraft(rejectDraft.draftPath, release);
    expect(v1.ruleSet.rules.every((r) => r.status === 'validated')).toBe(true);
    expect(v1.ruleSet.rules.map((r) => r.id)).not.toContain('call');
    expect(v1.stdout).toContain('not exported (rejected): call');
    expect(v1.changelog).toContain('Not exported (status `rejected` in the draft): `call`.');

    const v2 = await exportDraft((await compile(copyToylang().skillsDir, recordingsDir('wp09'))).draftPath, release, release);
    expect(v2.ruleSet.version).toBe('1.1.0');
    expect(v2.changelog).toMatch(/- `call`: added[^\n]*\n- `config-flag`: added/);
  });

  it('an unchanged recompile keeps the version and the file, and adds no CHANGELOG entry', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'toylang.ruleset.json');
    await exportDraft((await compile(skillsDir, recordingsDir('wp09'))).draftPath, release);
    const before = readFileSync(release, 'utf8');
    const changelogBefore = readFileSync(join(release, '..', 'CHANGELOG.md'), 'utf8');
    const again = await exportDraft((await compile(skillsDir, recordingsDir('wp09'))).draftPath, release, release);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain('no changes since the previous export; version unchanged');
    expect(readFileSync(release, 'utf8')).toBe(before);
    expect(again.changelog).toBe(changelogBefore);
  });
});

describe('WP-10 acceptance: an exported Rule Set passes `lsc validate-ruleset` and `lsc test` offline', () => {
  it('validates and tests clean against the toylang examples and sample', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'toylang.ruleset.json');
    await exportDraft((await compile(skillsDir, recordingsDir('wp09-reject'))).draftPath, release);
    const ruleSet = readJson<RuleSet>(release);
    expect(validateRuleSet(ruleSet).ok).toBe(true);
    expect(ruleSet.version).toBe('1.0.0');

    io.out = [];
    expect(await runCli('validate-ruleset', release)).toBe(0);
    expect(io.out.join('')).toContain('is a valid Rule Set');

    io.out = [];
    const results = join(tempDir(), 'results.json');
    expect(await runCli('test', release, skillsDir, '--sample', TOYLANG_SAMPLE, '--out', results)).toBe(0);
    expect(io.out.join('')).toContain('OK: every rule passed its examples');
    expect(readJson<{ ok: boolean; ruleSetVersion: string }>(results)).toMatchObject({ ok: true, ruleSetVersion: '1.0.0' });
  });
});

describe('lsc export: command line', () => {
  it('refuses to overwrite an existing --out without --previous, and to overwrite the draft', async () => {
    const { skillsDir } = copyToylang();
    const { draftPath } = await compile(skillsDir, recordingsDir('wp09'));
    const release = join(tempDir(), 'toylang.ruleset.json');
    expect((await exportDraft(draftPath, release)).code).toBe(0);
    io.err = [];
    expect(await runCli('export', draftPath, '--out', release)).toBe(1);
    expect(io.err.join('')).toMatch(/already exists; pass --previous/);
    io.err = [];
    expect(await runCli('export', draftPath, '--out', draftPath)).toBe(1);
    expect(io.err.join('')).toMatch(/must not be the draft file itself/);
  });

  it('refuses a draft passed as --previous, and reports an unreadable or invalid draft', async () => {
    const { skillsDir } = copyToylang();
    const { draftPath } = await compile(skillsDir, recordingsDir('wp09'));
    const out = join(tempDir(), 'toylang.ruleset.json');
    io.err = [];
    expect(await runCli('export', draftPath, '--out', out, '--previous', draftPath)).toBe(1);
    expect(io.err.join('')).toMatch(/0\.0\.0-draft, which is not an exported version/);
    expect(existsSync(out)).toBe(false);

    io.err = [];
    expect(await runCli('export', join(tempDir(), 'missing.json'), '--out', out)).toBe(1);
    expect(io.err.join('')).toMatch(/ERROR: draft: cannot read/);
    const bad = join(tempDir(), 'bad.json');
    writeFileSync(bad, JSON.stringify({ ...readJson<RuleSet>(draftPath), rules: [{ id: 'x' }] }));
    io.err = [];
    expect(await runCli('export', bad, '--out', out)).toBe(1);
    expect(io.err.join('')).toMatch(/is not a valid Rule Set/);
  });

  it('writes the CHANGELOG to --changelog when given', async () => {
    const { skillsDir } = copyToylang();
    const { draftPath } = await compile(skillsDir, recordingsDir('wp09'), '--sample', TOYLANG_SAMPLE);
    const dir = tempDir();
    const changelog = join(dir, 'notes', 'toylang-CHANGES.md');
    expect(await runCli('export', draftPath, '--out', join(dir, 'toylang.ruleset.json'), '--changelog', changelog)).toBe(0);
    expect(readFileSync(changelog, 'utf8')).toMatch(/^# Changelog\n\n## toylang 1\.0\.0 /);
    expect(existsSync(join(dir, 'CHANGELOG.md'))).toBe(false);
  });
});
