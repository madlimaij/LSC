/**
 * Ingestion never crashes on malformed input (CLAUDE.md); every problem is
 * reported as a diagnostic with file and line instead. Diagnostics reuse the
 * `ExampleLoadError` shape (src/examples), so `formatLoadError` and the same
 * sort order work for every problem WP-06 finds, whether it comes from a
 * Skill file, a sidecar directory or `reviews.yaml`.
 */
import { compareErrors, type ExampleLoadError, formatLoadError } from '../examples/index.js';

export type IngestDiagnostic = ExampleLoadError;

export { formatLoadError, compareErrors };

export function sortDiagnostics(diagnostics: readonly IngestDiagnostic[]): IngestDiagnostic[] {
  return [...diagnostics].sort(compareErrors);
}
