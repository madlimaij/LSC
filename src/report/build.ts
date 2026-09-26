/**
 * Builds the report data model (`Report`, model.ts) from a `Results` file
 * (WP-05) plus, optionally, the Rule Set it was produced from (for pattern,
 * captures and provenance) and the examples it was tested against (for
 * source locations and snippets). Pure function: no file I/O, so it is easy
 * to unit-test and reused by every renderer and by `lsc report`.
 */
import { RULE_TYPES, type Rule, type RuleSet } from '../contract/index.js';
import type { Example } from '../examples/index.js';
import type { Results, RuleResult } from '../runner/index.js';
import type { SynthesisReport } from '../synth/synthesis-schema.js';
import { declaredMismatchNote, deriveConfidenceStats, explainConfidence } from './confidence-reason.js';
import { exampleSnippet } from './example-location.js';
import type {
  CoverageRow,
  ExtraMatchEntry,
  FalsePositiveEntry,
  LexicalSettingsView,
  LocatedSnippet,
  MissedExampleEntry,
  OverallVerdict,
  ProvenanceEntry,
  Report,
  RepresentativeMatchEntry,
  RuleReport,
  WrongCaptureEntry,
} from './model.js';
import { describeCaptures, describePattern } from './pattern.js';
import { isRuleOk } from './rule-status.js';
import { findNewSkillFiles, findSkillHashMismatches, type SourceSkillLike } from './skill-hash-check.js';
import { buildSynthesisView } from './synthesis-view.js';

export interface BuildReportOptions {
  /** The Rule Set the results were produced from: adds pattern, captures, provenance and lexical settings per rule. */
  readonly ruleSet?: RuleSet;
  /** The examples the results were tested against: adds a `file:line` location and snippet to each entry. */
  readonly examplesById?: ReadonlyMap<string, Example>;
  /** `synthesis.json` (WP-09): adds each construct's synthesis outcome and reasons (D25 item 2). */
  readonly synthesis?: SynthesisReport;
  /**
   * Freshly-hashed Skill files at the `--skills-dir` given to this report (e.g. `ingestSkills(dir).sourceSkills`),
   * compared against `ruleSet.sourceSkills` (reviewer Q5, D25 item 4). Needs `ruleSet` too.
   */
  readonly currentSourceSkills?: readonly SourceSkillLike[];
}

function snippetFor(exampleId: string, line: number, examplesById?: ReadonlyMap<string, Example>): LocatedSnippet | undefined {
  const example = examplesById?.get(exampleId);
  if (example === undefined) return undefined;
  return exampleSnippet(example, line);
}

function buildMissed(rule: RuleResult, examplesById?: ReadonlyMap<string, Example>): MissedExampleEntry[] {
  return rule.examples
    .filter((example) => example.missed.length > 0)
    .map((example) => ({
      exampleId: example.exampleId,
      construct: example.construct,
      missed: example.missed,
      ...(snippetFor(example.exampleId, example.missed[0]?.line ?? 1, examplesById) !== undefined
        ? { snippet: snippetFor(example.exampleId, example.missed[0]?.line ?? 1, examplesById) as LocatedSnippet }
        : {}),
    }));
}

function buildWrongCaptures(rule: RuleResult, examplesById?: ReadonlyMap<string, Example>): WrongCaptureEntry[] {
  return rule.examples
    .filter((example) => example.wrongCaptures.length > 0)
    .map((example) => ({
      exampleId: example.exampleId,
      construct: example.construct,
      wrongCaptures: example.wrongCaptures,
      ...(snippetFor(example.exampleId, example.wrongCaptures[0]?.line ?? 1, examplesById) !== undefined
        ? { snippet: snippetFor(example.exampleId, example.wrongCaptures[0]?.line ?? 1, examplesById) as LocatedSnippet }
        : {}),
    }));
}

function buildFalsePositives(rule: RuleResult, examplesById?: ReadonlyMap<string, Example>): FalsePositiveEntry[] {
  return rule.examples
    .filter((example) => example.polarity === 'negative' && example.unexpected.length > 0)
    .map((example) => ({
      exampleId: example.exampleId,
      construct: example.construct,
      role: example.role,
      unexpected: example.unexpected,
      ...(snippetFor(example.exampleId, example.unexpected[0]?.line ?? 1, examplesById) !== undefined
        ? { snippet: snippetFor(example.exampleId, example.unexpected[0]?.line ?? 1, examplesById) as LocatedSnippet }
        : {}),
    }));
}

function buildExtraMatches(rule: RuleResult, examplesById?: ReadonlyMap<string, Example>): ExtraMatchEntry[] {
  return rule.examples
    .filter((example) => example.polarity === 'positive' && example.unexpected.length > 0)
    .map((example) => ({
      exampleId: example.exampleId,
      construct: example.construct,
      unexpected: example.unexpected,
      ...(snippetFor(example.exampleId, example.unexpected[0]?.line ?? 1, examplesById) !== undefined
        ? { snippet: snippetFor(example.exampleId, example.unexpected[0]?.line ?? 1, examplesById) as LocatedSnippet }
        : {}),
    }));
}

