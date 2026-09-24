/**
 * The `Example` record (docs/PLAN.md §6.1): the one shape every labelled code
 * example takes, whether it comes from a Skill file (inline, parsed by WP-06),
 * a sidecar file pair, or a human review (`reviews.yaml`, D9).
 *
 * Format reference for other modules: src/examples/README.md.
 */
import { z } from 'zod';
import {
  CaptureRoleSchema,
  KEBAB_CASE_PATTERN,
  RULE_TYPE_SPEC,
  RULE_TYPES,
  type CaptureRole,
  type RuleType,
} from '../contract/index.js';

/** Example ids and construct ids are kebab-case, like rule ids. */
export const EXAMPLE_ID_PATTERN = KEBAB_CASE_PATTERN;
export const CONSTRUCT_ID_PATTERN = KEBAB_CASE_PATTERN;

const QUOTE_HINT = 'quote values YAML would read as a number, boolean or null';

const nonEmptyString = () =>
  z.string({ error: `must be a string (${QUOTE_HINT})` }).min(1, { error: 'must not be empty' });

export const ExampleIdSchema = z
  .string({ error: 'must be a string' })
  .regex(EXAMPLE_ID_PATTERN, { error: 'must be a kebab-case example id, e.g. "proc-01"' });

export const ConstructIdSchema = z
  .string({ error: 'must be a string' })
  .regex(CONSTRUCT_ID_PATTERN, { error: 'must be a kebab-case construct id, e.g. "proc-definition"' });

export const PolaritySchema = z.enum(['positive', 'negative'], {
  error: 'must be "positive" or "negative"',
});

export const ExpectedCapturesSchema = z.partialRecord(CaptureRoleSchema, nonEmptyString());

/**
 * One match the construct's rule must produce: the 1-based line (within
 * `code`) where the match starts, its rule type, and the exact text of every
 * capture role the match produces.
 */
export const ExpectedMatchSchema = z.strictObject({
  line: z.int({ error: 'must be a whole number' }).min(1, { error: 'must be 1 or greater' }),
  type: z.enum(RULE_TYPES, { error: `must be a rule type: ${RULE_TYPES.join(', ')}` }),
  captures: ExpectedCapturesSchema,
});

export const ExpectedMatchListSchema = z.array(ExpectedMatchSchema, {
  error: 'must be a list of expected matches',
});

const PathSchema = nonEmptyString();

/** Inline example in a Skill file (WP-06). */
export const InlineSourceSchema = z.strictObject({
  kind: z.literal('inline'),
  /** Skill file path relative to the Skill directory, `/` separators (as in `sourceSkills`). */
  skill: PathSchema,
  /** 1-based line of the opening code fence in the Skill file. */
  line: z.int().min(1),
});

/** Sidecar pair `examples/<construct>/<id>.<ext>` + `<id>.expect.yaml`. */
export const SidecarSourceSchema = z.strictObject({
  kind: z.literal('sidecar'),
  /** Code file path relative to the examples directory, `/` separators. */
  file: PathSchema,
  /** Expect file path relative to the examples directory, `/` separators. */
  expectFile: PathSchema,
});

export const ReviewVerdictSchema = z.enum(['correct', 'false_positive'], {
  error: 'must be "correct" or "false_positive"',
});

/**
 * Entry in `reviews.yaml` (D9). The code is repository-sample text: see
 * README.md "Review examples and the model" before sending it anywhere.
 */
export const ReviewSourceSchema = z.strictObject({
  kind: z.literal('review'),
  /** reviews.yaml path as given to the loader. */
  file: PathSchema,
  /** 0-based index of the entry in the `reviews` list. */
  entry: z.int().min(0),
  /** Rule whose sample match was reviewed. */
  ruleId: z.string().regex(KEBAB_CASE_PATTERN),
  /** Sample file (relative to the sample directory, `/` separators) and 1-based line of the match. */
  sampleFile: PathSchema,
  sampleLine: z.int().min(1),
  verdict: ReviewVerdictSchema,
});

export const ExampleSourceSchema = z.discriminatedUnion('kind', [
  InlineSourceSchema,
  SidecarSourceSchema,
  ReviewSourceSchema,
]);

/** Number of lines in normalised code; a final newline does not start a new line. */
export function codeLineCount(code: string): number {
  const lines = code.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

/**
 * Normalises example code as every loader must: removes a UTF-8 byte order
 * mark and turns `\r\n` into `\n` (contract/CONTRACT.md §6.2). Nothing else is
 * changed: indentation and a final newline are kept.
 */
export function normalizeCode(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, '\n');
}

