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
  /**
   * `results.filesScanned.length > 0` (G2 round, D27 item b / defect A5): a sample scan actually
   * ran. When false, the verdict must say "no sample repository scanned", not "no unreviewed
   * sample matches" — those read as the same good news, but only one of them is.
   */
  readonly sampleScanned: boolean;
  /** Number of sample files the scan covered (`results.filesScanned.length`), 0 when none was scanned. */
  readonly filesScannedCount: number;
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

/** What one lexical-settings attempt proposed (D27 item e: the model's proposal, or `notJustified`, verbatim — no repository-sample text is ever involved here, unlike construct attempts). */
export interface LexicalProposalView {
  readonly fileMatchers: readonly string[];
  readonly lineComment?: string;
  readonly blockComment?: DelimiterPair;
  readonly stringDelimiters?: readonly DelimiterPair[];
  readonly notJustified?: string;
}

/**
 * One attempt at the lexical settings (`synthesis.json`'s `lexical.attempts`, D27 item e): what was
 * proposed and, for a refused attempt, why (e.g. a marker or glob literal that does not occur
 * verbatim in the Skill files sent, D24 a) — shown next to the accepted lexical settings so a reader
 * can see the whole negotiation, not only its outcome.
 */
export interface LexicalAttemptView {
  readonly attempt: number;
  readonly outcome: string;
  readonly problems: readonly string[];
  readonly proposal?: LexicalProposalView;
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

/**
 * The report's view of `synthesis.json`'s `modelSource` (src/synth/model-source.ts, D25 item 2):
 * provider, model and recording origin of the model answers behind this Rule Set. `notRealModel`
 * is true when `origin` is `hand-written` or `mixed`, i.e. at least the hand-written share of the
 * rules were not produced by a real model — the report must say so plainly (WP-07 follow-up).
 */
export interface SynthesisModelSourceView {
  readonly mode: string;
  readonly configuredProvider: string;
  readonly provider: string;
  readonly model: string;
  readonly origin: string;
  readonly summary: string;
  readonly notRealModel: boolean;
}

/** What `synthesis.json` (WP-09, src/synth/synthesis-schema.ts) says about how the draft Rule Set was produced (D25 item 2). Only present with `--synthesis`. */
export interface SynthesisView {
  readonly status: string;
  readonly error?: string;
  readonly lexicalStatus: string;
  readonly lexicalReason?: string;
  /** D27 item e: every lexical-settings attempt, proposed and accepted/refused, in order. */
  readonly lexicalAttempts: readonly LexicalAttemptView[];
  readonly constructs: readonly SynthesisConstructView[];
  readonly summary: { readonly constructs: number; readonly validated: number; readonly rejected: number; readonly notJustified: number; readonly skipped: number; readonly notAttempted: number };
  readonly usage: SynthesisUsageView;
  /** Present when `synthesis.json` has `modelSource` (every file written after this follow-up); rendered instead of `providerNote`. */
  readonly modelSource?: SynthesisModelSourceView;
  /** Present only when `modelSource` is absent (a `synthesis.json` written before it existed): says so instead of silently omitting the section. */
  readonly providerNote?: string;
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
  /**
   * Skill files present under `--skills-dir` that this Rule Set's `sourceSkills` does not cite at
   * all (added since compile; D27 defect A4). Only present with both `--ruleset` and `--skills-dir`;
   * empty when there are none.
   */
  readonly newSkillFiles?: readonly string[];
}
