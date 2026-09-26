/**
 * Reuse of previous rules for unchanged Skill files (WP-10 brief), without
 * any model call: `planReuse` and `reuseConstruct`. The last test composes
 * them with the WP-09 building blocks the way `compileLanguage` would once
 * wired (see src/release/README.md), and shows that only the changed
 * construct reaches the provider.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuleSet } from '../../src/contract/index.js';
import type { Example } from '../../src/examples/index.js';
import { ingestSkills, type IngestResult } from '../../src/ingest/index.js';
import { FakeProvider, type LlmProvider, type LlmRequest, type LlmResponse } from '../../src/llm/index.js';
import { constructSkillFiles, exportRuleSet, generalSkillPaths, planReuse, reuseConstruct, type ReuseDecision } from '../../src/release/index.js';
import { compileLanguage, DEFAULT_MAX_OUTPUT_TOKENS, synthesizeConstruct, type ConstructOutcome, type LexicalSettings } from '../../src/synth/index.js';
import { copyToylang, recordingsDir, targetOf } from './helpers.js';
import { DB_WRITE_REGEX, editDbWriteSkill, recordingsFor } from './scenarios.js';

/** Compiles `skillsDir` with the wp09 recordings and exports it: the "previous" Rule Set of a recompile. */
async function exportedFrom(skillsDir: string): Promise<RuleSet> {
  const out = await compileLanguage({
    skillsDir,
    languageId: 'toylang',
    provider: FakeProvider.fromDirectory(recordingsDir('wp09')),
    maxAttempts: 3,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    compilerVersion: '0.0.0-test',
  });
  if (out.ruleSet === undefined) throw new Error('compile produced no draft');
  return exportRuleSet({ draft: out.ruleSet }).ruleSet;
}

function decisions(plan: ReturnType<typeof planReuse>): Record<string, boolean> {
  return Object.fromEntries([...plan.constructs].map(([id, d]: [string, ReuseDecision]) => [id, d.reuse]));
}

function lexicalOf(ruleSet: RuleSet): LexicalSettings {
  return {
    fileMatchers: ruleSet.fileMatchers,
    ...(ruleSet.lineComment !== undefined ? { lineComment: ruleSet.lineComment } : {}),
    ...(ruleSet.blockComment !== undefined ? { blockComment: ruleSet.blockComment } : {}),
    ...(ruleSet.stringDelimiters !== undefined ? { stringDelimiters: ruleSet.stringDelimiters } : {}),
  };
}

const allExamples = (ingest: IngestResult): Example[] => ingest.constructs.flatMap((c) => c.examples);

