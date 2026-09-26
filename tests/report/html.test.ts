import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/build.js';
import { renderHtml } from '../../src/report/html.js';
import { fixtureExamplesById, loadFixtureRuleSet, loadSampleFiles, runFixture } from './helpers.js';

describe('renderHtml', () => {
  it('is a single self-contained HTML document: no external assets, no remote requests', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const html = renderHtml(report);

    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<style>'); // CSS is inlined
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/https?:\/\//); // no remote URL anywhere, including in escaped text
    expect(html).not.toMatch(/<script\b/i);
  });

  it('renders every section and never a bare confidence level', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const html = renderHtml(report);

    expect(html).toContain('<h2>Coverage</h2>');
    expect(html).toContain('<h2>Rules</h2>');
    expect(html).toContain('<h2>Provenance</h2>');
    expect(html).toContain('Unreviewed sample matches');
    expect(html).toContain('Skill file hashes');
    expect(html).toMatch(/Confidence: <strong>\w+<\/strong>.*&mdash; /);
  });

  it('escapes example text so it cannot break out of the HTML (e.g. a "<" in a snippet)', () => {
    const results = runFixture();
    const report = buildReport(results);
    const html = renderHtml(report);
    // The document must still be one well-formed document: no unescaped '<' followed by a non-tag character sequence we did not emit.
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;|quot;|mdash;|sect;|rsquo;)/);
  });

  it('a broken rule set is flagged red (rejected) in both the verdict box and the coverage row', () => {
    const ruleSet = loadFixtureRuleSet();
    const clone = JSON.parse(JSON.stringify(ruleSet)) as typeof ruleSet;
    const rule = clone.rules.find((r) => r.id === 'db-read');
    if (rule?.engine !== 'regex') throw new Error('expected db-read to be regex');
    rule.regex = { ...rule.regex, multiline: false };
    const results = runFixture(clone);
    const report = buildReport(results, { ruleSet: clone });
    const html = renderHtml(report);

    expect(html).toContain('verdict-rejected');
    expect(html).toContain('cov-rejected');
    expect(html).toContain('read-03');
  });
});
