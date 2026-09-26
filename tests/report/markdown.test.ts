import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/build.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import {
  brokenRuleSetWithAllThreeDefects,
  fixtureExamplesById,
  loadFixtureRuleSet,
  loadSampleFiles,
  markdownRuleSection,
  runFixture,
} from './helpers.js';

describe('renderMarkdown', () => {
  it('matches the snapshot for the healthy toylang fixture, with samples, ruleset and skills-dir', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    expect(renderMarkdown(report)).toMatchSnapshot();
  });

  it('every section from the WP-07 brief appears, in order', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const markdown = renderMarkdown(report);

    const verdictAt = markdown.indexOf('## Verdict');
    const coverageAt = markdown.indexOf('## Coverage');
    const rulesAt = markdown.indexOf('## Rules');
    const provenanceAt = markdown.indexOf('## Provenance');
    expect(verdictAt).toBeGreaterThanOrEqual(0);
    expect(verdictAt).toBeLessThan(coverageAt);
    expect(coverageAt).toBeLessThan(rulesAt);
    expect(rulesAt).toBeLessThan(provenanceAt);
    expect(markdown).toContain('Unreviewed sample matches');
    expect(markdown).toContain('Skill file hashes');
    expect(markdown).toMatch(/Confidence: \*\*\w+\*\*.* — /); // never a bare confidence level
  });

  it("layout (D25 item 3): each rule's own section holds its unreviewed sample matches and provenance, before the global Provenance section", () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const markdown = renderMarkdown(report);

    const ruleWithSamples = report.rules.find((rule) => rule.sampleMatches.length > 0 && rule.provenance !== undefined);
    expect(ruleWithSamples).toBeDefined();
    if (ruleWithSamples === undefined) return;

    const section = markdownRuleSection(markdown, ruleWithSamples.ruleId);
    const confidenceAt = section.indexOf('Confidence:');
    const falsePositivesAt = section.indexOf('False positives');
    const sampleMatchesAt = section.indexOf('Unreviewed sample matches');
    const provenanceAt = section.indexOf('**Provenance**');
    expect(confidenceAt).toBeGreaterThanOrEqual(0);
    expect(confidenceAt).toBeLessThan(falsePositivesAt);
    expect(falsePositivesAt).toBeLessThan(sampleMatchesAt);
    expect(sampleMatchesAt).toBeLessThan(provenanceAt);

    // The global Provenance section (Skill file hashes) comes after every rule's own section, not
    // grouped separately in the middle of the document.
    const globalProvenanceAt = markdown.indexOf('## Provenance');
    const lastRuleHeadingAt = markdown.lastIndexOf('### `');
    expect(lastRuleHeadingAt).toBeGreaterThanOrEqual(0);
    expect(lastRuleHeadingAt).toBeLessThan(globalProvenanceAt);
    expect(markdown.indexOf('Skill file hashes')).toBeGreaterThan(globalProvenanceAt);
  });

  it('a broken rule set makes each of its three defects visible inside that rule\'s own section (a miss, a false positive, wrong captures)', () => {
    const ruleSet = brokenRuleSetWithAllThreeDefects();
    const results = runFixture(ruleSet);
    const report = buildReport(results, { ruleSet, examplesById: fixtureExamplesById() });
    const markdown = renderMarkdown(report);

    expect(markdown).toContain('REJECTED');

    // Missed match: db-read forced per-line breaks read-03 (trap T8, a statement continued right after the keyword).
    const dbRead = markdownRuleSection(markdown, 'db-read');
    expect(dbRead).toContain('DEFECT');
    expect(dbRead).toContain('read-03');
    expect(dbRead).toMatch(/line 1 expected table="order_lines"/);

    // False positive: a loosened db-write pattern matches inside identifiers on write-neg-01.
    const dbWrite = markdownRuleSection(markdown, 'db-write');
    expect(dbWrite).toContain('DEFECT');
    expect(dbWrite).toContain('write-neg-01');
    expect(dbWrite).toMatch(/table="_count"/);
    expect(dbWrite).toMatch(/table="_mode"/);

    // Wrong captures: swapping the name/kind captures on proc-definition mislabels proc-01.
    const procDefinition = markdownRuleSection(markdown, 'proc-definition');
    expect(procDefinition).toContain('DEFECT');
    expect(procDefinition).toContain('proc-01');
    expect(procDefinition).toMatch(/expected name="calc_total", kind="PROC"/);
    expect(procDefinition).toMatch(/got name="PROC", kind="calc_total"/);

    // Every other rule's own section stays "OK" (single-field mutations do not cross-contaminate).
    for (const rule of report.rules) {
      if (['db-read', 'db-write', 'proc-definition'].includes(rule.ruleId)) continue;
      expect(markdownRuleSection(markdown, rule.ruleId), rule.ruleId).toContain('OK');
    }
  });
});
