/**
 * D28 (owner readability pass): the top-of-report Summary — a plain-language verdict and a
 * priority-ordered "what to do next" list, with no internal references (decision ids, schema field
 * names, "cross-construct negative", "own examples").
 */
import { describe, expect, it } from 'vitest';
import { buildReport } from '../../src/report/build.js';
import { renderHtml } from '../../src/report/html.js';
import { renderMarkdown } from '../../src/report/markdown.js';
import type { SynthesisReport } from '../../src/synth/index.js';
import { cloneRuleSet, fixtureExamplesById, loadSampleFiles, runFixture } from './helpers.js';

/** No internal reference the owner named should ever appear in the Summary. */
const INTERNAL_REFERENCE = /\bD2[0-9]\s?[a-z]?\b|modelSource|cross-construct negative|own examples/i;

function fakeSynthesis(overrides: Partial<SynthesisReport> = {}): SynthesisReport {
  return {
    languageId: 'toylang',
    compilerVersion: '0.1.0',
    generatedAt: '2026-09-26T00:00:00.000Z',
    status: 'completed',
    maxAttemptsPerConstruct: 3,
    lexical: { status: 'accepted', attempts: [] },
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
    ...overrides,
  };
}

/**
 * Builds a report shaped like the real `.lsc/g2/reject.report.*` run (docs/progress.md): one rejected
 * rule (`db-read`, WP-05's own breakage recipe) and one construct with no rule at all (`config-flag`,
 * removed from the Rule Set here the same way the model declining to propose one would leave it out of
 * `results.rules` — the construct still has examples, so it still appears in `results.coverage.constructs`).
 */
function rejectLikeReport() {
  const ruleSet = cloneRuleSet();
  const dbRead = ruleSet.rules.find((r) => r.id === 'db-read');
  if (dbRead?.engine !== 'regex') throw new Error('expected db-read to be regex');
  dbRead.regex = { ...dbRead.regex, multiline: false };
  ruleSet.rules = ruleSet.rules.filter((r) => r.id !== 'config-flag');

  const results = runFixture(ruleSet, loadSampleFiles());
  const synthesis = fakeSynthesis({
    summary: { constructs: 8, validated: 6, rejected: 1, notJustified: 1, skipped: 0, notAttempted: 0 },
    constructs: [
      {
        constructId: 'db-read',
        ruleType: 'db_read',
        status: 'rejected',
        ruleId: 'db-read',
        reason: 'no attempt passed within the cap of 3 attempt(s)',
        attempts: [
          { attempt: 1, requestHash: 'a'.repeat(64), outcome: 'failed-tests', problems: [], usage: { inputTokens: 1, outputTokens: 1 } },
          { attempt: 2, requestHash: 'b'.repeat(64), outcome: 'failed-tests', problems: [], usage: { inputTokens: 1, outputTokens: 1 } },
          { attempt: 3, requestHash: 'c'.repeat(64), outcome: 'failed-tests', problems: [], usage: { inputTokens: 1, outputTokens: 1 } },
        ],
      },
      {
        constructId: 'config-flag',
        status: 'not-justified',
        reason: 'the model proposed no rule',
        attempts: [{ attempt: 1, requestHash: 'd'.repeat(64), outcome: 'not-justified', problems: [], usage: { inputTokens: 1, outputTokens: 1 } }],
      },
    ],
  });
  return buildReport(results, { ruleSet, examplesById: fixtureExamplesById(), synthesis });
}

/**
 * WP-07 follow-up: a `synthesis.json` shaped like `lsc compile --previous` (src/synth/README.md
 * "Recompile" section) — every construct but `db-write` reused unchanged from `1.0.0`.
 */
