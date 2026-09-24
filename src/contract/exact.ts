/**
 * Normative definition of the `exact` engine (contract/CONTRACT.md §6.4).
 *
 * An exact rule is a token sequence. Its meaning is defined as an equivalent
 * RE2 regular expression, built by `exactToRegex`, applied per line exactly
 * like a regex rule with `multiline: false`. Navigator may reimplement the
 * engine any way it likes, as long as it matches what this function produces.
 */

/** Characters a capture placeholder matches, and what counts as a "word" character. */
export const WORD_CHAR_CLASS = '[0-9A-Za-z_]';

/** Separator allowed between consecutive tokens: spaces and tabs, possibly none. */
export const TOKEN_SEPARATOR = '[ \\t]*';

/** Capture group names, in regex patterns and exact placeholders. */
export const GROUP_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A token that is exactly `(?<name>)` is a capture placeholder. */
const PLACEHOLDER_PATTERN = /^\(\?<([A-Za-z_][A-Za-z0-9_]*)>\)$/;

const WORD_CHAR = /^[0-9A-Za-z_]$/;

export type ExactToken =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'placeholder'; readonly name: string };

export function parseExactToken(token: string): ExactToken {
  const placeholder = PLACEHOLDER_PATTERN.exec(token);
  if (placeholder?.[1] !== undefined) return { kind: 'placeholder', name: placeholder[1] };
  return { kind: 'literal', text: token };
}

/** Escapes every RE2 metacharacter so the text matches literally. */
export function quoteRegex(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

function tokenSource(token: ExactToken): string {
  if (token.kind === 'placeholder') {
    return `\\b(?<${token.name}>${WORD_CHAR_CLASS}+)\\b`;
  }
  const { text } = token;
  const start = isWordChar(text[0]) ? '\\b' : '';
  const end = isWordChar(text[text.length - 1]) ? '\\b' : '';
  return `${start}${quoteRegex(text)}${end}`;
}

export interface ExactConfigLike {
  readonly tokens: readonly string[];
  readonly caseSensitive: boolean;
}

export interface EquivalentRegex {
  readonly pattern: string;
  readonly flags: string;
}

/**
 * Builds the RE2 regex an exact rule is equivalent to:
 * - literal token → the text, escaped; `\b` before it if it starts with a word
 *   character, `\b` after it if it ends with one;
 * - placeholder `(?<name>)` → `\b(?<name>[0-9A-Za-z_]+)\b`;
 * - tokens joined by `[ \t]*`;
 * - flag `i` when `caseSensitive` is false.
 */
export function exactToRegex(config: ExactConfigLike): EquivalentRegex {
  const pattern = config.tokens.map((t) => tokenSource(parseExactToken(t))).join(TOKEN_SEPARATOR);
  return { pattern, flags: config.caseSensitive ? '' : 'i' };
}

/** Placeholder names in token order (duplicates kept, so callers can detect them). */
export function exactPlaceholderNames(tokens: readonly string[]): string[] {
  const names: string[] = [];
  for (const token of tokens) {
    const parsed = parseExactToken(token);
    if (parsed.kind === 'placeholder') names.push(parsed.name);
  }
  return names;
}
