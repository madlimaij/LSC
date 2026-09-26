/**
 * Line handling shared by every engine (contract/CONTRACT.md §6.2).
 *
 * Lines are 1-based and separated by `\n`. A `\r` at the end of a line is not
 * part of the line; the normaliser below removes it up front (by turning
 * every `\r\n` into `\n`, and also stripping a trailing `\r` that ends the
 * file with no following `\n`) so every later step — masking, per-line
 * matching, whole-text matching, offset-to-line/column conversion — works on
 * one consistent text and never re-derives line numbers differently.
 */

/**
 * Turns `\r\n` into `\n`, and strips a lone `\r` at the very end of the
 * text (the last line of a file with no trailing `\n`). Lone `\r` elsewhere
 * (old Mac line endings mid-file) is left alone: the contract only specifies
 * line ends, and only `\r\n` and end-of-file `\r` are unambiguously line ends
 * here since lines are otherwise separated by `\n`.
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r$/, '');
}

/** Splits already-normalised text into lines (no `\r`, separated by `\n`). */
export function splitLines(normalizedText: string): string[] {
  return normalizedText.split('\n');
}

/** Character offset (UTF-16 code unit, 0-based) each line starts at, for `normalizedText`. */
export function computeLineStarts(normalizedText: string): number[] {
  const starts = [0];
  for (let i = 0; i < normalizedText.length; i += 1) {
    if (normalizedText[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

export interface LineColumn {
  readonly line: number;
  readonly column: number;
}

/**
 * Converts a 0-based character offset into `normalizedText` to a 1-based
 * line and column, using the line-start table from {@link computeLineStarts}.
 */
export function offsetToLineColumn(offset: number, lineStarts: readonly number[]): LineColumn {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((lineStarts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  const lineStart = lineStarts[low] ?? 0;
  return { line: low + 1, column: offset - lineStart + 1 };
}