function fakeReuseSynthesis(): SynthesisReport {
  const constructIds = ['module-declaration', 'proc-definition', 'call-statement', 'include-directive', 'db-read', 'db-write', 'config-flag', 'entry-point'];
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
    constructs: constructIds.map((constructId) =>
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

describe('buildReport summary (D28)', () => {
  it('a healthy, hand-written, still-draft Rule Set with unreviewed sample matches lists exactly the review, hand-written and export items, in order', () => {
    const results = { ...runFixture(undefined, loadSampleFiles()), ruleSetVersion: '0.0.0-draft' };
    const report = buildReport(results, { synthesis: fakeSynthesis() });

    expect(report.summary.status).toBe('action-needed');
    expect(report.summary.whatNext).toHaveLength(3);
    expect(report.summary.whatNext[0]).toMatch(/^Review the \d+ matches found in the sample repository: `lsc review …`$/);
    expect(report.summary.whatNext[1]).toBe('These results come from hand-written test answers; run with a real model before trusting them');
    expect(report.summary.whatNext[2]).toBe(
      'When everything above is done, export the Rule Set with `lsc export` (only exported Rule Sets go to Navigator)',
    );
  });

  it('a rejected rule and a not-justified construct produce exactly those two items first, in priority order, before review/hand-written/export', () => {
    const report = rejectLikeReport();

    expect(report.summary.status).toBe('rejected');
    expect(report.summary.whatNext[0]).toBe(
      'Rule `db-read` failed its examples after 3 attempts: improve or add examples in db-read.md, then run `lsc compile` again',
    );
    expect(report.summary.whatNext[1]).toBe(
      "The Skill files don't describe `config-flag` clearly enough to write a rule: expand config-flag.md",
    );
    expect(report.summary.whatNext.some((item) => item.startsWith('Review the'))).toBe(true);
    expect(report.summary.whatNext.some((item) => item.includes('hand-written test answers'))).toBe(true);
  });

  it('a validated, non-draft Rule Set with nothing to review and no synthesis has an empty "what to do next" and status "ready"', () => {
    // No sample files: nothing to review. Fixture version 1.0.0: not a draft. No --synthesis: no
    // "hand-written" clause to add either. Nothing is left to do.
    const report = buildReport(runFixture());
    expect(report.summary.status).toBe('ready');
    expect(report.summary.whatNext).toEqual([]);
    expect(report.summary.paragraphs.join(' ')).toContain('This Rule Set can be used.');
  });

  it('names the working and broken rules in plain language, with no internal reference (decision ids, "modelSource", "cross-construct negative", "own examples")', () => {
    const report = rejectLikeReport();
    const text = report.summary.paragraphs.join('\n');
    expect(text).toContain('`db-read`'); // broken rule named
    expect(text).toMatch(/rule.*tested against the examples in the Skill files/);
    expect(text).not.toMatch(INTERNAL_REFERENCE);
    expect(report.summary.whatNext.join('\n')).not.toMatch(INTERNAL_REFERENCE);
  });

  it('the Summary section renders before the Verdict section, in both formats', () => {
    const report = rejectLikeReport();
    const md = renderMarkdown(report);
    const html = renderHtml(report);
    expect(md.indexOf('## Summary')).toBeGreaterThanOrEqual(0);
    expect(md.indexOf('## Summary')).toBeLessThan(md.indexOf('## Verdict'));
    expect(html.indexOf('<div class="summary-box')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('<div class="summary-box')).toBeLessThan(html.indexOf('<div class="verdict-box'));
  });

  it('the rendered Summary (both formats) contains no internal reference either', () => {
    const report = rejectLikeReport();
    const md = renderMarkdown(report);
    const summarySectionMd = md.slice(md.indexOf('## Summary'), md.indexOf('## Verdict'));
    expect(summarySectionMd).not.toMatch(INTERNAL_REFERENCE);

    const html = renderHtml(report);
    const summarySectionHtml = html.slice(html.indexOf('<div class="summary-box'), html.indexOf('<div class="verdict-box'));
    expect(summarySectionHtml).not.toMatch(INTERNAL_REFERENCE);
  });

  // WP-07 follow-up: `lsc compile --previous` reuses unchanged rules (docs/progress.md "WP-10 compile
  // wiring"). The summary must name the recompile in plain words and keep "what to do next" correct.
  describe('recompile (--previous)', () => {
    it('mentions the recompile in plain words: reused count, rebuilt count and which construct(s) were rebuilt', () => {
      const report = buildReport(runFixture(), { synthesis: fakeReuseSynthesis() });
      expect(report.summary.paragraphs).toContain('Recompiled from version 1.0.0: 7 rules reused unchanged, 1 rule rebuilt (db-write).');
    });

    it('"what to do next" stays correct: nothing to review and every rule passing means an empty list and "ready"', () => {
      const report = buildReport(runFixture(), { synthesis: fakeReuseSynthesis() });
      expect(report.summary.whatNext).toEqual([]);
      expect(report.summary.status).toBe('ready');
    });

    it('says everything was rebuilt with --force, and names no reused rules', () => {
      const forced = fakeReuseSynthesis();
      const forcedSynthesis: SynthesisReport = {
        ...forced,
        reuse: { previousVersion: '1.0.0', force: true },
        summary: { ...forced.summary, reused: 0 },
        constructs: forced.constructs.map((c) => ({ ...c, reusedFrom: undefined, reuseNote: '--force' })),
      };
      const report = buildReport(runFixture(), { synthesis: forcedSynthesis });
      expect(report.summary.paragraphs).toContain("Recompiled from version 1.0.0 with `--force`: everything was rebuilt, nothing was reused.");
    });

    it('has no effect when synthesis.json has no reuse fields', () => {
      const report = buildReport(runFixture(), { synthesis: fakeSynthesis() });
      expect(report.summary.paragraphs.some((p) => p.includes('Recompiled from version'))).toBe(false);
    });
  });
});
