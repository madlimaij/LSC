/**
 * `synthesis.json`: what the synthesis loop did, per construct and attempt.
 * Written by `lsc compile` next to the draft Rule Set and `results.json`, so
 * rejected rules, "not justified" answers and every failure reason stay
 * visible (WP-09 brief). A Zod schema so WP-07/WP-10 can read it safely.
 */
import { z } from 'zod';
import { DelimiterPairSchema, RuleTypeSchema } from '../contract/index.js';
import { LexicalProposalSchema, RuleDraftSchema } from './schema.js';

const UsageSchema = z.strictObject({
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
});

const HashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const LexicalAttemptSchema = z.strictObject({
  attempt: z.int().min(1),
  requestHash: HashSchema,
  outcome: z.enum(['accepted', 'invalid-output', 'unjustified-settings', 'not-justified']),
  problems: z.array(z.string()),
  usage: UsageSchema,
  proposal: LexicalProposalSchema.optional(),
});

export const LexicalSettingsSchema = z.strictObject({
  fileMatchers: z.array(z.string().min(1)),
  lineComment: z.string().min(1).optional(),
  blockComment: DelimiterPairSchema.optional(),
  stringDelimiters: z.array(DelimiterPairSchema).optional(),
});

export const ConstructAttemptSchema = z.strictObject({
  attempt: z.int().min(1),
  requestHash: HashSchema,
  outcome: z.enum(['passed', 'failed-tests', 'invalid-output', 'invalid-rule', 'not-justified']),
  problems: z.array(z.string()),
  usage: UsageSchema,
  draft: RuleDraftSchema.optional(),
  tests: z
    .strictObject({
      passed: z.int().min(0),
      failed: z.int().min(0),
      failingExampleIds: z.array(z.string()),
      crossNegativeFailures: z.array(z.string()),
    })
    .optional(),
  notJustified: z.string().optional(),
});

export const ConstructSynthesisSchema = z.strictObject({
  constructId: z.string(),
  ruleType: RuleTypeSchema.optional(),
  /** `not-attempted`: the compile stopped (budget, provider error) before this construct. */
  status: z.enum(['validated', 'rejected', 'not-justified', 'skipped', 'not-attempted']),
  reason: z.string().optional(),
  /** Id of the rule in the draft Rule Set (validated or rejected), when there is one. */
  ruleId: z.string().optional(),
  attempts: z.array(ConstructAttemptSchema),
});

export const SynthesisReportSchema = z.strictObject({
  languageId: z.string(),
  compilerVersion: z.string(),
  generatedAt: z.iso.datetime(),
  /** `completed`: every construct was processed. `failed`: no Rule Set (lexical settings missing). `aborted`: stopped early by an infrastructure error. */
  status: z.enum(['completed', 'failed', 'aborted']),
  error: z.string().optional(),
  maxAttemptsPerConstruct: z.int().min(1),
  lexical: z.strictObject({
    status: z.enum(['accepted', 'rejected', 'not-justified', 'no-documentation', 'not-attempted']),
    reason: z.string().optional(),
    settings: LexicalSettingsSchema.optional(),
    attempts: z.array(LexicalAttemptSchema),
  }),
  constructs: z.array(ConstructSynthesisSchema),
  summary: z.strictObject({
    constructs: z.int().min(0),
    validated: z.int().min(0),
    rejected: z.int().min(0),
    notJustified: z.int().min(0),
    skipped: z.int().min(0),
    notAttempted: z.int().min(0),
  }),
  /** Model usage as reported per call (input + output tokens), and number of calls. */
  usage: z.strictObject({
    inputTokens: z.int().min(0),
    outputTokens: z.int().min(0),
    calls: z.int().min(0),
  }),
  /** Ingestion diagnostics (`file:line: message`). */
  ingestDiagnostics: z.array(z.string()),
});

export type SynthesisReport = z.infer<typeof SynthesisReportSchema>;
export type ConstructSynthesis = z.infer<typeof ConstructSynthesisSchema>;
