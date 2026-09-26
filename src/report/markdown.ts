/**
 * Markdown renderer for the validation report (WP-07 brief, docs/PLAN.md
 * §7). Section order is fixed by the brief: overall verdict, coverage
 * table, per-rule detail, unreviewed sample matches, provenance.
 */
import type {
  ExtraMatchEntry,
  FalsePositiveEntry,
  LocatedSnippet,
  MissedExampleEntry,
  Report,
  RepresentativeMatchEntry,
  RuleReport,
  SynthesisAttemptView,
  SynthesisView,
  WrongCaptureEntry,
} from './model.js';
import { reasonWithoutLeadingLevel } from './confidence-reason.js';

function captureText(captures: Readonly<Record<string, string | undefined>>): string {
  const entries = Object.entries(captures).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (entries.length === 0) return '(none)';
  return entries.map(([role, value]) => `${role}=${JSON.stringify(value)}`).join(', ');
}

function snippetLines(snippet: LocatedSnippet | undefined, highlightLine?: number): string {
  if (snippet === undefined) return '';
  const code = snippet.lines.map((l) => `${String(l.line).padStart(4)}${l.line === highlightLine ? ' > ' : '   '}${l.text}`).join('\n');
  return `\n  location: ${snippet.location}\n  \`\`\`\n${code}\n  \`\`\`\n`;
}

/**
 * D27 item d: a `0.0.0-draft` Rule Set (D24 g: the version `lsc compile`'s draft output always
 * carries, before `lsc export` assigns a real one, D25 item 5) must never be delivered to Navigator.
 */
function draftWarning(report: Report): string | undefined {
  if (report.ruleSetVersion !== '0.0.0-draft') return undefined;
  return '**Draft Rule Set: must not be delivered to Navigator.** Version `0.0.0-draft` means `lsc export` has not yet assigned this Rule Set a real version (D24 g, D25 item 5).';
}

/**
 * D27 item a: "not produced by a real model" also belongs next to the verdict, not only in the
 * Synthesis section (which keeps its own statement, see `renderModelSource` below). Only available
 * with `--synthesis` (`report.synthesis`).
 */
function modelSourceWarningNearVerdict(report: Report): string | undefined {
  const modelSource = report.synthesis?.modelSource;
  if (modelSource === undefined || !modelSource.notRealModel) return undefined;
  return (
    '**Not produced by a real model**: the rules in this Rule Set come from hand-written (or partly hand-written) answers, ' +
    'not a live or recorded model call — see the Synthesis section below (`modelSource`).'
  );
}

function renderVerdict(report: Report): string {
  const { overall } = report;
  const lines = [
    `## Verdict`,
    '',
    `**${overall.summary}**`,
    '',
    ...(draftWarning(report) !== undefined ? [draftWarning(report) as string, ''] : []),
    ...(modelSourceWarningNearVerdict(report) !== undefined ? [modelSourceWarningNearVerdict(report) as string, ''] : []),
    `- Rule Set: \`${report.languageId}\` version \`${report.ruleSetVersion}\` (compiled with lsc \`${report.compilerVersion}\`, generated ${report.generatedAt})`,
    `- Validated rules (high/medium confidence, own tests pass): ${String(overall.validatedRuleCount)}`,
    `- Low-confidence rules: ${String(overall.lowConfidenceRuleCount)}`,
    `- Rejected/broken rules: ${String(overall.rejectedRuleCount)}`,
    `- Example pass rate (own examples): ${String(Math.round(overall.examplePassRate * 1000) / 10)}% (${String(report.rules.reduce((s, r) => s + r.testsPassed, 0))}/${String(overall.totalOwnExamples)})`,
    `- Unreviewed sample matches: ${String(overall.unreviewedSampleMatchCount)}${overall.unreviewedSampleMatchCount > 0 ? ' (run `lsc review`)' : ''}` +
      ` (${String(overall.filesScannedCount)} sample file(s) scanned)`,
    '- **Sample coverage shows matches only**: it cannot show constructs the rules missed in the sample. ' +
      (overall.sampleScanned
        ? 'Misses in the sample must be found by reviewing it (`lsc review`), not by reading this report.'
        : 'No sample repository was scanned at all here, so even that is unavailable — pass `--sample <dir>` to `lsc test`/`lsc compile`.'),
    overall.constructsWithoutUsableRule.length > 0
      ? `- Constructs without a usable rule: ${overall.constructsWithoutUsableRule.join(', ')}`
      : `- Every construct with examples has a usable rule`,
  ];
  return lines.join('\n');
}

