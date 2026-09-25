/**
 * Comment and string-literal masking (contract/CONTRACT.md §6.3).
 *
 * Masking replaces comment and string-literal text with spaces so keywords
 * inside them never match, while keeping every newline so line numbers never
 * move and every other character in place so columns never move either.
 *
 * Two views are produced per file (see {@link maskText}'s `maskStrings`):
 * - full mask (`maskStrings: true`): comments and strings become spaces;
 * - comment mask (`maskStrings: false`, for rules with `searchStrings: true`):
 *   only comments become spaces, strings are kept verbatim.
 *
 * String detection always runs (so a comment marker inside a string is still
 * not treated as a comment), it just decides differently whether to blank
 * the string's characters in the output.
 */
import type { DelimiterPair } from '../contract/index.js';

/** The three optional masking fields of a Rule Set (docs/PLAN.md §5.1). */
export interface CommentStringConfig {
  readonly lineComment?: string | undefined;
  readonly blockComment?: DelimiterPair | undefined;
  readonly stringDelimiters?: readonly DelimiterPair[] | undefined;
}

type Candidate =
  | { readonly length: number; readonly order: number; readonly kind: 'block'; readonly delimiter: DelimiterPair }
  | { readonly length: number; readonly order: number; readonly kind: 'line' }
  | { readonly length: number; readonly order: number; readonly kind: 'string'; readonly delimiter: DelimiterPair };

/**
 * Masks `normalizedText` (already `\r\n` → `\n` normalised) per
 * contract/CONTRACT.md §6.3. `maskStrings` selects the full mask (`true`) or
 * the comment mask (`false`).
 */
export function maskText(
  normalizedText: string,
  config: CommentStringConfig,
  maskStrings: boolean,
): string {
  const { lineComment, blockComment, stringDelimiters = [] } = config;
  const n = normalizedText.length;
  const out = normalizedText.split('');
  let i = 0;

  while (i < n) {
    const candidates: Candidate[] = [];
    if (blockComment !== undefined && normalizedText.startsWith(blockComment.start, i)) {
      candidates.push({ length: blockComment.start.length, order: 0, kind: 'block', delimiter: blockComment });
    }
    if (lineComment !== undefined && normalizedText.startsWith(lineComment, i)) {
      candidates.push({ length: lineComment.length, order: 1, kind: 'line' });
    }
    stringDelimiters.forEach((delimiter, index) => {
      if (normalizedText.startsWith(delimiter.start, i)) {
        candidates.push({ length: delimiter.start.length, order: 2 + index, kind: 'string', delimiter });
      }
    });

    candidates.sort((a, b) => b.length - a.length || a.order - b.order);
    const [chosen] = candidates;

    if (chosen === undefined) {
      i += 1;
      continue;
    }

    if (chosen.kind === 'block') {
      const endIndex = normalizedText.indexOf(chosen.delimiter.end, i + chosen.delimiter.start.length);
      const regionEnd = endIndex === -1 ? n : endIndex + chosen.delimiter.end.length;
      blank(out, i, regionEnd);
      i = regionEnd;
      continue;
    }

    if (chosen.kind === 'line') {
      const newline = normalizedText.indexOf('\n', i);
      const regionEnd = newline === -1 ? n : newline;
      blank(out, i, regionEnd);
      i = regionEnd;
      continue;
    }

    // string
    const newline = normalizedText.indexOf('\n', i);
    const lineEnd = newline === -1 ? n : newline;
    const endIndex = normalizedText.indexOf(chosen.delimiter.end, i + chosen.delimiter.start.length);
    const regionEnd =
      endIndex === -1 || endIndex + chosen.delimiter.end.length > lineEnd ? lineEnd : endIndex + chosen.delimiter.end.length;
    if (maskStrings) blank(out, i, regionEnd);
    i = regionEnd;
  }

  return out.join('');
}

function blank(chars: string[], start: number, end: number): void {
  for (let j = start; j < end; j += 1) {
    if (chars[j] !== '\n') chars[j] = ' ';
  }
}
