import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/build.js';
import { renderHtml } from '../../src/report/html.js';
import type { SynthesisReport } from '../../src/synth/index.js';
import {
  brokenRuleSetWithAllThreeDefects,
  fixtureExamplesById,
  htmlRuleSection,
  loadFixtureRuleSet,
  loadSampleFiles,
  runFixture,
} from './helpers.js';

function fakeSynthesisWithHandWrittenModelSource(): SynthesisReport {
  return {
    languageId: 'toylang',
    compilerVersion: '0.1.0',
    generatedAt: '2026-09-26T00:00:00.000Z',
    status: 'completed',
    maxAttemptsPerConstruct: 3,
    lexical: {
      status: 'accepted',
      settings: { fileMatchers: ['**/*.tl'] },
      attempts: [
        {
          attempt: 1,
          requestHash: 'a'.repeat(64),
          outcome: 'unjustified-settings',
          problems: ['line comment "//" does not appear in the documentation'],
          usage: { inputTokens: 1, outputTokens: 1 },
          proposal: { fileMatchers: ['**/*.tl'], lineComment: '//' },
        },
        {
          attempt: 2,
          requestHash: 'b'.repeat(64),
          outcome: 'accepted',
          problems: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          proposal: { fileMatchers: ['**/*.tl'], lineComment: '--' },
        },
      ],
    },
    constructs: [],
    summary: { constructs: 8, validated: 8, rejected: 0, notJustified: 0, skipped: 0, notAttempted: 0 },
    usage: { inputTokens: 1, outputTokens: 1, calls: 1 },
    ingestDiagnostics: [],
    modelSource: {
      mode: 'replay',
      configuredProvider: 'fake',
      provider: 'hand-written',
      model: 'hand-written',
      origin: 'hand-written',
      calls: [{ origin: 'hand-written', provider: 'hand-written', model: 'hand-written', calls: 1 }],
      summary: 'replay of hand-written recordings',
    },
  };
}

const RUSE_CONSTRUCT_IDS = ['module-declaration', 'proc-definition', 'call-statement', 'include-directive', 'db-read', 'db-write', 'config-flag', 'entry-point'];

/**
 * WP-07 follow-up: a `synthesis.json` shaped like `lsc compile --previous` (src/synth/README.md
 * "Recompile" section) — every construct but `db-write` reused unchanged from `1.0.0`, `db-write`
 * synthesised again because its Skill file changed. Built with the schema types directly, like
 * `tests/synth/recompile-cli.test.ts` and `tests/report/synthesis-view.test.ts` do, rather than
 * running a real compile.
 */
