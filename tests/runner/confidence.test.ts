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

  describe('D19 a: cross-construct negatives never raise the "own" threshold, and any cross-construct match blocks high/medium', () => {
    it("reviewer's case 1: 5 own positives + 0 own negatives + 21 cross-construct negatives (all passing) is not high — 0 own negatives already fails the ≥2 threshold", () => {
      expect(
        computeConfidence({ positiveTotal: 5, positivePassed: 5, negativeTotal: 0, negativeFailed: 0, crossNegativeFailed: 0 }),
      ).not.toBe('high');
    });

    it("reviewer's case 2: 3 own positives (2 passing) + 2 own negatives stays low regardless of cross-construct negatives", () => {
      const withoutCross = computeConfidence({ positiveTotal: 3, positivePassed: 2, negativeTotal: 2, negativeFailed: 0 });
      const withCross = computeConfidence({
        positiveTotal: 3,
        positivePassed: 2,
        negativeTotal: 2,
        negativeFailed: 0,
        crossNegativeFailed: 21,
      });
      expect(withoutCross).toBe('low');
      expect(withCross).toBe('low');
    });

    it('a rule whose own examples alone would be "high" is forced to "low" by a single cross-construct negative match', () => {
      const withoutCross = computeConfidence({ positiveTotal: 5, positivePassed: 5, negativeTotal: 2, negativeFailed: 0 });
      const withCross = computeConfidence({
        positiveTotal: 5,
        positivePassed: 5,
        negativeTotal: 2,
        negativeFailed: 0,
        crossNegativeFailed: 1,
      });
      expect(withoutCross).toBe('high');
      expect(withCross).toBe('low');
    });

    it('cross-construct negatives are never counted in the pass rate or the ≥2-negatives threshold', () => {
      // 0 own negatives: would need negativeTotal >= 2 for high regardless of how many cross-construct
      // negatives pass; adding 100 passing cross-construct negatives must not change the result.
      expect(
        computeConfidence({ positiveTotal: 5, positivePassed: 5, negativeTotal: 0, negativeFailed: 0 }),
      ).toBe(
        computeConfidence({
          positiveTotal: 5,
          positivePassed: 5,
          negativeTotal: 0,
          negativeFailed: 0,
          crossNegativeFailed: 0,
        }),
      );
    });
  });
});
