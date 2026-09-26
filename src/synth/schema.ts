/**
 * Zod schemas for what the model may answer (WP-09 brief: "Response schema:
 * `{ rules: RuleDraft[], notJustified?: string }`").
 *
 * Every model answer is parsed with these schemas through `structured()`
 * (src/llm). An answer that does not match is a failed attempt; nothing is
 * repaired or guessed (plan §8 step 3).
 *
 * A `RuleDraft` holds only what the model decides: engine configuration,
 * captures, optional `blockEnd` / `searchStrings`, and a short rationale.
 * The runner adds everything else: `id` (the construct id), `type` (fixed by
 * the construct's positive examples), `sourceEvidence`, `tests`,
 * `confidence` (computed, D8) and `status`.
 */
import { z } from 'zod';
import { CapturesSchema, DelimiterPairSchema, ExactConfigSchema, RegexConfigSchema } from '../contract/index.js';

const rationale = z
  .string()
  .trim()
  .min(1, { message: 'rationale must say which documentation statements the rule follows' })
  .max(2000);

const draftShape = {
  captures: CapturesSchema,
  blockEnd: RegexConfigSchema.optional(),
  searchStrings: z.boolean().optional(),
  rationale,
};

export const ExactRuleDraftSchema = z.strictObject({
  engine: z.literal('exact'),
  exact: ExactConfigSchema,
  ...draftShape,
});

export const RegexRuleDraftSchema = z.strictObject({
  engine: z.literal('regex'),
  regex: RegexConfigSchema,
  ...draftShape,
});

export const RuleDraftSchema = z.discriminatedUnion('engine', [ExactRuleDraftSchema, RegexRuleDraftSchema]);

/**
 * One rule, or none with a reason. At most one rule: a positive example lists
 * every match of its construct (fixtures/toylang/SPEC.md §4, plan §6.2), and
 * the runner tests each rule on its own against all of the construct's
 * examples, so a second rule for the same construct could never pass.
 */
export const ProposalSchema = z
  .strictObject({
    rules: z.array(RuleDraftSchema).max(1, { message: 'propose at most one rule per construct' }),
    notJustified: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.rules.length === 0 && value.notJustified === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['notJustified'],
        message: 'an empty "rules" list needs "notJustified" with the reason',
      });
    }
    if (value.rules.length > 0 && value.notJustified !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['notJustified'],
        message: 'give either a rule or "notJustified", not both',
      });
    }
  });

/**
 * Language-wide lexical settings (Rule Set top-level fields, plan §5.1). Not
 * per construct: they come from the general Skill file(s). Fields the
 * documentation does not describe are omitted.
 */
export const LexicalProposalSchema = z
  .strictObject({
    fileMatchers: z.array(z.string().min(1)).max(20),
    lineComment: z.string().min(1).optional(),
    blockComment: DelimiterPairSchema.optional(),
    stringDelimiters: z.array(DelimiterPairSchema).max(10).optional(),
    notJustified: z.string().trim().min(1).max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.fileMatchers.length === 0 && value.notJustified === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['fileMatchers'],
        message: 'give at least one file glob, or "notJustified" with the reason',
      });
    }
  });

export type ExactRuleDraft = z.infer<typeof ExactRuleDraftSchema>;
export type RegexRuleDraft = z.infer<typeof RegexRuleDraftSchema>;
export type RuleDraft = z.infer<typeof RuleDraftSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type LexicalProposal = z.infer<typeof LexicalProposalSchema>;

/** Lexical settings as they go into the Rule Set. */
export interface LexicalSettings {
  readonly fileMatchers: string[];
  readonly lineComment?: string;
  readonly blockComment?: { readonly start: string; readonly end: string };
  readonly stringDelimiters?: { readonly start: string; readonly end: string }[];
}