function fakeReuseSynthesis(): SynthesisReport {
  return {
    languageId: 'toylang',
    compilerVersion: '0.1.0',
    generatedAt: '2026-09-26T00:00:00.000Z',
    status: 'completed',
    maxAttemptsPerConstruct: 3,
    reuse: { previousVersion: '1.0.0', force: false },
    lexical: {
      status: 'reused',
      reusedFrom: '1.0.0',
      reuseNote: 'general Skill file(s) unchanged since 1.0.0: language-basics.md',
      settings: { fileMatchers: ['**/*.tl'] },
      attempts: [],
    },
    constructs: RUSE_CONSTRUCT_IDS.map((constructId) =>
      constructId === 'db-write'
        ? {
            constructId,
            ruleType: 'db_write' as const,
            status: 'validated' as const,
            ruleId: 'db-write',
            reuseNote: 'Skill file(s) changed or new: db-write.md',
            attempts: [{ attempt: 1, requestHash: 'a'.repeat(64), outcome: 'passed' as const, problems: [], usage: { inputTokens: 5, outputTokens: 5 } }],
          }
        : {
            constructId,
            status: 'validated' as const,
            ruleId: constructId,
            reusedFrom: '1.0.0',
            reuseNote: `Skill file(s) unchanged since 1.0.0: ${constructId}.md`,
            attempts: [],
          },
    ),
    summary: { constructs: 8, validated: 8, rejected: 0, notJustified: 0, skipped: 0, notAttempted: 0, reused: 7 },
    usage: { inputTokens: 5, outputTokens: 5, calls: 1 },
    ingestDiagnostics: [],
  };
}

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
    // inventory/stock.tl:5 "READ stock_levels WHERE qty < reorder_level" — real "<" content, caught
    // by mutation (G2 round, D27 defect A3: deleting esc()'s "<" replacement did not fail any test).
    expect(html).toContain('qty &lt; reorder_level');

    // No unescaped '>' or '<' where a real snippet had one, and no bare '&'/'<' anywhere except the
    // handful of named entities this renderer itself emits (the document must stay well-formed).
    expect(html).not.toMatch(/ROWCOUNT\(\) > 0/);
    expect(html).not.toContain('qty < reorder_level');
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;|quot;|mdash;|sect;|rsquo;)/);
  });

  it('a rule with more than a handful of unreviewed sample matches collapses them behind <details> (D27 item c)', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const html = renderHtml(report);

    const longRule = report.rules.find((rule) => rule.sampleMatches.length > 5);
    expect(longRule).toBeDefined();
    if (longRule === undefined) return;
    const section = htmlRuleSection(html, longRule.ruleId);
    expect(section).toContain('<details>');
    expect(section).toContain('<summary>');
  });

  it('a compact per-rule unreviewed-sample-match table appears near the top, after Coverage, linking to each rule section (D27 item c)', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const html = renderHtml(report);

    const coverageAt = html.indexOf('<h2>Coverage</h2>');
    const tableAt = html.indexOf('<h2>Unreviewed sample matches per rule</h2>');
    const rulesAt = html.indexOf('<h2>Rules</h2>');
    expect(tableAt).toBeGreaterThan(coverageAt);
    expect(tableAt).toBeLessThan(rulesAt);
    expect(html).toContain('href="#rule-db-read"');
  });

  it('a rejected rule\'s heading and coverage row say "rejected" and that export drops it (D27 item d)', () => {
    const ruleSet = brokenRuleSetWithAllThreeDefects();
    const results = runFixture(ruleSet);
    const report = buildReport(results, { ruleSet, examplesById: fixtureExamplesById() });
    const html = renderHtml(report);

    expect(html).toMatch(/rejected \(dropped at export\)/);
    const dbRead = htmlRuleSection(html, 'db-read');
    expect(dbRead).toMatch(/DEFECT.*rejected \(dropped at export\)/);
  });

  it('the confidence line shows the level once, not twice (D27 item f)', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    const html = renderHtml(report);
    const dbRead = htmlRuleSection(html, 'db-read');
    expect(dbRead).not.toMatch(/<strong>high<\/strong>[^\n]*high — /);
  });

  // G2 round targeted review, finding (1): the html.ts counterpart of the markdown.ts fix — say no
  // sample was scanned, not the unrelated "no rule has any unreviewed sample match".
  it('says "No sample repository scanned" when no sample was scanned at all, not "no rule has any unreviewed sample match"', () => {
    const results = runFixture();
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    expect(report.overall.sampleScanned).toBe(false);
    const html = renderHtml(report);
    expect(html).toContain('No sample repository scanned.');
    expect(html).not.toContain('no rule has any unreviewed sample match');
  });

  // G2 round targeted review, finding (2): assert on text unique to the verdict-area statement
  // (`modelSourceWarningNearVerdictHtml`), not the Synthesis section's own sentence.
  it('states "Not produced by a real model" specifically next to the Verdict, not only in the Synthesis section', () => {
    const results = runFixture();
    const report = buildReport(results, { synthesis: fakeSynthesisWithHandWrittenModelSource() });
    const html = renderHtml(report);
    const verdictSection = html.slice(html.indexOf('<div class="verdict-box'), html.indexOf('<h2>Coverage</h2>'));
    expect(verdictSection).toContain('<strong>Not produced by a real model</strong>');
    expect(verdictSection).toContain('Synthesis section below');
  });

  // G2 round targeted review, finding (3): assert on the *rendered* lexical proposal history text.
  it('renders the lexical proposal history: each attempt, its outcome, and a refused attempt\'s reason', () => {
    const results = runFixture();
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), synthesis: fakeSynthesisWithHandWrittenModelSource() });
    const html = renderHtml(report);
    expect(html).toContain('attempt 1: <strong>unjustified-settings</strong>');
    expect(html).toContain('does not appear in the documentation');
    expect(html).toContain('attempt 2: <strong>accepted</strong>');
  });

  // G2 round targeted review, finding (4a): the "Sample coverage shows matches only" bullet had no
  // HTML test in either branch (scanned vs not scanned).
  it('the "Sample coverage shows matches only" bullet states the sample-scanned branch correctly, in both states', () => {
    const scanned = buildReport(runFixture(loadFixtureRuleSet(), loadSampleFiles()), { ruleSet: loadFixtureRuleSet() });
    const scannedHtml = renderHtml(scanned);
    expect(scannedHtml).toContain('Sample coverage shows matches only');
    expect(scannedHtml).toContain('Misses in the sample must be found by reviewing it');

    const notScanned = buildReport(runFixture(), { ruleSet: loadFixtureRuleSet() });
    const notScannedHtml = renderHtml(notScanned);
    expect(notScannedHtml).toContain('Sample coverage shows matches only');
    expect(notScannedHtml).toContain('No sample repository was scanned at all here');
  });

  // G2 round targeted review, finding (4b): the HTML new-Skill-file block had no test at all.
  it('the HTML new-Skill-file block warns about a Skill file present under --skills-dir but not in sourceSkills', () => {
    const ruleSet = loadFixtureRuleSet();
    const current = [...ruleSet.sourceSkills, { path: 'new-construct.md', sha256: 'c'.repeat(64) }];
    const report = buildReport(runFixture(), { ruleSet, currentSourceSkills: current });
    const html = renderHtml(report);
    expect(html).toContain('new-construct.md');
    expect(html).toContain('not used by this Rule Set');
  });

  // WP-07 follow-up: `lsc compile --previous` reuses unchanged rules (docs/progress.md "WP-10 compile
  // wiring", synthesis.json's new `reuse`/`reusedFrom`/`reuseNote`/`summary.reused` fields).
  describe('recompile (--previous) fields', () => {
    it('a reused construct says "reused from <version>, no model call" plus its reuseNote, and never looks like 0 failed attempts', () => {
      const report = buildReport(runFixture(), { synthesis: fakeReuseSynthesis() });
      const html = renderHtml(report);
      const synthesisSection = html.slice(html.indexOf('<h2>Synthesis</h2>'));
      expect(synthesisSection).toContain('<code>module-declaration</code>');
      expect(synthesisSection).toContain('reused from 1.0.0, no model call: Skill file(s) unchanged since 1.0.0: module-declaration.md');
      expect(synthesisSection).not.toMatch(/module-declaration[^<]*<\/code>[^<]*0 attempt\(s\)/);
      expect(synthesisSection).not.toMatch(/module-declaration[\s\S]*?no attempts recorded/);
    });

    it('a construct that was not reused shows its reuseNote next to its attempts, not the reused wording', () => {
      const report = buildReport(runFixture(), { synthesis: fakeReuseSynthesis() });
      const html = renderHtml(report);
      const synthesisSection = html.slice(html.indexOf('<h2>Synthesis</h2>'));
      expect(synthesisSection).toContain(
        '<code>db-write</code> (db_write) &mdash; <strong>validated</strong> (rule <code>db-write</code>), 1 attempt(s) (Skill file(s) changed or new: db-write.md)',
      );
      expect(synthesisSection).toContain('attempt 1: <strong>passed</strong>');
      expect(synthesisSection).not.toMatch(/db-write<\/code>[^<]*reused from/);
    });

    it('reused lexical settings show "reused from <version>" with the note', () => {
      const report = buildReport(runFixture(), { synthesis: fakeReuseSynthesis() });
      const html = renderHtml(report);
      const synthesisSection = html.slice(html.indexOf('<h2>Synthesis</h2>'));
      expect(synthesisSection).toContain('Lexical settings: <strong>reused</strong> from 1.0.0, no model call');
      expect(synthesisSection).toContain('general Skill file(s) unchanged since 1.0.0: language-basics.md');
    });

    it('the Summary paragraph mentions the recompile in plain words', () => {
      const report = buildReport(runFixture(), { synthesis: fakeReuseSynthesis() });
      const html = renderHtml(report);
      expect(html).toContain('Recompiled from version 1.0.0: 7 rules reused unchanged, 1 rule rebuilt (db-write).');
    });

    it('when synthesis.json has no reuse fields, nothing changes: no "reused"/"recompiled" wording appears', () => {
      const report = buildReport(runFixture(), { synthesis: fakeSynthesisWithHandWrittenModelSource() });
      const html = renderHtml(report);
      expect(html).not.toMatch(/reused from|Recompiled from version/);
    });
  });
});
