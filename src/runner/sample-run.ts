/**
 * Scans repository-sample files with the validated rules together (D4
 * block scopes included), so unlabelled matches can be reported for human
 * review (plan §6.2, D9). `fileMatchers` selection (contract/CONTRACT.md
 * §6.1) happens here, not in src/engines (WP-04's brief did not cover it).
 */
import type { Rule } from '../contract/index.js';
import { scanFile } from '../engines/blocks.js';
import type { CommentStringConfig } from '../engines/masking.js';
import { prepareFile } from '../engines/prepare.js';
import { matchesAnyGlob } from './glob.js';
import type { SampleMatch, SampleWarning, SnippetLine } from './results-schema.js';

export interface SampleFile {
  /** Repository-relative path, `/` separators (contract/CONTRACT.md §6.1). */
  readonly path: string;
  readonly content: string;
}

export interface SampleScanResult {
  readonly filesScanned: string[];
  readonly matches: SampleMatch[];
  readonly warnings: SampleWarning[];
}

/** Key identifying one reviewed (ruleId, file, line) triple (D9's `reviews.yaml`). */
export function reviewedMatchKey(ruleId: string, file: string, line: number): string {
  return `${ruleId}\u0000${file}\u0000${String(line)}`;
}

function snippetAround(lines: readonly string[], line: number, radius = 3): SnippetLine[] {
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  const snippet: SnippetLine[] = [];
  for (let current = start; current <= end; current += 1) {
    snippet.push({ line: current, text: lines[current - 1] ?? '' });
  }
  return snippet;
}

/**
 * `reviewedKeys` are (ruleId, file, line) triples already turned into
 * `reviews.yaml` examples (D9): matches at those positions are not reported
 * again as new findings.
 */
export function scanSampleFiles(
  validatedRules: readonly Rule[],
  fileMatchers: readonly string[],
  maskingConfig: CommentStringConfig,
  files: readonly SampleFile[],
  reviewedKeys: ReadonlySet<string>,
): SampleScanResult {
  const filesScanned: string[] = [];
  const matches: SampleMatch[] = [];
  const warnings: SampleWarning[] = [];

  for (const file of files) {
    if (!matchesAnyGlob(file.path, fileMatchers)) continue;
    filesScanned.push(file.path);

    const prepared = prepareFile(maskingConfig, file.content);
    const rawLines = prepared.normalizedText.split('\n');
    const scan = scanFile(validatedRules, prepared);

    for (const warning of scan.warnings) {
      warnings.push({ kind: warning.kind, ruleId: warning.ruleId, file: file.path, line: warning.line, column: warning.column, message: warning.message });
    }

    for (const match of scan.matches) {
      if (reviewedKeys.has(reviewedMatchKey(match.ruleId, file.path, match.line))) continue;
      matches.push({
        ruleId: match.ruleId,
        file: file.path,
        line: match.line,
        column: match.column,
        captures: match.captures,
        ...(match.enclosingSymbol !== undefined ? { enclosingSymbol: match.enclosingSymbol } : {}),
        snippet: snippetAround(rawLines, match.line),
      });
    }
  }

  return { filesScanned, matches, warnings };
}
