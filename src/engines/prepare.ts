/**
 * File preparation (WP-04): builds the two masked views of a file once, so
 * every rule can be matched against them without re-scanning the text.
 */
import { computeLineStarts, normalizeLineEndings, splitLines } from './lines.js';
import { maskText, type CommentStringConfig } from './masking.js';

export interface MaskedView {
  readonly text: string;
  readonly lines: readonly string[];
}

export interface PreparedFile {
  /** `\r\n` normalised to `\n`, otherwise the original text, unmasked. */
  readonly normalizedText: string;
  /** Offset each line starts at in `normalizedText` (and both masked views: masking never moves a newline). */
  readonly lineStarts: readonly number[];
  /** Comments and string literals blanked (contract/CONTRACT.md §6.3 "full mask"). Used unless `searchStrings: true`. */
  readonly fullMask: MaskedView;
  /** Only comments blanked, strings kept verbatim ("comment mask"). Used when `searchStrings: true`. */
  readonly commentMask: MaskedView;
}

/** Prepares one file's text for matching against a Rule Set's masking configuration. */
export function prepareFile(config: CommentStringConfig, rawText: string): PreparedFile {
  const normalizedText = normalizeLineEndings(rawText);
  const lineStarts = computeLineStarts(normalizedText);
  const fullMaskText = maskText(normalizedText, config, true);
  const commentMaskText = maskText(normalizedText, config, false);
  return {
    normalizedText,
    lineStarts,
    fullMask: { text: fullMaskText, lines: splitLines(fullMaskText) },
    commentMask: { text: commentMaskText, lines: splitLines(commentMaskText) },
  };
}