const ExampleShape = z.strictObject({
  id: ExampleIdSchema,
  construct: ConstructIdSchema,
  polarity: PolaritySchema,
  code: z.string({ error: 'must be a string' }),
  expected: ExpectedMatchListSchema,
  source: ExampleSourceSchema,
});

type ExampleShapeType = z.infer<typeof ExampleShape>;

function checkExample(example: ExampleShapeType, ctx: z.RefinementCtx): void {
  const { code, expected, polarity } = example;
  if (code.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['code'], message: 'must not be empty' });
    return;
  }
  if (code.includes('\r\n') || code.charCodeAt(0) === 0xfeff) {
    ctx.addIssue({
      code: 'custom',
      path: ['code'],
      message: 'must use \\n line endings and no byte order mark (normalise it with normalizeCode)',
    });
  }
  if (polarity === 'positive' && expected.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['expected'],
      message: 'a positive example needs at least one expected match',
    });
  }
  if (polarity === 'negative' && expected.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['expected'],
      message: 'a negative example must not list expected matches (the rule must match nothing)',
    });
  }
  const lineCount = codeLineCount(code);
  const firstType = expected[0]?.type;
  const seen = new Set<string>();
  expected.forEach((match, index) => {
    if (match.line > lineCount) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', index, 'line'],
        message: `line ${String(match.line)} is past the end of the code (${String(lineCount)} line${lineCount === 1 ? '' : 's'})`,
      });
    }
    if (firstType !== undefined && match.type !== firstType) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', index, 'type'],
        message: `all expected matches of one example must have the same type (the construct's rule type); first is "${firstType}", this is "${match.type}"`,
      });
    }
    checkCaptureRoles(match.type, match.captures, index, ctx);
    const key = JSON.stringify([match.line, match.type, sortedEntries(match.captures)]);
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', index],
        message: `duplicate expected match (same line, type and captures as an earlier entry)`,
      });
    }
    seen.add(key);
  });
}

function sortedEntries(captures: Partial<Record<CaptureRole, string>>): [string, string][] {
  return Object.entries(captures)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function checkCaptureRoles(
  type: RuleType,
  captures: Partial<Record<CaptureRole, string>>,
  index: number,
  ctx: z.RefinementCtx,
): void {
  const spec = RULE_TYPE_SPEC[type];
  for (const role of spec.requiredRoles) {
    if (captures[role] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', index, 'captures'],
        message: `type "${type}" requires capture "${role}"`,
      });
    }
  }
  const allowed = new Set<CaptureRole>([...spec.requiredRoles, ...spec.optionalRoles]);
  for (const role of Object.keys(captures) as CaptureRole[]) {
    if (!allowed.has(role)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expected', index, 'captures', role],
        message: `type "${type}" has no capture role "${role}" (allowed: ${[...allowed].join(', ')})`,
      });
    }
  }
}

/**
 * A labelled example. Invariants beyond the field types (checked by the
 * schema, so a parsed Example always satisfies them):
 * - `code` is not blank and uses `\n` line endings (see `normalizeCode`);
 * - positive ⇒ at least one expected match; negative ⇒ none;
 * - every expected `line` is within `code`;
 * - all expected matches share one rule type;
 * - each match's captures contain the type's required roles and only its
 *   required or optional roles (RULE_TYPE_SPEC);
 * - no two expected matches are identical.
 */
export const ExampleSchema = ExampleShape.superRefine(checkExample);

export type Polarity = z.infer<typeof PolaritySchema>;
export type ExpectedCaptures = z.infer<typeof ExpectedCapturesSchema>;
export type ExpectedMatch = z.infer<typeof ExpectedMatchSchema>;
export type InlineSource = z.infer<typeof InlineSourceSchema>;
export type SidecarSource = z.infer<typeof SidecarSourceSchema>;
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;
export type ExampleSource = z.infer<typeof ExampleSourceSchema>;
export type Example = z.infer<typeof ExampleSchema>;

/** Deterministic order for example lists: by construct, then id (code-unit comparison). */
export function compareExamples(a: Pick<Example, 'construct' | 'id'>, b: Pick<Example, 'construct' | 'id'>): number {
  if (a.construct !== b.construct) return a.construct < b.construct ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** The rule type of an example's expected matches, or undefined for a negative example. */
export function exampleRuleType(example: Pick<Example, 'expected'>): RuleType | undefined {
  return example.expected[0]?.type;
}
