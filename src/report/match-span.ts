/**
 * Recomputes the line span a sample match covers (start..end line,
 * inclusive) and every match of the same rule that falls on those lines.
 *
 * Needed because `SampleMatch` (src/runner/results-schema.ts) records only a
 * match's *start* line/column, but `src/examples/README.md` §4 requires a
 * `reviews.yaml` example's `code` to contain "the lines spanned by the
 * match" and to list every other match of the same rule on those lines
 * (positive) or contain none at all (negative, D16 h). A whole-text
 * (`multiline: true`) regex rule can match text that continues onto a later
 * line (db-read's trap T8: `READ &` continued on the next line), so the
 * match's end line is not always its start line.
 *
 * This deliberately re-executes the rule's own pattern rather than changing
 * `src/engines/` (WP-07 does not own that folder, and does not need a
 * runner change for this: `matchRule`, src/engines/match-rule.ts, already
 * gives every match's start line/column and captures for free; only the
 * *end* line of a multiline match needs recomputing, since neither
 * `matchRule` nor `runRegexWholeText`/`runRegexPerLine` return a match's
 * length — RE2 execution here is otherwise identical to
 * src/engines/regex-run.ts's `iterateMatches`, duplicated on purpose for the
 * same reason src/report/rule-status.ts duplicates `isRuleOk`).
 */
import RE2 from 're2';
import { exactToRegex, type Rule } from '../contract/index.js';
import { type CommentStringConfig, type Match, matchRule, offsetToLineColumn, prepareFile } from '../engines/index.js';

export interface MatchSpan {
  readonly startLine: number;
  readonly endLine: number;
}

export interface MatchSpanResult {
  readonly span: MatchSpan;
  /** Every match of `rule` (via `matchRule`) whose start line falls within `span`, including the match asked about. */
  readonly sameRuleMatches: readonly Match[];
}

function patternConfigOf(rule: Rule): { pattern: string; flags: string; multiline: boolean } {
  if (rule.engine === 'exact') {
    const { pattern, flags } = exactToRegex(rule.exact);
    return { pattern, flags, multiline: false };
  }
  return rule.regex;
}

function withGlobalFlag(flags: string): string {
  return flags.includes('g') ? flags : `${flags}g`;
}

/** The end line (inclusive) of the whole-text match starting at (`line`, `column`), or `line` itself if no such match is found (should not happen for an unmodified file). */
function findMultilineEndLine(rule: Rule, maskingConfig: CommentStringConfig, fileText: string, line: number, column: number): number {
  const prepared = prepareFile(maskingConfig, fileText);
  const view = rule.searchStrings === true ? prepared.commentMask : prepared.fullMask;
  const config = patternConfigOf(rule);
  const re = new RE2(config.pattern, withGlobalFlag(config.flags));
  re.lastIndex = 0;
  let match = re.exec(view.text);
  while (match !== null) {
    if (match[0].length === 0) {
      re.lastIndex = match.index + 1;
      if (re.lastIndex > view.text.length) break;
      match = re.exec(view.text);
      continue;
    }
    const start = offsetToLineColumn(match.index, prepared.lineStarts);
    if (start.line === line && start.column === column) {
      const end = offsetToLineColumn(match.index + match[0].length - 1, prepared.lineStarts);
      return end.line;
    }
    match = re.exec(view.text);
  }
  return line;
}

/**
 * The line span of `rule`'s match at (`line`, `column`) in `fileText`, and
 * every match of `rule` (line, column, captures) whose start line falls
 * within that span. Returns `undefined` when the rule no longer matches at
 * that exact position (the sample file or the Rule Set changed since the
 * match was recorded).
 */
export function computeMatchSpan(rule: Rule, maskingConfig: CommentStringConfig, fileText: string, line: number, column: number): MatchSpanResult | undefined {
  const prepared = prepareFile(maskingConfig, fileText);
  const all = matchRule(rule, prepared);
  const self = all.find((m) => m.line === line && m.column === column);
  if (self === undefined) return undefined;

  const config = patternConfigOf(rule);
  const endLine = config.multiline ? findMultilineEndLine(rule, maskingConfig, fileText, line, column) : line;
  const span: MatchSpan = { startLine: line, endLine };
  const sameRuleMatches = all.filter((m) => m.line >= span.startLine && m.line <= span.endLine);
  return { span, sameRuleMatches };
}
