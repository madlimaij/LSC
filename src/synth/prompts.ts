/**
 * Prompt texts for rule synthesis (WP-09, plan §8 steps 2 and 5).
 *
 * Everything here is a pure function of its inputs, so the same inputs always
 * give byte-identical requests: recordings are keyed by a hash of the request
 * (D17), and a timestamp or an absolute path in a prompt would break replay.
 *
 * What is sent, and nothing else:
 * - the construct's Skill section (already capped by src/ingest),
 * - its labelled examples from Skill files and sidecar files, bounded in
 *   number and size,
 * - the contract excerpt for its rule type,
 * - on refinement: failing examples, expected vs actual matches and the
 *   previous rule.
 *
 * Never sent: repository-sample files, and examples from `reviews.yaml`
 * (their code is repository-sample text; D16 g). Review examples are tested
 * by the runner only; when one fails, the feedback says so without any of its
 * content.
 */
import { CAPTURE_ROLES, RULE_TYPE_SPEC, type RuleType } from '../contract/index.js';
import type { Example, ExpectedMatch } from '../examples/index.js';
import type { Construct } from '../ingest/index.js';
import type { ExampleResult, MatchCaptures } from '../runner/index.js';
import type { LexicalSettings, RuleDraft } from './schema.js';

export interface PromptLimits {
  /** Characters of code shown per example; longer code is cut with a marker. */
  readonly exampleCodeChars: number;
  /** Examples shown in a proposal prompt (all are still tested). */
  readonly examplesPerPrompt: number;
  /** Total characters of example code in a proposal prompt. */
  readonly exampleTotalChars: number;
  /** Failing examples shown in one refinement message. */
  readonly failingExamplesShown: number;
  /** Characters of general documentation in the lexical-settings prompt. */
  readonly lexicalDocChars: number;
}

export const DEFAULT_PROMPT_LIMITS: PromptLimits = {
  exampleCodeChars: 1200,
  examplesPerPrompt: 12,
  exampleTotalChars: 10_000,
  failingExamplesShown: 6,
  lexicalDocChars: 12_000,
};

export const SYSTEM_PROMPT = [
  'You write deterministic detection rules for a source-code scanner that never calls a model: it runs your rules exactly as written.',
  'You only propose. An automatic runner decides: it validates every rule against a JSON contract and the RE2 regex engine, and tests it against labelled examples.',
  'Base every rule on the documentation you are given. If the documentation does not justify a rule, say so instead of guessing.',
  'Answer with exactly one JSON object and nothing else: no prose, no code fence.',
].join('\n');

/** True for examples whose code may be sent to a model (everything except `reviews.yaml` examples, D16 g). */
export function isPromptSafeExample(example: Example): boolean {
  return example.source.kind !== 'review';
}

const TRUNCATED_CODE = '… [code truncated]';

/** A code fence longer than any backtick run inside `code`. */
export function fenced(code: string): string {
  let longest = 0;
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const body = code.endsWith('\n') ? code.slice(0, -1) : code;
  return `${fence}\n${body}\n${fence}`;
}

export function boundCode(code: string, limit: number): string {
  return code.length <= limit ? code : `${code.slice(0, limit)}\n${TRUNCATED_CODE}`;
}

export function formatCaptures(captures: MatchCaptures): string {
  const parts: string[] = [];
  for (const role of CAPTURE_ROLES) {
    const value = captures[role];
    if (value !== undefined) parts.push(`${role}=${JSON.stringify(value)}`);
  }
  return parts.length === 0 ? '(no captures)' : parts.join(', ');
}

function formatExpected(expected: readonly ExpectedMatch[]): string {
  if (expected.length === 0) return 'Expected matches: none (the rule must not match anything here).';
  return ['Expected matches:', ...expected.map((m) => `- line ${String(m.line)}: ${formatCaptures(m.captures)}`)].join('\n');
}

function formatExample(example: Example, limits: PromptLimits): string {
  return [
    `## ${example.id} (${example.polarity})`,
    fenced(boundCode(example.code, limits.exampleCodeChars)),
    formatExpected(example.expected),
  ].join('\n');
}

