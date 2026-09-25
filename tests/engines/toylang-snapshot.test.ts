import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateRuleSet } from '../../src/contract/index.js';
import { mapMatches, prepareFile, scanFile } from '../../src/engines/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

function loadToylangRuleSet() {
  const raw = JSON.parse(readFileSync(join(repoRoot, 'contract/fixtures/toylang.ruleset.json'), 'utf8'));
  const result = validateRuleSet(raw);
  if (!result.ok) throw new Error(`fixture Rule Set is invalid: ${result.issues.map((i) => i.message).join('; ')}`);
  return result.ruleSet;
}

describe('one full toylang file: scan + mapping (WP-04 acceptance criteria)', () => {
  it('matches the committed snapshot', () => {
    const ruleSet = loadToylangRuleSet();
    const validatedRules = ruleSet.rules.filter((r) => r.status === 'validated');
    const rawText = readFileSync(join(here, 'fixtures/billing.tl'), 'utf8');

    const file = prepareFile(ruleSet, rawText);
    const { matches, warnings } = scanFile(validatedRules, file);
    const analysis = mapMatches(matches, validatedRules);

    expect({ matches, warnings, analysis }).toMatchSnapshot();
  });

  it('resolves every call, read, write, config-ref and include to its enclosing procedure', () => {
    const ruleSet = loadToylangRuleSet();
    const validatedRules = ruleSet.rules.filter((r) => r.status === 'validated');
    const rawText = readFileSync(join(here, 'fixtures/billing.tl'), 'utf8');
    const { matches } = scanFile(validatedRules, prepareFile(ruleSet, rawText));

    const nonDefinitionMatches = matches.filter(
      (m) => m.type !== 'module_declaration' && m.type !== 'symbol_definition' && m.type !== 'entry_point',
    );
    expect(nonDefinitionMatches.length).toBeGreaterThan(0);
    for (const match of nonDefinitionMatches) {
      expect(match.enclosingSymbol).toBe('calc_total');
    }
  });

  it('never matches a keyword masked inside a comment or a string literal', () => {
    const ruleSet = loadToylangRuleSet();
    const validatedRules = ruleSet.rules.filter((r) => r.status === 'validated');
    const rawText = readFileSync(join(here, 'fixtures/billing.tl'), 'utf8');
    const { matches } = scanFile(validatedRules, prepareFile(ruleSet, rawText));

    // Line 4 is a comment containing "CALL fake_call(x)"; line 9 is a string containing "READ hidden_table".
    expect(matches.some((m) => m.line === 4)).toBe(false);
    expect(matches.some((m) => m.type === 'db_read' && m.captures.table === 'hidden_table')).toBe(false);
    expect(matches.some((m) => m.type === 'call' && m.captures.callee === 'fake_call')).toBe(false);
  });
});
