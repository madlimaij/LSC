/**
 * The report's own data model: everything the Markdown, HTML and JSON
 * renderers need, built once by `buildReport` (docs/PLAN.md §7, WP-07
 * brief). Keeping this separate from `Results` (WP-05) means the renderers
 * never have to recompute confidence reasons, coverage status or example
 * locations themselves.
 */
import type { Confidence, DelimiterPair, RuleType } from '../contract/index.js';
import type { ExpectedMatch } from '../examples/index.js';
import type { CoverageConstruct, MatchSummary, SampleMatch, SampleWarning, WrongCapture } from '../runner/index.js';

export interface LocatedSnippet {
  readonly location: string;
  readonly lines: { readonly line: number; readonly text: string }[];
}

export interface MissedExampleEntry {
  readonly exampleId: string;
  readonly construct: string;
  readonly missed: readonly ExpectedMatch[];
  readonly snippet?: LocatedSnippet;
}

export interface WrongCaptureEntry {
  readonly exampleId: string;
  readonly construct: string;
  readonly wrongCaptures: readonly WrongCapture[];
  readonly snippet?: LocatedSnippet;
}

export interface FalsePositiveEntry {
  readonly exampleId: string;
  readonly construct: string;
  /** `own`: the rule's own negative example. `cross-negative`: another construct's negative example (D19 a). */
  readonly role: 'own' | 'cross-negative';
  readonly unexpected: readonly MatchSummary[];
  readonly snippet?: LocatedSnippet;
}

export interface ExtraMatchEntry {
  readonly exampleId: string;
  readonly construct: string;
  readonly unexpected: readonly MatchSummary[];
  readonly snippet?: LocatedSnippet;
}

export interface RepresentativeMatchEntry {
  readonly exampleId: string;
  readonly construct: string;
  /** The example's own expected matches (only available with `--skills-dir`; empty otherwise). */
  readonly expected: readonly ExpectedMatch[];
  readonly snippet?: LocatedSnippet;
}

export interface ProvenanceEntry {
  readonly skill: string;
  readonly anchor: string;
  readonly exampleIds: readonly string[];
}

export interface RuleReport {
  readonly ruleId: string;
  readonly type: RuleType;
  readonly ok: boolean;
  readonly declaredConfidence: Confidence;
  readonly computedConfidence?: Confidence;
  readonly confidenceMatchesDeclared: boolean;
  /** Never absent: CLAUDE.md "Never show a confidence level without the reason for it". */
  readonly confidenceReason: string;
  readonly declaredMismatchNote?: string;
  readonly passRate: number;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly missingExampleIds: readonly string[];
  readonly crossNegativeFailures: readonly string[];
  readonly missedExamples: readonly MissedExampleEntry[];
  readonly wrongCaptureExamples: readonly WrongCaptureEntry[];
  readonly falsePositives: readonly FalsePositiveEntry[];
  readonly extraMatchesOnPositive: readonly ExtraMatchEntry[];
  readonly representativeMatches: readonly RepresentativeMatchEntry[];
  readonly sampleMatches: readonly SampleMatch[];
  /** Only present when the report was built with `--ruleset`. */
  readonly pattern?: string;
  readonly captures?: readonly (readonly [string, string])[];
  readonly provenance?: readonly ProvenanceEntry[];
}

export interface CoverageRow {
  readonly ruleType: RuleType;
  readonly ruleIds: readonly string[];
  readonly status: 'no-rule' | 'rejected' | 'low-confidence' | 'validated';
  readonly confidences: readonly Confidence[];
}

export interface OverallVerdict {
  readonly verdict: 'validated' | 'low-confidence' | 'rejected';
  /** One line, always includes a reason; never a bare label. */
  readonly summary: string;
  readonly reasons: readonly string[];
  /** Across every rule's own examples (D19 a), not counting cross-construct negatives. */
  readonly examplePassRate: number;
  readonly totalOwnExamples: number;
  readonly validatedRuleCount: number;
  readonly lowConfidenceRuleCount: number;
  readonly rejectedRuleCount: number;
  readonly constructsWithoutUsableRule: readonly string[];
  /** Sum of every rule's `sampleMatches.length` (D25 item 2: shown in the verdict line, e.g. "138 sample matches not yet reviewed"). */
  readonly unreviewedSampleMatchCount: number;
}

/** The Rule Set's language-wide lexical settings (docs/PLAN.md §5.1), shown so a reader does not have to open the Rule Set JSON (D25 item 2). Only present with `--ruleset`. */
export interface LexicalSettingsView {
  readonly fileMatchers: readonly string[];
  readonly lineComment?: string;
  readonly blockComment?: DelimiterPair;
  readonly stringDelimiters?: readonly DelimiterPair[];
}

/** One `synthesis.json` attempt, with review-example capture text withheld (plan §8: no repository sample ever reaches a report the way it reaches a model prompt; see `redactReviewProblem`). */
export interface SynthesisAttemptView {
  readonly attempt: number;
  readonly outcome: string;
  readonly problems: readonly string[];
}

export interface SynthesisConstructView {
  readonly constructId: string;
  readonly ruleType?: RuleType;
  readonly status: string;
  readonly reason?: string;
  readonly ruleId?: string;
  readonly attemptCount: number;
  readonly attempts: readonly SynthesisAttemptView[];
}

export interface SynthesisUsageView {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly calls: number;
}

/** What `synthesis.json` (WP-09, src/synth/synthesis-schema.ts) says about how the draft Rule Set was produced (D25 item 2). Only present with `--synthesis`. */
export interface SynthesisView {
  readonly status: string;
  readonly error?: string;
  readonly lexicalStatus: string;
  readonly lexicalReason?: string;
  readonly constructs: readonly SynthesisConstructView[];
  readonly summary: { readonly constructs: number; readonly validated: number; readonly rejected: number; readonly notJustified: number; readonly skipped: number; readonly notAttempted: number };
  readonly usage: SynthesisUsageView;
  /** Always present: `synthesis.json` (src/synth/synthesis-schema.ts) has no `provider`/`model`/recording-origin field as of WP-09 (see this package's WP-07 completion note); this says so instead of silently omitting the section. */
  readonly providerNote: string;
}

/** One Skill file whose hash in the Rule Set's `sourceSkills` no longer matches the file at `--skills-dir` (or is missing there), reviewer Q5 / D25 item 4. */
export interface SkillHashMismatch {
  readonly path: string;
  readonly ruleSetSha256: string;
  /** `undefined` when the file is no longer at that path under `--skills-dir`. */
  readonly currentSha256?: string;
}

export interface Report {
  readonly languageId: string;
  readonly ruleSetVersion: string;
  readonly compilerVersion: string;
  readonly generatedAt: string;
  readonly overall: OverallVerdict;
  readonly coverage: readonly CoverageRow[];
  readonly constructCoverage: readonly CoverageConstruct[];
  readonly rules: readonly RuleReport[];
  readonly sampleWarnings: readonly SampleWarning[];
  readonly sourceSkills?: readonly { readonly path: string; readonly sha256: string }[];
  /** Only present with `--ruleset`. */
  readonly lexical?: LexicalSettingsView;
  /** Only present with `--synthesis`. */
  readonly synthesis?: SynthesisView;
  /** Only present with both `--ruleset` and `--skills-dir`; empty when every hash still matches. */
  readonly skillHashMismatches?: readonly SkillHashMismatch[];
}
