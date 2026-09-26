import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/build.js';
import { renderHtml } from '../../src/report/html.js';
import {
  brokenRuleSetWithAllThreeDefects,
  fixtureExamplesById,
  htmlRuleSection,
  loadFixtureRuleSet,
  loadSampleFiles,
  runFixture,
} from './helpers.js';

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

  it("a broken rule set makes each of its three defects visible inside that rule's own section, and is flagged red (rejected) in the verdict box and coverage row", () => {
    const ruleSet = brokenRuleSetWithAllThreeDefects();
    const results = runFixture(ruleSet);
    const report = buildReport(results, { ruleSet, examplesById: fixtureExamplesById() });
    const html = renderHtml(report);

    expect(html).toContain('verdict-rejected');
    expect(html).toContain('cov-rejected');

    const dbRead = htmlRuleSection(html, 'db-read');
    expect(dbRead).toContain('class="rule defect"');
    expect(dbRead).toContain('read-03');
    expect(dbRead).toMatch(/line 1 expected table=&quot;order_lines&quot;/);

    const dbWrite = htmlRuleSection(html, 'db-write');
    expect(dbWrite).toContain('class="rule defect"');
    expect(dbWrite).toContain('write-neg-01');
    expect(dbWrite).toMatch(/table=&quot;_count&quot;/);
    expect(dbWrite).toMatch(/table=&quot;_mode&quot;/);

    const procDefinition = htmlRuleSection(html, 'proc-definition');
    expect(procDefinition).toContain('class="rule defect"');
    expect(procDefinition).toContain('proc-01');
    expect(procDefinition).toMatch(/expected name=&quot;calc_total&quot;, kind=&quot;PROC&quot;/);
    expect(procDefinition).toMatch(/got name=&quot;PROC&quot;, kind=&quot;calc_total&quot;/);
  });

  it("layout (D25 item 3): each rule's own <section> holds its unreviewed sample matches and provenance, before the global Provenance section", () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const html = renderHtml(report);

    const ruleWithSamples = report.rules.find((rule) => rule.sampleMatches.length > 0 && rule.provenance !== undefined);
    expect(ruleWithSamples).toBeDefined();
    if (ruleWithSamples === undefined) return;

    const section = htmlRuleSection(html, ruleWithSamples.ruleId);
    const confidenceAt = section.indexOf('Confidence:');
    const falsePositivesAt = section.indexOf('False positives');
    const sampleMatchesAt = section.indexOf('Unreviewed sample matches');
    const provenanceAt = section.indexOf('<h4>Provenance</h4>');
    expect(confidenceAt).toBeGreaterThanOrEqual(0);
    expect(confidenceAt).toBeLessThan(falsePositivesAt);
    expect(falsePositivesAt).toBeLessThan(sampleMatchesAt);
    expect(sampleMatchesAt).toBeLessThan(provenanceAt);

    // The global Provenance section (Skill file hashes) comes after every rule's own <section>.
    const globalProvenanceAt = html.indexOf('<h2>Provenance</h2>');
    const lastSectionCloseAt = html.lastIndexOf('</section>');
    expect(lastSectionCloseAt).toBeGreaterThanOrEqual(0);
    expect(lastSectionCloseAt).toBeLessThan(globalProvenanceAt);
    expect(html.indexOf('Skill file hashes')).toBeGreaterThan(globalProvenanceAt);
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

  it('escapes example text so it cannot break out of the HTML ("<", ">", "&" and quotes from real Rule Set + example + sample snippets)', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const html = renderHtml(report);

    // These come straight from real snippet source text (billing.tl's "IF ROWCOUNT() > 0 THEN",
    // order_lines.tl's "READ &" line-continuation, and a quoted flag literal), so the assertions
    // prove real "<"/">"/"&"/'"' content is escaped, not merely that none happens to occur.
    expect(html).toContain('ROWCOUNT() &gt; 0');
    expect(html).toContain('READ &amp;');
    expect(html).toMatch(/&quot;[\w-]+&quot;/); // a quoted literal (e.g. a FLAG("...") key), escaped

    // No unescaped '>' where a real snippet had one, and no bare '&'/'<' anywhere except the
    // handful of named entities this renderer itself emits (the document must stay well-formed).
    expect(html).not.toMatch(/ROWCOUNT\(\) > 0/);
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;|quot;|mdash;|sect;|rsquo;)/);
  });

});
