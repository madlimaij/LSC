/**
 * Shared loader for a `Results` JSON file (WP-05's `lsc test --out`), used
 * by both `lsc report` and `lsc review`.
 */
import { readFileSync } from 'node:fs';
import { ResultsSchema, type Results } from '../runner/index.js';

export type LoadResultsOutcome = { readonly ok: true; readonly results: Results } | { readonly ok: false; readonly error: string };

export function loadResultsFile(path: string): LoadResultsOutcome {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `cannot read ${path}: ${reason}` };
  }
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `${path} is not valid JSON: ${reason}` };
  }
  const parsed = ResultsSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    return { ok: false, error: `${path} is not a valid Results file:\n${issues}` };
  }
  return { ok: true, results: parsed.data };
}