describe('planReuse', () => {
  it('toylang: language-basics.md is the only general Skill file; each construct depends on its own file', () => {
    const { skillsDir } = copyToylang();
    const ingest = ingestSkills(skillsDir);
    expect(generalSkillPaths(ingest)).toEqual(['language-basics.md']);
    const dbWrite = ingest.constructs.find((c) => c.id === 'db-write');
    expect(dbWrite && constructSkillFiles(dbWrite)).toEqual(['db-write.md']);
  });

  it('nothing changed: every construct and the lexical settings are reusable', async () => {
    const { skillsDir } = copyToylang();
    const previous = await exportedFrom(skillsDir);
    const plan = planReuse({ previous, ingest: ingestSkills(skillsDir) });
    expect(plan.previousVersion).toBe('1.0.0');
    expect(Object.values(decisions(plan))).toEqual(Array(8).fill(true));
    expect(plan.lexical).toMatchObject({ reuse: true, settings: lexicalOf(previous) });
  });

  it('one Skill file changed: only its construct is re-synthesised, with the file named in the reason', async () => {
    const { skillsDir } = copyToylang();
    const previous = await exportedFrom(skillsDir);
    editDbWriteSkill(skillsDir);
    const plan = planReuse({ previous, ingest: ingestSkills(skillsDir) });
    const d = decisions(plan);
    expect(Object.entries(d).filter(([, reuse]) => !reuse).map(([id]) => id)).toEqual(['db-write']);
    expect(plan.constructs.get('db-write')).toEqual({ reuse: false, reason: 'Skill file(s) changed or new: db-write.md' });
    expect(plan.lexical.reuse).toBe(true);
  });

  it('a changed general Skill file re-synthesises the lexical settings only; construct rules are still re-tested under the new settings', async () => {
    const { skillsDir } = copyToylang();
    const previous = await exportedFrom(skillsDir);
    const path = join(skillsDir, 'language-basics.md');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\nOne more sentence.\n`);
    const plan = planReuse({ previous, ingest: ingestSkills(skillsDir) });
    expect(plan.lexical).toEqual({ reuse: false, reason: 'general Skill file(s) changed or new: language-basics.md' });
    expect(Object.values(decisions(plan)).every(Boolean)).toBe(true);
  });

  it('--force reuses nothing; a construct without a validated previous rule is re-synthesised', async () => {
    const { skillsDir } = copyToylang();
    const previous = await exportedFrom(skillsDir);
    const ingest = ingestSkills(skillsDir);
    const forced = planReuse({ previous, ingest, force: true });
    expect(forced.lexical).toEqual({ reuse: false, reason: '--force' });
    expect(Object.values(decisions(forced)).some(Boolean)).toBe(false);

    const withoutCall = { ...previous, rules: previous.rules.filter((r) => r.id !== 'call') };
    expect(planReuse({ previous: withoutCall, ingest }).constructs.get('call')).toEqual({ reuse: false, reason: 'no validated rule `call` in 1.0.0' });
  });
});

describe('reuseConstruct', () => {
  it('re-tests the previous rule on the current examples and returns it validated, with zero attempts and no provider', async () => {
    const { skillsDir } = copyToylang();
    const previous = await exportedFrom(skillsDir);
    const ingest = ingestSkills(skillsDir);
    for (const construct of ingest.constructs) {
      const rule = previous.rules.find((r) => r.id === construct.id);
      if (rule === undefined) throw new Error(`no rule ${construct.id}`);
      const res = reuseConstruct({ rule, construct, allExamples: allExamples(ingest), lexical: lexicalOf(previous) });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.outcome).toMatchObject({ constructId: construct.id, status: 'validated', attempts: [] });
        expect(res.outcome.rule).toEqual(rule);
      }
    }
  });

  it('a previous rule that now fails a current example (e.g. a new reviews.yaml entry, D9) is not reused', async () => {
    const { skillsDir } = copyToylang();
    const previous = await exportedFrom(skillsDir);
    const ingest = ingestSkills(skillsDir);
    const construct = ingest.constructs.find((c) => c.id === 'db-write');
    const rule = previous.rules.find((r) => r.id === 'db-write');
    if (construct === undefined || rule === undefined) throw new Error('db-write missing');
    const firstPositive = construct.examples.find((e) => e.polarity === 'positive');
    if (firstPositive === undefined) throw new Error('no positive example');
    const changed = allExamples(ingest).map((e) =>
      e.id === firstPositive.id ? { ...e, expected: e.expected.map((m) => ({ ...m, captures: { table: 'somethingElse' } })) } : e,
    );
    const res = reuseConstruct({ rule, construct, allExamples: changed, lexical: lexicalOf(previous) });
    expect(res).toEqual({ ok: false, reason: `the previous rule fails the current examples: ${firstPositive.id}` });
  });

  it('refuses when the examples now call for another rule type', async () => {
    const { skillsDir } = copyToylang();
    const previous = await exportedFrom(skillsDir);
    const ingest = ingestSkills(skillsDir);
    const construct = ingest.constructs.find((c) => c.id === 'db-write');
    const rule = previous.rules.find((r) => r.id === 'db-write');
    if (construct === undefined || rule === undefined) throw new Error('db-write missing');
    const res = reuseConstruct({ rule: { ...rule, type: 'db_read' }, construct, allExamples: allExamples(ingest), lexical: lexicalOf(previous) });
    expect(res).toEqual({ ok: false, reason: 'the examples now call for type db_write, the previous rule is db_read' });
  });
});

describe('recompile composition (reuse + WP-09 synthesis)', () => {
  it('after changing db-write.md, only the db-write construct reaches the provider; every other rule is reused', async () => {
    const { skillsDir } = copyToylang();
    const previous = await exportedFrom(skillsDir);
    editDbWriteSkill(skillsDir);
    const recordings = await recordingsFor(skillsDir, { 'db-write': [DB_WRITE_REGEX] });

    const replay = FakeProvider.fromDirectory(recordings);
    const asked: string[] = [];
    const provider: LlmProvider = {
      name: 'counting',
      model: 'recorded',
      complete(request: LlmRequest): Promise<LlmResponse> {
        asked.push(targetOf(request).target);
        return replay.complete(request);
      },
    };

    const ingest = ingestSkills(skillsDir);
    const plan = planReuse({ previous, ingest });
    if (!plan.lexical.reuse) throw new Error('lexical settings should be reusable');
    const lexical = plan.lexical.settings;
    const outcomes: ConstructOutcome[] = [];
    for (const construct of ingest.constructs) {
      const decision = plan.constructs.get(construct.id);
      const reused = decision?.reuse === true ? reuseConstruct({ rule: decision.rule, construct, allExamples: allExamples(ingest), lexical }) : undefined;
      outcomes.push(
        reused?.ok === true
          ? reused.outcome
          : await synthesizeConstruct(provider, {
              languageId: 'toylang',
              construct,
              allExamples: allExamples(ingest),
              lexical,
              maxAttempts: 3,
              maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
            }),
      );
    }
    expect(asked).toEqual(['db-write']);
    expect(outcomes.every((o) => o.status === 'validated')).toBe(true);
    expect(outcomes.filter((o) => o.attempts.length > 0).map((o) => o.constructId)).toEqual(['db-write']);
    expect(outcomes.find((o) => o.constructId === 'db-write')?.rule?.engine).toBe('regex');
  });
});
