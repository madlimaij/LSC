/**
 * Pure logic behind `lsc review` (WP-07 brief): which sample matches still
 * need a verdict, and how a verdict turns into a `reviews.yaml` entry
 * (D9, D15). Kept free of terminal I/O so it can be unit-tested by feeding
 * it a fixed sequence of answers, and reused unchanged by the interactive
 * CLI (`src/cli/commands/review.ts`).
 */
import type { ReviewEntry, ReviewVerdict } from '../examples/index.js';
import type { Results, RuleResult, SampleMatch } from '../runner/index.js';

export interface UnreviewedMatch {
  readonly ruleId: string;
  readonly construct: string;
  readonly match: SampleMatch;
}

/** The construct a rule's sample match should be filed under: its own examples' construct, or the rule type as a fallback. */
export function deriveConstruct(rule: Pick<RuleResult, 'type' | 'examples'>): string {
  const ownConstructs = [...new Set(rule.examples.filter((example) => example.role === 'own').map((example) => example.construct))].sort();
  if (ownConstructs.length > 0 && ownConstructs[0] !== undefined) return ownConstructs[0];
  return rule.type.replace(/_/g, '-');
}

/**
 * Every unlabelled sample match across every rule, in a stable order
 * (`Results.rules` order, then the order `runRules` recorded matches in).
 * `runRules` already excludes matches an earlier review recorded (D9), so
 * every match here genuinely still needs a verdict.
 */
export function collectUnreviewedMatches(results: Results): UnreviewedMatch[] {
  const items: UnreviewedMatch[] = [];
  for (const rule of results.rules) {
    const construct = deriveConstruct(rule);
    for (const match of rule.sampleMatches) {
      items.push({ ruleId: rule.ruleId, construct, match });
    }
  }
  return items;
}

/** Builds a `(construct) -> next id` generator that avoids every id already in `existing` (review-<construct>-<n>, D15). */
export function makeIdGenerator(existing: readonly ReviewEntry[]): (construct: string) => string {
  const nextByConstruct = new Map<string, number>();
  const idPattern = /^review-(.+)-(\d+)$/;
  for (const entry of existing) {
    const match = idPattern.exec(entry.id);
    if (match === null) continue;
    const [, construct, digits] = match;
    if (construct === undefined || digits === undefined) continue;
    const n = Number.parseInt(digits, 10);
    const current = nextByConstruct.get(construct) ?? 0;
    if (n >= current) nextByConstruct.set(construct, n + 1);
  }
  return (construct: string): string => {
    const n = nextByConstruct.get(construct) ?? 1;
    nextByConstruct.set(construct, n + 1);
    return `review-${construct}-${String(n).padStart(3, '0')}`;
  };
}

/** The single line of sample text the match is on, or '' if the snippet did not include it (should not happen). */
export function matchedLineText(match: SampleMatch): string {
  return match.snippet.find((line) => line.line === match.line)?.text ?? '';
}

export interface BuildReviewEntryOptions {
  readonly note?: string;
  readonly now?: () => string;
}

/**
 * Turns one decided sample match into a `reviews.yaml` entry (D9, D15,
 * src/examples/README.md "reviews.yaml"). `code` is the single matched
 * line, the README's recommended choice: it contains the reviewed match
 * and nothing else that could make the example fail for an unrelated
 * reason. `verdict: correct` records the match's own captures as the
 * expected match; a reviewer who disagrees with a capture should choose
 * `false positive` instead (or edit `reviews.yaml` afterwards).
 */
export function buildReviewEntry(
  item: UnreviewedMatch,
  ruleType: RuleResult['type'],
  verdict: ReviewVerdict,
  id: string,
  options: BuildReviewEntryOptions = {},
): ReviewEntry {
  const code = matchedLineText(item.match);
  const base = {
    id,
    construct: item.construct,
    ruleId: item.ruleId,
    verdict,
    sampleFile: item.match.file,
    sampleLine: item.match.line,
    code,
    ...(options.now !== undefined ? { reviewedAt: options.now() } : {}),
    ...(options.note !== undefined ? { note: options.note } : {}),
  };
  if (verdict === 'correct') {
    return { ...base, expected: [{ line: 1, type: ruleType, captures: item.match.captures }] };
  }
  return base;
}

