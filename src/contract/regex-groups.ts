/**
 * Static scan of a regex pattern for named capture groups.
 *
 * RE2 (the `re2` package) does not expose group names without a match, so the
 * contract validator reads them from the pattern text. The scanner skips
 * escaped characters and character classes, so `\(?<x>` or `[(?<x>]` are not
 * mistaken for groups. It is only used on patterns that RE2 has compiled.
 */

export interface NamedGroupScan {
  /** Names written as `(?<name>...)`, in order of appearance. */
  readonly names: readonly string[];
  /** Names written in the Python/RE2 form `(?P<name>...)`, which the contract forbids. */
  readonly pythonStyleNames: readonly string[];
}

const NAMED_GROUP_AT = /^\(\?(P?)<([A-Za-z_][A-Za-z0-9_]*)>/;

export function scanNamedGroups(pattern: string): NamedGroupScan {
  const names: string[] = [];
  const pythonStyleNames: string[] = [];
  let i = 0;
  let inClass = false;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (inClass) {
      if (ch === '[' && pattern[i + 1] === ':') {
        // POSIX class such as `[:alpha:]` inside a bracket expression.
        const close = pattern.indexOf(':]', i + 2);
        if (close !== -1) {
          i = close + 2;
          continue;
        }
      }
      if (ch === ']') inClass = false;
      i += 1;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      i += 1;
      // A `]` directly after `[` or `[^` is a literal member, not the end of the class.
      if (pattern[i] === '^') i += 1;
      if (pattern[i] === ']') i += 1;
      continue;
    }
    if (ch === '(') {
      const m = NAMED_GROUP_AT.exec(pattern.slice(i));
      if (m?.[2] !== undefined) {
        (m[1] === 'P' ? pythonStyleNames : names).push(m[2]);
        i += m[0].length;
        continue;
      }
    }
    i += 1;
  }
  return { names, pythonStyleNames };
}