function buildRepresentativeMatches(rule: RuleResult, examplesById?: ReadonlyMap<string, Example>): RepresentativeMatchEntry[] {
  return rule.examples
    .filter((example) => example.role === 'own' && example.polarity === 'positive' && example.passed)
    .map((example) => {
      const loaded = examplesById?.get(example.exampleId);
      const expected = loaded?.expected ?? [];
      const firstLine = expected[0]?.line ?? 1;
      const snippet = snippetFor(example.exampleId, firstLine, examplesById);
      return {
        exampleId: example.exampleId,
        construct: example.construct,
        expected,
        ...(snippet !== undefined ? { snippet } : {}),
      };
    });
}

function buildProvenance(rule: Rule): ProvenanceEntry[] {
  return rule.sourceEvidence.map((evidence) => ({
    skill: evidence.skill,
    anchor: evidence.anchor,
    exampleIds: evidence.exampleIds,
  }));
}

function buildRuleReport(rule: RuleResult, ruleSet?: RuleSet, examplesById?: ReadonlyMap<string, Example>): RuleReport {
  const ok = isRuleOk(rule);
  const stats = deriveConfidenceStats(rule);
  const confidenceReason = explainConfidence(stats, rule.computedConfidence);
  const mismatch = declaredMismatchNote(rule);
  const totalOwn = rule.tests.passed + rule.tests.failed;
  const passRate = totalOwn === 0 ? 0 : rule.tests.passed / totalOwn;
  const definition = ruleSet?.rules.find((r) => r.id === rule.ruleId);

  return {
    ruleId: rule.ruleId,
    type: rule.type,
    ok,
    declaredConfidence: rule.declaredConfidence,
    ...(rule.computedConfidence !== undefined ? { computedConfidence: rule.computedConfidence } : {}),
    confidenceMatchesDeclared: rule.confidenceMatchesDeclared,
    confidenceReason,
    ...(mismatch !== undefined ? { declaredMismatchNote: mismatch } : {}),
    passRate,
    testsPassed: rule.tests.passed,
    testsFailed: rule.tests.failed,
    missingExampleIds: rule.missingExampleIds,
    crossNegativeFailures: rule.crossNegativeFailures,
    missedExamples: buildMissed(rule, examplesById),
    wrongCaptureExamples: buildWrongCaptures(rule, examplesById),
    falsePositives: buildFalsePositives(rule, examplesById),
    extraMatchesOnPositive: buildExtraMatches(rule, examplesById),
    representativeMatches: buildRepresentativeMatches(rule, examplesById),
    sampleMatches: rule.sampleMatches,
    ...(definition !== undefined
      ? {
          pattern: describePattern(definition),
          captures: describeCaptures(definition),
          provenance: buildProvenance(definition),
        }
      : {}),
  };
}

function buildCoverage(rules: readonly RuleReport[]): CoverageRow[] {
  return RULE_TYPES.map((ruleType) => {
    const matching = rules.filter((rule) => rule.type === ruleType);
    if (matching.length === 0) {
      return { ruleType, ruleIds: [], status: 'no-rule', confidences: [] };
    }
    const confidences = matching
      .map((rule) => rule.computedConfidence)
      .filter((confidence): confidence is NonNullable<typeof confidence> => confidence !== undefined);
    let status: CoverageRow['status'];
    if (matching.some((rule) => !rule.ok)) status = 'rejected';
    else if (matching.some((rule) => rule.computedConfidence === 'low')) status = 'low-confidence';
    else status = 'validated';
    return { ruleType, ruleIds: matching.map((rule) => rule.ruleId), status, confidences };
  });
}

