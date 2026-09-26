/**
 * Diff between two Rule Sets of the same language (WP-10, plan §5.1,
 * contract/CONTRACT.md §3). The diff decides the content-version bump and
 * feeds the CHANGELOG entry.
 *
 * Only what Navigator would apply is compared: rules with `status:
 * "validated"` (CONTRACT.md §6.1). A rule that is `rejected` in the new
 * draft is therefore "removed" if the previous Rule Set had it.
 *
 * Classification (CONTRACT.md §3; the rows marked * were specified in
 * contract 1.0.4, D30):
 *
 * | Change | Bump |
 * | --- | --- |
 * | rule removed, rule renamed (`id` changed) | major |
 * | `type` changed | major |
 * | capture roles added, removed or remapped (role → different group) | major |
 * | `fileMatchers` glob removed * | major |
 * | rule added | minor |
 * | `fileMatchers` glob added * | minor |
 * | matcher refined: `engine`, `exact`, `regex`, `blockEnd`, `searchStrings` | patch |
 * | `lineComment`, `blockComment`, `stringDelimiters` changed * | patch |
 * | `confidence`, `sourceEvidence`, `tests` changed * | patch |
 * | `sourceSkills` changed (a Skill file edited, added or removed) * | patch |
 * | rule order changed * | patch |
 *
 * `compiledAt`, `compilerVersion`, `contractVersion` and `version` are not
 * compared: they describe the build, not the content.
 */
import type { DelimiterPair, Rule, RuleSet } from '../contract/index.js';

export type Bump = 'major' | 'minor' | 'patch' | 'none';

export type ChangeKind =
  | 'rule-added'
  | 'rule-removed'
  | 'rule-renamed'
  | 'type-changed'
  | 'captures-changed'
  | 'pattern-changed'
  | 'confidence-changed'
  | 'evidence-changed'
  | 'tests-changed'
  | 'rules-reordered'
  | 'file-matchers-changed'
  | 'lexical-changed'
  | 'skills-changed';

export interface Change {
  readonly kind: ChangeKind;
  /** The smallest bump this change alone requires. Never `none`. */
  readonly bump: Exclude<Bump, 'none'>;
  /** The rule in the new Rule Set (or the removed rule's id for `rule-removed`). */
  readonly ruleId?: string;
  /** Previous id, for `rule-renamed`. */
  readonly previousRuleId?: string;
  /** One readable line, used verbatim in the CHANGELOG. */
  readonly summary: string;
}

export interface RuleSetDiff {
  readonly changes: readonly Change[];
  /** Largest bump over all changes; `none` when nothing changed. */
  readonly bump: Bump;
}

const BUMP_ORDER: readonly Bump[] = ['none', 'patch', 'minor', 'major'];

export function maxBump(a: Bump, b: Bump): Bump {
  return BUMP_ORDER.indexOf(a) >= BUMP_ORDER.indexOf(b) ? a : b;
}

/** Only rules Navigator applies (CONTRACT.md §6.1). */
export function validatedRules(ruleSet: RuleSet): Rule[] {
  return ruleSet.rules.filter((r) => r.status === 'validated');
}

/** JSON with object keys sorted, so key order never counts as a change. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** The parts of a rule that decide what it matches (CONTRACT.md §3 "patterns refined"). `searchStrings` absent = false. */
function matcherParts(rule: Rule): Record<string, unknown> {
  return {
    engine: rule.engine,
    config: rule.engine === 'exact' ? rule.exact : rule.regex,
    blockEnd: rule.blockEnd ?? null,
    searchStrings: rule.searchStrings ?? false,
  };
}

