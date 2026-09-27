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

  // D32 item 7: `lsc compile --export` passes its export result through so the report it writes into
  // `--out` already says the draft was exported, without a follow-up `lsc report` run.
  it('passes `exported` through to the report and both rendered files, when given', () => {
    const results = { ...runFixture(), ruleSetVersion: '0.0.0-draft' };
    const { report, markdownPath, htmlPath } = renderReportFiles({
      results,
      exported: { version: '1.1.0', path: '/out/toylang.ruleset.json' },
      outDir: tmp,
    });

    expect(report.exported).toEqual({ version: '1.1.0', path: '/out/toylang.ruleset.json' });
    expect(readFileSync(markdownPath, 'utf8')).toContain('This draft was exported as version 1.1.0 to /out/toylang.ruleset.json');
    expect(readFileSync(htmlPath, 'utf8')).toContain('This draft was exported as version 1.1.0 to /out/toylang.ruleset.json');
  });

  it('omits `exported` from the report when not given (no change from before)', () => {
    const results = { ...runFixture(), ruleSetVersion: '0.0.0-draft' };
    const { report } = renderReportFiles({ results, outDir: tmp });
    expect(report.exported).toBeUndefined();
  });
});
