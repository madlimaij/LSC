/**
 * Pure logic behind `lsc review` (WP-07 brief): which sample matches still
 * need a verdict, and how a verdict turns into a `reviews.yaml` entry
 * (D9, D15). Kept free of terminal I/O so it can be unit-tested by feeding
 * it a fixed sequence of answers, and reused unchanged by the interactive
 * CLI (`src/cli/commands/review.ts`).
 */
import type { Rule, RuleSet } from '../contract/index.js';
import type { CommentStringConfig } from '../engines/index.js';
import type { ReviewEntry, ReviewVerdict } from '../examples/index.js';
import type { Results, RuleResult, SampleMatch } from '../runner/index.js';
import { computeMatchSpan } from './match-span.js';

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

export type BuildReviewEntryResult = { readonly ok: true; readonly entry: ReviewEntry } | { readonly ok: false; readonly reason: string };

function captureKey(captures: Readonly<Record<string, string | undefined>>): string {
  return JSON.stringify(Object.entries(captures).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * Turns one decided sample match into a `reviews.yaml` entry (D9, D15,
 * src/examples/README.md §4). `code` is the lines the match *spans*
 * (`computeMatchSpan`, src/report/match-span.ts) — usually one line, but a
 * whole-text rule can match text continued onto a later line (db-read's
 * trap T8). Other matches of the same rule on those lines are handled per
 * README §4: for `correct`, every one of them (including this one) is
 * listed in `expected`, sorted by line then capture; for `false_positive`,
 * any *other* match of the same rule on those lines makes the example
 * impossible to write as a negative (D16 h: "a negative example must
 * contain no match of any construct"), so this refuses rather than writing
 * an entry that a correct rule would then fail.
 */
export function buildReviewEntry(
  item: UnreviewedMatch,
  rule: Rule,
  maskingConfig: CommentStringConfig,
  fileText: string,
  verdict: ReviewVerdict,
  id: string,
  options: BuildReviewEntryOptions = {},
): BuildReviewEntryResult {
  const found = computeMatchSpan(rule, maskingConfig, fileText, item.match.line, item.match.column);
  if (found === undefined) {
    return {
      ok: false,
      reason: `rule "${rule.id}" no longer matches ${item.match.file}:${String(item.match.line)}:${String(item.match.column)} — has the sample file or the Rule Set changed since this match was recorded?`,
    };
  }
  const { span, sameRuleMatches } = found;
  const isSelf = (m: { line: number; column: number }): boolean => m.line === item.match.line && m.column === item.match.column;
  const others = sameRuleMatches.filter((m) => !isSelf(m));

  if (verdict === 'false_positive' && others.length > 0) {
    const where = others.map((m) => `${String(m.line)}:${String(m.column)}`).join(', ');
    return {
      ok: false,
      reason:
        `line${span.startLine === span.endLine ? ` ${String(span.startLine)}` : `s ${String(span.startLine)}-${String(span.endLine)}`} ` +
        `of ${item.match.file} also matched by rule "${rule.id}" at ${where}; a negative example must contain no match of any ` +
        `construct (src/examples/README.md §4, D16 h) — review those matches too, or edit reviews.yaml by hand to narrow the snippet`,
    };
  }

  const lines = fileText.replace(/\r\n/g, '\n').split('\n');
  const code = lines.slice(span.startLine - 1, span.endLine).join('\n');
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
    const expected = [...sameRuleMatches]
      .sort((a, b) => a.line - b.line || captureKey(a.captures).localeCompare(captureKey(b.captures)))
      .map((m) => ({ line: m.line - span.startLine + 1, type: rule.type, captures: m.captures }));
    return { ok: true, entry: { ...base, expected } };
  }
  return { ok: true, entry: base };
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

export interface ReviewSessionContext {
  /** The Rule Set the sample scan ran with (gives each rule's pattern/masking, needed to recompute a match's span, src/report/match-span.ts). */
  readonly ruleSet: RuleSet;
  /** Reads a sample file's raw text by its repository-relative path (`SampleMatch.file`); `undefined` if it cannot be read. */
  readonly readSampleFile: (file: string) => string | undefined;
}

/**
 * Drives one review session end to end: asks about every unreviewed sample
 * match in `results` (via `callbacks.ask`) and turns each answer into a
 * `reviews.yaml` entry via `buildReviewEntry` (which needs `context` to
 * recompute the match's line span and check for other same-rule matches on
 * those lines, src/examples/README.md §4). Free of terminal I/O, so
 * `src/cli/commands/review.ts` supplies a `readline`-backed `ask` and tests
 * supply a scripted one.
 */
export async function runReviewSession(
  results: Results,
  existingEntries: readonly ReviewEntry[],
  context: ReviewSessionContext,
  callbacks: ReviewSessionCallbacks,
  options: ReviewSessionOptions = {},
): Promise<ReviewSessionResult> {
  const matches = collectUnreviewedMatches(results);
  const ruleById = new Map<string, Rule>(context.ruleSet.rules.map((rule) => [rule.id, rule]));
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
    const rule = ruleById.get(item.ruleId);
    if (rule === undefined) {
      callbacks.onSkipped?.(item, `rule ${item.ruleId} is not in the given Rule Set`);
      skipped += 1;
      continue;
    }
    const fileText = context.readSampleFile(item.match.file);
    if (fileText === undefined) {
      callbacks.onSkipped?.(item, `sample file ${item.match.file} could not be read (pass --sample <dir>, the one used to produce these results)`);
      skipped += 1;
      continue;
    }
    const id = nextId(item.construct);
    const built = buildReviewEntry(item, rule, context.ruleSet, fileText, verdict, id, options.now !== undefined ? { now: options.now } : {});
    if (!built.ok) {
      callbacks.onSkipped?.(item, built.reason);
      skipped += 1;
      continue;
    }
    entries.push(built.entry);
    if (verdict === 'correct') correct += 1;
    else falsePositive += 1;
    callbacks.onRecorded?.(entries);
  }

  return { entries, correct, falsePositive, skipped, quit };
}
