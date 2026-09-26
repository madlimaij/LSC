import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLoadError, ingestSkills, TRUNCATION_MARKER } from '../../src/ingest/index.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const TOYLANG_SKILLS = resolve(import.meta.dirname, '../../fixtures/toylang/skills');
const TOYLANG_RULESET = resolve(import.meta.dirname, '../../contract/fixtures/toylang.ruleset.json');

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
    // Exact counts from fixtures/toylang/SPEC.md §5 (74 examples in total: 50 positive, 24 negative).
    const expectedCounts: Record<string, { positive: number; negative: number }> = {
      'module-declaration': { positive: 6, negative: 3 },
      'proc-definition': { positive: 6, negative: 3 },
      call: { positive: 7, negative: 3 },
      include: { positive: 6, negative: 3 },
      'db-read': { positive: 7, negative: 3 },
      'db-write': { positive: 6, negative: 3 },
      'config-flag': { positive: 6, negative: 3 },
      'entry-point': { positive: 6, negative: 3 },
    };
    let totalPositive = 0;
    let totalNegative = 0;
    for (const construct of result.constructs) {
      const positive = construct.examples.filter((e) => e.polarity === 'positive').length;
      const negative = construct.examples.filter((e) => e.polarity === 'negative').length;
      const expected = expectedCounts[construct.id];
      expect(expected, `no expected count for construct "${construct.id}"`).toBeDefined();
      expect(positive, `${construct.id} positive examples`).toBe(expected?.positive);
      expect(negative, `${construct.id} negative examples`).toBe(expected?.negative);
      totalPositive += positive;
      totalNegative += negative;
    }
    expect(totalPositive, 'total positive examples').toBe(50);
    expect(totalNegative, 'total negative examples').toBe(24);
    expect(totalPositive + totalNegative, 'total examples').toBe(74);
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
    const dirs = ['example-without-construct', 'orphan-expect-block', 'duplicate-id', 'no-positive-example', 'missing-info-keys', 'malformed-expect-yaml', 'conflicting-types', 'valid', 'nested-examples'];
    for (const dir of dirs) expect(() => ingestSkills(join(FIXTURES, dir, 'skills'))).not.toThrow();
  });
});

describe('ingestSkills: IngestOptions.proseCharLimit caps a construct\'s prose', () => {
  it('leaves prose under the default limit unchanged', () => {
    const result = ingestSkills(TOYLANG_SKILLS);
    const call = result.constructs.find((c) => c.id === 'call');
    expect(call?.prose.length).toBeLessThanOrEqual(4000);
    expect(call?.prose).not.toContain('[truncated]');
  });

  it('a small proseCharLimit truncates every construct\'s prose and appends the marker', () => {
    const limit = 50;
    const result = ingestSkills(TOYLANG_SKILLS, { proseCharLimit: limit });
    expect(result.diagnostics).toEqual([]);
    for (const construct of result.constructs) {
      expect(construct.prose.length, `${construct.id} prose length`).toBe(limit + TRUNCATION_MARKER.length);
      expect(construct.prose.endsWith(TRUNCATION_MARKER), `${construct.id} prose should end with the truncation marker`).toBe(true);
      expect(construct.prose.startsWith(construct.prose.slice(0, limit))).toBe(true);
    }
  });

  it('a proseCharLimit large enough for every section leaves prose untouched (no marker)', () => {
    const result = ingestSkills(TOYLANG_SKILLS, { proseCharLimit: 100_000 });
    for (const construct of result.constructs) {
      expect(construct.prose).not.toContain('[truncated]');
    }
  });
});

