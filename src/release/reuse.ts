/**
 * Recompile without needless model calls (WP-10 brief): "Unchanged Skill
 * files (same hash) reuse previous rules without a model call, unless
 * `--force`; changed Skill files re-synthesise only their constructs."
 *
 * Two steps, both free of model calls:
 *
 * 1. `planReuse` compares the current Skill hashes with the previous
 *    exported Rule Set's `sourceSkills` and decides, per construct and for
 *    the lexical settings, whether the previous result may be reused.
 * 2. `reuseConstruct` re-tests a reusable rule with the runner against the
 *    construct's *current* examples (sidecar and `reviews.yaml` examples can
 *    change without any Skill file changing, D9) and under the current
 *    lexical settings. Only a rule that still passes is reused; otherwise the
 *    construct is re-synthesised like a changed one.
 *
 * Which Skill files a construct depends on: the file holding its section
 * (`construct.skillPath`) and every Skill file with an inline example of it.
 * The lexical settings depend on the general Skill files (those with no
 * inline example, as `generalSkillDocs` in src/synth defines them).
 *
 * Wiring these into `compileLanguage` / `lsc compile` belongs to
 * `llm-integrator` (src/synth, src/cli/commands/compile.ts); see
 * src/release/README.md.
 */
import { validateRule, formatIssue, type Rule, type RuleSet } from '../contract/index.js';
import type { Example } from '../examples/index.js';
import { ruleTypeHintOf, type Construct, type IngestResult } from '../ingest/index.js';
import { runRuleAgainstExamples } from '../runner/index.js';
import { anchorSlug, passes, type ConstructOutcome, type LexicalSettings } from '../synth/index.js';

export type ReuseDecision =
  | { readonly reuse: true; readonly rule: Rule; readonly reason: string }
  | { readonly reuse: false; readonly reason: string };

export type LexicalReuseDecision =
  | { readonly reuse: true; readonly settings: LexicalSettings; readonly reason: string }
  | { readonly reuse: false; readonly reason: string };

export interface ReusePlan {
  readonly previousVersion: string;
  readonly lexical: LexicalReuseDecision;
  /** One decision per current construct id. */
  readonly constructs: ReadonlyMap<string, ReuseDecision>;
}

export interface PlanReuseOptions {
  /** The last exported Rule Set (`lsc export` output) for this language. */
  readonly previous: RuleSet;
  /** The current ingest of the Skill directory. */
  readonly ingest: IngestResult;
  /** `--force`: reuse nothing. */
  readonly force?: boolean;
}

/** Skill files a construct's prompt is built from: its section's file and every file with an inline example of it. Sorted. */
export function constructSkillFiles(construct: Construct): string[] {
  const files = new Set<string>([construct.skillPath]);
  for (const example of construct.examples) {
    if (example.source.kind === 'inline') files.add(example.source.skill);
  }
  return [...files].sort();
}

/** General Skill files: no inline example of any construct (src/synth `generalSkillDocs`). Sorted. */
export function generalSkillPaths(ingest: IngestResult): string[] {
  const withExamples = new Set(ingest.constructs.flatMap(constructSkillFiles));
  return ingest.sourceSkills.map((s) => s.path).filter((p) => !withExamples.has(p)).sort();
}

function changedFiles(paths: readonly string[], current: ReadonlyMap<string, string>, previous: ReadonlyMap<string, string>): string[] {
  return paths.filter((p) => previous.get(p) === undefined || previous.get(p) !== current.get(p));
}