/** Lexical settings as prose for the prompt. */
export function describeLexical(lexical: LexicalSettings): string {
  const lines = [
    `- line comment: ${lexical.lineComment !== undefined ? `\`${lexical.lineComment}\` to end of line` : 'none'}`,
    `- block comment: ${lexical.blockComment !== undefined ? `\`${lexical.blockComment.start}\` … \`${lexical.blockComment.end}\`` : 'none'}`,
    `- string literals: ${
      lexical.stringDelimiters !== undefined && lexical.stringDelimiters.length > 0
        ? lexical.stringDelimiters.map((d) => `\`${d.start}\` … \`${d.end}\` (on one line)`).join(', ')
        : 'none'
    }`,
  ];
  return lines.join('\n');
}

/** Contract excerpt for one rule type (contract/CONTRACT.md §4–§6). */
export function contractExcerpt(type: RuleType): string {
  const spec = RULE_TYPE_SPEC[type];
  const optional = spec.optionalRoles.length > 0 ? spec.optionalRoles.join(', ') : 'none';
  return [
    `- Rule type: \`${type}\` (fixed by the examples; you do not choose it).`,
    `- Required capture roles: ${spec.requiredRoles.join(', ')}.`,
    `- Optional capture roles: ${optional}. Map an optional role only if the documentation says to report that value.`,
    spec.allowsBlockEnd
      ? '- "blockEnd" is allowed: a regex config matching the end marker of this construct\'s block. Give it only if the documentation names an end marker; omit it otherwise.'
      : '- "blockEnd" is not allowed for this rule type.',
    '- "captures" maps each capture role to a group name. Every group name must exist in the rule: as a named group (?<name>...) in a regex, or as a placeholder token (?<name>) in exact tokens.',
  ].join('\n');
}

const ENGINE_TEXT = [
  '# Engines',
  'Prefer "exact". Use "regex" only if "exact" cannot express what the documentation and examples require.',
  '',
  '"exact": {"tokens": [string, ...], "caseSensitive": boolean}',
  '- The tokens must appear in order on one line, separated by optional spaces or tabs.',
  '- A token written exactly as (?<name>) is a placeholder: it captures one word [0-9A-Za-z_]+ under group "name".',
  '- Any other token is a literal, matched as written, with a word boundary where it starts or ends with a word character. caseSensitive false makes literals case-insensitive.',
  '- At least one literal token; placeholder names must be unique. Tokens contain no whitespace.',
  '',
  '"regex": {"pattern": string, "flags": string, "multiline": boolean}',
  '- RE2 syntax only: no lookahead or lookbehind, no backreferences, no possessive quantifiers or atomic groups.',
  '- Named groups must be written (?<name>...), never (?P<name>...).',
  '- "flags" is a subset of "ims" in that order: i ignore case, m ^ and $ match at line breaks, s dot matches newline. Use "" for none.',
  '- multiline false: the pattern runs on each line separately, without the line break.',
  '- multiline true: the pattern runs once on the whole file text; a match is reported on the line where it starts.',
  '- Every non-overlapping match is reported, left to right.',
].join('\n');

function preparationText(lexical: LexicalSettings): string {
  return [
    '# How text is prepared before matching',
    'Comments and string literals are replaced by spaces before any rule runs; line numbers and columns do not change. Settings in effect:',
    describeLexical(lexical),
    'Set "searchStrings": true only when the value to capture is itself inside a string literal. For such a rule, string literals are kept as written and only comments are blanked.',
  ].join('\n');
}

const ANSWER_TEXT = [
  '# Answer',
  'Return one JSON object, either',
  '{"rules": [RULE]}',
  'or, when the documentation does not justify a rule,',
  '{"rules": [], "notJustified": "<why the documentation and examples do not justify a rule>"}',
  '',
  'RULE is {"engine": "exact", "exact": {...}, "captures": {...}, "rationale": "..."} or {"engine": "regex", "regex": {...}, "captures": {...}, "rationale": "..."}, optionally with "searchStrings": true and "blockEnd": {"pattern": ..., "flags": ..., "multiline": ...}.',
  '"rationale": one or two sentences naming the documentation statements the rule follows.',
  '',
  'Instructions:',
  '- Prefer "exact" over "regex".',
  '- Use named captures for every capture role.',
  '- Propose exactly one rule, or none. That one rule must produce every positive example\'s matches by itself.',
  '- Follow the documentation, not only the examples: the rule will also run on real code you have not seen.',
  '- If the documentation does not justify a rule, propose none and say why in "notJustified".',
  '- Use no fields other than the ones named here.',
].join('\n');

export interface ProposalPromptInput {
  readonly languageId: string;
  readonly construct: Construct;
  readonly ruleType: RuleType;
  readonly lexical: LexicalSettings;
  readonly limits?: PromptLimits;
}

/**
 * Selects the examples shown in a proposal prompt, within the limits:
 * positive examples first (up to the slots left after reserving up to a
 * quarter, at least one, for negative examples), then negative examples; each
 * group in construct order (by id). An example that would exceed the total
 * character budget is skipped. Review examples are never shown (D16 g).
 */
