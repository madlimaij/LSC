/**
 * Zod schemas and inferred types for the Rule Set contract (docs/PLAN.md §5.1–5.2).
 *
 * These schemas describe the *structure* only. They are exported to
 * contract/rule-set.schema.json. Cross-field rules that JSON Schema cannot
 * express live in ./validate.ts and are listed in contract/CONTRACT.md §5.
 *
 * All objects are strict: unknown properties are rejected, so a misspelt field
 * fails loudly instead of being ignored.
 */
import { z } from 'zod';
import { CAPTURE_ROLES, RULE_TYPES } from './rule-types.js';
import {
  CONTRACT_VERSION,
  SEMVER_PATTERN,
  SUPPORTED_CONTRACT_VERSION_PATTERN,
  SUPPORTED_CONTRACT_VERSION_RANGE,
} from './version.js';

/** kebab-case: lowercase ASCII letters and digits, words joined by single hyphens. */
export const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Allowed regex flags, in this canonical order, each at most once. */
export const REGEX_FLAGS_PATTERN = /^i?m?s?$/;

const GROUP_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const nonEmpty = () => z.string().min(1);

const semver = (what: string) =>
  z.string().regex(SEMVER_PATTERN, { message: `${what} must be a semantic version (x.y.z)` });

export const SemverSchema = semver('value');

export const RuleTypeSchema = z
  .enum(RULE_TYPES)
  .meta({ id: 'RuleType', description: 'What the rule detects; determines the Navigator record (see RULE_TYPE_SPEC).' });

export const CaptureRoleSchema = z
  .enum(CAPTURE_ROLES)
  .meta({ id: 'CaptureRole', description: 'Role of a captured value; allowed roles depend on the rule type.' });

export const ConfidenceSchema = z
  .enum(['high', 'medium', 'low'])
  .describe('Computed by the fixed formula in docs/PLAN.md §6.3 (D8); never model-assigned.');

export const RuleStatusSchema = z
  .enum(['validated', 'rejected'])
  .describe('Only validated rules are exported; consumers must ignore rejected rules.');

export const ExactConfigSchema = z
  .strictObject({
    tokens: z
      .array(
        z
          .string()
          .regex(/^\S+$/, { message: 'exact tokens must be non-empty and contain no whitespace' }),
      )
      .min(1)
      .describe(
        'Token sequence matched on one line. A token written exactly as (?<name>) is a capture placeholder.',
      ),
    caseSensitive: z.boolean().describe('false: literal tokens match case-insensitively (RE2 flag i).'),
  })
  .meta({ id: 'ExactConfig', description: 'Exact engine configuration (contract/CONTRACT.md §6.4).' });

export const RegexConfigSchema = z
  .strictObject({
    pattern: nonEmpty().describe(
      'RE2-compatible pattern (D3). Named groups use the (?<name>...) form (D2).',
    ),
    flags: z
      .string()
      .regex(REGEX_FLAGS_PATTERN, {
        message: 'flags may contain only i, m, s, each at most once, in that order',
      })
      .describe('Subset of "ims" in that order: i case-insensitive, m ^/$ at line breaks, s dot matches newline.'),
    multiline: z
      .boolean()
      .describe('false: applied to each line separately; true: applied to the whole file text.'),
  })
  .meta({ id: 'RegexConfig', description: 'RE2 regex configuration (contract/CONTRACT.md §6.4).' });

export const CapturesSchema = z
  .partialRecord(
    CaptureRoleSchema,
    z.string().regex(GROUP_NAME, { message: 'capture group names must be identifiers' }),
  )
  .meta({
    id: 'Captures',
    description:
      'Capture role → named group in the pattern (or placeholder in exact tokens). Must include the roles required by the rule type.',
  });

export const SourceEvidenceSchema = z
  .strictObject({
    skill: nonEmpty().describe('Skill file path, relative to the Skill directory, with forward slashes.'),
    anchor: nonEmpty().describe('Section anchor (heading slug) inside the Skill file.'),
    exampleIds: z.array(nonEmpty()).describe('IDs of the examples that justify the rule.'),
  })
  .meta({ id: 'SourceEvidence', description: 'Provenance: where the rule comes from.' });

export const RuleTestsSchema = z
  .strictObject({
    passed: z.int().min(0).describe('Examples passed in the last validation.'),
    failed: z.int().min(0).describe('Examples failed in the last validation.'),
    failingExampleIds: z.array(nonEmpty()).describe('IDs of the failing examples.'),
  })
  .meta({ id: 'RuleTests', description: 'Result of the last validation run (docs/PLAN.md §6.2).' });

