/**
 * Checks on the toylang fixture language (fixtures/toylang/) and on the
 * alignment of contract/fixtures/toylang.ruleset.json with it.
 *
 * Whether the fixture Rule Set *matches* the examples needs the engines and
 * runner (WP-04/05); these tests check everything that can be checked without
 * them.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULE_TYPES, validateRuleSet, type RuleType } from '../../src/contract/index.js';
import {
  buildExample,
  codeLineCount,
  exampleLocations,
  exampleRuleType,
  formatLoadError,
  loadSidecarExamples,
  normalizeCode,
  parseExpectBlock,
  type Example,
  type ExampleLoadError,
} from '../../src/examples/index.js';

const REPO = resolve(import.meta.dirname, '../..');
const TOYLANG = join(REPO, 'fixtures/toylang');
const SKILLS = join(TOYLANG, 'skills');
const SAMPLE = join(TOYLANG, 'sample-repo');
const SPEC = readFileSync(join(TOYLANG, 'SPEC.md'), 'utf8');

/**
 * Minimal extraction of inline examples, only to validate the fixture files.
 * The real parser (remark-based, with diagnostics) is WP-06's `src/ingest/`.
 */
function inlineExamples(): { examples: Example[]; errors: ExampleLoadError[] } {
  const examples: Example[] = [];
  const errors: ExampleLoadError[] = [];
  for (const file of readdirSync(SKILLS).filter((f) => f.endsWith('.md')).sort()) {
    const lines = readFileSync(join(SKILLS, file), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const info = /^```toylang (.*)$/.exec(lines[i] ?? '')?.[1];
      if (info === undefined) continue;
      const attrs = Object.fromEntries(info.split(/\s+/).map((kv) => kv.split('=') as [string, string]));
      let end = i + 1;
      while (lines[end] !== '```') end += 1;
      const code = lines.slice(i + 1, end).join('\n');
      let next = end + 1;
      while (lines[next] === '') next += 1;
      let expected: unknown = [];
      if (lines[next] === '```yaml expect') {
        let close = next + 1;
        while (lines[close] !== '```') close += 1;
        const parsed = parseExpectBlock(lines.slice(next + 1, close).join('\n'), file, next + 1);
        if (!parsed.ok) {
          errors.push(...parsed.errors);
          continue;
        }
        expected = parsed.expected;
      }
      const built = buildExample({
        id: attrs.id,
        construct: attrs.construct,
        polarity: attrs.example,
        code: normalizeCode(code),
        expected,
        source: { kind: 'inline', skill: file, line: i + 1 },
      });
      if (built.ok) examples.push(built.example);
      else errors.push(...built.issues.map((issue) => ({ file, line: i + 1, message: JSON.stringify(issue) })));
    }
  }
  return { examples, errors };
}

const inline = inlineExamples();
const sidecar = loadSidecarExamples(exampleLocations(SKILLS).examplesDir);
const all = [...inline.examples, ...sidecar.examples];
const ids = new Set(all.map((e) => e.id));

function byConstruct(): Map<string, Example[]> {
  const map = new Map<string, Example[]>();
  for (const e of all) map.set(e.construct, [...(map.get(e.construct) ?? []), e]);
  return map;
}

