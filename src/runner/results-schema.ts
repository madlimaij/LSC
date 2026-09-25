/**
 * `Results` (WP-05 deliverable): what `runRules` returns, and what `lsc test`
 * writes to `results.json`. WP-07 (report) and WP-09 (synthesis) consume
 * this shape, so it is a Zod schema, not just a TypeScript type.
 */
import { z } from 'zod';
import { CaptureRoleSchema, ConfidenceSchema, RuleTestsSchema, RuleTypeSchema } from '../contract/index.js';
import { ExpectedMatchSchema, PolaritySchema } from '../examples/index.js';

/** A match's captured values, keyed by role (docs/PLAN.md §5.3), as produced by the engines. */
export const MatchCapturesSchema = z.partialRecord(CaptureRoleSchema, z.string());

export const MatchSummarySchema = z.strictObject({
  line: z.int().min(1),
  column: z.int().min(1),
  captures: MatchCapturesSchema,
});

export const CaptureMismatchSchema = z.strictObject({
  role: CaptureRoleSchema,
  expected: z.string().optional(),
  actual: z.string().optional(),
});

/** An expected match found on the right line, but with different captures than expected. */
export const WrongCaptureSchema = z.strictObject({
  line: z.int().min(1),
  expectedCaptures: MatchCapturesSchema,
  actualCaptures: MatchCapturesSchema,
  mismatches: z.array(CaptureMismatchSchema),
});

/** How one rule fared against one example (plan §6.2). */
export const ExampleResultSchema = z.strictObject({
  exampleId: z.string(),
  construct: z.string(),
  polarity: PolaritySchema,
  /** `own`: one of the rule's `sourceEvidence` examples. `cross-negative`: a negative example of another construct (plan §8 step 4). */
  role: z.enum(['own', 'cross-negative']),
  passed: z.boolean(),
  missed: z.array(ExpectedMatchSchema),
  unexpected: z.array(MatchSummarySchema),
  wrongCaptures: z.array(WrongCaptureSchema),
});

export const SnippetLineSchema = z.strictObject({
  line: z.int().min(1),
  text: z.string(),
});

/** An unlabelled match on a repository-sample file (plan §6.2, D9). */
export const SampleMatchSchema = z.strictObject({
  ruleId: z.string(),
  file: z.string(),
  line: z.int().min(1),
  column: z.int().min(1),
  captures: MatchCapturesSchema,
  enclosingSymbol: z.string().optional(),
  /** +-3 lines of context (WP-05 brief). */
  snippet: z.array(SnippetLineSchema),
});

export const RuleResultSchema = z.strictObject({
  ruleId: z.string(),
  type: RuleTypeSchema,
  /** Every example id referenced in the rule's `sourceEvidence` (its own examples). */
  ownExampleIds: z.array(z.string()),
  /** `sourceEvidence` example ids that were not found in the loaded example set. */
  missingExampleIds: z.array(z.string()),
  examples: z.array(ExampleResultSchema),
  /** Same shape as the contract's `RuleTests` (docs/PLAN.md §5.2), so WP-10 can write it back unchanged. */
  tests: RuleTestsSchema,
  /** `confidence` as declared in the Rule Set file. */
  declaredConfidence: ConfidenceSchema,
  /** Computed by the fixed formula (D8); absent when the rule passes no positive example. */
  computedConfidence: ConfidenceSchema.optional(),
  confidenceMatchesDeclared: z.boolean(),
  sampleMatches: z.array(SampleMatchSchema),
});

export const CoverageConstructSchema = z.strictObject({
  construct: z.string(),
  positive: z.int().min(0),
  negative: z.int().min(0),
  /** At least 5 positive and 2 negative examples: the precondition for `high` (plan §6.3). */
  meetsHighThreshold: z.boolean(),
});

export const CoverageSchema = z.strictObject({
  ruleTypesCovered: z.array(RuleTypeSchema),
  ruleTypesMissing: z.array(RuleTypeSchema),
  constructs: z.array(CoverageConstructSchema),
});

export const SampleWarningSchema = z.strictObject({
  kind: z.enum(['unclosed-block', 'unmatched-block-end']),
  ruleId: z.string(),
  file: z.string(),
  line: z.int().min(1),
  column: z.int().min(1),
  message: z.string(),
});

export const ResultsSchema = z.strictObject({
  languageId: z.string(),
  ruleSetVersion: z.string(),
  compilerVersion: z.string(),
  generatedAt: z.iso.datetime(),
  rules: z.array(RuleResultSchema),
  coverage: CoverageSchema,
  sampleWarnings: z.array(SampleWarningSchema),
  filesScanned: z.array(z.string()),
  /** `true` when every rule's `tests.failed` is 0 (CLI exit code, WP-05 brief). */
  ok: z.boolean(),
});

export type MatchCaptures = z.infer<typeof MatchCapturesSchema>;
export type MatchSummary = z.infer<typeof MatchSummarySchema>;
export type CaptureMismatch = z.infer<typeof CaptureMismatchSchema>;
export type WrongCapture = z.infer<typeof WrongCaptureSchema>;
export type ExampleResult = z.infer<typeof ExampleResultSchema>;
export type SnippetLine = z.infer<typeof SnippetLineSchema>;
export type SampleMatch = z.infer<typeof SampleMatchSchema>;
export type RuleResult = z.infer<typeof RuleResultSchema>;
export type CoverageConstruct = z.infer<typeof CoverageConstructSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type SampleWarning = z.infer<typeof SampleWarningSchema>;
export type Results = z.infer<typeof ResultsSchema>;
