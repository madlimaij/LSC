import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/build.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import { fixtureExamplesById, loadFixtureRuleSet, loadSampleFiles, runFixture } from './helpers.js';

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

  it('a broken rule set makes its defects visible with rule id, example id and captures', () => {
    const ruleSet = loadFixtureRuleSet();
    const clone = JSON.parse(JSON.stringify(ruleSet)) as typeof ruleSet;
    const rule = clone.rules.find((r) => r.id === 'db-write');
    if (rule?.engine !== 'regex') throw new Error('expected db-write to be regex');
    rule.regex = { ...rule.regex, pattern: 'WRITE\\s*(?<table>[A-Za-z_][A-Za-z0-9_]*)' };
    const results = runFixture(clone);
    const report = buildReport(results, { ruleSet: clone, examplesById: fixtureExamplesById() });
    const markdown = renderMarkdown(report);

    expect(markdown).toContain('db-write');
    expect(markdown).toContain('write-neg-01');
    expect(markdown).toContain('REJECTED');
  });
});
