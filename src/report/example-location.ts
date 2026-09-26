/**
 * Turns an `Example` (WP-03/WP-06) into a `file:line` location and a small
 * snippet, so a report reader can find the example without reading compiler
 * internals. Only available when the report is built with `--skills-dir`
 * (src/cli/commands/report.ts), since `Results` alone does not carry the
 * example's source code.
 */
import type { Example } from '../examples/index.js';

export interface ExampleSnippet {
  readonly location: string;
  readonly lines: { readonly line: number; readonly text: string }[];
}

/** `file:line` for an example's source, in the same style as a rule's `sourceEvidence`. */
export function exampleLocation(example: Example): string {
  switch (example.source.kind) {
    case 'inline':
      return `${example.source.skill}:${String(example.source.line)} (example ${example.id})`;
    case 'sidecar':
      return `${example.source.file} (example ${example.id})`;
    case 'review':
      return `${example.source.sampleFile}:${String(example.source.sampleLine)} (reviewed, example ${example.id})`;
  }
}

/** Lines `around` +-`radius` (default 2) within the example's own code, 1-based, clamped to the code. */
export function exampleSnippet(example: Example, around: number, radius = 2): ExampleSnippet {
  const codeLines = example.code.split('\n');
  const lastIsEmpty = codeLines.length > 1 && codeLines[codeLines.length - 1] === '';
  const lineCount = lastIsEmpty ? codeLines.length - 1 : codeLines.length;
  const start = Math.max(1, around - radius);
  const end = Math.min(lineCount, around + radius);
  const lines: { line: number; text: string }[] = [];
  for (let line = start; line <= end; line += 1) {
    lines.push({ line, text: codeLines[line - 1] ?? '' });
  }
  return { location: exampleLocation(example), lines };
}

/** Builds a lookup by example id for fast enrichment while rendering a report. */
export function indexExamplesById(examples: readonly Example[]): ReadonlyMap<string, Example> {
  return new Map(examples.map((example) => [example.id, example] as const));
}
