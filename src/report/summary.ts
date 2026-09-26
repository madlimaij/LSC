/**
 * Builds the report's top-of-document `Summary` (D28, owner readability pass, docs/DECISIONS.md):
 * a plain-language verdict and a priority-ordered "what to do next" list, for a reader who is not a
 * regex expert and wants to know within a few lines whether a Rule Set can be trusted. Built last,
 * from the already-assembled `Report` (minus `summary` itself), so it never recomputes anything the
 * other builders already worked out (confidence reasons, coverage, the detailed verdict reasons).
 *
 * Wording rule (owner instruction): no internal references ("D24 g", "modelSource",
 * "cross-construct negative", "own examples", a schema field name) ever appears here — say "tested
 * against the examples in the Skill files" and similar instead. The detailed sections below keep
 * their existing technical wording; the glossary (`markdown.ts`/`html.ts` `renderGlossary`) explains it.
 */
import type { Report, RuleReport, Summary } from './model.js';

type SummaryReport = Omit<Report, 'summary'>;

function plural(n: number, word: string): string {
  if (n === 1) return `1 ${word}`;
  const suffix = /[sxz]$|[cs]h$/.test(word) ? 'es' : 's';
  return `${String(n)} ${word}${suffix}`;
}

function ruleList(rules: readonly RuleReport[]): string {
  return rules.map((r) => `\`${r.ruleId}\``).join(', ');
}

/** Best-effort Skill file name for a rule or construct with no rule at all: the rule's own recorded provenance when there is one (needs `--ruleset`), otherwise a guess from the id, since every fixture Skill file here is named after the construct or rule it documents. Not guaranteed correct for every language; it is only ever used to name a starting point for the reader, not to prove one. */
function skillFileGuess(id: string, rule?: RuleReport): string {
  return rule?.provenance?.[0]?.skill ?? `${id}.md`;
}

function ruleParagraph(report: SummaryReport): string {
  const working = report.rules.filter((r) => r.ok);
  const broken = report.rules.filter((r) => !r.ok);
  const constructCount = report.constructCoverage.length;
  const intro = `This Rule Set was compiled for \`${report.languageId}\` from ${plural(constructCount, 'language construct')} described in the Skill files.`;
  const workingSentence =
    working.length > 0
      ? `${plural(working.length, 'rule')} tested against the examples in the Skill files ${working.length === 1 ? 'passes' : 'pass'}: ${ruleList(working)}.`
      : `No rule tested against the examples in the Skill files passes.`;
  const brokenSentence = broken.length > 0 ? ` ${plural(broken.length, 'rule')} ${broken.length === 1 ? 'does' : 'do'} not: ${ruleList(broken)}.` : '';
  return `${intro} ${workingSentence}${brokenSentence}`;
}

function statusParagraph(report: SummaryReport): string {
  const modelClause =
    report.synthesis?.modelSource !== undefined
      ? report.synthesis.modelSource.notRealModel
        ? 'These results come from hand-written test answers, not a real model.'
        : 'These results come from a real model.'
      : undefined;

  const { overall } = report;
  const sampleClause = !overall.sampleScanned
    ? 'No sample repository was scanned.'
    : overall.unreviewedSampleMatchCount > 0
      ? `${plural(overall.unreviewedSampleMatchCount, 'match')} found while scanning a sample repository still ${overall.unreviewedSampleMatchCount === 1 ? 'needs' : 'need'} review.`
      : 'Scanning a sample repository found nothing left to review.';

  const isDraft = report.ruleSetVersion === '0.0.0-draft';
  const usableClause = isDraft
    ? 'This is a draft Rule Set, so it cannot be used yet — see "What to do next" below.'
    : overall.verdict === 'validated'
      ? 'This Rule Set can be used.'
      : 'This Rule Set should not be used yet — see "What to do next" below.';

  return [modelClause, sampleClause, usableClause].filter((part): part is string => part !== undefined).join(' ');
}

function rejectedRuleItems(report: SummaryReport): string[] {
  return report.rules
    .filter((rule) => !rule.ok)
    .map((rule) => {
      const attemptCount = report.synthesis?.constructs.find((c) => c.ruleId === rule.ruleId)?.attemptCount;
      const skill = skillFileGuess(rule.ruleId, rule);
      if (attemptCount !== undefined) {
        return `Rule \`${rule.ruleId}\` failed its examples after ${plural(attemptCount, 'attempt')}: improve or add examples in ${skill}, then run \`lsc compile\` again`;
      }
      return `Rule \`${rule.ruleId}\` did not pass its own tests: improve or add examples in ${skill}, then run \`lsc compile\` again`;
    });
}

function notJustifiedConstructItems(report: SummaryReport): string[] {
  const ruleIds = new Set(report.rules.map((r) => r.ruleId));
  const notJustified = report.overall.constructsWithoutUsableRule.filter((construct) => !ruleIds.has(construct));
  return notJustified.map(
    (construct) => `The Skill files don't describe \`${construct}\` clearly enough to write a rule: expand ${skillFileGuess(construct)}`,
  );
}

/** Owner priority order (D28): rejected rule, not-justified construct, unreviewed samples, hand-written answers, Skill drift, then export (last, only for a draft). */
export function buildWhatNext(report: SummaryReport): string[] {
  const items: string[] = [...rejectedRuleItems(report), ...notJustifiedConstructItems(report)];

  const { overall } = report;
  if (overall.sampleScanned && overall.unreviewedSampleMatchCount > 0) {
    items.push(`Review the ${plural(overall.unreviewedSampleMatchCount, 'match')} found in the sample repository: \`lsc review …\``);
  }

  if (report.synthesis?.modelSource?.notRealModel === true) {
    items.push('These results come from hand-written test answers; run with a real model before trusting them');
  }

  const skillsChanged =
    report.skillHashMismatches !== undefined && (report.skillHashMismatches.length > 0 || (report.newSkillFiles?.length ?? 0) > 0);
  if (skillsChanged) {
    items.push('The Skill files changed since this Rule Set was built: run `lsc compile` again');
  }

  if (report.ruleSetVersion === '0.0.0-draft') {
    items.push(
      items.length === 0
        ? 'Nothing else to do: export the Rule Set with `lsc export` (only exported Rule Sets go to Navigator)'
        : 'When everything above is done, export the Rule Set with `lsc export` (only exported Rule Sets go to Navigator)',
    );
  }

  return items;
}

function buildStatus(report: SummaryReport, whatNext: readonly string[]): Summary['status'] {
  if (report.overall.verdict === 'rejected') return 'rejected';
  if (whatNext.length === 0) return 'ready';
  return 'action-needed';
}

/** Builds the report's top-of-document `Summary` from the rest of the already-assembled `Report`. */
export function buildSummary(report: SummaryReport): Summary {
  const whatNext = buildWhatNext(report);
  return {
    status: buildStatus(report, whatNext),
    paragraphs: [ruleParagraph(report), statusParagraph(report)],
    whatNext,
  };
}
