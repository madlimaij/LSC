/**
 * Self-contained HTML renderer for the validation report (WP-07 brief:
 * "single self-contained file (no external assets), readable offline").
 * All CSS is inlined in a `<style>` tag; there are no external requests.
 */
import type {
  ExtraMatchEntry,
  FalsePositiveEntry,
  LocatedSnippet,
  MissedExampleEntry,
  Report,
  RepresentativeMatchEntry,
  RuleReport,
  WrongCaptureEntry,
} from './model.js';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function captureText(captures: Readonly<Record<string, string | undefined>>): string {
  const entries = Object.entries(captures).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (entries.length === 0) return '(none)';
  return entries.map(([role, value]) => `${role}=${JSON.stringify(value)}`).join(', ');
}

function snippetHtml(snippet: LocatedSnippet | undefined, highlightLine?: number): string {
  if (snippet === undefined) return '';
  const code = snippet.lines
    .map((l) => `${l.line === highlightLine ? '<span class="hl">' : '<span>'}${String(l.line).padStart(4)}  ${esc(l.text)}</span>`)
    .join('\n');
  return `<div class="loc">location: ${esc(snippet.location)}</div><pre class="snippet">${code}</pre>`;
}

function listOrNone(items: string[], none = 'None.'): string {
  if (items.length === 0) return `<p class="muted">${esc(none)}</p>`;
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function renderRepresentative(entries: readonly RepresentativeMatchEntry[]): string {
  if (entries.length === 0) return `<p class="muted">No representative matches (rule passes no positive example).</p>`;
  return listOrNone(
    entries.map((entry) => {
      const captures =
        entry.expected[0] !== undefined ? captureText(entry.expected[0].captures) : '(captures unavailable without --skills-dir)';
      return `<code>${esc(entry.exampleId)}</code> (${esc(entry.construct)}): ${esc(captures)}${snippetHtml(entry.snippet, entry.expected[0]?.line)}`;
    }),
  );
}

function renderMissed(entries: readonly MissedExampleEntry[]): string {
  return listOrNone(
    entries.map((entry) => {
      const detail = entry.missed.map((m) => `line ${String(m.line)} expected ${captureText(m.captures)}`).join('; ');
      return `<code>${esc(entry.exampleId)}</code> (${esc(entry.construct)}): ${esc(detail)}${snippetHtml(entry.snippet, entry.missed[0]?.line)}`;
    }),
  );
}

function renderWrongCaptures(entries: readonly WrongCaptureEntry[]): string {
  return listOrNone(
    entries.map((entry) => {
      const detail = entry.wrongCaptures
        .map((w) => `line ${String(w.line)} expected ${captureText(w.expectedCaptures)}, got ${captureText(w.actualCaptures)}`)
        .join('; ');
      return `<code>${esc(entry.exampleId)}</code> (${esc(entry.construct)}): ${esc(detail)}${snippetHtml(entry.snippet, entry.wrongCaptures[0]?.line)}`;
    }),
  );
}

function renderFalsePositives(entries: readonly FalsePositiveEntry[]): string {
  return listOrNone(
    entries.map((entry) => {
      const detail = entry.unexpected.map((u) => `line ${String(u.line)} matched ${captureText(u.captures)}`).join('; ');
      const roleNote = entry.role === 'cross-negative' ? ' (negative example of another construct)' : '';
      return `<code>${esc(entry.exampleId)}</code> (${esc(entry.construct)})${esc(roleNote)}: ${esc(detail)}${snippetHtml(entry.snippet, entry.unexpected[0]?.line)}`;
    }),
  );
}

function renderExtraMatches(entries: readonly ExtraMatchEntry[]): string {
  if (entries.length === 0) return '';
  const body = listOrNone(
    entries.map((entry) => {
      const detail = entry.unexpected.map((u) => `line ${String(u.line)} extra match ${captureText(u.captures)}`).join('; ');
      return `<code>${esc(entry.exampleId)}</code> (${esc(entry.construct)}): ${esc(detail)}${snippetHtml(entry.snippet, entry.unexpected[0]?.line)}`;
    }),
  );
  return `<h4>Extra matches on positive examples</h4>${body}`;
}

function renderSampleMatches(rule: RuleReport): string {
  if (rule.sampleMatches.length === 0) return '';
  const body = rule.sampleMatches
    .map((match) => {
      const code = match.snippet
        .map((l) => `${l.line === match.line ? '<span class="hl">' : '<span>'}${String(l.line).padStart(4)}  ${esc(l.text)}</span>`)
        .join('\n');
      const enclosing = match.enclosingSymbol !== undefined ? `, in <code>${esc(match.enclosingSymbol)}</code>` : '';
      return `<li><code>${esc(match.file)}:${String(match.line)}</code>${enclosing}: ${esc(captureText(match.captures))}<pre class="snippet">${code}</pre></li>`;
    })
    .join('');
  return `<h4>Unreviewed sample matches (${String(rule.sampleMatches.length)})</h4><p class="muted">Run <code>lsc review</code> to label them.</p><ul>${body}</ul>`;
}

function renderProvenance(rule: RuleReport): string {
  if (rule.provenance === undefined) return '';
  const body = rule.provenance
    .map((p) => `<li><code>${esc(p.skill)}</code> &sect; ${esc(p.anchor)} &mdash; examples: ${esc(p.exampleIds.join(', ') || '(none)')}</li>`)
    .join('');
  return `<h4>Provenance</h4><ul>${body}</ul>`;
}

function renderRule(rule: RuleReport): string {
  const statusClass = rule.ok ? 'ok' : 'defect';
  const pattern = rule.pattern !== undefined ? esc(rule.pattern) : 'unavailable (pass <code>--ruleset</code> to <code>lsc report</code>)';
  const captures =
    rule.captures !== undefined
      ? esc(rule.captures.map(([role, group]) => `${role} → ${group}`).join(', ') || '(none)')
      : 'unavailable (pass <code>--ruleset</code>)';
  return `
<section class="rule ${statusClass}">
  <h3><code>${esc(rule.ruleId)}</code> (${esc(rule.type)}) &mdash; <span class="badge ${statusClass}">${rule.ok ? 'OK' : 'DEFECT'}</span></h3>
  <ul class="facts">
    <li>Pattern: <code>${pattern}</code></li>
    <li>Captures: ${captures}</li>
    <li>Confidence: <strong>${esc(rule.computedConfidence ?? 'rejected')}</strong> (declared: ${esc(rule.declaredConfidence)}) &mdash; ${esc(rule.confidenceReason)}</li>
    ${rule.declaredMismatchNote !== undefined ? `<li class="warn">${esc(rule.declaredMismatchNote)}</li>` : ''}
    <li>Pass rate (own examples): ${String(Math.round(rule.passRate * 1000) / 10)}% (${String(rule.testsPassed)}/${String(rule.testsPassed + rule.testsFailed)})</li>
    ${rule.missingExampleIds.length > 0 ? `<li class="warn">Missing examples cited in sourceEvidence but not found: ${esc(rule.missingExampleIds.join(', '))}</li>` : ''}
    ${rule.crossNegativeFailures.length > 0 ? `<li class="warn">Matched negative examples of other constructs (cross-construct negatives): ${esc(rule.crossNegativeFailures.join(', '))}</li>` : ''}
  </ul>
  <h4>Representative matches (passed positive examples)</h4>
  ${renderRepresentative(rule.representativeMatches)}
  <h4>Missed examples (expected but not found)</h4>
  ${renderMissed(rule.missedExamples)}
  <h4>Wrong captures (matched the right line, wrong values)</h4>
  ${renderWrongCaptures(rule.wrongCaptureExamples)}
  <h4>False positives (matched a negative example)</h4>
  ${renderFalsePositives(rule.falsePositives)}
  ${renderExtraMatches(rule.extraMatchesOnPositive)}
  ${renderSampleMatches(rule)}
  ${renderProvenance(rule)}
</section>`;
}

function renderSourceSkills(report: Report): string {
  if (report.sourceSkills === undefined) {
    return `<p class="muted">Skill file hashes unavailable (pass <code>--ruleset</code> to <code>lsc report</code>).</p>`;
  }
  if (report.sourceSkills.length === 0) return `<p class="muted">No Skill files recorded.</p>`;
  return `<ul>${report.sourceSkills.map((s) => `<li><code>${esc(s.path)}</code> &mdash; sha256 <code>${esc(s.sha256)}</code></li>`).join('')}</ul>`;
}

function renderSampleWarnings(report: Report): string {
  if (report.sampleWarnings.length === 0) return '';
  const body = report.sampleWarnings
    .map((w) => `<li><code>${esc(w.ruleId)}</code> ${esc(w.kind)} at <code>${esc(w.file)}:${String(w.line)}</code>: ${esc(w.message)}</li>`)
    .join('');
  return `<h2>Sample-scan warnings</h2><ul>${body}</ul>`;
}

function renderCoverage(report: Report): string {
  const rows = report.coverage
    .map((row) => {
      const status = row.status === 'no-rule' ? 'no validated rule' : row.status;
      const confidence = row.confidences.length === 0 ? '&mdash;' : esc([...new Set(row.confidences)].join(', '));
      const ruleIds = row.ruleIds.length === 0 ? '&mdash;' : esc(row.ruleIds.join(', '));
      return `<tr class="cov-${esc(row.status)}"><td>${esc(row.ruleType)}</td><td>${esc(status)}</td><td>${confidence}</td><td>${ruleIds}</td></tr>`;
    })
    .join('');
  return `<table><thead><tr><th>Rule type</th><th>Status</th><th>Confidence</th><th>Rule(s)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STYLE = `
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem auto; max-width: 60rem; line-height: 1.45; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #333; padding-bottom: .3rem; }
  h2 { margin-top: 2.5rem; border-bottom: 1px solid #ccc; padding-bottom: .2rem; }
  h3 { margin-top: 2rem; }
  h4 { margin-bottom: .3rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ccc; padding: .35rem .6rem; text-align: left; }
  th { background: #f0f0f0; }
  .verdict-box { padding: 1rem; border-radius: .4rem; border: 2px solid; margin: 1rem 0; }
  .verdict-validated { border-color: #1a7f37; background: #eaffef; }
  .verdict-low-confidence { border-color: #9a6700; background: #fff8e6; }
  .verdict-rejected { border-color: #b31d28; background: #ffecec; }
  .rule { border: 1px solid #ddd; border-radius: .4rem; padding: 1rem 1.2rem; margin: 1.2rem 0; }
  .rule.defect { border-color: #b31d28; }
  .rule.ok { border-color: #1a7f37; }
  .badge { padding: .1rem .5rem; border-radius: .3rem; font-size: .85em; }
  .badge.ok { background: #1a7f37; color: white; }
  .badge.defect { background: #b31d28; color: white; }
  .facts { list-style: none; padding-left: 0; }
  .facts li { margin: .2rem 0; }
  .warn { color: #9a6700; }
  .muted { color: #666; font-style: italic; }
  .snippet { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: .3rem; padding: .5rem; overflow-x: auto; font-size: .9em; }
  .snippet span { display: block; white-space: pre; }
  .snippet span.hl { background: #fff3b0; font-weight: bold; }
  .loc { font-size: .85em; color: #555; margin-top: .5rem; }
  .cov-rejected td { background: #ffecec; }
  .cov-low-confidence td { background: #fff8e6; }
  .cov-validated td { background: #eaffef; }
  code { background: #f0f0f0; padding: 0 .25rem; border-radius: .2rem; }
`;

/** Renders the full report as one self-contained HTML file (no external assets or requests). */
export function renderHtml(report: Report): string {
  const { overall } = report;
  const passRatePct = String(Math.round(overall.examplePassRate * 1000) / 10);
  const totalOwnPassed = report.rules.reduce((s, r) => s + r.testsPassed, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Rule Set report — ${esc(report.languageId)} ${esc(report.ruleSetVersion)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Rule Set report &mdash; ${esc(report.languageId)} ${esc(report.ruleSetVersion)}</h1>

<div class="verdict-box verdict-${esc(overall.verdict)}">
  <p><strong>${esc(overall.summary)}</strong></p>
  <ul>
    <li>Rule Set: <code>${esc(report.languageId)}</code> version <code>${esc(report.ruleSetVersion)}</code> (compiled with lsc <code>${esc(report.compilerVersion)}</code>, generated ${esc(report.generatedAt)})</li>
    <li>Validated rules (high/medium confidence, own tests pass): ${String(overall.validatedRuleCount)}</li>
    <li>Low-confidence rules: ${String(overall.lowConfidenceRuleCount)}</li>
    <li>Rejected/broken rules: ${String(overall.rejectedRuleCount)}</li>
    <li>Example pass rate (own examples): ${passRatePct}% (${String(totalOwnPassed)}/${String(overall.totalOwnExamples)})</li>
    <li>${overall.constructsWithoutUsableRule.length > 0 ? `Constructs without a usable rule: ${esc(overall.constructsWithoutUsableRule.join(', '))}` : 'Every construct with examples has a usable rule'}</li>
  </ul>
</div>

<h2>Coverage</h2>
${renderCoverage(report)}

<h2>Rules</h2>
${report.rules.map((rule) => renderRule(rule)).join('')}

${renderSampleWarnings(report)}

<h2>Provenance</h2>
<h3>Skill file hashes</h3>
${renderSourceSkills(report)}

</body>
</html>
`;
}