describe('ingestSkills: examples nested inside lists and blockquotes', () => {
  it('finds a top-level example, a negative example inside a list item and a negative example inside a blockquote', () => {
    const result = ingestSkills(join(FIXTURES, 'nested-examples', 'skills'));
    expect(result.diagnostics).toEqual([]);
    const say = result.constructs.find((c) => c.id === 'say');
    expect(say?.examples.map((e) => e.id)).toEqual(['say-01', 'say-neg-list', 'say-neg-quote']);
    const positive = say?.examples.filter((e) => e.polarity === 'positive').length;
    const negative = say?.examples.filter((e) => e.polarity === 'negative').length;
    expect(positive).toBe(1);
    expect(negative).toBe(2);
    // Provenance: both nested examples keep their own fence line, not the enclosing list/blockquote's line.
    const nested = say?.examples.filter((e) => e.id !== 'say-01') ?? [];
    for (const example of nested) {
      expect(example.source.kind).toBe('inline');
      if (example.source.kind === 'inline') {
        expect(example.source.skill).toBe('greet.md');
        expect(example.source.line).toBeGreaterThan(1);
      }
    }
    // Both nested examples belong to the heading that encloses them (the "Traps" subsection), same anchor as the top-level one.
    expect(say?.anchor).toBe('greet.md#saying-hello');
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

  it('in a multi-file directory, changing one character in one Skill file changes only that file\'s hash, and nothing else in the ingest result', () => {
    dir = mkdtempSync(join(tmpdir(), 'lsc-ingest-multi-'));
    // Copy the whole toylang Skill directory (9 files) plus its sidecar examples, so
    // mutating one file is tested against a realistic multi-file tree, not a single file.
    cpSync(TOYLANG_SKILLS, join(dir, 'skills'), { recursive: true });
    cpSync(resolve(import.meta.dirname, '../../fixtures/toylang/examples'), join(dir, 'examples'), { recursive: true });

    const before = ingestSkills(join(dir, 'skills'));
    expect(before.diagnostics).toEqual([]);
    const hashesBefore = new Map(before.sourceSkills.map((s) => [s.path, s.sha256] as const));

    // Mutate only language-basics.md, which introduces no construct and is not itself
    // referenced by any anchor, in a place with no example fence or heading.
    const target = join(dir, 'skills', 'language-basics.md');
    const original = readFileSync(target, 'utf8');
    const mutated = original.replace('This page is the starting point', 'THIS PAGE is the starting point');
    expect(mutated).not.toBe(original);
    writeFileSync(target, mutated);

    const after = ingestSkills(join(dir, 'skills'));
    expect(after.diagnostics).toEqual([]);

    // Only language-basics.md's hash changed; every other file's hash is untouched.
    for (const skill of after.sourceSkills) {
      if (skill.path === 'language-basics.md') {
        expect(skill.sha256).not.toBe(hashesBefore.get(skill.path));
        expect(skill.sha256).toMatch(/^[0-9a-f]{64}$/);
      } else {
        expect(skill.sha256, `${skill.path} hash should be unchanged`).toBe(hashesBefore.get(skill.path));
      }
    }
    expect(after.sourceSkills.map((s) => s.path)).toEqual(before.sourceSkills.map((s) => s.path));

    // Full construct and example records (code, expected, source line, anchor, prose) are
    // untouched: language-basics.md documents no construct, so nothing here can be affected.
    expect(after.constructs).toEqual(before.constructs);
  });

  it('every toylang Skill file\'s hash matches the sourceSkills entry in the fixture Rule Set (contract/fixtures/toylang.ruleset.json)', () => {
    const ruleset = JSON.parse(readFileSync(TOYLANG_RULESET, 'utf8')) as {
      sourceSkills: { path: string; sha256: string }[];
    };
    const known = new Map(ruleset.sourceSkills.map((s) => [s.path.replace(/^skills\//, ''), s.sha256] as const));
    const result = ingestSkills(TOYLANG_SKILLS);
    expect(result.sourceSkills.length).toBe(known.size);
    for (const skill of result.sourceSkills) {
      expect(skill.sha256, `${skill.path} hash should match contract/fixtures/toylang.ruleset.json`).toBe(known.get(skill.path));
    }
  });
});