function describeMatcherChange(prev: Rule, next: Rule): string {
  const parts: string[] = [];
  if (prev.engine !== next.engine) {
    parts.push(`engine ${prev.engine} → ${next.engine}`);
  } else if (prev.engine === 'exact' && next.engine === 'exact') {
    if (!same(prev.exact.tokens, next.exact.tokens)) parts.push(`tokens ${JSON.stringify(prev.exact.tokens)} → ${JSON.stringify(next.exact.tokens)}`);
    if (prev.exact.caseSensitive !== next.exact.caseSensitive) {
      parts.push(`caseSensitive ${String(prev.exact.caseSensitive)} → ${String(next.exact.caseSensitive)}`);
    }
  } else if (prev.engine === 'regex' && next.engine === 'regex') {
    if (prev.regex.pattern !== next.regex.pattern) parts.push(`pattern \`${prev.regex.pattern}\` → \`${next.regex.pattern}\``);
    if (prev.regex.flags !== next.regex.flags) parts.push(`flags "${prev.regex.flags}" → "${next.regex.flags}"`);
    if (prev.regex.multiline !== next.regex.multiline) parts.push(`multiline ${String(prev.regex.multiline)} → ${String(next.regex.multiline)}`);
  }
  if (!same(prev.blockEnd ?? null, next.blockEnd ?? null)) {
    parts.push(
      prev.blockEnd === undefined ? 'blockEnd added' : next.blockEnd === undefined ? 'blockEnd removed' : `blockEnd \`${prev.blockEnd.pattern}\` → \`${next.blockEnd.pattern}\``,
    );
  }
  if ((prev.searchStrings ?? false) !== (next.searchStrings ?? false)) {
    parts.push(`searchStrings ${String(prev.searchStrings ?? false)} → ${String(next.searchStrings ?? false)}`);
  }
  return parts.join('; ');
}

function describeCaptureChange(prev: Rule, next: Rule): string {
  const prevRoles = Object.keys(prev.captures).sort();
  const nextRoles = Object.keys(next.captures).sort();
  const added = nextRoles.filter((r) => !prevRoles.includes(r));
  const removed = prevRoles.filter((r) => !nextRoles.includes(r));
  const remapped = nextRoles.filter(
    (r) => prevRoles.includes(r) && (prev.captures as Record<string, string>)[r] !== (next.captures as Record<string, string>)[r],
  );
  const parts: string[] = [];
  if (added.length > 0) parts.push(`role(s) added: ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`role(s) removed: ${removed.join(', ')}`);
  for (const r of remapped) {
    parts.push(`role ${r} remapped: group ${String((prev.captures as Record<string, string>)[r])} → ${String((next.captures as Record<string, string>)[r])}`);
  }
  return parts.join('; ');
}

function evidenceKey(rule: Rule): string {
  return canonicalJson(rule.sourceEvidence.map((e) => [e.skill, e.anchor]));
}

/**
 * Pairs removed and added rules that are one rule under a new id: same
 * `type`, and the same matcher and captures or the same Skill sections.
 * Only one-to-one candidates are paired, so the result never depends on
 * rule order. A rename is major either way; pairing only makes the
 * CHANGELOG say "renamed" instead of "removed" plus "added".
 */
function pairRenames(removed: readonly Rule[], added: readonly Rule[]): [Rule, Rule][] {
  const looksSame = (a: Rule, b: Rule): boolean =>
    a.type === b.type && ((same(matcherParts(a), matcherParts(b)) && same(a.captures, b.captures)) || evidenceKey(a) === evidenceKey(b));
  const pairs: [Rule, Rule][] = [];
  for (const prev of removed) {
    const candidates = added.filter((a) => looksSame(prev, a));
    if (candidates.length !== 1) continue;
    const next = candidates[0] as Rule;
    if (removed.filter((r) => looksSame(r, next)).length !== 1) continue;
    pairs.push([prev, next]);
  }
  return pairs;
}

function ruleChanges(prev: Rule, next: Rule): Change[] {
  const changes: Change[] = [];
  const id = next.id;
  if (prev.type !== next.type) {
    changes.push({ kind: 'type-changed', bump: 'major', ruleId: id, summary: `\`${id}\`: type changed from ${prev.type} to ${next.type}` });
  }
  if (!same(prev.captures, next.captures)) {
    changes.push({ kind: 'captures-changed', bump: 'major', ruleId: id, summary: `\`${id}\`: capture roles changed (${describeCaptureChange(prev, next)})` });
  }
  if (!same(matcherParts(prev), matcherParts(next))) {
    changes.push({ kind: 'pattern-changed', bump: 'patch', ruleId: id, summary: `\`${id}\`: pattern changed (${describeMatcherChange(prev, next)})` });
  }
  if (prev.confidence !== next.confidence) {
    changes.push({ kind: 'confidence-changed', bump: 'patch', ruleId: id, summary: `\`${id}\`: confidence ${prev.confidence} → ${next.confidence}` });
  }
  if (!same(prev.sourceEvidence, next.sourceEvidence)) {
    const prevIds = new Set(prev.sourceEvidence.flatMap((e) => e.exampleIds));
    const nextIds = new Set(next.sourceEvidence.flatMap((e) => e.exampleIds));
    const addedIds = [...nextIds].filter((x) => !prevIds.has(x));
    const removedIds = [...prevIds].filter((x) => !nextIds.has(x));
    const detail = [
      ...(addedIds.length > 0 ? [`examples added: ${addedIds.join(', ')}`] : []),
      ...(removedIds.length > 0 ? [`examples removed: ${removedIds.join(', ')}`] : []),
      ...(evidenceKey(prev) !== evidenceKey(next)
        ? [`sections ${prev.sourceEvidence.map((e) => `${e.skill}#${e.anchor}`).join(', ')} → ${next.sourceEvidence.map((e) => `${e.skill}#${e.anchor}`).join(', ')}`]
        : []),
    ];
    changes.push({
      kind: 'evidence-changed',
      bump: 'patch',
      ruleId: id,
      summary: `\`${id}\`: provenance changed (${detail.length > 0 ? detail.join('; ') : 'example order'})`,
    });
  }
  if (!same(prev.tests, next.tests)) {
    const t = (r: Rule): string => `${String(r.tests.passed)} passed, ${String(r.tests.failed)} failed`;
    changes.push({ kind: 'tests-changed', bump: 'patch', ruleId: id, summary: `\`${id}\`: test results ${t(prev)} → ${t(next)}` });
  }
  return changes;
}