/** One answer to a review prompt, parsed from free text (accepts the letter or the full word). */
export function parseAnswer(raw: string): ReviewVerdict | 'skip' | 'quit' | undefined {
  const answer = raw.trim().toLowerCase();
  if (answer === 'c' || answer === 'correct') return 'correct';
  if (answer === 'f' || answer === 'false' || answer === 'false_positive' || answer === 'false positive') return 'false_positive';
  if (answer === 's' || answer === 'skip' || answer === '') return 'skip';
  if (answer === 'q' || answer === 'quit') return 'quit';
  return undefined;
}

export interface ReviewSessionCallbacks {
  /** Asks for a verdict on one match; returns the raw text typed (parsed with `parseAnswer`). */
  readonly ask: (item: UnreviewedMatch, index: number, total: number) => Promise<string>;
  /** Called after each new entry is appended, so a caller can persist progress incrementally. */
  readonly onRecorded?: (entries: readonly ReviewEntry[]) => void;
  /** Called when an answer could not be recorded (unrecognised, blank matched line, or an unknown rule id), with why. */
  readonly onSkipped?: (item: UnreviewedMatch, reason: string) => void;
}

export interface ReviewSessionResult {
  readonly entries: ReviewEntry[];
  readonly correct: number;
  readonly falsePositive: number;
  readonly skipped: number;
  /** True when the session ended because the reviewer asked to quit, rather than running out of matches. */
  readonly quit: boolean;
}

export interface ReviewSessionOptions {
  readonly now?: () => string;
}

/**
 * Drives one review session end to end: asks about every unreviewed sample
 * match in `results` (via `callbacks.ask`) and turns each answer into a
 * `reviews.yaml` entry. Free of terminal I/O, so `src/cli/commands/review.ts`
 * supplies a `readline`-backed `ask` and tests supply a scripted one.
 */
export async function runReviewSession(
  results: Results,
  existingEntries: readonly ReviewEntry[],
  callbacks: ReviewSessionCallbacks,
  options: ReviewSessionOptions = {},
): Promise<ReviewSessionResult> {
  const matches = collectUnreviewedMatches(results);
  const typeByRuleId = new Map<string, RuleResult['type']>(results.rules.map((rule) => [rule.ruleId, rule.type]));
  const nextId = makeIdGenerator(existingEntries);
  const entries: ReviewEntry[] = [...existingEntries];
  let correct = 0;
  let falsePositive = 0;
  let skipped = 0;
  let quit = false;

  for (const [index, item] of matches.entries()) {
    const raw = await callbacks.ask(item, index, matches.length);
    const verdict = parseAnswer(raw);
    if (verdict === undefined) {
      callbacks.onSkipped?.(item, `not understood (${JSON.stringify(raw)})`);
      skipped += 1;
      continue;
    }
    if (verdict === 'quit') {
      quit = true;
      break;
    }
    if (verdict === 'skip') {
      skipped += 1;
      continue;
    }
    if (matchedLineText(item.match).trim() === '') {
      callbacks.onSkipped?.(item, 'its line has no text (unexpected)');
      skipped += 1;
      continue;
    }
    const ruleType = typeByRuleId.get(item.ruleId);
    if (ruleType === undefined) {
      callbacks.onSkipped?.(item, `rule ${item.ruleId} is missing from the results`);
      skipped += 1;
      continue;
    }
    const id = nextId(item.construct);
    const entry = buildReviewEntry(item, ruleType, verdict, id, options.now !== undefined ? { now: options.now } : {});
    entries.push(entry);
    if (verdict === 'correct') correct += 1;
    else falsePositive += 1;
    callbacks.onRecorded?.(entries);
  }

  return { entries, correct, falsePositive, skipped, quit };
}
