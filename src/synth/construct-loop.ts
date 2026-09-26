/**
 * The per-construct pipeline (WP-09 brief, plan §8 steps 2–5):
 *
 * 1. propose (model)
 * 2. validate the answer with Zod, then the rule with the contract validator
 *    (schema + RE2 + captures, D14)
 * 3. run it with the WP-05 runner against the construct's examples plus the
 *    negative examples of every other construct
 * 4. on failure, refine: send the failing examples, expected vs actual matches
 *    and the previous rule
 * 5. stop at the attempt cap
 *
 * The model proposes; the runner decides. A rule is `validated` only when the
 * runner says every one of its own examples passed, no cross-construct
 * negative matched, and at least one positive passed. Its confidence comes
 * from the fixed formula (D8). A rule that never passes within the cap is
 * `rejected`, keeping its last runnable pattern and the failure reasons.
 */
import { validateRule, formatIssue, type Rule, type RuleType } from '../contract/index.js';
import type { Example } from '../examples/index.js';
import { ruleTypeHintOf, type Construct } from '../ingest/index.js';
import { requestHash, structured, type LlmMessage, type LlmProvider, type LlmRequest } from '../llm/index.js';
import { runRuleAgainstExamples, type ExampleResult, type RuleResultWithoutSamples } from '../runner/index.js';
import {
  buildProposalMessage,
  buildRefinementMessage,
  DEFAULT_PROMPT_LIMITS,
  formatCaptures,
  isPromptSafeExample,
  SYSTEM_PROMPT,
  type AttemptFailure,
  type PromptLimits,
} from './prompts.js';
import { ProposalSchema, type LexicalSettings, type RuleDraft } from './schema.js';
import type { Usage } from './types.js';

export type AttemptOutcome = 'passed' | 'failed-tests' | 'invalid-output' | 'invalid-rule' | 'not-justified';

export interface AttemptTests {
  readonly passed: number;
  readonly failed: number;
  readonly failingExampleIds: string[];
  readonly crossNegativeFailures: string[];
}

export interface ConstructAttempt {
  readonly attempt: number;
  readonly requestHash: string;
  readonly outcome: AttemptOutcome;
  /** Why the attempt failed, readable; empty for `passed`. */
  readonly problems: string[];
  readonly usage: Usage;
  readonly draft?: RuleDraft;
  readonly tests?: AttemptTests;
  readonly notJustified?: string;
}

export type ConstructStatus = 'validated' | 'rejected' | 'not-justified' | 'skipped';

export interface ConstructOutcome {
  readonly constructId: string;
  readonly ruleType?: RuleType;
  readonly status: ConstructStatus;
  /** Set for every status except `validated`. */
  readonly reason?: string;
  /** The final rule: `validated`, or `rejected` with the last runnable pattern. */
  readonly rule?: Rule;
  /** The runner's result for `rule`. */
  readonly result?: RuleResultWithoutSamples;
  readonly attempts: ConstructAttempt[];
}

export interface ConstructOptions {
  readonly languageId: string;
  readonly construct: Construct;
  /** Every example of the language (all constructs, all sources); the runner tests against these. */
  readonly allExamples: readonly Example[];
  readonly lexical: LexicalSettings;
  readonly maxAttempts: number;
  readonly maxOutputTokens: number;
  readonly limits?: PromptLimits;
}

/** `construct.anchor` is `<skillPath>#<slug>`; the Rule Set wants the slug alone (contract §7). */
export function anchorSlug(construct: Pick<Construct, 'anchor' | 'skillPath'>): string {
  const hash = construct.anchor.indexOf('#');
  return hash >= 0 && hash < construct.anchor.length - 1 ? construct.anchor.slice(hash + 1) : construct.skillPath;
}