/**
 * Confidence is never shown without its reason (CLAUDE.md): the coverage
 * table's own cell is a single word ("low", "rejected", …), so each row
 * also gets a pointer to the rule section below that spells the reason out
 * (`explainConfidence`, confidence-reason.ts) — a link when there is a rule
 * to link to, otherwise a short inline reason.
 */
function confidenceReasonPointer(row: Report['coverage'][number]): string {
  if (row.ruleIds.length === 0) return 'no validated rule for this type — see the Verdict above';
  return row.ruleIds.map((id) => `see [\`${id}\`](#rule-${id}) below`).join('; ');
}

function renderCoverage(report: Report): string {
  const rows = report.coverage.map((row) => {
    // D27 item d: a rejected rule's coverage row says so plainly, and that export drops it (D25 item 5).
    const status = row.status === 'no-rule' ? 'no validated rule' : row.status === 'rejected' ? 'rejected (dropped at export)' : row.status;
    const confidence = row.confidences.length === 0 ? '—' : [...new Set(row.confidences)].join(', ');
    const ruleIds = row.ruleIds.length === 0 ? '—' : row.ruleIds.join(', ');
    return `| ${row.ruleType} | ${status} | ${confidence} | ${ruleIds} | ${confidenceReasonPointer(row)} |`;
  });
  return [
    '## Coverage',
    '',
    '| Rule type | Status | Confidence | Rule(s) | Confidence reason |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/**
 * D27 item c: a compact table, near the top (after Coverage), of the unreviewed sample match count
 * per rule with a link to its section — so a reader does not have to scroll every rule's own section
 * just to see where review effort is needed. The inline per-rule listing (`renderSampleMatches`)
 * stays too.
 */
function renderSampleMatchCounts(report: Report): string {
  const rows = report.rules
    .filter((rule) => rule.sampleMatches.length > 0)
    .map((rule) => `| [\`${rule.ruleId}\`](#rule-${rule.ruleId}) | ${rule.type} | ${String(rule.sampleMatches.length)} |`);
  if (rows.length === 0) {
    return ['## Unreviewed sample matches per rule', '', '_None (no rule has any unreviewed sample match)._'].join('\n');
  }
  return [
    '## Unreviewed sample matches per rule',
    '',
    '| Rule | Type | Unreviewed matches |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function renderRepresentative(entries: readonly RepresentativeMatchEntry[]): string {
  if (entries.length === 0) return '_No representative matches (rule passes no positive example)._';
  return entries
    .map((entry) => {
      const captures = entry.expected[0] !== undefined ? captureText(entry.expected[0].captures) : '(captures unavailable without --skills-dir)';
      return `- \`${entry.exampleId}\` (${entry.construct}): ${captures}${snippetLines(entry.snippet, entry.expected[0]?.line)}`;
    })
    .join('\n');
}

function renderMissed(entries: readonly MissedExampleEntry[]): string {
  if (entries.length === 0) return '_None._';
  return entries
    .map((entry) => {
      const detail = entry.missed
        .map((m) => `line ${String(m.line)} expected ${captureText(m.captures)}`)
        .join('; ');
      return `- \`${entry.exampleId}\` (${entry.construct}): ${detail}${snippetLines(entry.snippet, entry.missed[0]?.line)}`;
    })
    .join('\n');
}

function renderWrongCaptures(entries: readonly WrongCaptureEntry[]): string {
  if (entries.length === 0) return '_None._';
  return entries
    .map((entry) => {
      const detail = entry.wrongCaptures
        .map(
          (w) =>
            `line ${String(w.line)} expected ${captureText(w.expectedCaptures)}, got ${captureText(w.actualCaptures)}`,
        )
        .join('; ');
      return `- \`${entry.exampleId}\` (${entry.construct}): ${detail}${snippetLines(entry.snippet, entry.wrongCaptures[0]?.line)}`;
    })
    .join('\n');
}

function renderFalsePositives(entries: readonly FalsePositiveEntry[]): string {
  if (entries.length === 0) return '_None._';
  return entries
    .map((entry) => {
      const detail = entry.unexpected.map((u) => `line ${String(u.line)} matched ${captureText(u.captures)}`).join('; ');
      const roleNote = entry.role === 'cross-negative' ? ' (negative example of another construct)' : '';
      return `- \`${entry.exampleId}\` (${entry.construct})${roleNote}: ${detail}${snippetLines(entry.snippet, entry.unexpected[0]?.line)}`;
    })
    .join('\n');
}

function renderExtraMatches(entries: readonly ExtraMatchEntry[]): string {
  if (entries.length === 0) return '';
  const body = entries
    .map((entry) => {
      const detail = entry.unexpected.map((u) => `line ${String(u.line)} extra match ${captureText(u.captures)}`).join('; ');
      return `- \`${entry.exampleId}\` (${entry.construct}): ${detail}${snippetLines(entry.snippet, entry.unexpected[0]?.line)}`;
    })
    .join('\n');
  return `\n**Extra matches on positive examples** (matched more than expected):\n\n${body}\n`;
}

function renderSampleMatches(rule: RuleReport): string {
  if (rule.sampleMatches.length === 0) return '';
  const body = rule.sampleMatches
    .map((match) => {
      const code = match.snippet
        .map((l) => `${String(l.line).padStart(4)}${l.line === match.line ? ' > ' : '   '}${l.text}`)
        .join('\n');
      const enclosing = match.enclosingSymbol !== undefined ? `, in \`${match.enclosingSymbol}\`` : '';
      return `- \`${match.file}:${String(match.line)}\`${enclosing}: ${captureText(match.captures)}\n  \`\`\`\n${code}\n  \`\`\`\n`;
    })
    .join('\n');
  return `\n**Unreviewed sample matches** (${String(rule.sampleMatches.length)}, run \`lsc review\` to label them):\n\n${body}`;
}

function renderProvenance(rule: RuleReport): string {
  if (rule.provenance === undefined) return '';
  const body = rule.provenance.map((p) => `- \`${p.skill}\` § ${p.anchor} — examples: ${p.exampleIds.join(', ') || '(none)'}`).join('\n');
  return `\n**Provenance**\n\n${body}\n`;
}

function renderRule(rule: RuleReport): string {
  // D27 item d: a rejected rule's own heading also says so, and that export drops it (D25 item 5), not only "DEFECT".
  const status = rule.ok ? 'OK' : 'DEFECT — rejected (dropped at export)';
  const parts = [
    `<a id="rule-${rule.ruleId}"></a>`,
    `### \`${rule.ruleId}\` (${rule.type}) — ${status}`,
    '',
    rule.pattern !== undefined ? `- Pattern: \`${rule.pattern}\`` : `- Pattern: unavailable (pass \`--ruleset\` to \`lsc report\`)`,
    rule.captures !== undefined
      ? `- Captures: ${rule.captures.map(([role, group]) => `${role} → ${group}`).join(', ') || '(none)'}`
      : `- Captures: unavailable (pass \`--ruleset\`)`,
    // D27 item f: the level is shown once (here) — the reason no longer repeats it ("high — high — ...").
    `- Confidence: **${rule.computedConfidence ?? 'rejected'}** (declared: ${rule.declaredConfidence}) — ${reasonWithoutLeadingLevel(rule.confidenceReason)}`,
    ...(rule.declaredMismatchNote !== undefined ? [`- ⚠ ${rule.declaredMismatchNote}`] : []),
    `- Pass rate (own examples): ${String(Math.round(rule.passRate * 1000) / 10)}% (${String(rule.testsPassed)}/${String(rule.testsPassed + rule.testsFailed)})`,
    ...(rule.missingExampleIds.length > 0
      ? [`- ⚠ Missing examples cited in sourceEvidence but not found: ${rule.missingExampleIds.join(', ')}`]
      : []),
    ...(rule.crossNegativeFailures.length > 0
      ? [`- ⚠ Matched negative examples of other constructs (cross-construct negatives): ${rule.crossNegativeFailures.join(', ')}`]
      : []),
    '',
    '**Representative matches** (passed positive examples):',
    '',
    renderRepresentative(rule.representativeMatches),
    '',
    '**Missed examples** (expected but not found):',
    '',
    renderMissed(rule.missedExamples),
    '',
    '**Wrong captures** (matched the right line, wrong values):',
    '',
    renderWrongCaptures(rule.wrongCaptureExamples),
    '',
    '**False positives** (matched a negative example):',
    '',
    renderFalsePositives(rule.falsePositives),
    renderExtraMatches(rule.extraMatchesOnPositive),
    renderSampleMatches(rule),
    renderProvenance(rule),
  ];
  return parts.join('\n');
}

function renderSourceSkills(report: Report): string {
  if (report.sourceSkills === undefined) {
    return '_Skill file hashes unavailable (pass `--ruleset` to `lsc report`)._';
  }
  if (report.sourceSkills.length === 0) return '_No Skill files recorded._';
  return report.sourceSkills.map((s) => `- \`${s.path}\` — sha256 \`${s.sha256}\``).join('\n');
}

function renderSkillHashMismatches(report: Report): string {
  if (report.skillHashMismatches === undefined) return '';
  if (report.skillHashMismatches.length === 0) {
    return '\n_Checked against `--skills-dir`: every Skill file hash still matches._\n';
  }
  const body = report.skillHashMismatches
    .map((m) =>
      m.currentSha256 === undefined
        ? `- ⚠ \`${m.path}\`: in the Rule Set's \`sourceSkills\` (sha256 \`${m.ruleSetSha256}\`) but not found under \`--skills-dir\``
        : `- ⚠ \`${m.path}\`: sha256 differs — Rule Set \`${m.ruleSetSha256}\`, current \`${m.currentSha256}\``,
    )
    .join('\n');
  return `\n**⚠ Skill file hashes differ from \`--skills-dir\`** (reviewer Q5, D25 item 4): this Rule Set may not reflect the documentation currently on disk.\n\n${body}\n`;
}

/** Skill files under `--skills-dir` this Rule Set was never compiled from (D27 defect A4). */
function renderNewSkillFiles(report: Report): string {
  if (report.newSkillFiles === undefined || report.newSkillFiles.length === 0) return '';
  const body = report.newSkillFiles.map((path) => `- ⚠ \`${path}\`: new Skill file not used by this Rule Set`).join('\n');
  return `\n**⚠ New Skill file(s) under \`--skills-dir\` not used by this Rule Set** (added since it was compiled; recompile to use them):\n\n${body}\n`;
}

/** One lexical proposal (D27 item e), as a compact description: the fileMatchers/markers it offered, or `notJustified`'s reason. */
function describeLexicalProposal(proposal: NonNullable<Report['synthesis']>['lexicalAttempts'][number]['proposal']): string {
  if (proposal === undefined) return '(no proposal on this attempt)';
  if (proposal.notJustified !== undefined) return `not justified: ${proposal.notJustified}`;
  const parts = [
    `file matchers ${proposal.fileMatchers.map((g) => `\`${g}\``).join(', ')}`,
    proposal.lineComment !== undefined ? `line comment \`${proposal.lineComment}\`` : undefined,
    proposal.blockComment !== undefined ? `block comment \`${proposal.blockComment.start}\` … \`${proposal.blockComment.end}\`` : undefined,
    proposal.stringDelimiters !== undefined && proposal.stringDelimiters.length > 0
      ? `string delimiters ${proposal.stringDelimiters.map((d) => `\`${d.start}\` … \`${d.end}\``).join(', ')}`
      : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.join('; ');
}

/**
 * D27 item e: the lexical proposal history, next to the accepted settings — each attempt, what was
 * proposed, and why a refused one was refused (e.g. a marker that "does not appear in the
 * documentation", D24 a). Only available with `--synthesis`.
 */
function renderLexicalProposalHistory(report: Report): string {
  const attempts = report.synthesis?.lexicalAttempts;
  if (attempts === undefined) return '_Lexical proposal history unavailable (pass `--synthesis <file>` to `lsc report`)._';
  if (attempts.length === 0) return '_(no lexical attempts recorded)_';
  return attempts
    .map(
      (a) =>
        `- attempt ${String(a.attempt)}: **${a.outcome}** — proposed: ${describeLexicalProposal(a.proposal)}` +
        `${a.problems.length > 0 ? ` — refused because: ${a.problems.join(' | ')}` : ''}`,
    )
    .join('\n');
}

/** Lexical settings (docs/PLAN.md §5.1): comment/string markers and `fileMatchers`, only with `--ruleset` (D25 item 2). */
function renderLexical(report: Report): string {
  const accepted =
    report.lexical === undefined
      ? '_Lexical settings unavailable (pass `--ruleset` to `lsc report`)._'
      : [
          `- File matchers: ${report.lexical.fileMatchers.map((g) => `\`${g}\``).join(', ')}`,
          `- Line comment: ${report.lexical.lineComment !== undefined ? `\`${report.lexical.lineComment}\`` : '_(none)_'}`,
          `- Block comment: ${report.lexical.blockComment !== undefined ? `\`${report.lexical.blockComment.start}\` … \`${report.lexical.blockComment.end}\`` : '_(none)_'}`,
          `- String delimiters: ${
            report.lexical.stringDelimiters !== undefined && report.lexical.stringDelimiters.length > 0
              ? report.lexical.stringDelimiters.map((d) => `\`${d.start}\` … \`${d.end}\``).join(', ')
              : '_(none)_'
          }`,
        ].join('\n');
  return [
    accepted,
    '',
    '**Proposal history** (D27 item e; from `synthesis.json`, next to the accepted settings above):',
    '',
    renderLexicalProposalHistory(report),
  ].join('\n');
}

function renderSynthesisAttempts(attempts: readonly SynthesisAttemptView[]): string {
  if (attempts.length === 0) return '_(no attempts recorded)_';
  return attempts
    .map((a) => `  - attempt ${String(a.attempt)}: **${a.outcome}**${a.problems.length > 0 ? ` — ${a.problems.join(' | ')}` : ''}`)
    .join('\n');
}

/**
 * `modelSource` line, shown at the top of the Synthesis section (D25 item 2, WP-07 follow-up:
 * "show it prominently ... at the top of the Synthesis section"). Falls back to the "not recorded"
 * `providerNote` for a `synthesis.json` written before `modelSource` existed.
 */
function renderModelSource(synthesis: SynthesisView): string {
  if (synthesis.modelSource === undefined) {
    return synthesis.providerNote !== undefined ? `- ⚠ ${synthesis.providerNote}\n` : '';
  }
  const m = synthesis.modelSource;
  const lines = [
    `- **Model source:** ${m.summary} (mode \`${m.mode}\`, configured provider \`${m.configuredProvider}\`, provider \`${m.provider}\`, model \`${m.model}\`, origin \`${m.origin}\`)`,
  ];
  if (m.notRealModel) {
    lines.push('- ⚠ **These rules were not produced by a real model** — the answers behind this Rule Set are hand-written (or a mix that includes hand-written answers), not a live or recorded model call.');
  }
  return `${lines.join('\n')}\n`;
}

