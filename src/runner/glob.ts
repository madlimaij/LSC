/**
 * `fileMatchers` glob matching (contract/CONTRACT.md §6.1): "a file is
 * scanned when its repository-relative path, with `/` separators, matches at
 * least one `fileMatchers` glob. Globs are case-sensitive and use only `**`
 * (any number of path segments, including none), `*` (any characters except
 * `/`) and `?` (one character except `/`)."
 *
 * Not implemented in src/engines (WP-04's brief did not cover it); this is
 * where the runner selects which files a Rule Set applies to.
 *
 * Patterns are translated to an RE2 pattern and run under RE2, consistent
 * with D3 (every regex pattern, including ones derived from Rule Set data,
 * runs under RE2, never the built-in RegExp).
 */
import RE2 from 're2';

const REGEX_METACHARACTERS = /[.^$+(){}|[\]\\]/;

function escapeLiteral(char: string): string {
  return REGEX_METACHARACTERS.test(char) ? `\\${char}` : char;
}

/** Translates one `fileMatchers` glob into an RE2 pattern, anchored at both ends. */
export function globToRegexPattern(glob: string): string {
  let out = '';
  let i = 0;
  while (i < glob.length) {
    const char = glob[i] ?? '';
    if (char === '*' && glob[i + 1] === '*') {
      i += 2;
      if (glob[i] === '/') {
        // "**/" — any number of whole path segments, including none.
        out += '(?:.*/)?';
        i += 1;
      } else {
        // A "**" not followed by "/" (e.g. trailing "**") — any characters, including "/".
        out += '.*';
      }
      continue;
    }
    if (char === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }
    out += escapeLiteral(char);
    i += 1;
  }
  return `^${out}$`;
}

/** True when `path` (repository-relative, `/` separators) matches `glob`. */
export function matchesGlob(path: string, glob: string): boolean {
  const re = new RE2(globToRegexPattern(glob));
  return re.test(path);
}

/** True when `path` matches at least one of `globs` (contract/CONTRACT.md §6.1). */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}