/** Builds a full contract Rule from a draft. `tests`, `confidence` and `status` are placeholders until the runner decides. */
export function ruleFromDraft(draft: RuleDraft, construct: Construct, type: RuleType): unknown {
  const common = {
    id: construct.id,
    type,
    captures: draft.captures,
    ...(draft.blockEnd !== undefined ? { blockEnd: draft.blockEnd } : {}),
    ...(draft.searchStrings !== undefined ? { searchStrings: draft.searchStrings } : {}),
    confidence: 'low' as const,
    sourceEvidence: [{ skill: construct.skillPath, anchor: anchorSlug(construct), exampleIds: construct.examples.map((e) => e.id) }],
    tests: { passed: 0, failed: 0, failingExampleIds: [] as string[] },
    status: 'rejected' as const,
  };
  return draft.engine === 'exact'
    ? { ...common, engine: 'exact', exact: draft.exact }
    : { ...common, engine: 'regex', regex: draft.regex };
}

/** The runner's verdict: every own example passed, no cross-construct negative matched, at least one positive passed. */
export function passes(result: RuleResultWithoutSamples): boolean {
  return (
    result.tests.failed === 0 &&
    result.crossNegativeFailures.length === 0 &&
    result.missingExampleIds.length === 0 &&
    result.computedConfidence !== undefined
  );
}

function describeFailure(result: ExampleResult, example: Example | undefined): string {
  const label =
    result.role === 'cross-negative' ? `${result.exampleId} (negative example of ${result.construct})` : `${result.exampleId} (${result.polarity})`;
  const origin = example?.source.kind === 'review' ? ' [review example]' : '';
  const details = [
    ...result.missed.map((m) => `missed line ${String(m.line)} ${formatCaptures(m.captures)}`),
    ...result.wrongCaptures.map(
      (w) => `line ${String(w.line)} expected ${formatCaptures(w.expectedCaptures)} got ${formatCaptures(w.actualCaptures)}`,
    ),
    ...result.unexpected.map((u) => `unexpected match line ${String(u.line)} ${formatCaptures(u.captures)}`),
  ];
  return `${label}${origin}: ${details.join('; ')}`;
}

const REVIEW_TAG = ' [review example]';

/**
 * A failure line for the construct's `reason` (a one-line summary shown by
 * `lsc compile` and the report): a review example's captured text is
 * repository-sample text (D9), so only its id and the tag are kept. The full
 * line stays in the attempt's `problems` in synthesis.json.
 */
export function summaryProblem(problem: string): string {
  const at = problem.indexOf(REVIEW_TAG);
  return at === -1 ? problem : `${problem.slice(0, at + REVIEW_TAG.length)}: details withheld (repository-sample text)`;
}

function finalRule(rule: Rule, result: RuleResultWithoutSamples, status: Rule['status']): Rule {
  return {
    ...rule,
    tests: { ...result.tests, failingExampleIds: [...result.tests.failingExampleIds] },
    confidence: result.computedConfidence ?? 'low',
    status,
  };
}

