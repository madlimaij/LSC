/**
 * Parses a fenced code block's info string (the text after the language tag)
 * into `key=value` pairs, per docs/PLAN.md §6.1:
 * `toylang example=positive construct=proc-definition id=proc-01`.
 */

const KEY_VALUE = /^([A-Za-z][A-Za-z0-9_]*)=(\S+)$/;

export interface InfoStringResult {
  /** `key=value` pairs found, in order; later duplicates win, like a query string. */
  readonly fields: Readonly<Record<string, string>>;
  /** Tokens that were not a valid `key=value` pair, in order. */
  readonly malformed: readonly string[];
}

/** `meta` is the mdast `code` node's `meta` field (everything after the language tag), or `null`. */
export function parseInfoString(meta: string | null | undefined): InfoStringResult {
  const fields: Record<string, string> = {};
  const malformed: string[] = [];
  const tokens = (meta ?? '').trim().split(/\s+/).filter((t) => t !== '');
  for (const token of tokens) {
    const match = KEY_VALUE.exec(token);
    if (match === null) {
      malformed.push(token);
      continue;
    }
    const [, key, value] = match;
    fields[key as string] = value as string;
  }
  return { fields, malformed };
}
