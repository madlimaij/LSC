/**
 * The report's own data model: everything the Markdown, HTML and JSON
 * renderers need, built once by `buildReport` (docs/PLAN.md §7, WP-07
 * brief). Keeping this separate from `Results` (WP-05) means the renderers
 * never have to recompute confidence reasons, coverage status or example
 * locations themselves.
 */
import type { Confidence, RuleType } from '../contract/index.js';
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
}
