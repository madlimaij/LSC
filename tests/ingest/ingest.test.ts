import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLoadError, ingestSkills } from '../../src/ingest/index.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const TOYLANG_SKILLS = resolve(import.meta.dirname, '../../fixtures/toylang/skills');

function diagnosticsOf(fixture: string): string[] {
  const dir = join(FIXTURES, fixture, 'skills');
  return ingestSkills(dir).diagnostics.map(formatLoadError);
}

describe('ingestSkills: toylang (acceptance criterion 1)', () => {
  const result = ingestSkills(TOYLANG_SKILLS);

  it('ingests every toylang Skill file with zero diagnostics', () => {
    expect(result.diagnostics).toEqual([]);
  });

  it('hashes every Skill file', () => {
    expect(result.sourceSkills.map((s) => s.path)).toEqual([
      'call.md',
      'config-flag.md',
      'db-read.md',
      'db-write.md',
      'entry-point.md',
      'include.md',
      'language-basics.md',
      'module.md',
      'procedure.md',
    ]);
    for (const skill of result.sourceSkills) expect(skill.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('finds one construct per rule type, each with a rule type hint and enough examples', () => {
    expect(result.constructs.map((c) => c.id)).toEqual([
      'call',
      'config-flag',
      'db-read',
      'db-write',
      'entry-point',
      'include',
      'module-declaration',
      'proc-definition',
    ]);
    const hints = Object.fromEntries(result.constructs.map((c) => [c.id, c.ruleTypeHint]));
    expect(hints).toEqual({
      call: 'call',
      'config-flag': 'config_ref',
      'db-read': 'db_read',
      'db-write': 'db_write',
      'entry-point': 'entry_point',
      include: 'include',
      'module-declaration': 'module_declaration',
      'proc-definition': 'symbol_definition',
    });
    for (const construct of result.constructs) {
      const positive = construct.examples.filter((e) => e.polarity === 'positive').length;
      const negative = construct.examples.filter((e) => e.polarity === 'negative').length;
      expect(positive, `${construct.id} positive examples`).toBeGreaterThanOrEqual(5);
      expect(negative, `${construct.id} negative examples`).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives every construct a stable anchor into its own Skill file', () => {
    const call = result.constructs.find((c) => c.id === 'call');
    expect(call?.anchor).toBe('call.md#calling-a-procedure');
    expect(call?.skillPath).toBe('call.md');
  });

  it('combines inline, sidecar and (when present) review examples under one construct, sorted by id', () => {
    const call = result.constructs.find((c) => c.id === 'call');
    const ids = call?.examples.map((e) => e.id) ?? [];
    expect(ids).toEqual([...ids].sort());
    expect(new Set(call?.examples.map((e) => e.source.kind))).toEqual(new Set(['inline', 'sidecar']));
  });
});

describe('ingestSkills: diagnostics have a triggering fixture each', () => {
  it('example without construct: a sidecar example for a construct no Skill file documents', () => {
    expect(diagnosticsOf('example-without-construct')).toEqual([
      'mystery/mystery-01.tl: example "mystery-01" refers to construct "mystery", which no Skill file documents (no inline example uses construct=mystery)',
    ]);
  });

  it('expect block without example: a yaml expect fence with nothing before it', () => {
    expect(diagnosticsOf('orphan-expect-block')).toEqual([
      'greet.md:7: yaml expect block has no preceding positive inline example',
    ]);
  });

  it('duplicate example id: the same id used inline and in a sidecar file', () => {
    const diagnostics = diagnosticsOf('duplicate-id');
    expect(diagnostics).toEqual([
      'greet.md: example id "say-01" is used more than once across Skill files, sidecar examples and reviews (greet.md, say/say-01.tl); ids must be unique',
      'greet.md: construct "say" has no positive example; no rule can be synthesised for it',
    ]);
  });

  it('construct without any positive example: only a negative example is documented', () => {
    expect(diagnosticsOf('no-positive-example')).toEqual([
      'greet.md: construct "say" has no positive example; no rule can be synthesised for it',
    ]);
  });

  it('inline example info string missing a required key', () => {
    expect(diagnosticsOf('missing-info-keys')).toEqual([
      'greet.md:7: inline example info string is missing construct (got "example=positive id=say-01")',
      'greet.md:11: yaml expect block has no preceding positive inline example',
    ]);
  });

  it('a yaml expect block that fails the Example schema is reported at its own line', () => {
    expect(diagnosticsOf('malformed-expect-yaml')).toEqual([
      'greet.md: construct "say" has no positive example; no rule can be synthesised for it',
      'greet.md:12: expected[0].captures.table: type "call" has no capture role "table" (allowed: callee, module)',
    ]);
  });

  it('positive examples of one construct that disagree on rule type', () => {
    expect(diagnosticsOf('conflicting-types')).toEqual([
      'greet.md: construct "say" has positive examples with different rule types (call and db_read); a construct must map to one rule type',
    ]);
  });

  it('every fixture directory under tests/ingest/fixtures is exercised by a test', () => {
    const dirs = ['example-without-construct', 'orphan-expect-block', 'duplicate-id', 'no-positive-example', 'missing-info-keys', 'malformed-expect-yaml', 'conflicting-types', 'valid'];
    for (const dir of dirs) expect(() => ingestSkills(join(FIXTURES, dir, 'skills'))).not.toThrow();
  });
});

describe('ingestSkills: the "valid" fixture merges all three example sources', () => {
  it('merges inline, sidecar and review examples for one construct', () => {
    const result = ingestSkills(join(FIXTURES, 'valid', 'skills'));
    expect(result.diagnostics).toEqual([]);
    const say = result.constructs[0];
    expect(say?.id).toBe('say');
    expect(say?.examples.map((e) => `${e.source.kind}:${e.id}`)).toEqual([
      'review:review-say-001',
      'inline:say-01',
      'sidecar:say-02',
      'inline:say-neg-01',
    ]);
  });
});

describe('ingestSkills: hashing (acceptance criterion 3)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('changing one character in a Skill file changes only that file\'s hash', () => {
    dir = mkdtempSync(join(tmpdir(), 'lsc-ingest-'));
    const skillsDir = join(dir, 'skills');
    mkdirSync(skillsDir, { recursive: true });
    // Copy the "valid" fixture's Skill file so we have something realistic to mutate.
    const src = join(FIXTURES, 'valid', 'skills', 'greet.md');
    const original = readFileSync(src, 'utf8');
    writeFileSync(join(skillsDir, 'greet.md'), original);

    const before = ingestSkills(skillsDir);
    const beforeHash = before.sourceSkills[0]?.sha256;
    const beforeConstructIds = before.constructs.map((c) => c.id);
    const beforeAnchors = before.constructs.map((c) => c.anchor);
    const beforeExampleIds = before.constructs.map((c) => c.examples.map((e) => e.id));

    // Change one character in the prose, well away from any example fence or heading.
    const mutated = original.replace('writes a greeting', 'Writes a greeting');
    expect(mutated).not.toBe(original);
    writeFileSync(join(skillsDir, 'greet.md'), mutated);

    const after = ingestSkills(skillsDir);
    expect(after.sourceSkills[0]?.sha256).not.toBe(beforeHash);
    expect(after.sourceSkills[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(after.constructs.map((c) => c.id)).toEqual(beforeConstructIds);
    expect(after.constructs.map((c) => c.anchor)).toEqual(beforeAnchors);
    expect(after.constructs.map((c) => c.examples.map((e) => e.id))).toEqual(beforeExampleIds);
    expect(after.diagnostics).toEqual([]);
  });
});
