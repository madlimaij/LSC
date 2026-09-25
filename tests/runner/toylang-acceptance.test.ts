/**
 * WP-05 acceptance criterion: "The toylang fixture Rule Set passes all
 * toylang examples; any discrepancy is reported to the orchestrator for
 * contract-architect to fix in the fixture." Also exercises the sample
 * repository traps recorded in fixtures/toylang/SPEC.md §7 (S1-S14).
 */
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import FastGlob from 'fast-glob';
import { describe, expect, it } from 'vitest';
import { loadRuleSetFile } from '../../src/contract/load.js';
import { ingestSkills } from '../../src/ingest/index.js';
import { runRules, type SampleFile } from '../../src/runner/index.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const RULESET_PATH = join(REPO_ROOT, 'contract/fixtures/toylang.ruleset.json');
const SKILLS_DIR = join(REPO_ROOT, 'fixtures/toylang/skills');
const SAMPLE_DIR = join(REPO_ROOT, 'fixtures/toylang/sample-repo');

function loadFixtureRuleSet() {
  const loaded = loadRuleSetFile(RULESET_PATH);
  if (!loaded.ok) throw new Error('fixture Rule Set is invalid');
  return loaded.ruleSet;
}

function loadSampleFiles(): SampleFile[] {
  const files = FastGlob.sync('**/*', { cwd: SAMPLE_DIR, onlyFiles: true }).sort();
  return files.map((relPath) => ({
    path: relPath.split(sep).join('/'),
    content: readFileSync(join(SAMPLE_DIR, relPath), 'utf8'),
  }));
}

describe('toylang fixture Rule Set against all toylang examples', () => {
  it('passes every example (positive and negative, inline and sidecar), for every rule', () => {
    const ruleSet = loadFixtureRuleSet();
    const ingested = ingestSkills(SKILLS_DIR);
    expect(ingested.diagnostics).toEqual([]);
    const examples = ingested.constructs.flatMap((construct) => construct.examples);
    expect(examples.length).toBe(74); // fixtures/toylang/SPEC.md §5

    const results = runRules(ruleSet, examples, []);

    for (const rule of results.rules) {
      expect(rule.tests.failed, `rule "${rule.ruleId}" has failing examples: ${rule.tests.failingExampleIds.join(', ')}`).toBe(0);
      expect(rule.missingExampleIds).toEqual([]);
    }
    expect(results.ok).toBe(true);
  });

  it('every rule reaches high computed confidence on the full example set', () => {
    const ruleSet = loadFixtureRuleSet();
    const examples = ingestSkills(SKILLS_DIR).constructs.flatMap((c) => c.examples);
    const results = runRules(ruleSet, examples, []);
    for (const rule of results.rules) {
      expect(rule.computedConfidence, `rule "${rule.ruleId}"`).toBe('high');
    }
  });

  it('every construct has enough examples for the "high" coverage threshold', () => {
    const ruleSet = loadFixtureRuleSet();
    const examples = ingestSkills(SKILLS_DIR).constructs.flatMap((c) => c.examples);
    const results = runRules(ruleSet, examples, []);
    expect(results.coverage.ruleTypesMissing).toEqual([]);
    for (const construct of results.coverage.constructs) {
      expect(construct.meetsHighThreshold, construct.construct).toBe(true);
    }
  });
});

describe('toylang fixture Rule Set against the sample repository (SPEC.md §7)', () => {
  function scanSample() {
    const ruleSet = loadFixtureRuleSet();
    const examples = ingestSkills(SKILLS_DIR).constructs.flatMap((c) => c.examples);
    return runRules(ruleSet, examples, loadSampleFiles());
  }

  it('S11: the non-toylang file is never scanned (fileMatchers)', () => {
    const results = scanSample();
    expect(results.filesScanned).not.toContain('docs/notes.txt');
  });

  it('S2: one deliberate false positive, a second db_read of table "LET" on customers/messages.tl:4', () => {
    const results = scanSample();
    const dbRead = results.rules.find((r) => r.ruleId === 'db-read');
    const falsePositive = dbRead?.sampleMatches.filter((m) => m.file === 'customers/messages.tl' && m.line === 4);
    expect(falsePositive).toEqual([
      expect.objectContaining({ captures: { table: 'inbox' } }),
      expect.objectContaining({ captures: { table: 'LET' } }),
    ]);
  });

  it('S3: one deliberate miss, the continued CALL on batch/nightly.tl:6 is not found', () => {
    const results = scanSample();
    const call = results.rules.find((r) => r.ruleId === 'call-statement');
    expect(call?.sampleMatches.some((m) => m.file === 'batch/nightly.tl' && m.line === 6)).toBe(false);
  });

  it('S7/S8: block-tracking warnings for the unclosed procedure and the stray blockEnd', () => {
    const results = scanSample();
    expect(results.sampleWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'unclosed-block', file: 'batch/retry.tl', line: 4 }),
        expect.objectContaining({ kind: 'unmatched-block-end', file: 'legacy/old_billing.tl', line: 17 }),
      ]),
    );
  });

  it('S10: CRLF sample file (legacy/dos_export.tl) is scanned with the same result as LF', () => {
    const results = scanSample();
    const moduleDecl = results.rules.find((r) => r.ruleId === 'module-declaration');
    expect(moduleDecl?.sampleMatches.some((m) => m.file === 'legacy/dos_export.tl' && m.line === 1)).toBe(true);
  });
});