/** Each construct's synthesis outcome and reasons from `synthesis.json` (D25 item 2), only with `--synthesis`. */
function renderSynthesis(report: Report): string {
  if (report.synthesis === undefined) {
    return '_Synthesis details unavailable (pass `--synthesis <file>` to `lsc report`)._';
  }
  const s = report.synthesis;
  const modelSourceLines = renderModelSource(s).trimEnd();
  const lines = [
    ...(modelSourceLines.length > 0 ? [modelSourceLines] : []),
    `- Compile status: **${s.status}**${s.error !== undefined ? ` — ${s.error}` : ''}`,
    `- Lexical settings: **${s.lexicalStatus}**${s.lexicalReason !== undefined ? ` — ${s.lexicalReason}` : ''}`,
    `- Constructs: ${String(s.summary.constructs)} (validated ${String(s.summary.validated)}, rejected ${String(s.summary.rejected)}, ` +
      `not justified ${String(s.summary.notJustified)}, skipped ${String(s.summary.skipped)}, not attempted ${String(s.summary.notAttempted)})`,
    `- Model usage: ${String(s.usage.calls)} call(s), ${String(s.usage.inputTokens)} input + ${String(s.usage.outputTokens)} output tokens`,
    '',
    ...s.constructs.map(
      (c) =>
        `- \`${c.constructId}\`${c.ruleType !== undefined ? ` (${c.ruleType})` : ''} — **${c.status}**` +
        `${c.ruleId !== undefined ? ` (rule \`${c.ruleId}\`)` : ''}, ${String(c.attemptCount)} attempt(s)` +
        `${c.reason !== undefined ? `: ${c.reason}` : ''}\n${renderSynthesisAttempts(c.attempts)}`,
    ),
  ];
  return lines.join('\n');
}

function renderSampleWarnings(report: Report): string {
  if (report.sampleWarnings.length === 0) return '';
  const body = report.sampleWarnings
    .map((w) => `- \`${w.ruleId}\` ${w.kind} at \`${w.file}:${String(w.line)}\`: ${w.message}`)
    .join('\n');
  return `\n## Sample-scan warnings\n\n${body}\n`;
}

/** Renders the full report as a single Markdown document. */
export function renderMarkdown(report: Report): string {
  const sections = [
    `# Rule Set report — ${report.languageId} ${report.ruleSetVersion}`,
    '',
    renderVerdict(report),
    '',
    renderCoverage(report),
    '',
    renderSampleMatchCounts(report),
    '',
    '## Lexical settings',
    '',
    renderLexical(report),
    '',
    '## Rules',
    '',
    ...report.rules.map((rule) => renderRule(rule)),
    renderSampleWarnings(report),
    '## Synthesis',
    '',
    renderSynthesis(report),
    '',
    '## Provenance',
    '',
    '### Skill file hashes',
    '',
    renderSourceSkills(report),
    renderSkillHashMismatches(report),
    renderNewSkillFiles(report),
    '',
  ];
  return `${sections.join('\n')}\n`;
}
