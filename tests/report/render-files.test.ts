import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderReportFiles } from '../../src/report/render-files.js';
import { fixtureExamples, loadFixtureRuleSet, loadSampleFiles, runFixture } from './helpers.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'lsc-render-report-files-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('renderReportFiles', () => {
  it('writes report.md and report.html by default, both containing the verdict', () => {
    const results = runFixture(loadFixtureRuleSet(), loadSampleFiles());
    const { report, markdownPath, htmlPath } = renderReportFiles({
      results,
      ruleSet: loadFixtureRuleSet(),
      examples: fixtureExamples(),
      outDir: tmp,
    });

    expect(report.overall.verdict).toBe('validated');
    expect(markdownPath).toBe(join(tmp, 'report.md'));
    expect(htmlPath).toBe(join(tmp, 'report.html'));
    expect(existsSync(markdownPath)).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
    expect(readFileSync(markdownPath, 'utf8')).toContain('VALIDATED');
    expect(readFileSync(htmlPath, 'utf8')).toMatch(/^<!DOCTYPE html>/);
  });

  it('honours --baseName and creates outDir if missing', () => {
    const nested = join(tmp, 'nested', 'out');
    const results = runFixture();
    const { markdownPath, htmlPath } = renderReportFiles({ results, outDir: nested, baseName: 'validation' });

    expect(markdownPath).toBe(join(nested, 'validation.md'));
    expect(htmlPath).toBe(join(nested, 'validation.html'));
    expect(existsSync(markdownPath)).toBe(true);
    expect(existsSync(htmlPath)).toBe(true);
  });

  it('works from Results alone (no ruleSet/examples/synthesis), same as buildReport', () => {
    const results = runFixture();
    const { report } = renderReportFiles({ results, outDir: tmp });
    expect(report.rules.every((rule) => rule.pattern === undefined)).toBe(true);
    expect(report.lexical).toBeUndefined();
    expect(report.synthesis).toBeUndefined();
  });
});
