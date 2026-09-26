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
  WrongCaptureEntry,
} from './model.js';

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

function renderVerdict(report: Report): string {
  const { overall } = report;
  const lines = [
    `## Verdict`,
    '',
    `**${overall.summary}**`,
    '',
    `- Rule Set: \`${report.languageId}\` version \`${report.ruleSetVersion}\` (compiled with lsc \`${report.compilerVersion}\`, generated ${report.generatedAt})`,
    `- Validated rules (high/medium confidence, own tests pass): ${String(overall.validatedRuleCount)}`,
    `- Low-confidence rules: ${String(overall.lowConfidenceRuleCount)}`,
    `- Rejected/broken rules: ${String(overall.rejectedRuleCount)}`,
    `- Example pass rate (own examples): ${String(Math.round(overall.examplePassRate * 1000) / 10)}% (${String(report.rules.reduce((s, r) => s + r.testsPassed, 0))}/${String(overall.totalOwnExamples)})`,
    `- Unreviewed sample matches: ${String(overall.unreviewedSampleMatchCount)}${overall.unreviewedSampleMatchCount > 0 ? ' (run `lsc review`)' : ''}`,
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
    const status = row.status === 'no-rule' ? 'no validated rule' : row.status;
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
  const status = rule.ok ? 'OK' : 'DEFECT';
  const parts = [
    `<a id="rule-${rule.ruleId}"></a>`,
    `### \`${rule.ruleId}\` (${rule.type}) — ${status}`,
    '',
    rule.pattern !== undefined ? `- Pattern: \`${rule.pattern}\`` : `- Pattern: unavailable (pass \`--ruleset\` to \`lsc report\`)`,
    rule.captures !== undefined
      ? `- Captures: ${rule.captures.map(([role, group]) => `${role} → ${group}`).join(', ') || '(none)'}`
      : `- Captures: unavailable (pass \`--ruleset\`)`,
    `- Confidence: **${rule.computedConfidence ?? 'rejected'}** (declared: ${rule.declaredConfidence}) — ${rule.confidenceReason}`,
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

/** Lexical settings (docs/PLAN.md §5.1): comment/string markers and `fileMatchers`, only with `--ruleset` (D25 item 2). */
function renderLexical(report: Report): string {
  if (report.lexical === undefined) {
    return '_Lexical settings unavailable (pass `--ruleset` to `lsc report`)._';
  }
  const l = report.lexical;
  const lines = [
    `- File matchers: ${l.fileMatchers.map((g) => `\`${g}\``).join(', ')}`,
    `- Line comment: ${l.lineComment !== undefined ? `\`${l.lineComment}\`` : '_(none)_'}`,
    `- Block comment: ${l.blockComment !== undefined ? `\`${l.blockComment.start}\` … \`${l.blockComment.end}\`` : '_(none)_'}`,
    `- String delimiters: ${
      l.stringDelimiters !== undefined && l.stringDelimiters.length > 0
        ? l.stringDelimiters.map((d) => `\`${d.start}\` … \`${d.end}\``).join(', ')
        : '_(none)_'
    }`,
  ];
  return lines.join('\n');
}

function renderSynthesisAttempts(attempts: readonly SynthesisAttemptView[]): string {
  if (attempts.length === 0) return '_(no attempts recorded)_';
  return attempts
    .map((a) => `  - attempt ${String(a.attempt)}: **${a.outcome}**${a.problems.length > 0 ? ` — ${a.problems.join(' | ')}` : ''}`)
    .join('\n');
}

/** Each construct's synthesis outcome and reasons from `synthesis.json` (D25 item 2), only with `--synthesis`. */
function renderSynthesis(report: Report): string {
  if (report.synthesis === undefined) {
    return '_Synthesis details unavailable (pass `--synthesis <file>` to `lsc report`)._';
  }
  const s = report.synthesis;
  const lines = [
    `- Compile status: **${s.status}**${s.error !== undefined ? ` — ${s.error}` : ''}`,
    `- Lexical settings: **${s.lexicalStatus}**${s.lexicalReason !== undefined ? ` — ${s.lexicalReason}` : ''}`,
    `- Constructs: ${String(s.summary.constructs)} (validated ${String(s.summary.validated)}, rejected ${String(s.summary.rejected)}, ` +
      `not justified ${String(s.summary.notJustified)}, skipped ${String(s.summary.skipped)}, not attempted ${String(s.summary.notAttempted)})`,
    `- Model usage: ${String(s.usage.calls)} call(s), ${String(s.usage.inputTokens)} input + ${String(s.usage.outputTokens)} output tokens`,
    `- ⚠ ${s.providerNote}`,
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
    '',
  ];
  return `${sections.join('\n')}\n`;
}
