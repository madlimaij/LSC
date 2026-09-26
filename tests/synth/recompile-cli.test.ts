/**
 * WP-10 compile wiring, end to end through the CLI and offline:
 * `lsc compile --export` (first export 1.0.0) → edit one Skill file →
 * `lsc compile --previous <export> --export <export>`.
 *
 * Only the changed construct may reach the provider: checked in the snippet
 * log of the second run (every request sent is logged there) and in
 * synthesis.json. Recordings: fixtures/recordings/wp09 (hand-written) plus one
 * hand-written recording for the changed db-write prompt, written into a temp
 * directory by tests/release/scenarios.ts `recordingsFor` (imported, not
 * changed). Nothing is written under fixtures/.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuleSet } from '../../src/contract/index.js';
import { SynthesisReportSchema, type SynthesisReport } from '../../src/synth/index.js';
import { DB_WRITE_REGEX, editDbWriteSkill, recordingsFor } from '../release/scenarios.js';
import { copyToylang, io, logEntries, runCli, tempDir, writeConfig } from './helpers.js';
import { recordingsDir, targetOf } from './wp09-recordings.js';

const CONSTRUCTS = 8;

interface Run {
  readonly code: number;
  readonly out: string;
  readonly synthesis: SynthesisReport;
  /** Target (`lexical` or construct id) of every request sent in this run, in order. */
  readonly asked: string[];
  readonly stdout: string;
  readonly stderr: string;
}

async function compile(skillsDir: string, recordings: string, ...extra: string[]): Promise<Run> {
  const { config, logDir } = writeConfig();
  const out = join(tempDir(), 'out');
  io.out = [];
  io.err = [];
  const code = await runCli('compile', skillsDir, '--provider', 'fake', '--recordings', recordings, '--config', config, '--out', out, ...extra);
  const synthesisPath = join(out, 'synthesis.json');
  return {
    code,
    out,
    synthesis: existsSync(synthesisPath) ? SynthesisReportSchema.parse(JSON.parse(readFileSync(synthesisPath, 'utf8'))) : ({} as SynthesisReport),
    asked: logEntries(logDir)
      .filter((e) => e.sent)
      .map((e) => targetOf(e.request).target),
    stdout: io.out.join(''),
    stderr: io.err.join(''),
  };
}

const readRuleSet = (path: string): RuleSet => JSON.parse(readFileSync(path, 'utf8')) as RuleSet;