export function selectPromptExamples(construct: Construct, limits: PromptLimits = DEFAULT_PROMPT_LIMITS): { shown: Example[]; omitted: number } {
  const safe = construct.examples.filter(isPromptSafeExample);
  const positives = safe.filter((e) => e.polarity === 'positive');
  const negatives = safe.filter((e) => e.polarity === 'negative');
  const negativeSlots = Math.min(negatives.length, Math.max(1, Math.floor(limits.examplesPerPrompt / 4)));
  const positiveSlots = limits.examplesPerPrompt - negativeSlots;

  const shown: Example[] = [];
  let chars = 0;
  const take = (candidates: readonly Example[], slots: number): void => {
    let taken = 0;
    for (const example of candidates) {
      if (taken >= slots || shown.length >= limits.examplesPerPrompt) return;
      const size = Math.min(example.code.length, limits.exampleCodeChars);
      if (shown.length > 0 && chars + size > limits.exampleTotalChars) continue;
      shown.push(example);
      chars += size;
      taken += 1;
    }
  };
  take(positives, positiveSlots);
  take(negatives, limits.examplesPerPrompt - shown.length);
  return { shown, omitted: safe.length - shown.length };
}

/** The first user message for one construct (plan §8 step 2). */
export function buildProposalMessage(input: ProposalPromptInput): string {
  const limits = input.limits ?? DEFAULT_PROMPT_LIMITS;
  const { construct } = input;
  const { shown, omitted } = selectPromptExamples(construct, limits);
  const parts = [
    '# Task',
    `Language: ${input.languageId}`,
    `Construct: ${construct.id}`,
    `Propose one detection rule for this construct.`,
    '',
    '# Rule contract',
    contractExcerpt(input.ruleType),
    '',
    ENGINE_TEXT,
    '',
    preparationText(input.lexical),
    '',
    `# Documentation (${construct.anchor})`,
    fenced(construct.prose),
    '',
    '# Labelled examples',
    'Positive: the rule must produce exactly the expected matches (line numbers count from 1 within the example, captured values exactly as listed) and no other match.',
    'Negative: the rule must produce no match.',
    'The rule is also run against the negative examples of every other construct of the language.',
    '',
    ...shown.map((example) => formatExample(example, limits) + '\n'),
  ];
  if (omitted > 0) {
    parts.push(`(${String(omitted)} more example(s) of this construct are not shown; they are tested too.)`, '');
  }
  parts.push(ANSWER_TEXT);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Refinement feedback (plan §8 step 5)
// ---------------------------------------------------------------------------

/** Why the previous attempt failed, in a shape the feedback builder can render. */
export type AttemptFailure =
  | { readonly kind: 'invalid-output'; readonly message: string }
  | { readonly kind: 'invalid-rule'; readonly draft: RuleDraft; readonly issues: readonly string[] }
  | {
      readonly kind: 'failed-tests';
      readonly draft: RuleDraft;
      /** Passed / total of the construct's own examples that may be shown (review examples excluded). */
      readonly ownPassed: number;
      readonly ownTotal: number;
      /** Failing results: own examples and cross-construct negatives. */
      readonly failing: readonly ExampleResult[];
    };

export interface RefinementInput {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly failure: AttemptFailure;
  /** Every example of the language, to look up failing examples' code. */
  readonly examplesById: ReadonlyMap<string, Example>;
  readonly limits?: PromptLimits;
}

function formatActualVsExpected(result: ExampleResult): string[] {
  const lines: string[] = [];
  for (const missed of result.missed) {
    lines.push(`- missed: expected a match on line ${String(missed.line)} with ${formatCaptures(missed.captures)}; the rule found none on that line`);
  }
  for (const wrong of result.wrongCaptures) {
    lines.push(
      `- wrong captures on line ${String(wrong.line)}: expected ${formatCaptures(wrong.expectedCaptures)}, got ${formatCaptures(wrong.actualCaptures)}`,
    );
  }
  for (const extra of result.unexpected) {
    lines.push(`- unexpected match on line ${String(extra.line)} with ${formatCaptures(extra.captures)}`);
  }
  return lines;
}

function formatFailingExample(result: ExampleResult, example: Example | undefined, limits: PromptLimits): string {
  const heading =
    result.role === 'cross-negative'
      ? `## ${result.exampleId} (negative example of construct ${result.construct})`
      : `## ${result.exampleId} (${result.polarity})`;
  const body = example !== undefined ? [fenced(boundCode(example.code, limits.exampleCodeChars)), formatExpected(example.expected)] : [];
  return [heading, ...body, 'What the rule did:', ...formatActualVsExpected(result)].join('\n');
}

/** The user message after a failed attempt. */
export function buildRefinementMessage(input: RefinementInput): string {
  const limits = input.limits ?? DEFAULT_PROMPT_LIMITS;
  const { failure } = input;
  const head = `Attempt ${String(input.attempt)} of ${String(input.maxAttempts)} failed.`;
  const tail = 'Propose a corrected rule, or none with "notJustified". Answer in the same JSON format as before.';

  if (failure.kind === 'invalid-output') {
    return [head, '', 'Your answer could not be used:', failure.message, '', tail].join('\n');
  }

  const previous = ['Previous rule:', JSON.stringify(failure.draft)];
  if (failure.kind === 'invalid-rule') {
    return [head, '', ...previous, '', 'It is not valid under the Rule Set contract:', ...failure.issues.map((i) => `- ${i}`), '', tail].join('\n');
  }

  const visible = failure.failing.filter((r) => {
    const example = input.examplesById.get(r.exampleId);
    return example !== undefined && isPromptSafeExample(example);
  });
  const withheld = failure.failing.length - visible.length;
  const shown = visible.slice(0, limits.failingExamplesShown);
  const cross = failure.failing.filter((r) => r.role === 'cross-negative').length;

  const parts = [
    head,
    '',
    ...previous,
    '',
    `Test result: ${String(failure.ownPassed)} of ${String(failure.ownTotal)} documented examples of this construct passed` +
      (cross > 0 ? `; ${String(cross)} negative example(s) of other constructs were matched.` : '.'),
    '',
    'Failing examples:',
    '',
    ...shown.map((r) => formatFailingExample(r, input.examplesById.get(r.exampleId), limits) + '\n'),
  ];
  if (visible.length > shown.length) {
    parts.push(`(${String(visible.length - shown.length)} more failing example(s) not shown.)`, '');
  }
  if (withheld > 0) {
    parts.push(
      `${String(withheld)} failing example(s) come from human review of repository samples; their content is not shown. ` +
        'Fix the rule from the documentation and the examples above.',
      '',
    );
  }
  parts.push(tail);
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Lexical settings (Rule Set top-level fields)
// ---------------------------------------------------------------------------

export interface LexicalDoc {
  /** Skill file path relative to the Skill directory. */
  readonly path: string;
  readonly text: string;
}

/** The general documentation actually shown, after the character bound. */
export function boundLexicalDocs(docs: readonly LexicalDoc[], limits: PromptLimits = DEFAULT_PROMPT_LIMITS): LexicalDoc[] {
  let remaining = limits.lexicalDocChars;
  const shown: LexicalDoc[] = [];
  for (const doc of docs) {
    if (remaining <= 0) break;
    const text = doc.text.length <= remaining ? doc.text : `${doc.text.slice(0, remaining)}\n… [truncated]`;
    remaining -= Math.min(doc.text.length, remaining);
    shown.push({ path: doc.path, text });
  }
  return shown;
}

export function buildLexicalMessage(languageId: string, docs: readonly LexicalDoc[], limits: PromptLimits = DEFAULT_PROMPT_LIMITS): string {
  const shown = boundLexicalDocs(docs, limits).flatMap((doc) => [`## ${doc.path}`, fenced(doc.text), '']);
  return [
    '# Task',
    `Language: ${languageId}`,
    'Read the general documentation below and give the lexical settings a scanner needs for this language.',
    '',
    '# Fields',
    '- "fileMatchers": globs of the source files of this language, relative to the repository root, with "/" separators. Only "**" (any number of directories), "*" (any characters except "/") and "?" (one character) are wildcards. Globs are case-sensitive.',
    '- "lineComment": the marker that starts a comment running to the end of the line.',
    '- "blockComment": {"start": ..., "end": ...} markers of a comment that may span lines.',
    '- "stringDelimiters": [{"start": ..., "end": ...}] of string literals.',
    'Omit a field the documentation does not describe. Every marker and file extension you give must appear literally in the documentation.',
    '',
    '# Documentation',
    ...shown,
    '# Answer',
    'Return one JSON object: {"fileMatchers": [...], "lineComment"?: ..., "blockComment"?: {...}, "stringDelimiters"?: [...]}.',
    'If the documentation does not say which files belong to the language, return {"fileMatchers": [], "notJustified": "<why>"}.',
    'Use no other fields.',
  ].join('\n');
}

export function buildLexicalRefinementMessage(attempt: number, maxAttempts: number, problems: readonly string[]): string {
  return [
    `Attempt ${String(attempt)} of ${String(maxAttempts)} failed.`,
    '',
    ...problems.map((p) => `- ${p}`),
    '',
    'Give corrected lexical settings in the same JSON format as before.',
  ].join('\n');
}
