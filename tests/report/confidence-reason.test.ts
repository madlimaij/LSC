import { describe, expect, it } from 'vitest';
import { declaredMismatchNote, explainConfidence, type ConfidenceStats } from '../../src/report/confidence-reason.js';

describe('explainConfidence', () => {
  it('rejected: passes no positive example', () => {
    const stats: ConfidenceStats = { positiveTotal: 3, positivePassed: 0, negativeTotal: 2, negativeFailed: 0, crossNegativeFailed: 0 };
    expect(explainConfidence(stats, undefined)).toMatch(/^rejected/);
    expect(explainConfidence(stats, undefined)).toContain('passes no positive example');
  });

  it('low: cross-construct negative failures override everything else', () => {
    const stats: ConfidenceStats = { positiveTotal: 6, positivePassed: 6, negativeTotal: 3, negativeFailed: 0, crossNegativeFailed: 1 };
    const reason = explainConfidence(stats, 'low');
    expect(reason).toMatch(/^low/);
    expect(reason).toContain('cross-construct');
  });

  it('high: meets all thresholds', () => {
    const stats: ConfidenceStats = { positiveTotal: 5, positivePassed: 5, negativeTotal: 2, negativeFailed: 0, crossNegativeFailed: 0 };
    const reason = explainConfidence(stats, 'high');
    expect(reason).toMatch(/^high/);
    expect(reason).toContain('5/5');
  });

  it('medium: names which high threshold was missed (too few positive examples)', () => {
    const stats: ConfidenceStats = { positiveTotal: 3, positivePassed: 3, negativeTotal: 2, negativeFailed: 0, crossNegativeFailed: 0 };
    const reason = explainConfidence(stats, 'medium');
    expect(reason).toMatch(/^medium/);
    expect(reason).toContain('only 3 positive examples (high needs ≥5)');
  });

  it('medium: names which high threshold was missed (a positive example failed)', () => {
    const stats: ConfidenceStats = { positiveTotal: 6, positivePassed: 5, negativeTotal: 2, negativeFailed: 0, crossNegativeFailed: 0 };
    const reason = explainConfidence(stats, 'medium');
    expect(reason).toContain('1 positive example failed (high needs 100%)');
  });

  it('low: names which medium threshold was missed (pass rate too low)', () => {
    const stats: ConfidenceStats = { positiveTotal: 4, positivePassed: 3, negativeTotal: 2, negativeFailed: 0, crossNegativeFailed: 0 };
    const reason = explainConfidence(stats, 'low');
    expect(reason).toMatch(/^low/);
    expect(reason).toContain('pass rate is');
    expect(reason).toContain('(medium needs ≥90%)');
  });

  it('low: names which medium threshold was missed (a negative example failed)', () => {
    const stats: ConfidenceStats = { positiveTotal: 5, positivePassed: 5, negativeTotal: 2, negativeFailed: 1, crossNegativeFailed: 0 };
    const reason = explainConfidence(stats, 'low');
    expect(reason).toContain('1 own negative example failed (medium needs none failing)');
  });
});

describe('declaredMismatchNote', () => {
  it('undefined when declared matches computed', () => {
    expect(declaredMismatchNote({ declaredConfidence: 'high', computedConfidence: 'high', confidenceMatchesDeclared: true })).toBeUndefined();
  });

  it('a message naming both values when they differ', () => {
    const note = declaredMismatchNote({ declaredConfidence: 'high', computedConfidence: 'low', confidenceMatchesDeclared: false });
    expect(note).toContain('"high"');
    expect(note).toContain('"low"');
  });
});
