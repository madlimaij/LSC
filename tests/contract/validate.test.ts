import { describe, expect, it } from 'vitest';
import {
  formatIssue,
  formatPath,
  isSupportedContractVersion,
  parseVersion,
  validateRule,
  validateRuleSet,
  type RuleSet,
} from '../../src/contract/index.js';
import { readJson, VALID_FIXTURE } from './helpers.js';

function validFixture(): RuleSet {
  return readJson(VALID_FIXTURE) as RuleSet;
}

describe('contract versions', () => {
  it('accepts 1.0.x only', () => {
    expect(isSupportedContractVersion('1.0.0')).toBe(true);
    expect(isSupportedContractVersion('1.0.7')).toBe(true);
    expect(isSupportedContractVersion('1.1.0')).toBe(false);
    expect(isSupportedContractVersion('2.0.0')).toBe(false);
    expect(isSupportedContractVersion('0.9.0')).toBe(false);
    expect(isSupportedContractVersion('1.0.0-rc.1')).toBe(false);
    expect(isSupportedContractVersion('1.0')).toBe(false);
  });

  it('parses semver cores', () => {
    expect(parseVersion('1.2.3-beta+x')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('01.2.3')).toBeUndefined();
  });

  it('stops at an unsupported contractVersion before checking anything else', () => {
    const result = validateRuleSet({ contractVersion: '2.0.0', rules: 'not even an array' });
    expect(result.issues.map((i) => i.rule)).toEqual(['contract-version']);
  });
});

describe('validateRuleSet', () => {
  it('rejects non-objects with a schema issue', () => {
    for (const input of [null, 42, 'x', []]) {
      const result = validateRuleSet(input);
      expect(result.ok).toBe(false);
      expect(result.issues[0]?.rule).toBe('schema');
    }
  });

  it('reports several cross-field issues in a deterministic order', () => {
    const rs = validFixture();
    const call = rs.rules.find((r) => r.id === 'call-statement');
    const read = rs.rules.find((r) => r.id === 'db-read');
    if (call === undefined || read === undefined) throw new Error('fixture changed');
    call.captures = {};
    if (read.engine !== 'regex') throw new Error('fixture changed');
    read.regex.pattern = '(';
    const result = validateRuleSet(rs);
    expect(result.issues.map(formatIssue)).toEqual([
      '$.rules[2].captures: [captures-required-roles] type "call" requires capture role "callee"',
      expect.stringMatching(/^\$\.rules\[4\]\.regex\.pattern: \[re2-compile\] pattern does not compile under RE2/),
    ]);
  });

  it('accepts a rejected rule (draft Rule Sets may contain them) and optional fields omitted', () => {
    const rs = validFixture();
    const rule = rs.rules[0];
    if (rule === undefined) throw new Error('fixture changed');
    rule.status = 'rejected';
    rule.confidence = 'low';
    rule.tests = { passed: 0, failed: 2, failingExampleIds: ['a', 'b'] };
    delete rs.lineComment;
    delete rs.blockComment;
    delete rs.stringDelimiters;
    rs.rules = [rule];
    expect(validateRuleSet(rs).issues).toEqual([]);
  });

  it('rejects a compiledAt with a UTC offset (UTC Z only)', () => {
    const rs = { ...validFixture(), compiledAt: '2026-09-24T02:00:00+02:00' };
    expect(validateRuleSet(rs).issues.map((i) => i.path.join('.'))).toEqual(['compiledAt']);
  });
});

describe('validateRule (single draft, e.g. model output)', () => {
  it('validates a good draft and prefixes paths', () => {
    const rule = validFixture().rules[4];
    expect(validateRule(rule).ok).toBe(true);
    const bad = { ...rule, captures: {} };
    const result = validateRule(bad, ['rules', 0]);
    expect(result.issues.map(formatIssue)).toEqual([
      '$.rules[0].captures: [captures-required-roles] type "db_read" requires capture role "table"',
    ]);
  });

  it('reports structural problems with the schema code', () => {
    const result = validateRule({ id: 'x', engine: 'regex' });
    expect(result.ok).toBe(false);
    expect(new Set(result.issues.map((i) => i.rule))).toEqual(new Set(['schema']));
  });
});

describe('formatPath', () => {
  it('renders JSONPath-style strings', () => {
    expect(formatPath([])).toBe('$');
    expect(formatPath(['rules', 2, 'regex', 'pattern'])).toBe('$.rules[2].regex.pattern');
    expect(formatPath(['odd key'])).toBe('$["odd key"]');
  });
});