export function planReuse(options: PlanReuseOptions): ReusePlan {
  const { previous, ingest } = options;
  const current = new Map(ingest.sourceSkills.map((s) => [s.path, s.sha256] as const));
  const before = new Map(previous.sourceSkills.map((s) => [s.path, s.sha256] as const));
  const previousRules = new Map(previous.rules.filter((r) => r.status === 'validated').map((r) => [r.id, r] as const));

  let lexical: LexicalReuseDecision;
  const general = generalSkillPaths(ingest);
  const changedGeneral = changedFiles(general, current, before);
  const removed = [...before.keys()].filter((p) => !current.has(p));
  if (options.force === true) {
    lexical = { reuse: false, reason: '--force' };
  } else if (general.length === 0) {
    lexical = { reuse: false, reason: 'no general Skill file to compare' };
  } else if (changedGeneral.length > 0) {
    lexical = { reuse: false, reason: `general Skill file(s) changed or new: ${changedGeneral.join(', ')}` };
  } else if (removed.length > 0) {
    lexical = { reuse: false, reason: `Skill file(s) removed since ${previous.version}: ${removed.join(', ')}` };
  } else {
    lexical = {
      reuse: true,
      reason: `general Skill file(s) unchanged since ${previous.version}: ${general.join(', ')}`,
      settings: {
        fileMatchers: [...previous.fileMatchers],
        ...(previous.lineComment !== undefined ? { lineComment: previous.lineComment } : {}),
        ...(previous.blockComment !== undefined ? { blockComment: { ...previous.blockComment } } : {}),
        ...(previous.stringDelimiters !== undefined ? { stringDelimiters: previous.stringDelimiters.map((d) => ({ ...d })) } : {}),
      },
    };
  }

  const constructs = new Map<string, ReuseDecision>();
  for (const construct of ingest.constructs) {
    const rule = previousRules.get(construct.id);
    const files = constructSkillFiles(construct);
    const changed = changedFiles(files, current, before);
    const evidenceFiles = rule?.sourceEvidence.map((e) => e.skill) ?? [];
    const changedEvidence = changedFiles(evidenceFiles, current, before).filter((p) => !changed.includes(p));
    let decision: ReuseDecision;
    if (options.force === true) {
      decision = { reuse: false, reason: '--force' };
    } else if (rule === undefined) {
      decision = { reuse: false, reason: `no validated rule \`${construct.id}\` in ${previous.version}` };
    } else if (changed.length > 0) {
      decision = { reuse: false, reason: `Skill file(s) changed or new: ${changed.join(', ')}` };
    } else if (changedEvidence.length > 0) {
      decision = { reuse: false, reason: `the previous rule cites changed or removed Skill file(s): ${changedEvidence.join(', ')}` };
    } else {
      decision = { reuse: true, rule, reason: `Skill file(s) unchanged since ${previous.version}: ${files.join(', ')}` };
    }
    constructs.set(construct.id, decision);
  }
  return { previousVersion: previous.version, lexical, constructs };
}

export interface ReuseConstructOptions {
  /** The previous rule (from a `reuse: true` decision). */
  readonly rule: Rule;
  readonly construct: Construct;
  /** Every current example of the language; the runner tests against these (own + cross-construct negatives). */
  readonly allExamples: readonly Example[];
  /** The lexical settings of this compile (reused or new). */
  readonly lexical: LexicalSettings;
}

export type ReuseConstructResult = { readonly ok: true; readonly outcome: ConstructOutcome } | { readonly ok: false; readonly reason: string };

/**
 * Re-tests a previous rule on the current examples, exactly as synthesis
 * would test a new proposal (src/synth `passes`). No model call. On success
 * the outcome is `validated` with zero attempts, fresh `sourceEvidence`,
 * `tests` and `confidence` (D8).
 */
export function reuseConstruct(options: ReuseConstructOptions): ReuseConstructResult {
  const { construct } = options;
  const { type, conflicting } = ruleTypeHintOf(construct.examples);
  if (type === undefined) return { ok: false, reason: 'the construct has no positive example any more' };
  if (conflicting.length > 0) return { ok: false, reason: `the construct's positive examples disagree on the rule type (${[type, ...conflicting].join(', ')})` };
  if (type !== options.rule.type) return { ok: false, reason: `the examples now call for type ${type}, the previous rule is ${options.rule.type}` };

  const checked = validateRule({
    ...options.rule,
    sourceEvidence: [{ skill: construct.skillPath, anchor: anchorSlug(construct), exampleIds: construct.examples.map((e) => e.id) }],
  });
  if (!checked.ok) return { ok: false, reason: `the previous rule is not valid any more: ${checked.issues.map(formatIssue).join('; ')}` };

  const result = runRuleAgainstExamples(checked.rule, options.lexical, options.allExamples);
  if (!passes(result)) {
    const failing = [...result.tests.failingExampleIds, ...result.crossNegativeFailures, ...result.missingExampleIds];
    return {
      ok: false,
      reason: `the previous rule fails the current examples${failing.length > 0 ? `: ${failing.join(', ')}` : ' (passes no positive example)'}`,
    };
  }
  const rule: Rule = {
    ...checked.rule,
    tests: { ...result.tests, failingExampleIds: [...result.tests.failingExampleIds] },
    confidence: result.computedConfidence ?? 'low',
    status: 'validated',
  };
  return { ok: true, outcome: { constructId: construct.id, ruleType: type, status: 'validated', rule, result, attempts: [] } };
}
