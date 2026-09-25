import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateRuleSet } from '../../src/contract/index.js';
import { mapMatches, prepareFile, scanFile } from '../../src/engines/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

// A 50,000-line synthetic toylang file exercising every rule in the fixture Rule Set
// (module, nested-looking procedures, calls, includes, reads, writes, config flags,
// entry points), plus comments and strings so masking runs on every line too.
function generateFile(procedureCount: number): string {
  const lines: string[] = ['MODULE perf_test', 'INCLUDE "common.tl"', ''];
  for (let i = 0; i < procedureCount; i += 1) {
    lines.push(
      `PROC proc_${String(i)}(x)`,
      `  -- comment mentioning CALL fake_${String(i)}() must be ignored`,
      `  READ table_${String(i)} WHERE id = x INTO row_${String(i)}`,
      `  WRITE table_${String(i)} SET flag = "value_${String(i)}"`,
      `  CALL other.helper_${String(i)}(x)`,
      `  IF FLAG("feature_${String(i)}") THEN`,
      `    CALL other.fallback_${String(i)}(x)`,
      `  ENDIF`,
      `ENDPROC`,
      '',
    );
  }
  lines.push(`ENTRY main -> proc_0`, '');
  return lines.join('\n');
}

function loadToylangRuleSet() {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'contract/fixtures/toylang.ruleset.json'), 'utf8'));
  const result = validateRuleSet(raw);
  if (!result.ok) throw new Error(`fixture Rule Set is invalid: ${result.issues.map((i) => i.message).join('; ')}`);
  return result.ruleSet;
}

describe('performance guard (WP-04: 50,000-line file under a time budget)', () => {
  it('scans a 50,000-line toylang file with the fixture Rule Set within budget', () => {
    const ruleSet = loadToylangRuleSet();
    const validatedRules = ruleSet.rules.filter((r) => r.status === 'validated');
    // 10 lines per procedure + 3 header lines + 2 trailing lines: 50,005 lines at 5,000 procedures.
    const text = generateFile(5000);
    const lineCount = text.split('\n').length;
    expect(lineCount).toBeGreaterThanOrEqual(50000);

    const start = performance.now();
    const file = prepareFile(ruleSet, text);
    const { matches, warnings } = scanFile(validatedRules, file);
    const analysis = mapMatches(matches, validatedRules);
    const elapsedMs = performance.now() - start;

    // Measured on the development machine: ~1.3s. Budget kept generous (5s) to stay
    // reliable on slower CI hardware; this test records the measured time below.
    console.log(`[performance] scanned ${String(lineCount)} lines in ${elapsedMs.toFixed(1)}ms`);
    expect(elapsedMs).toBeLessThan(5000);

    expect(warnings).toEqual([]);
    expect(analysis.symbols.length).toBeGreaterThan(0);
    expect(analysis.relations.length).toBeGreaterThan(0);
    expect(analysis.dbAccesses.length).toBeGreaterThan(0);
    expect(analysis.configRefs.length).toBeGreaterThan(0);
    expect(analysis.entryPoints.length).toBeGreaterThan(0);
  });
});
