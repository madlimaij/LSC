import { describe, expect, it } from 'vitest';
import { checkLexicalProposal, globLiterals, ProposalSchema, ruleFromDraft, anchorSlug } from '../../src/synth/index.js';
import { validateRule } from '../../src/contract/index.js';

const exactRule = {
  engine: 'exact',
  exact: { tokens: ['CALL', '(?<callee>)'], caseSensitive: false },
  captures: { callee: 'callee' },
  rationale: 'CALL then the name.',
};

describe('ProposalSchema', () => {
  it('accepts one rule, or no rule with a reason', () => {
    expect(ProposalSchema.safeParse({ rules: [exactRule] }).success).toBe(true);
    expect(ProposalSchema.safeParse({ rules: [], notJustified: 'docs are silent' }).success).toBe(true);
  });

  it('rejects: no rule and no reason; rule and reason; two rules; unknown fields; missing rationale', () => {
    expect(ProposalSchema.safeParse({ rules: [] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ rules: [exactRule], notJustified: 'x' }).success).toBe(false);
    expect(ProposalSchema.safeParse({ rules: [exactRule, exactRule] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ rules: [{ ...exactRule, confidence: 'high' }] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ rules: [{ ...exactRule, id: 'my-id' }] }).success).toBe(false);
    const { rationale: _r, ...noRationale } = exactRule;
    expect(ProposalSchema.safeParse({ rules: [noRationale] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ rules: [{ ...exactRule, engine: 'regex' }] }).success).toBe(false);
  });
});

describe('ruleFromDraft', () => {
  it('builds a contract rule the runner decides on: id and type from the construct, placeholders for the rest', () => {
    const construct = { id: 'call', skillPath: 'call.md', anchor: 'call.md#calling-a-procedure', prose: '', examples: [] };
    const draft = ProposalSchema.parse({ rules: [exactRule] }).rules[0];
    if (draft === undefined) throw new Error('no draft');
    const res = validateRule(ruleFromDraft(draft, construct, 'call'));
    expect(res.ok).toBe(true);
    expect(res.ok && res.rule).toMatchObject({ id: 'call', type: 'call', status: 'rejected', confidence: 'low', sourceEvidence: [{ skill: 'call.md', anchor: 'calling-a-procedure' }] });
  });

  it('falls back to the Skill path when the construct has no heading anchor', () => {
    expect(anchorSlug({ anchor: 'call.md', skillPath: 'call.md' })).toBe('call.md');
  });
});

describe('checkLexicalProposal', () => {
  const docs = 'Files end in `.tl`. `--` starts a line comment. `/*` … `*/` block comments. Strings use `"`.';

  it('accepts settings that the documentation states', () => {
    expect(
      checkLexicalProposal({ fileMatchers: ['**/*.tl'], lineComment: '--', blockComment: { start: '/*', end: '*/' }, stringDelimiters: [{ start: '"', end: '"' }] }, docs),
    ).toEqual([]);
  });

  it('refuses markers and extensions the documentation does not contain', () => {
    expect(checkLexicalProposal({ fileMatchers: ['**/*.tlx'], lineComment: '#' }, docs)).toEqual([
      'fileMatchers: ".tlx" (from "**/*.tlx") does not appear in the documentation',
      'lineComment: "#" does not appear in the documentation',
    ]);
  });

  it('refuses globs that match everything or use unsupported syntax', () => {
    expect(checkLexicalProposal({ fileMatchers: ['**/*'] }, docs)[0]).toContain('matches every file');
    expect(checkLexicalProposal({ fileMatchers: ['**/*.{tl,tlx}'] }, docs)[0]).toContain('outside the supported glob subset');
  });

  it('splits globs into literal pieces', () => {
    expect(globLiterals('src/**/*.tl')).toEqual(['src', '.tl']);
  });
});
