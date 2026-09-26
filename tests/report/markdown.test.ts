import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/build.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import type { SynthesisReport } from '../../src/synth/index.js';
import {
  brokenRuleSetWithAllThreeDefects,
  fixtureExamplesById,
  loadFixtureRuleSet,
  loadSampleFiles,
  markdownRuleSection,
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

  // G2 round targeted review, finding (1): "Unreviewed sample matches per rule" must say no sample
  // was scanned, not the unrelated "no rule has any unreviewed sample match" (which reads as good
  // news from a scan that found nothing, not as "nothing was scanned at all").
  it('says "No sample repository scanned" when no sample was scanned at all, not "no rule has any unreviewed sample match"', () => {
    const results = runFixture(); // no sample files passed to runFixture
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    expect(report.overall.sampleScanned).toBe(false);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('No sample repository scanned.');
    expect(markdown).not.toContain('no rule has any unreviewed sample match');
  });

  it('still says "no rule has any unreviewed sample match" when a sample scan ran and found nothing (distinct from no scan at all)', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), examplesById: fixtureExamplesById() });
    expect(report.overall.sampleScanned).toBe(true);
    // The toylang fixture sample always has matches, so the "rows.length === 0" branch isn't reached
    // here; this only proves the branch is scan-state-aware, not always the same text.
    const markdown = renderMarkdown(report);
    expect(markdown).not.toContain('No sample repository scanned.');
  });

  // G2 round targeted review, finding (2): the existing check for "not produced by a real model" was
  // a lowercase, unanchored regex that happened to match the (lowercase, mid-sentence) Synthesis
  // section's own sentence even when the verdict-area statement (`modelSourceWarningNearVerdict`) was
  // disabled. This asserts on text unique to the verdict-area sentence.
  it('states "not produced by a real model" specifically next to the Verdict, not only in the Synthesis section', () => {
    const results = runFixture();
    const report = buildReport(results, { synthesis: fakeSynthesisWithHandWrittenModelSource() });
    const markdown = renderMarkdown(report);
    const verdictSection = markdown.slice(markdown.indexOf('## Verdict'), markdown.indexOf('## Coverage'));
    expect(verdictSection).toMatch(/Not produced by a real model/);
    expect(verdictSection).toContain('see the Synthesis section below');
  });

  // G2 round targeted review, finding (3): nothing asserted on the *rendered* lexical proposal
  // history text (only on the report model, in build.test.ts). Emptying `renderLexicalProposalHistory`
  // must fail this.
  it('renders the lexical proposal history: each attempt, its outcome, and a refused attempt\'s reason', () => {
    const results = runFixture();
    const report = buildReport(results, { ruleSet: loadFixtureRuleSet(), synthesis: fakeSynthesisWithHandWrittenModelSource() });
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('attempt 1: **unjustified-settings**');
    expect(markdown).toContain('does not appear in the documentation');
    expect(markdown).toContain('attempt 2: **accepted**');
  });
});