describe('lsc compile --previous --export (WP-10 recompile)', () => {
  it('after editing db-write.md, only db-write reaches the provider, the export is 1.0.1 and the CHANGELOG names only db-write', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'release', 'toylang.ruleset.json');
    const changelog = join(release, '..', 'CHANGELOG.md');

    const first = await compile(skillsDir, recordingsDir('wp09'), '--export', release);
    expect(first.code).toBe(0);
    expect(first.asked).toContain('lexical');
    expect(new Set(first.asked).size).toBe(CONSTRUCTS + 1);
    expect(first.synthesis.reuse).toBeUndefined();
    expect(first.stdout).toContain('Export toylang 1.0.0: first export, 8 validated rule(s)');
    expect(readRuleSet(release).version).toBe('1.0.0');
    // The draft is still written next to the other outputs, unchanged in kind.
    expect(readRuleSet(join(first.out, 'toylang.ruleset.draft.json')).version).toBe('0.0.0-draft');

    editDbWriteSkill(skillsDir);
    const recordings = await recordingsFor(skillsDir, { 'db-write': [DB_WRITE_REGEX] });

    const second = await compile(skillsDir, recordings, '--previous', release, '--export', release);
    expect(second.stderr).toBe('');
    expect(second.code).toBe(0);
    // The snippet log of this run: db-write only (one attempt), no lexical call.
    expect(second.asked).toEqual(['db-write']);

    const s = second.synthesis;
    expect(s.status).toBe('completed');
    expect(s.reuse).toEqual({ previousVersion: '1.0.0', force: false });
    expect(s.lexical).toMatchObject({ status: 'reused', reusedFrom: '1.0.0', attempts: [] });
    expect(s.lexical.reuseNote).toBe('general Skill file(s) unchanged since 1.0.0: language-basics.md');
    expect(s.lexical.settings?.fileMatchers).toEqual(['**/*.tl']);
    expect(s.summary).toMatchObject({ constructs: CONSTRUCTS, validated: CONSTRUCTS, reused: CONSTRUCTS - 1 });
    expect(s.usage.calls).toBe(1);
    const dbWrite = s.constructs.find((c) => c.constructId === 'db-write');
    expect(dbWrite?.reusedFrom).toBeUndefined();
    expect(dbWrite?.reuseNote).toBe('Skill file(s) changed or new: db-write.md');
    expect(dbWrite?.attempts).toHaveLength(1);
    for (const c of s.constructs.filter((x) => x.constructId !== 'db-write')) {
      expect(c).toMatchObject({ status: 'validated', reusedFrom: '1.0.0', attempts: [] });
      expect(c.reuseNote).toMatch(/^Skill file\(s\) unchanged since 1\.0\.0: /);
    }
    expect(second.stdout).toContain('previous Rule Set 1.0.0: 7 rule(s) reused without a model call');
    expect(second.stdout).toContain('lexical settings: reused from 1.0.0, no model call');
    expect(second.stdout).toMatch(/VALIDATED +call .*reused from 1\.0\.0, no model call/);
    expect(second.stdout).toContain('Export toylang 1.0.0 → 1.0.1 (patch)');

    const exported = readRuleSet(release);
    expect(exported.version).toBe('1.0.1');
    expect(exported.rules.find((r) => r.id === 'db-write')?.engine).toBe('regex');
    const text = readFileSync(changelog, 'utf8');
    const entry = text.slice(0, text.indexOf('## toylang 1.0.0'));
    expect(entry).toMatch(/^# Changelog\n\n## toylang 1\.0\.1 \(\d{4}-\d{2}-\d{2}\)\n/);
    expect(entry).toContain('- `db-write`: pattern changed (engine exact → regex)');
    expect(entry).toContain('- Skill files edited: db-write.md');
    expect(entry.match(/^- /gm)).toHaveLength(2);

    // The report renders the reused compile (it reads the new synthesis.json fields without failing).
    expect(existsSync(join(second.out, 'report.md'))).toBe(true);
  });

  it('nothing changed: no model call at all, and the export keeps 1.0.0 without a CHANGELOG entry', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'toylang.ruleset.json');
    expect((await compile(skillsDir, recordingsDir('wp09'), '--export', release)).code).toBe(0);
    const before = readFileSync(release, 'utf8');
    const changelogBefore = readFileSync(join(release, '..', 'CHANGELOG.md'), 'utf8');

    const again = await compile(skillsDir, recordingsDir('wp09'), '--previous', release, '--export', release);
    expect(again.code).toBe(0);
    expect(again.asked).toEqual([]);
    expect(again.synthesis.usage.calls).toBe(0);
    expect(again.synthesis.summary.reused).toBe(CONSTRUCTS);
    expect(again.stdout).toContain('no changes since the previous export; version unchanged');
    expect(readFileSync(release, 'utf8')).toBe(before);
    expect(readFileSync(join(release, '..', 'CHANGELOG.md'), 'utf8')).toBe(changelogBefore);
  });

  it('--force synthesises everything again: every construct and the lexical settings reach the provider', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'toylang.ruleset.json');
    const first = await compile(skillsDir, recordingsDir('wp09'), '--export', release);
    const forced = await compile(skillsDir, recordingsDir('wp09'), '--previous', release, '--force');
    expect(forced.code).toBe(0);
    expect(forced.asked).toEqual(first.asked);
    expect(forced.synthesis.reuse).toEqual({ previousVersion: '1.0.0', force: true });
    expect(forced.synthesis.lexical).toMatchObject({ status: 'accepted', reuseNote: '--force' });
    expect(forced.synthesis.summary.reused).toBe(0);
    expect(forced.synthesis.constructs.every((c) => c.reusedFrom === undefined && c.reuseNote === '--force')).toBe(true);
    expect(forced.stdout).toContain('previous Rule Set 1.0.0: --force, everything synthesised again');
  });

  it('a previous rule that fails the current examples is synthesised again, with the reason recorded', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'toylang.ruleset.json');
    expect((await compile(skillsDir, recordingsDir('wp09'), '--export', release)).code).toBe(0);
    // Sabotage the exported db-write rule (a hand-edited file, not a real export) so the runner fails it.
    const edited = readRuleSet(release);
    const rules = edited.rules.map((r) =>
      r.id === 'db-write' && r.engine === 'exact' && r.exact !== undefined ? { ...r, exact: { ...r.exact, tokens: ['WRITEX', '(?<table>)'] } } : r,
    );
    writeFileSync(release, JSON.stringify({ ...edited, rules }));

    const again = await compile(skillsDir, recordingsDir('wp09'), '--previous', release);
    expect(again.code).toBe(0);
    expect(again.asked).toEqual(['db-write']);
    const dbWrite = again.synthesis.constructs.find((c) => c.constructId === 'db-write');
    expect(dbWrite?.reusedFrom).toBeUndefined();
    expect(dbWrite?.reuseNote).toMatch(/^the previous rule fails the current examples/);
  });

  it('refuses before any model call: --force without --previous, a draft as --previous, an existing --export without --previous', async () => {
    const { skillsDir } = copyToylang();
    const noForce = await compile(skillsDir, recordingsDir('wp09'), '--force');
    expect(noForce.code).toBe(1);
    expect(noForce.stderr).toContain('--force only has a meaning with --previous');
    expect(noForce.asked).toEqual([]);

    const drafted = await compile(skillsDir, recordingsDir('wp09'));
    const draftPath = join(drafted.out, 'toylang.ruleset.draft.json');
    const fromDraft = await compile(skillsDir, recordingsDir('wp09'), '--previous', draftPath);
    expect(fromDraft.code).toBe(1);
    expect(fromDraft.stderr).toMatch(/0\.0\.0-draft, which is not an exported version/);
    expect(fromDraft.asked).toEqual([]);

    const other = join(tempDir(), 'other.ruleset.json');
    writeFileSync(other, JSON.stringify({ ...readRuleSet(draftPath), version: '1.0.0', languageId: 'otherlang', rules: readRuleSet(draftPath).rules }));
    const wrongLanguage = await compile(skillsDir, recordingsDir('wp09'), '--previous', other);
    expect(wrongLanguage.code).toBe(1);
    expect(wrongLanguage.stderr).toContain('is for language otherlang, this compile is for toylang');

    const existing = join(tempDir(), 'toylang.ruleset.json');
    writeFileSync(existing, '{}');
    const overwrite = await compile(skillsDir, recordingsDir('wp09'), '--export', existing);
    expect(overwrite.code).toBe(1);
    expect(overwrite.stderr).toMatch(/already exists; pass --previous/);
    expect(overwrite.asked).toEqual([]);
    expect(readFileSync(existing, 'utf8')).toBe('{}');
  });

  it('--export after a compile with a rejected construct drops it, as lsc export does', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'toylang.ruleset.json');
    const run = await compile(skillsDir, recordingsDir('wp09-reject'), '--export', release);
    expect(run.code).toBe(2);
    expect(run.stdout).toContain('not exported (rejected): call');
    const exported = readRuleSet(release);
    expect(exported.version).toBe('1.0.0');
    expect(exported.rules.every((r) => r.status === 'validated')).toBe(true);
  });

  it('an aborted compile is not exported', async () => {
    const { skillsDir } = copyToylang();
    const release = join(tempDir(), 'toylang.ruleset.json');
    // A small budget stops the compile part-way (BudgetExceededError → aborted), with a partial draft written.
    const { config } = writeConfig({ budgets: { maxOutputTokensPerCall: 1024, maxTotalTokensPerCompile: 6000 } });
    const out = join(tempDir(), 'out');
    io.err = [];
    const code = await runCli('compile', skillsDir, '--provider', 'fake', '--recordings', recordingsDir('wp09'), '--config', config, '--out', out, '--export', release);
    expect(code).toBe(1);
    expect(io.err.join('')).toMatch(/--export: not exported, because the compile did not complete \(status aborted\)/);
    expect(existsSync(join(out, 'toylang.ruleset.draft.json'))).toBe(true);
    expect(existsSync(release)).toBe(false);
  });

  it('a synthesis.json written before the reuse fields still loads', async () => {
    const run = await compile(copyToylang().skillsDir, recordingsDir('wp09'));
    const raw = JSON.parse(readFileSync(join(run.out, 'synthesis.json'), 'utf8')) as Record<string, unknown>;
    expect(raw.reuse).toBeUndefined();
    expect((raw.summary as Record<string, unknown>).reused).toBeUndefined();
    expect(JSON.stringify(raw)).not.toMatch(/reusedFrom|reuseNote/);
    expect(SynthesisReportSchema.safeParse(raw).success).toBe(true);
  });
});
