/**
 * Runs one RE2 pattern over masked text and returns every non-overlapping
 * match with its 1-based line/column (contract/CONTRACT.md §6.4).
 */
import RE2 from 're2';
import { offsetToLineColumn } from './lines.js';

export interface RawMatch {
  readonly line: number;
  readonly column: number;
  readonly groups: Readonly<Record<string, string | undefined>>;
}

interface PatternConfig {
  readonly pattern: string;
  readonly flags: string;
}

function withGlobalFlag(flags: string): string {
  return flags.includes('g') ? flags : `${flags}g`;
}

/**
 * Iterates every match of an already-compiled RE2 in `text` left to right,
 * like a global search. Zero-length matches are ignored
 * (contract/CONTRACT.md §6.4); the scan still advances by one character so
 * it terminates.
 */
function* iterateMatches(re: RE2, text: string): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  let match = re.exec(text);
  while (match !== null) {
    if (match[0].length === 0) {
      re.lastIndex = match.index + 1;
      if (re.lastIndex > text.length) break;
      match = re.exec(text);
      continue;
    }
    yield match;
    match = re.exec(text);
  }
}

/**
 * `multiline: false`: the pattern runs on each line separately (no line
 * terminator). The pattern is compiled once and reused across every line —
 * compiling RE2 is comparatively expensive, and a file can have tens of
 * thousands of lines (WP-04 performance guard).
 */
export function runRegexPerLine(config: PatternConfig, lines: readonly string[]): RawMatch[] {
  const re = new RE2(config.pattern, withGlobalFlag(config.flags));
  const results: RawMatch[] = [];
  lines.forEach((lineText, index) => {
    for (const match of iterateMatches(re, lineText)) {
      results.push({ line: index + 1, column: match.index + 1, groups: match.groups ?? {} });
    }
  });
  return results;
}

/** `multiline: true`: the pattern runs once on the whole masked text. */
export function runRegexWholeText(
  config: PatternConfig,
  text: string,
  lineStarts: readonly number[],
): RawMatch[] {
  const re = new RE2(config.pattern, withGlobalFlag(config.flags));
  const results: RawMatch[] = [];
  for (const match of iterateMatches(re, text)) {
    const { line, column } = offsetToLineColumn(match.index, lineStarts);
    results.push({ line, column, groups: match.groups ?? {} });
  }
  return results;
}
