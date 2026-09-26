/**
 * `renderReportFiles`: builds the report model from `Results` (plus
 * whatever of Rule Set / examples / `synthesis.json` is available) and
 * writes both renderers to disk, so `lsc compile` (WP-09/llm-integrator)
 * and `lsc report` share one entry point instead of duplicating the
 * "build, render, write" sequence (D25 item 2: "`lsc compile` writes the
 * report itself ... into `--out`").
 *
 * The only file I/O in `src/report/` besides `load-results.ts`'s read: kept
 * to this one module so the rest of the package stays pure functions over
 * data (see this package's README).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RuleSet } from '../contract/index.js';
import type { Example } from '../examples/index.js';
import type { Results } from '../runner/index.js';
import type { SynthesisReport } from '../synth/synthesis-schema.js';
import { buildReport } from './build.js';
import { indexExamplesById } from './example-location.js';
import { renderHtml } from './html.js';
import { renderMarkdown } from './markdown.js';
import type { Report } from './model.js';

export interface RenderReportFilesOptions {
  readonly results: Results;
  /** Adds pattern, captures, provenance and lexical settings per rule (`buildReport`'s `ruleSet` option). */
  readonly ruleSet?: RuleSet;
  /** Adds source locations and snippets (`buildReport`'s `examplesById` option, built from this list). */
  readonly examples?: readonly Example[];
  /** Adds each construct's synthesis outcome and reasons (D25 item 2). */
  readonly synthesis?: SynthesisReport;
  /** Directory the two files are written into (created if missing). */
  readonly outDir: string;
  /** File name without extension for both files (default `"report"`, i.e. `report.md` / `report.html`). */
  readonly baseName?: string;
}

export interface RenderReportFilesResult {
  readonly report: Report;
  readonly markdownPath: string;
  readonly htmlPath: string;
}

/** Builds the report and writes `<baseName>.md` and `<baseName>.html` to `outDir`. Returns both paths and the report model built (e.g. to check `report.overall.verdict`). */
export function renderReportFiles(options: RenderReportFilesOptions): RenderReportFilesResult {
  const report = buildReport(options.results, {
    ...(options.ruleSet !== undefined ? { ruleSet: options.ruleSet } : {}),
    ...(options.examples !== undefined ? { examplesById: indexExamplesById(options.examples) } : {}),
    ...(options.synthesis !== undefined ? { synthesis: options.synthesis } : {}),
  });

  mkdirSync(options.outDir, { recursive: true });
  const baseName = options.baseName ?? 'report';
  const markdownPath = join(options.outDir, `${baseName}.md`);
  const htmlPath = join(options.outDir, `${baseName}.html`);
  writeFileSync(markdownPath, renderMarkdown(report));
  writeFileSync(htmlPath, renderHtml(report));

  return { report, markdownPath, htmlPath };
}
