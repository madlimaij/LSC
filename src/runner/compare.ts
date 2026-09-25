/**
 * Compares one rule's matches on one example's code against that example's
 * expected matches (docs/PLAN.md §6.2):
 *
 * "A positive example passes when every expected match is found on the
 * stated line with identical captures, and no extra match of that rule
 * appears. A negative example passes when the rule produces no match."
 */
import type { CaptureRole } from '../contract/index.js';
import type { Match } from '../engines/index.js';
import type { ExpectedMatch } from '../examples/index.js';
import type { CaptureMismatch, MatchCaptures, MatchSummary, WrongCapture } from './results-schema.js';

export interface ExampleDiff {
  readonly passed: boolean;
  readonly missed: ExpectedMatch[];
  readonly unexpected: MatchSummary[];
  readonly wrongCaptures: WrongCapture[];
}

function captureRoles(captures: MatchCaptures): CaptureRole[] {
  return Object.keys(captures) as CaptureRole[];
}

function capturesEqual(a: MatchCaptures, b: MatchCaptures): boolean {
  const aRoles = captureRoles(a);
  const bRoles = captureRoles(b);
  if (aRoles.length !== bRoles.length) return false;
  return aRoles.every((role) => a[role] === b[role]);
}

function diffCaptures(expected: MatchCaptures, actual: MatchCaptures): CaptureMismatch[] {
  const roles = new Set<CaptureRole>([...captureRoles(expected), ...captureRoles(actual)]);
  const mismatches: CaptureMismatch[] = [];
  for (const role of roles) {
    const expectedValue = expected[role];
    const actualValue = actual[role];
    if (expectedValue === actualValue) continue;
    mismatches.push({
      role,
      ...(expectedValue !== undefined ? { expected: expectedValue } : {}),
      ...(actualValue !== undefined ? { actual: actualValue } : {}),
    });
  }
  return mismatches;
}

/**
 * `expected` are the example's expected matches (empty for a negative
 * example); `actual` are `matchRule`'s matches on that example's code.
 *
 * Expected matches are paired with actual matches that share their line: an
 * exact capture match first (order-independent, so several matches sharing a
 * line — plan trap T10 — pair correctly regardless of order); otherwise the
 * first unclaimed actual match on that line is a wrong-capture pairing;
 * otherwise the expected match is missed. Actual matches left unclaimed are
 * unexpected.
 */
export function diffExample(expected: readonly ExpectedMatch[], actual: readonly Match[]): ExampleDiff {
  const remaining = actual.map((match) => ({ line: match.line, column: match.column, captures: match.captures }));
  const consumed = new Set<number>();
  const missed: ExpectedMatch[] = [];
  const wrongCaptures: WrongCapture[] = [];

  for (const expectedMatch of expected) {
    const exactIndex = remaining.findIndex(
      (candidate, index) =>
        !consumed.has(index) && candidate.line === expectedMatch.line && capturesEqual(candidate.captures, expectedMatch.captures),
    );
    if (exactIndex !== -1) {
      consumed.add(exactIndex);
      continue;
    }
    const sameLineIndex = remaining.findIndex((candidate, index) => !consumed.has(index) && candidate.line === expectedMatch.line);
    if (sameLineIndex !== -1) {
      consumed.add(sameLineIndex);
      const actualMatch = remaining[sameLineIndex];
      if (actualMatch !== undefined) {
        wrongCaptures.push({
          line: expectedMatch.line,
          expectedCaptures: expectedMatch.captures,
          actualCaptures: actualMatch.captures,
          mismatches: diffCaptures(expectedMatch.captures, actualMatch.captures),
        });
      }
      continue;
    }
    missed.push(expectedMatch);
  }

  const unexpected: MatchSummary[] = remaining
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ index }) => !consumed.has(index))
    .map(({ candidate }) => ({ line: candidate.line, column: candidate.column, captures: candidate.captures }));

  const passed = missed.length === 0 && wrongCaptures.length === 0 && unexpected.length === 0;
  return { passed, missed, unexpected, wrongCaptures };
}
