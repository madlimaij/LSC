import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/build.js';
import type { SynthesisReport } from '../../src/synth/index.js';
import {
  cloneRuleSet,
  fixtureExamplesById,
  loadFixtureRuleSet,
  loadSampleFiles,
  runFixture,
} from './helpers.js';

function fakeSynthesis(overrides: Partial<SynthesisReport> = {}): SynthesisReport {
  return {
    languageId: 'toylang',
    compilerVersion: '0.1.0',
    generatedAt: '2026-09-26T00:00:00.000Z',
    status: 'completed',
    maxAttemptsPerConstruct: 3,
    lexical: { status: 'accepted', attempts: [] },
    constructs: [
      {
        constructId: 'db-read',
        ruleType: 'db_read',
        status: 'validated',
        ruleId: 'db-read',
        attempts: [{ attempt: 1, requestHash: 'a'.repeat(64), outcome: 'passed', problems: [], usage: { inputTokens: 1, outputTokens: 1 } }],
      },
    ],
    summary: { constructs: 1, validated: 1, rejected: 0, notJustified: 0, skipped: 0, notAttempted: 0 },
    usage: { inputTokens: 1, outputTokens: 1, calls: 1 },
    ingestDiagnostics: [],
    ...overrides,
  };
}

describe('buildReport on the healthy toylang fixture', () => {
  it('every section is present and the overall verdict is validated', () => {
    const results = runFixture();
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });

    expect(report.overall.verdict).toBe('validated');
    expect(report.overall.rejectedRuleCount).toBe(0);
    expect(report.overall.summary).toContain('VALIDATED');
    expect(report.coverage).toHaveLength(8); // RULE_TYPES.length
    expect(report.coverage.every((row) => row.status !== 'no-rule')).toBe(true);
    expect(report.rules.length).toBeGreaterThan(0);
    for (const rule of report.rules) {
      expect(rule.confidenceReason.length).toBeGreaterThan(0); // never a bare confidence level
      expect(rule.pattern).toBeDefined();
      expect(rule.captures).toBeDefined();
      expect(rule.provenance).toBeDefined();
    }
  });

  it('a rule that passes at least one positive example has representative matches with captures, from --skills-dir', () => {
    const results = runFixture();
    const report = buildReport(results, { examplesById: fixtureExamplesById() });
    const procDefinition = report.rules.find((rule) => rule.ruleId === 'proc-definition');
    expect(procDefinition?.representativeMatches.length).toBeGreaterThan(0);
    expect(procDefinition?.representativeMatches[0]?.expected.length).toBeGreaterThan(0);
  });

  it('without --ruleset or --skills-dir, pattern/captures/provenance/snippets are omitted, not guessed', () => {
    const results = runFixture();
    const report = buildReport(results);
    for (const rule of report.rules) {
      expect(rule.pattern).toBeUndefined();
      expect(rule.captures).toBeUndefined();
      expect(rule.provenance).toBeUndefined();
    }
    expect(report.sourceSkills).toBeUndefined();
  });

  it('unreviewed sample matches are grouped per rule with file:line and snippet', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results);
    const ruleWithSamples = report.rules.find((rule) => rule.sampleMatches.length > 0);
    expect(ruleWithSamples).toBeDefined();
    const sample = ruleWithSamples?.sampleMatches[0];
    expect(sample?.file).toBeTruthy();
    expect(sample?.line).toBeGreaterThan(0);
    expect(sample?.snippet.length).toBeGreaterThan(0);
  });
});

