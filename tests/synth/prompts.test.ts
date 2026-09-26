import { describe, expect, it } from 'vitest';
import { buildExample, type Example } from '../../src/examples/index.js';
import { ingestSkills, type Construct } from '../../src/ingest/index.js';
import {
  buildLexicalMessage,
  buildProposalMessage,
  buildRefinementMessage,
  contractExcerpt,
  DEFAULT_PROMPT_LIMITS,
  fenced,
  selectPromptExamples,
  type LexicalSettings,
} from '../../src/synth/index.js';
import { TOYLANG_SKILLS } from './wp09-recordings.js';

const LEXICAL: LexicalSettings = {
  fileMatchers: ['**/*.tl'],
  lineComment: '--',
  blockComment: { start: '/*', end: '*/' },
  stringDelimiters: [{ start: '"', end: '"' }],
};

const toylang = ingestSkills(TOYLANG_SKILLS);
const construct = (id: string): Construct => {
  const c = toylang.constructs.find((x) => x.id === id);
  if (c === undefined) throw new Error(id);
  return c;
};

function example(id: string, code: string, polarity: 'positive' | 'negative' = 'negative'): Example {
  const built = buildExample({
    id,
    construct: 'call',
    polarity,
    code,
    expected: polarity === 'positive' ? [{ line: 1, type: 'call', captures: { callee: 'x' } }] : [],
    source: { kind: 'sidecar', file: `call/${id}.tl`, expectFile: `call/${id}.expect.yaml` },
  });
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return built.example;
}

describe('proposal prompt', () => {
  const message = buildProposalMessage({ languageId: 'toylang', construct: construct('call'), ruleType: 'call', lexical: LEXICAL });

  it('contains the construct prose, its examples, the contract excerpt and the instructions', () => {
    expect(message).toContain('Construct: call');
    expect(message).toContain(construct('call').prose);
    for (const id of ['call-01', 'call-07', 'call-neg-01', 'call-neg-03']) expect(message).toContain(`## ${id} (`);
    expect(message).toContain('Required capture roles: callee.');
    expect(message).toContain('Optional capture roles: module.');
    expect(message).toContain('"blockEnd" is not allowed');
    expect(message).toContain('RE2 syntax only');
    expect(message).toContain('never (?P<name>...)');
    expect(message).toContain('Prefer "exact" over "regex".');
    expect(message).toContain('Use named captures for every capture role.');
    expect(message).toContain('"notJustified"');
    expect(message).toContain('- line comment: `--` to end of line');
    expect(message).toContain('- line 1: callee="apply_discount", module="billing"');
  });

  it('holds nothing of another construct and nothing variable (deterministic)', () => {
    expect(message).not.toContain('read-01');
    expect(message).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(message).not.toContain(TOYLANG_SKILLS);
    expect(buildProposalMessage({ languageId: 'toylang', construct: construct('call'), ruleType: 'call', lexical: LEXICAL })).toBe(message);
  });

  it('allows blockEnd only for definition types', () => {
    expect(contractExcerpt('symbol_definition')).toContain('"blockEnd" is allowed');
    expect(contractExcerpt('module_declaration')).toContain('"blockEnd" is allowed');
    expect(contractExcerpt('db_read')).toContain('"blockEnd" is not allowed');
  });

  it('bounds example size and count, keeps negatives, and says how many were left out', () => {
    const long = 'LET a = 1\n'.repeat(500);
    const examples = [
      ...Array.from({ length: 20 }, (_, i) => example(`call-p${String(i)}`, `CALL x()\n${i === 0 ? long : ''}`, 'positive')),
      example('call-n1', 'LET b = 2\n'),
      example('call-n2', 'LET c = 3\n'),
    ];
    const big: Construct = { ...construct('call'), examples };
    const { shown, omitted } = selectPromptExamples(big);
    expect(shown.length).toBe(DEFAULT_PROMPT_LIMITS.examplesPerPrompt);
    expect(shown.filter((e) => e.polarity === 'negative').map((e) => e.id)).toEqual(['call-n1', 'call-n2']);
    expect(omitted).toBe(examples.length - shown.length);
    const text = buildProposalMessage({ languageId: 'toylang', construct: big, ruleType: 'call', lexical: LEXICAL });
    expect(text).toContain('… [code truncated]');
    expect(text).toContain(`(${String(omitted)} more example(s) of this construct are not shown; they are tested too.)`);
    expect(text.length).toBeLessThan(construct('call').prose.length + DEFAULT_PROMPT_LIMITS.exampleTotalChars + 8000);
  });

  it('fences code with a fence longer than any backtick run inside it', () => {
    expect(fenced('a ``` b')).toBe('````\na ``` b\n````');
    expect(fenced('x\n')).toBe('```\nx\n```');
  });
});

describe('refinement prompt', () => {
  it('reports invalid output and contract issues with the previous rule', () => {
    const invalid = buildRefinementMessage({ attempt: 1, maxAttempts: 3, failure: { kind: 'invalid-output', message: 'invalid_json: bad' }, examplesById: new Map() });
    expect(invalid).toContain('Attempt 1 of 3 failed.');
    expect(invalid).toContain('invalid_json: bad');
    const draft = { engine: 'regex' as const, regex: { pattern: 'CALL(?=x)', flags: 'i', multiline: false }, captures: {}, rationale: 'r' };
    const contract = buildRefinementMessage({ attempt: 2, maxAttempts: 3, failure: { kind: 'invalid-rule', draft, issues: ['$.regex.pattern: [re2-compile] nope'] }, examplesById: new Map() });
    expect(contract).toContain('Previous rule:');
    expect(contract).toContain('CALL(?=x)');
    expect(contract).toContain('[re2-compile] nope');
  });

  it('shows at most the configured number of failing examples', () => {
    const examples = Array.from({ length: 9 }, (_, i) => example(`call-f${String(i)}`, `LET v${String(i)} = 1\n`));
    const failing = examples.map((e) => ({
      exampleId: e.id,
      construct: 'call',
      polarity: 'negative' as const,
      role: 'cross-negative' as const,
      passed: false,
      missed: [],
      unexpected: [{ line: 1, column: 1, captures: { callee: 'v' } }],
      wrongCaptures: [],
    }));
    const text = buildRefinementMessage({
      attempt: 1,
      maxAttempts: 3,
      failure: { kind: 'failed-tests', draft: { engine: 'exact', exact: { tokens: ['LET', '(?<c>)'], caseSensitive: false }, captures: { callee: 'c' }, rationale: 'r' }, ownPassed: 5, ownTotal: 5, failing },
      examplesById: new Map(examples.map((e) => [e.id, e])),
    });
    expect(text.match(/^## call-f/gm)).toHaveLength(DEFAULT_PROMPT_LIMITS.failingExamplesShown);
    expect(text).toContain('(3 more failing example(s) not shown.)');
    expect(text).toContain('9 negative example(s) of other constructs were matched');
  });
});

describe('lexical prompt', () => {
  it('bounds the documentation', () => {
    const text = buildLexicalMessage('toylang', [{ path: 'basics.md', text: 'x'.repeat(50_000) }]);
    expect(text.length).toBeLessThan(DEFAULT_PROMPT_LIMITS.lexicalDocChars + 3000);
    expect(text).toContain('… [truncated]');
  });
});