/** Rule type of each construct, from its positive examples. */
function constructTypes(): Map<string, RuleType> {
  const map = new Map<string, RuleType>();
  for (const e of all) {
    const type = exampleRuleType(e);
    if (type !== undefined) map.set(e.construct, type);
  }
  return map;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Lines of the SPEC.md section starting with `## <n>.` */
function specSection(n: number): string {
  const start = SPEC.indexOf(`\n## ${String(n)}. `);
  const end = SPEC.indexOf('\n## ', start + 1);
  return SPEC.slice(start, end === -1 ? undefined : end);
}

describe('toylang examples', () => {
  it('all sidecar examples load without errors', () => {
    expect(sidecar.errors.map(formatLoadError)).toEqual([]);
  });

  it('all inline examples produce valid Example records', () => {
    expect(inline.errors.map(formatLoadError)).toEqual([]);
    expect(inline.examples.length).toBe(34);
  });

  it('example ids are unique across inline and sidecar examples', () => {
    expect(ids.size).toBe(all.length);
  });

  it('every construct has at least 5 positive and 2 negative examples, as counted in SPEC.md §5', () => {
    const counts = Object.fromEntries(
      [...byConstruct()].map(([construct, list]) => [
        construct,
        [list.filter((e) => e.polarity === 'positive').length, list.filter((e) => e.polarity === 'negative').length],
      ]),
    );
    expect(counts).toEqual({
      'module-declaration': [6, 3],
      'proc-definition': [6, 3],
      call: [7, 3],
      include: [6, 3],
      'db-read': [7, 3],
      'db-write': [6, 3],
      'config-flag': [6, 3],
      'entry-point': [6, 3],
    });
  });

  it('every rule type in the contract has positive and negative examples', () => {
    const types = constructTypes();
    expect([...new Set(types.values())].sort()).toEqual([...RULE_TYPES].sort());
    for (const [construct, list] of byConstruct()) {
      expect(types.has(construct), `${construct} has no positive example`).toBe(true);
      expect(list.some((e) => e.polarity === 'negative'), `${construct} has no negative example`).toBe(true);
    }
  });

  it('each construct maps to exactly one rule type', () => {
    for (const [construct, list] of byConstruct()) {
      const types = new Set(list.map(exampleRuleType).filter((t) => t !== undefined));
      expect(types.size, construct).toBe(1);
    }
  });
});

describe('toylang SPEC.md', () => {
  it('lists every trap with at least one existing covering example (§6)', () => {
    const rows = specSection(6)
      .split('\n')
      .filter((l) => /^\| T\d+ \|/.test(l));
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      const covered = row.split('|')[4] ?? '';
      const listed = [...covered.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
      expect(listed.length, row).toBeGreaterThan(0);
      for (const id of listed) expect(ids, `${row.slice(0, 8)}: unknown example ${String(id)}`).toContain(id);
    }
  });

  it('covers the traps named in WP-03', () => {
    const traps = specSection(6);
    for (const phrase of [
      'line comment',
      'block comment',
      'string literal',
      'Identifier containing a keyword',
      'continued over two lines',
      'Nested `IF` blocks inside a `PROC`',
      'Case-insensitive keywords',
    ]) {
      expect(traps).toContain(phrase);
    }
  });

  it('every sample-repo location in §7 exists', () => {
    const rows = specSection(7)
      .split('\n')
      .filter((l) => /^\| S\d+ \|/.test(l));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const location = /`sample-repo\/([^`:]+):(\d+)`/.exec(row);
      expect(location, row).not.toBeNull();
      const [, file = '', line = '0'] = location ?? [];
      const text = readFileSync(join(SAMPLE, file), 'utf8');
      expect(Number(line), row).toBeLessThanOrEqual(codeLineCount(normalizeCode(text)));
    }
  });
});

describe('toylang sample-repo', () => {
  const files = walk(SAMPLE);
  const toylangFiles = files.filter((f) => f.endsWith('.tl'));

  it('has 15–30 toylang files', () => {
    expect(toylangFiles.length).toBeGreaterThanOrEqual(15);
    expect(toylangFiles.length).toBeLessThanOrEqual(30);
  });

  it('contains one non-toylang file (fileMatchers trap S11)', () => {
    expect(files.filter((f) => !f.endsWith('.tl')).map((f) => f.slice(SAMPLE.length + 1))).toEqual(['docs/notes.txt']);
  });

  it('keeps CRLF line endings in legacy/dos_export.tl (trap S10)', () => {
    expect(readFileSync(join(SAMPLE, 'legacy/dos_export.tl'), 'utf8')).toContain('\r\n');
  });
});

describe('contract/fixtures/toylang.ruleset.json is aligned with toylang', () => {
  const validation = validateRuleSet(JSON.parse(readFileSync(join(REPO, 'contract/fixtures/toylang.ruleset.json'), 'utf8')));
  if (!validation.ok) throw new Error('fixture Rule Set is invalid');
  const ruleSet = validation.ruleSet;

  it('lexical fields match SPEC.md §2', () => {
    expect(ruleSet.languageId).toBe('toylang');
    expect(ruleSet.fileMatchers).toEqual(['**/*.tl']);
    expect(ruleSet.lineComment).toBe('--');
    expect(ruleSet.blockComment).toEqual({ start: '/*', end: '*/' });
    expect(ruleSet.stringDelimiters).toEqual([{ start: '"', end: '"' }]);
  });

  it('sourceSkills lists every Skill file with its current SHA-256', () => {
    const actual = readdirSync(SKILLS)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({ path: `skills/${f}`, sha256: createHash('sha256').update(readFileSync(join(SKILLS, f))).digest('hex') }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
    const listed = [...ruleSet.sourceSkills].sort((a, b) => (a.path < b.path ? -1 : 1));
    expect(listed, 'a Skill file changed: update its sha256 in the fixture Rule Set').toEqual(actual);
  });

  it('each rule cites an existing Skill heading and exactly the examples of one construct of its type', () => {
    const constructs = byConstruct();
    const types = constructTypes();
    const covered = new Set<string>();
    for (const rule of ruleSet.rules) {
      expect(rule.sourceEvidence).toHaveLength(1);
      const [evidence] = rule.sourceEvidence;
      if (evidence === undefined) continue;
      const skill = readFileSync(join(TOYLANG, evidence.skill), 'utf8');
      const slugs = [...skill.matchAll(/^#+ (.+)$/gm)].map((m) =>
        (m[1] ?? '').toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-'),
      );
      expect(slugs, `${rule.id}: anchor ${evidence.anchor}`).toContain(evidence.anchor);

      const construct = all.find((e) => e.id === evidence.exampleIds[0])?.construct ?? '';
      const expectedIds = (constructs.get(construct) ?? []).map((e) => e.id).sort();
      expect([...evidence.exampleIds].sort(), rule.id).toEqual(expectedIds);
      expect(types.get(construct), rule.id).toBe(rule.type);
      expect(rule.tests).toEqual({ passed: expectedIds.length, failed: 0, failingExampleIds: [] });
      covered.add(construct);
    }
    expect([...covered].sort()).toEqual([...constructs.keys()].sort());
  });
});
