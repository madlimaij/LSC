import { describe, expect, it } from 'vitest';
import type { SynthesisReport } from '../../src/synth/index.js';
import { buildSynthesisView, redactReviewProblem } from '../../src/report/synthesis-view.js';

function baseSynthesis(overrides: Partial<SynthesisReport> = {}): SynthesisReport {
  return {
    languageId: 'toylang',
    compilerVersion: '0.1.0',
    generatedAt: '2026-09-26T00:00:00.000Z',
    status: 'completed',
    maxAttemptsPerConstruct: 3,
    lexical: { status: 'accepted', attempts: [] },
    constructs: [],
    summary: { constructs: 0, validated: 0, rejected: 0, notJustified: 0, skipped: 0, notAttempted: 0 },
    usage: { inputTokens: 0, outputTokens: 0, calls: 0 },
    ingestDiagnostics: [],
    ...overrides,
  };
}

describe('redactReviewProblem', () => {
  it('leaves a non-review problem untouched', () => {
    const problem = 'call-01 (positive): missed line 3 callee="apply_discount"';
    expect(redactReviewProblem(problem)).toBe(problem);
  });

  it('withholds captured repository-sample text after the [review example] tag, keeping the id and tag', () => {
    const problem = 'review-db-read-002 (negative example of db-read) [review example]: unexpected match line 6 table="stock_levels"';
    const redacted = redactReviewProblem(problem);
    expect(redacted).toContain('review-db-read-002');
    expect(redacted).toContain('[review example]');
    expect(redacted).not.toContain('stock_levels'); // repository-sample text withheld
    expect(redacted).not.toContain('unexpected match line 6');
  });
});

describe('buildSynthesisView', () => {
  it('carries construct outcomes, attempt counts and redacts review-example problems in attempts', () => {
    const synthesis = baseSynthesis({
      constructs: [
        {
          constructId: 'db-read',
          ruleType: 'db_read',
          status: 'validated',
          ruleId: 'db-read',
          attempts: [
            {
              attempt: 1,
              requestHash: 'a'.repeat(64),
              outcome: 'failed-tests',
              problems: [
                'read-03 (positive): missed line 1 table="order_lines"',
                'review-db-read-002 (negative example of db-read) [review example]: unexpected match line 6 table="stock_levels"',
              ],
              usage: { inputTokens: 10, outputTokens: 5 },
            },
            { attempt: 2, requestHash: 'b'.repeat(64), outcome: 'passed', problems: [], usage: { inputTokens: 8, outputTokens: 4 } },
          ],
        },
        { constructId: 'entry-point', status: 'not-attempted', reason: 'compile aborted', attempts: [] },
      ],
      summary: { constructs: 2, validated: 1, rejected: 0, notJustified: 0, skipped: 0, notAttempted: 1 },
      usage: { inputTokens: 18, outputTokens: 9, calls: 2 },
    });

    const view = buildSynthesisView(synthesis);

    expect(view.status).toBe('completed');
    expect(view.usage).toEqual({ inputTokens: 18, outputTokens: 9, calls: 2 });
    expect(view.providerNote?.length).toBeGreaterThan(0); // never silently omitted (no modelSource on this fixture)

    const dbRead = view.constructs.find((c) => c.constructId === 'db-read');
    expect(dbRead?.status).toBe('validated');
    expect(dbRead?.attemptCount).toBe(2);
    expect(dbRead?.attempts).toHaveLength(2);
    const firstAttemptProblems = dbRead?.attempts[0]?.problems ?? [];
    expect(firstAttemptProblems[0]).toContain('table="order_lines"'); // non-review problem kept in full
    expect(firstAttemptProblems[1]).not.toContain('stock_levels'); // review problem redacted

    const entryPoint = view.constructs.find((c) => c.constructId === 'entry-point');
    expect(entryPoint?.status).toBe('not-attempted');
    expect(entryPoint?.reason).toBe('compile aborted');
    expect(entryPoint?.attemptCount).toBe(0);
  });

  // WP-07 follow-up: WP-10's `lsc compile --previous` reuse fields (docs/progress.md "WP-10 compile
  // wiring") must reach the report's view unchanged, so the renderers can show them.
  it('carries the top-level reuse info, a reused lexical status and per-construct reusedFrom/reuseNote', () => {
    const synthesis = baseSynthesis({
      reuse: { previousVersion: '1.0.0', force: false },
      lexical: {
        status: 'reused',
        reusedFrom: '1.0.0',
        reuseNote: 'general Skill file(s) unchanged since 1.0.0: language-basics.md',
        settings: { fileMatchers: ['**/*.tl'] },
        attempts: [],
      },
      constructs: [
        { constructId: 'db-write', status: 'validated', ruleId: 'db-write', reuseNote: 'Skill file(s) changed or new: db-write.md', attempts: [] },
        {
          constructId: 'db-read',
          status: 'validated',
          ruleId: 'db-read',
          reusedFrom: '1.0.0',
          reuseNote: 'Skill file(s) unchanged since 1.0.0: db-read.md',
          attempts: [],
        },
      ],
      summary: { constructs: 2, validated: 2, rejected: 0, notJustified: 0, skipped: 0, notAttempted: 0, reused: 1 },
    });

    const view = buildSynthesisView(synthesis);

    expect(view.reuse).toEqual({ previousVersion: '1.0.0', force: false });
    expect(view.lexicalStatus).toBe('reused');
    expect(view.lexicalReusedFrom).toBe('1.0.0');
    expect(view.lexicalReuseNote).toBe('general Skill file(s) unchanged since 1.0.0: language-basics.md');
    expect(view.summary.reused).toBe(1);

    const dbWrite = view.constructs.find((c) => c.constructId === 'db-write');
    expect(dbWrite?.reusedFrom).toBeUndefined();
    expect(dbWrite?.reuseNote).toBe('Skill file(s) changed or new: db-write.md');

    const dbRead = view.constructs.find((c) => c.constructId === 'db-read');
    expect(dbRead?.reusedFrom).toBe('1.0.0');
    expect(dbRead?.reuseNote).toBe('Skill file(s) unchanged since 1.0.0: db-read.md');
  });

  it('a synthesis.json without reuse fields produces a view without them', () => {
    const view = buildSynthesisView(baseSynthesis());
    expect(view.reuse).toBeUndefined();
    expect(view.lexicalReusedFrom).toBeUndefined();
    expect(view.lexicalReuseNote).toBeUndefined();
    expect(view.summary.reused).toBeUndefined();
  });
});
