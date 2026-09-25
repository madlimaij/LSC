/**
 * Applies one rule to one prepared file (WP-04 engine interface:
 * `match(rule, preparedFile) -> Match[]`).
 *
 * The exact engine (contract/CONTRACT.md §6.4) is implemented as its
 * equivalent RE2 regex (`exactToRegex`, the contract's reference definition)
 * run per line, exactly like a regex rule with `multiline: false`.
 */
import { exactToRegex, type CaptureRole, type Captures, type RegexConfig, type Rule } from '../contract/index.js';
import type { PreparedFile } from './prepare.js';
import { runRegexPerLine, runRegexWholeText, type RawMatch } from './regex-run.js';
import type { Match } from './types.js';

function patternConfigOf(rule: Rule): { pattern: string; flags: string; multiline: boolean } {
  if (rule.engine === 'exact') {
    const { pattern, flags } = exactToRegex(rule.exact);
    return { pattern, flags, multiline: false };
  }
  return rule.regex;
}

/** Selects the masked view a rule's own pattern (and its `blockEnd`, §6.6) runs against. */
function selectView(rule: Pick<Rule, 'searchStrings'>, file: PreparedFile) {
  return rule.searchStrings === true ? file.commentMask : file.fullMask;
}

function runPattern(
  config: { pattern: string; flags: string; multiline: boolean },
  file: PreparedFile,
  view: ReturnType<typeof selectView>,
): RawMatch[] {
  return config.multiline
    ? runRegexWholeText(config, view.text, file.lineStarts)
    : runRegexPerLine(config, view.lines);
}

function extractCaptures(captures: Captures, groups: Readonly<Record<string, string | undefined>>): Partial<Record<CaptureRole, string>> {
  const result: Partial<Record<CaptureRole, string>> = {};
  for (const [role, groupName] of Object.entries(captures) as [CaptureRole, string | undefined][]) {
    if (groupName === undefined) continue;
    const value = groups[groupName];
    if (value !== undefined) result[role] = value;
  }
  return result;
}

/** Every match of `rule` in `file`, in file order. */
export function matchRule(rule: Rule, file: PreparedFile): Match[] {
  const view = selectView(rule, file);
  const config = patternConfigOf(rule);
  const raw = runPattern(config, file, view);
  return raw.map((r) => ({
    ruleId: rule.id,
    type: rule.type,
    line: r.line,
    column: r.column,
    captures: extractCaptures(rule.captures, r.groups),
  }));
}

export interface BlockEndMatch {
  readonly line: number;
  readonly column: number;
}

/**
 * Every match of `rule.blockEnd`, using the same masked view as `rule` itself
 * (contract/CONTRACT.md §6.6).
 */
export function matchBlockEnd(rule: Rule, blockEnd: RegexConfig, file: PreparedFile): BlockEndMatch[] {
  const view = selectView(rule, file);
  const raw = runPattern({ ...blockEnd }, file, view);
  return raw.map((r) => ({ line: r.line, column: r.column }));
}