const ruleIdentityShape = {
  id: z
    .string()
    .regex(KEBAB_CASE_PATTERN, { message: 'rule id must be kebab-case' })
    .describe('Stable kebab-case identifier, unique within the Rule Set.'),
  type: RuleTypeSchema,
};

const ruleMetadataShape = {
  captures: CapturesSchema,
  blockEnd: RegexConfigSchema.optional().describe(
    'Closes the scope opened by this definition (D4). Only on module_declaration and symbol_definition.',
  ),
  searchStrings: z
    .boolean()
    .optional()
    .describe('Default false. true: the rule also matches inside string literals (strings are not masked for it).'),
  confidence: ConfidenceSchema,
  sourceEvidence: z.array(SourceEvidenceSchema).min(1).describe('At least one provenance entry.'),
  tests: RuleTestsSchema,
  status: RuleStatusSchema,
};

export const ExactRuleSchema = z
  .strictObject({
    ...ruleIdentityShape,
    engine: z.literal('exact'),
    exact: ExactConfigSchema,
    ...ruleMetadataShape,
  })
  .meta({ id: 'ExactRule', description: 'Rule using the exact (token sequence) engine.' });

export const RegexRuleSchema = z
  .strictObject({
    ...ruleIdentityShape,
    engine: z.literal('regex'),
    regex: RegexConfigSchema,
    ...ruleMetadataShape,
  })
  .meta({ id: 'RegexRule', description: 'Rule using the RE2 regex engine.' });

export const RuleSchema = z
  .discriminatedUnion('engine', [ExactRuleSchema, RegexRuleSchema])
  .meta({
    id: 'Rule',
    description: 'One deterministic rule. `engine` selects which engine configuration is present.',
  });

export const SourceSkillSchema = z.strictObject({
  path: nonEmpty().describe('Skill file path, relative to the Skill directory, with forward slashes.'),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/, { message: 'sha256 must be 64 lowercase hex characters' })
    .describe('SHA-256 of the file bytes, lowercase hex.'),
});

export const DelimiterPairSchema = z
  .strictObject({
    start: nonEmpty(),
    end: nonEmpty(),
  })
  .meta({ id: 'DelimiterPair', description: 'Start and end marker.' });

export const RuleSetSchema = z
  .strictObject({
    contractVersion: z
      .string()
      .regex(SUPPORTED_CONTRACT_VERSION_PATTERN, {
        message: `contractVersion must be ${SUPPORTED_CONTRACT_VERSION_RANGE} (this validator implements contract ${CONTRACT_VERSION})`,
      })
      .describe(
        `Version of the Rule Set format. This schema implements ${CONTRACT_VERSION} and accepts ${SUPPORTED_CONTRACT_VERSION_RANGE}.`,
      ),
    languageId: z
      .string()
      .regex(/^\S+$/, { message: 'languageId must be non-empty and contain no whitespace' })
      .describe('Language identifier.'),
    version: semver('version').describe('Version of this rule content (semver; bump rules in CONTRACT.md §3).'),
    compiledAt: z.iso.datetime().describe('Compile time, ISO 8601 in UTC (suffix Z).'),
    compilerVersion: semver('compilerVersion').describe('Version of the lsc build that produced the file.'),
    sourceSkills: z.array(SourceSkillSchema).describe('Exact Skill file inputs used.'),
    fileMatchers: z
      .array(nonEmpty())
      .min(1)
      .describe('Glob patterns (forward slashes, relative to the repository root) of files the Rule Set applies to.'),
    lineComment: nonEmpty().optional().describe('Line comment marker; the comment runs to end of line.'),
    blockComment: DelimiterPairSchema.optional().describe('Block comment start and end markers (not nested).'),
    stringDelimiters: z
      .array(DelimiterPairSchema)
      .optional()
      .describe('String literal delimiters. No escape sequences in contract 1.0.'),
    rules: z.array(RuleSchema).describe('The rules. Only rules with status validated are applied.'),
  })
  .describe('Language Skill Compiler Rule Set: the contract with Legacy Navigator.');

export type Confidence = z.infer<typeof ConfidenceSchema>;
export type RuleStatus = z.infer<typeof RuleStatusSchema>;
export type ExactConfig = z.infer<typeof ExactConfigSchema>;
export type RegexConfig = z.infer<typeof RegexConfigSchema>;
export type Captures = z.infer<typeof CapturesSchema>;
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;
export type RuleTests = z.infer<typeof RuleTestsSchema>;
export type ExactRule = z.infer<typeof ExactRuleSchema>;
export type RegexRule = z.infer<typeof RegexRuleSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type SourceSkill = z.infer<typeof SourceSkillSchema>;
export type DelimiterPair = z.infer<typeof DelimiterPairSchema>;
export type RuleSet = z.infer<typeof RuleSetSchema>;
export type RuleEngine = Rule['engine'];
