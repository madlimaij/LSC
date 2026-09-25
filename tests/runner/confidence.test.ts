import { describe, expect, it } from 'vitest';
import { computeConfidence } from '../../src/runner/index.js';

describe('computeConfidence (docs/PLAN.md §6.3, D8)', () => {
  it('high: at least 5 positive and 2 negative examples, 100% pass', () => {
    expect(
      computeConfidence({ positiveTotal: 5, positivePassed: 5, negativeTotal: 2, negativeFailed: 0 }),
    ).toBe('high');
    expect(
      computeConfidence({ positiveTotal: 7, positivePassed: 7, negativeTotal: 20, negativeFailed: 0 }),
    ).toBe('high');
  });

  it('one failing positive drops "high" to "medium" or "low" even with enough examples', () => {
    expect(
      computeConfidence({ positiveTotal: 5, positivePassed: 4, negativeTotal: 2, negativeFailed: 0 }),
    ).not.toBe('high');
  });

  it('one failing negative drops "high" to "low"', () => {
    expect(
      computeConfidence({ positiveTotal: 5, positivePassed: 5, negativeTotal: 2, negativeFailed: 1 }),
    ).toBe('low');
  });

  it('medium: at least 3 positive, at least 90% pass, no failing negative', () => {
    // 9 passed of 10 total = 90%.
    expect(
      computeConfidence({ positiveTotal: 9, positivePassed: 8, negativeTotal: 1, negativeFailed: 0 }),
    ).toBe('medium');
  });

  it('a failing negative excludes medium even at a high pass rate', () => {
    expect(
      computeConfidence({ positiveTotal: 9, positivePassed: 9, negativeTotal: 1, negativeFailed: 1 }),
    ).toBe('low');
  });

  it('below 90% pass with enough positives is low, not medium', () => {
    expect(
      computeConfidence({ positiveTotal: 4, positivePassed: 3, negativeTotal: 0, negativeFailed: 0 }),
    ).toBe('low');
  });

  it('fewer than 3 positive examples is never medium or high', () => {
    expect(
      computeConfidence({ positiveTotal: 2, positivePassed: 2, negativeTotal: 5, negativeFailed: 0 }),
    ).toBe('low');
  });

  it('low: passes at least one positive example but nothing else qualifies', () => {
    expect(
      computeConfidence({ positiveTotal: 1, positivePassed: 1, negativeTotal: 0, negativeFailed: 0 }),
    ).toBe('low');
  });

  it('undefined: passes no positive example at all (candidate for rejection)', () => {
    expect(
      computeConfidence({ positiveTotal: 5, positivePassed: 0, negativeTotal: 2, negativeFailed: 0 }),
    ).toBeUndefined();
    expect(
      computeConfidence({ positiveTotal: 0, positivePassed: 0, negativeTotal: 0, negativeFailed: 0 }),
    ).toBeUndefined();
  });
});