function buildOverallVerdict(results: Results, rules: readonly RuleReport[]): OverallVerdict {
  const totalOwnExamples = rules.reduce((sum, rule) => sum + rule.testsPassed + rule.testsFailed, 0);
  const totalOwnPassed = rules.reduce((sum, rule) => sum + rule.testsPassed, 0);
  const examplePassRate = totalOwnExamples === 0 ? 0 : totalOwnPassed / totalOwnExamples;

  const rejected = rules.filter((rule) => !rule.ok);
  const lowConfidence = rules.filter((rule) => rule.ok && rule.computedConfidence === 'low');
  const validated = rules.filter((rule) => rule.ok && (rule.computedConfidence === 'high' || rule.computedConfidence === 'medium'));

  const constructUsable = new Map<string, boolean>();
  for (const rule of results.rules) {
    const constructs = new Set(rule.examples.filter((example) => example.role === 'own').map((example) => example.construct));
    const ok = isRuleOk(rule);
    for (const construct of constructs) {
      constructUsable.set(construct, (constructUsable.get(construct) ?? false) || ok);
    }
  }
  const constructsWithoutUsableRule = results.coverage.constructs
    .map((construct) => construct.construct)
    .filter((construct) => !(constructUsable.get(construct) ?? false));

  const reasons: string[] = [];
  let verdict: OverallVerdict['verdict'] = 'validated';

  if (rejected.length > 0) {
    verdict = 'rejected';
    reasons.push(
      `${String(rejected.length)} of ${String(rules.length)} rule(s) failed their own tests, matched a cross-construct negative, or cite a missing example: ${rejected.map((rule) => rule.ruleId).join(', ')}`,
    );
  }
  if (results.coverage.ruleTypesMissing.length > 0) {
    if (verdict !== 'rejected') verdict = 'low-confidence';
    reasons.push(`no validated rule at all for: ${results.coverage.ruleTypesMissing.join(', ')}`);
  }
  if (constructsWithoutUsableRule.length > 0) {
    if (verdict !== 'rejected') verdict = 'low-confidence';
    reasons.push(`construct(s) with no usable rule: ${constructsWithoutUsableRule.join(', ')}`);
  }
  if (lowConfidence.length > 0) {
    if (verdict === 'validated') verdict = 'low-confidence';
    reasons.push(`${String(lowConfidence.length)} rule(s) at low confidence: ${lowConfidence.map((rule) => rule.ruleId).join(', ')}`);
  }
  if (reasons.length === 0) {
    reasons.push(`all ${String(validated.length)} validated rule(s) pass every own example at high or medium confidence`);
  }

  const unreviewedSampleMatchCount = rules.reduce((sum, rule) => sum + rule.sampleMatches.length, 0);
  const filesScannedCount = results.filesScanned.length;
  const sampleScanned = filesScannedCount > 0;

  const verdictLabel = verdict === 'validated' ? 'VALIDATED' : verdict === 'low-confidence' ? 'LOW CONFIDENCE' : 'REJECTED';
  const passRatePct = Math.round(examplePassRate * 1000) / 10;
  // D27 item b / defect A5: "no sample repository scanned" and "no unreviewed sample matches" read
  // as the same good news but are not — only a scan that actually ran and found nothing to flag
  // earns the second, more reassuring phrasing.
  const sampleMatchesClause = !sampleScanned
    ? 'no sample repository scanned'
    : unreviewedSampleMatchCount === 0
      ? 'no unreviewed sample matches'
      : `${String(unreviewedSampleMatchCount)} sample match${unreviewedSampleMatchCount === 1 ? '' : 'es'} not yet reviewed`;
  const summary =
    `${verdictLabel} — ${String(passRatePct)}% of own examples pass (${String(totalOwnPassed)}/${String(totalOwnExamples)}); ` +
    `${sampleMatchesClause}; ${reasons.join('; ')}`;

  return {
    verdict,
    summary,
    reasons,
    examplePassRate,
    totalOwnExamples,
    validatedRuleCount: validated.length,
    lowConfidenceRuleCount: lowConfidence.length,
    rejectedRuleCount: rejected.length,
    constructsWithoutUsableRule,
    unreviewedSampleMatchCount,
    sampleScanned,
    filesScannedCount,
  };
}

function buildLexical(ruleSet: RuleSet): LexicalSettingsView {
  return {
    fileMatchers: ruleSet.fileMatchers,
    ...(ruleSet.lineComment !== undefined ? { lineComment: ruleSet.lineComment } : {}),
    ...(ruleSet.blockComment !== undefined ? { blockComment: ruleSet.blockComment } : {}),
    ...(ruleSet.stringDelimiters !== undefined ? { stringDelimiters: ruleSet.stringDelimiters } : {}),
  };
}

/** Builds the full report model from a Results file (WP-05), optionally enriched with the Rule Set, examples, `synthesis.json` and a fresh Skill-file hash check. */
export function buildReport(results: Results, options: BuildReportOptions = {}): Report {
  const rules = results.rules.map((rule) => buildRuleReport(rule, options.ruleSet, options.examplesById));
  const coverage = buildCoverage(rules);
  const overall = buildOverallVerdict(results, rules);

  return {
    languageId: results.languageId,
    ruleSetVersion: results.ruleSetVersion,
    compilerVersion: results.compilerVersion,
    generatedAt: results.generatedAt,
    overall,
    coverage,
    constructCoverage: results.coverage.constructs,
    rules,
    sampleWarnings: results.sampleWarnings,
    ...(options.ruleSet !== undefined ? { sourceSkills: options.ruleSet.sourceSkills } : {}),
    ...(options.ruleSet !== undefined ? { lexical: buildLexical(options.ruleSet) } : {}),
    ...(options.synthesis !== undefined ? { synthesis: buildSynthesisView(options.synthesis) } : {}),
    ...(options.ruleSet !== undefined && options.currentSourceSkills !== undefined
      ? {
          skillHashMismatches: findSkillHashMismatches(options.ruleSet.sourceSkills, options.currentSourceSkills),
          newSkillFiles: findNewSkillFiles(options.ruleSet.sourceSkills, options.currentSourceSkills),
        }
      : {}),
  };
}