/** Runs the propose → validate → test → refine loop for one construct. Infrastructure errors (budget, provider, unknown recording) are thrown. */
export async function synthesizeConstruct(provider: LlmProvider, options: ConstructOptions): Promise<ConstructOutcome> {
  const { construct } = options;
  const limits = options.limits ?? DEFAULT_PROMPT_LIMITS;
  const attempts: ConstructAttempt[] = [];

  const { type, conflicting } = ruleTypeHintOf(construct.examples);
  if (type === undefined) {
    return { constructId: construct.id, status: 'skipped', reason: 'the construct has no positive example, so no rule can be tested', attempts };
  }
  if (conflicting.length > 0) {
    return {
      constructId: construct.id,
      ruleType: type,
      status: 'skipped',
      reason: `the construct's positive examples disagree on the rule type (${type}, ${conflicting.join(', ')}); fix the examples first`,
      attempts,
    };
  }

  const examplesById = new Map(options.allExamples.map((e) => [e.id, e] as const));
  const messages: LlmMessage[] = [
    { role: 'user', content: buildProposalMessage({ languageId: options.languageId, construct, ruleType: type, lexical: options.lexical, limits }) },
  ];
  let lastRunnable: { rule: Rule; result: RuleResultWithoutSamples } | undefined;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const request: LlmRequest = { system: SYSTEM_PROMPT, messages: [...messages], maxOutputTokens: options.maxOutputTokens };
    const hash = requestHash(request);
    const res = await structured(provider, ProposalSchema, request);
    const usage = { inputTokens: res.response.usage.inputTokens, outputTokens: res.response.usage.outputTokens };
    let failure: AttemptFailure;

    if (!res.ok) {
      const detail = res.error.issues !== undefined && res.error.issues.length > 0 ? res.error.issues.map((i) => `${i.path}: ${i.message}`) : [res.error.message];
      attempts.push({ attempt, requestHash: hash, outcome: 'invalid-output', problems: [`${res.error.kind}: ${detail.join('; ')}`], usage });
      failure = { kind: 'invalid-output', message: `${res.error.kind}: ${res.error.message}` };
    } else if (res.value.rules.length === 0) {
      const reason = res.value.notJustified ?? 'no reason given';
      attempts.push({ attempt, requestHash: hash, outcome: 'not-justified', problems: [], usage, notJustified: reason });
      return { constructId: construct.id, ruleType: type, status: 'not-justified', reason: `the model proposed no rule: ${reason}`, attempts };
    } else {
      const draft = res.value.rules[0] as RuleDraft;
      const validation = validateRule(ruleFromDraft(draft, construct, type));
      if (!validation.ok) {
        const issues = validation.issues.map(formatIssue);
        attempts.push({ attempt, requestHash: hash, outcome: 'invalid-rule', problems: issues, usage, draft });
        failure = { kind: 'invalid-rule', draft, issues };
      } else {
        const rule = validation.rule;
        const result = runRuleAgainstExamples(rule, options.lexical, options.allExamples);
        lastRunnable = { rule, result };
        const tests: AttemptTests = {
          passed: result.tests.passed,
          failed: result.tests.failed,
          failingExampleIds: [...result.tests.failingExampleIds],
          crossNegativeFailures: [...result.crossNegativeFailures],
        };
        if (passes(result)) {
          attempts.push({ attempt, requestHash: hash, outcome: 'passed', problems: [], usage, draft, tests });
          return { constructId: construct.id, ruleType: type, status: 'validated', rule: finalRule(rule, result, 'validated'), result, attempts };
        }
        const failing = result.examples.filter((r) => !r.passed);
        const problems = failing.map((r) => describeFailure(r, examplesById.get(r.exampleId)));
        for (const id of result.missingExampleIds) problems.push(`${id}: cited in sourceEvidence but not loaded`);
        if (result.computedConfidence === undefined && failing.length === 0) problems.push('passes no positive example');
        attempts.push({ attempt, requestHash: hash, outcome: 'failed-tests', problems, usage, draft, tests });
        // Counts in the feedback cover only examples the model may see, so review examples (D16 g) leave no trace in a prompt unless one fails.
        const visibleOwn = result.examples.filter((r) => {
          const example = examplesById.get(r.exampleId);
          return r.role === 'own' && example !== undefined && isPromptSafeExample(example);
        });
        failure = {
          kind: 'failed-tests',
          draft,
          ownPassed: visibleOwn.filter((r) => r.passed).length,
          ownTotal: visibleOwn.length,
          failing,
        };
      }
    }

    if (attempt < options.maxAttempts) {
      messages.push(
        { role: 'assistant', content: res.response.text.trim() === '' ? '(empty answer)' : res.response.text },
        {
          role: 'user',
          content: buildRefinementMessage({ attempt, maxAttempts: options.maxAttempts, failure, examplesById, limits }),
        },
      );
    }
  }

  const last = attempts[attempts.length - 1];
  const reason =
    `no attempt passed within the cap of ${String(options.maxAttempts)} attempt(s)` +
    (last !== undefined ? `; last attempt (${last.outcome}): ${last.problems.map(summaryProblem).join(' | ')}` : '');
  if (lastRunnable === undefined) {
    return { constructId: construct.id, ruleType: type, status: 'rejected', reason, attempts };
  }
  return {
    constructId: construct.id,
    ruleType: type,
    status: 'rejected',
    reason,
    rule: finalRule(lastRunnable.rule, lastRunnable.result, 'rejected'),
    result: lastRunnable.result,
    attempts,
  };
}