describe('buildReport on a deliberately broken toylang fixture (WP-05 breakage recipes)', () => {
  it('a missed match is visible: rule id, example id, expected line/captures', () => {
    const ruleSet = cloneRuleSet();
    const rule = ruleSet.rules.find((r) => r.id === 'db-read');
    if (rule?.engine !== 'regex') throw new Error('expected db-read to be regex');
    rule.regex = { ...rule.regex, multiline: false };

    const results = runFixture(ruleSet);
    const report = buildReport(results, { ruleSet, examplesById: fixtureExamplesById() });

    expect(report.overall.verdict).toBe('rejected');
    expect(report.overall.summary).toContain('db-read');
    const dbRead = report.rules.find((r) => r.ruleId === 'db-read');
    expect(dbRead?.ok).toBe(false);
    expect(dbRead?.missedExamples).toHaveLength(1);
    expect(dbRead?.missedExamples[0]).toMatchObject({
      exampleId: 'read-03',
      missed: [{ line: 1, type: 'db_read', captures: { table: 'order_lines' } }],
    });
    expect(dbRead?.missedExamples[0]?.snippet?.location).toContain('read-03');

    // every other rule stays fine
    for (const other of report.rules.filter((r) => r.ruleId !== 'db-read')) {
      expect(other.ok, other.ruleId).toBe(true);
    }
  });

  it('a false positive on a negative example is visible: rule id, example id, unexpected match', () => {
    const ruleSet = cloneRuleSet();
    const rule = ruleSet.rules.find((r) => r.id === 'db-write');
    if (rule?.engine !== 'regex') throw new Error('expected db-write to be regex');
    rule.regex = { ...rule.regex, pattern: 'WRITE\\s*(?<table>[A-Za-z_][A-Za-z0-9_]*)' };

    const results = runFixture(ruleSet);
    const report = buildReport(results, { ruleSet, examplesById: fixtureExamplesById() });

    const dbWrite = report.rules.find((r) => r.ruleId === 'db-write');
    expect(dbWrite?.ok).toBe(false);
    expect(dbWrite?.falsePositives).toHaveLength(1);
    expect(dbWrite?.falsePositives[0]).toMatchObject({ exampleId: 'write-neg-01', role: 'own' });
    expect(dbWrite?.falsePositives[0]?.unexpected.length).toBeGreaterThan(0);
  });

  it('wrong captures are visible: expected vs actual for each mismatch', () => {
    const ruleSet = cloneRuleSet();
    const rule = ruleSet.rules.find((r) => r.id === 'proc-definition');
    if (rule === undefined) throw new Error('expected proc-definition rule');
    rule.captures = { name: 'kind', kind: 'name' };

    const results = runFixture(ruleSet);
    const report = buildReport(results, { ruleSet, examplesById: fixtureExamplesById() });

    const proc = report.rules.find((r) => r.ruleId === 'proc-definition');
    expect(proc?.ok).toBe(false);
    expect(proc?.wrongCaptureExamples.length).toBeGreaterThan(0);
    const first = proc?.wrongCaptureExamples.find((entry) => entry.exampleId === 'proc-01');
    expect(first?.wrongCaptures[0]).toMatchObject({
      expectedCaptures: { name: 'calc_total', kind: 'PROC' },
      actualCaptures: { name: 'PROC', kind: 'calc_total' },
    });
  });
});

describe('buildReport: D25 owner additions', () => {
  it('the verdict line names the number of unreviewed sample matches', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results);
    expect(report.overall.unreviewedSampleMatchCount).toBeGreaterThan(0);
    expect(report.overall.summary).toContain(`${String(report.overall.unreviewedSampleMatchCount)} sample match`);
  });

  it('zero unreviewed sample matches is stated, not silently omitted', () => {
    const results = runFixture(); // no sample files
    const report = buildReport(results);
    expect(report.overall.unreviewedSampleMatchCount).toBe(0);
    expect(report.overall.summary).toContain('no unreviewed sample matches');
  });

  it('--ruleset adds lexical settings (comment/string markers, fileMatchers)', () => {
    const results = runFixture();
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet() });
    expect(report.lexical).toBeDefined();
    expect(report.lexical?.fileMatchers).toEqual(loadFixtureRuleSet().fileMatchers);
  });

  it('without --ruleset, lexical settings are unavailable, not guessed', () => {
    const results = runFixture();
    const report = buildReport(results);
    expect(report.lexical).toBeUndefined();
  });

  it('a synthesis.json adds each construct\'s outcome and reasons', () => {
    const results = runFixture();
    const report = buildReport(results, { synthesis: fakeSynthesis() });
    expect(report.synthesis?.constructs).toHaveLength(1);
    expect(report.synthesis?.constructs[0]).toMatchObject({ constructId: 'db-read', status: 'validated', attemptCount: 1 });
    expect(report.synthesis?.providerNote?.length).toBeGreaterThan(0); // states what's missing, never silent (no modelSource on this fixture)
  });

  it('without --synthesis, synthesis details are unavailable, not guessed', () => {
    const results = runFixture();
    const report = buildReport(results);
    expect(report.synthesis).toBeUndefined();
  });

  it('--ruleset + a matching current Skill hash set reports no mismatches', () => {
    const results = runFixture();
    const ruleSet = loadFixtureRuleSet();
    const report = buildReport(results, { ruleSet, currentSourceSkills: ruleSet.sourceSkills });
    expect(report.skillHashMismatches).toEqual([]);
  });

  it('a differing current Skill hash is reported as a mismatch', () => {
    const results = runFixture();
    const ruleSet = loadFixtureRuleSet();
    const current = ruleSet.sourceSkills.map((s, i) => (i === 0 ? { ...s, sha256: 'f'.repeat(64) } : s));
    const report = buildReport(results, { ruleSet, currentSourceSkills: current });
    expect(report.skillHashMismatches).toHaveLength(1);
    expect(report.skillHashMismatches?.[0]?.path).toBe(ruleSet.sourceSkills[0]?.path);
  });

  it('without a current Skill hash set, the mismatch check is unavailable, not guessed', () => {
    const results = runFixture();
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet() });
    expect(report.skillHashMismatches).toBeUndefined();
  });
});