function describePair(p: DelimiterPair | undefined): string {
  return p === undefined ? 'none' : `${p.start} … ${p.end}`;
}

function settingsChanges(prev: RuleSet, next: RuleSet): Change[] {
  const changes: Change[] = [];
  const removedGlobs = prev.fileMatchers.filter((g) => !next.fileMatchers.includes(g));
  const addedGlobs = next.fileMatchers.filter((g) => !prev.fileMatchers.includes(g));
  if (removedGlobs.length > 0) {
    changes.push({ kind: 'file-matchers-changed', bump: 'major', summary: `fileMatchers: glob(s) removed: ${removedGlobs.join(', ')} (those files are no longer scanned)` });
  }
  if (addedGlobs.length > 0) {
    changes.push({ kind: 'file-matchers-changed', bump: 'minor', summary: `fileMatchers: glob(s) added: ${addedGlobs.join(', ')}` });
  }
  if (removedGlobs.length === 0 && addedGlobs.length === 0 && !same(prev.fileMatchers, next.fileMatchers)) {
    changes.push({ kind: 'file-matchers-changed', bump: 'patch', summary: 'fileMatchers: order changed' });
  }
  if (prev.lineComment !== next.lineComment) {
    changes.push({ kind: 'lexical-changed', bump: 'patch', summary: `lineComment: ${prev.lineComment ?? 'none'} → ${next.lineComment ?? 'none'}` });
  }
  if (!same(prev.blockComment ?? null, next.blockComment ?? null)) {
    changes.push({ kind: 'lexical-changed', bump: 'patch', summary: `blockComment: ${describePair(prev.blockComment)} → ${describePair(next.blockComment)}` });
  }
  if (!same(prev.stringDelimiters ?? [], next.stringDelimiters ?? [])) {
    const list = (d: DelimiterPair[] | undefined): string => (d === undefined || d.length === 0 ? 'none' : d.map(describePair).join(', '));
    changes.push({ kind: 'lexical-changed', bump: 'patch', summary: `stringDelimiters: ${list(prev.stringDelimiters)} → ${list(next.stringDelimiters)}` });
  }
  const prevSkills = new Map(prev.sourceSkills.map((s) => [s.path, s.sha256] as const));
  const nextSkills = new Map(next.sourceSkills.map((s) => [s.path, s.sha256] as const));
  const edited = [...nextSkills].filter(([p, h]) => prevSkills.has(p) && prevSkills.get(p) !== h).map(([p]) => p);
  const addedSkills = [...nextSkills.keys()].filter((p) => !prevSkills.has(p));
  const removedSkills = [...prevSkills.keys()].filter((p) => !nextSkills.has(p));
  if (edited.length > 0 || addedSkills.length > 0 || removedSkills.length > 0) {
    const detail = [
      ...(edited.length > 0 ? [`edited: ${edited.join(', ')}`] : []),
      ...(addedSkills.length > 0 ? [`added: ${addedSkills.join(', ')}`] : []),
      ...(removedSkills.length > 0 ? [`removed: ${removedSkills.join(', ')}`] : []),
    ];
    changes.push({ kind: 'skills-changed', bump: 'patch', summary: `Skill files ${detail.join('; ')}` });
  }
  return changes;
}

/**
 * Compares the validated rules and the content settings of `previous` and
 * `next`. With no `previous` (first export) every validated rule is
 * `rule-added`. Throws if the language ids differ.
 */
export function diffRuleSets(previous: RuleSet | undefined, next: RuleSet): RuleSetDiff {
  const nextRules = validatedRules(next);
  if (previous === undefined) {
    const changes = nextRules.map(
      (r): Change => ({ kind: 'rule-added', bump: 'minor', ruleId: r.id, summary: `\`${r.id}\`: added (${r.type}, ${r.engine}, confidence ${r.confidence})` }),
    );
    return { changes, bump: changes.length > 0 ? 'minor' : 'none' };
  }
  if (previous.languageId !== next.languageId) {
    throw new Error(`cannot compare Rule Sets of different languages (${previous.languageId} and ${next.languageId})`);
  }

  const prevRules = validatedRules(previous);
  const prevById = new Map(prevRules.map((r) => [r.id, r] as const));
  const nextById = new Map(nextRules.map((r) => [r.id, r] as const));
  const removed = prevRules.filter((r) => !nextById.has(r.id));
  const added = nextRules.filter((r) => !prevById.has(r.id));
  const renames = pairRenames(removed, added);
  const renamedFrom = new Set(renames.map(([p]) => p.id));
  const renamedTo = new Set(renames.map(([, n]) => n.id));

  const changes: Change[] = [];
  for (const r of removed) {
    if (!renamedFrom.has(r.id)) {
      const rejected = next.rules.some((n) => n.id === r.id && n.status === 'rejected');
      changes.push({
        kind: 'rule-removed',
        bump: 'major',
        ruleId: r.id,
        summary: rejected ? `\`${r.id}\`: removed (rejected in the new draft; ${r.type})` : `\`${r.id}\`: removed (${r.type})`,
      });
    }
  }
  for (const [prev, next] of renames) {
    changes.push({ kind: 'rule-renamed', bump: 'major', ruleId: next.id, previousRuleId: prev.id, summary: `\`${prev.id}\` renamed to \`${next.id}\` (${next.type})` });
    changes.push(...ruleChanges(prev, next));
  }
  for (const r of added) {
    if (!renamedTo.has(r.id)) {
      changes.push({ kind: 'rule-added', bump: 'minor', ruleId: r.id, summary: `\`${r.id}\`: added (${r.type}, ${r.engine}, confidence ${r.confidence})` });
    }
  }
  for (const next of nextRules) {
    const prev = prevById.get(next.id);
    if (prev !== undefined) changes.push(...ruleChanges(prev, next));
  }
  const commonOrderPrev = prevRules.filter((r) => nextById.has(r.id)).map((r) => r.id);
  const commonOrderNext = nextRules.filter((r) => prevById.has(r.id)).map((r) => r.id);
  if (!same(commonOrderPrev, commonOrderNext)) {
    changes.push({ kind: 'rules-reordered', bump: 'patch', summary: 'rule order changed' });
  }
  changes.push(...settingsChanges(previous, next));

  return { changes, bump: changes.reduce<Bump>((acc, c) => maxBump(acc, c.bump), 'none') };
}
