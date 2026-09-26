/**
 * `lsc compile` end to end, offline, through FakeProvider and the
 * hand-written recordings in fixtures/recordings/wp09 and wp09-reject (see
 * tests/synth/wp09-recordings.ts). WP-09 acceptance criteria 1–4.
 */
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULE_TYPES, validateRuleSet, type RuleSet } from '../../src/contract/index.js';
import { loadRecordings } from '../../src/llm/index.js';
import { ResultsSchema, type Results } from '../../src/runner/index.js';
import { SynthesisReportSchema, type SynthesisReport } from '../../src/synth/index.js';
import { io, logEntries, runCli, tempDir, writeConfig } from './helpers.js';
import { recordingsDir, TOYLANG_SAMPLE, TOYLANG_SKILLS } from './wp09-recordings.js';

interface Outputs {
  code: number;
  out: string;
  logDir: string;
  ruleSet?: RuleSet;
  results?: Results;
  synthesis: SynthesisReport;
  /** report.md / report.html written by `lsc compile` (D25 item 2), when present. */
  reportMd?: string;
  reportHtml?: string;
}

async function compile(scenario: 'wp09' | 'wp09-reject', ...extra: string[]): Promise<Outputs> {
  const { config, logDir } = writeConfig();
  const out = join(tempDir(), 'out');
  const code = await runCli(
    'compile',
    TOYLANG_SKILLS,
    '--provider',
    'fake',
    '--recordings',
    recordingsDir(scenario),
    '--config',
    config,
    '--out',
    out,
    ...extra,
  );
  const read = (f: string): unknown => JSON.parse(readFileSync(join(out, f), 'utf8'));
  const draft = join(out, 'toylang.ruleset.draft.json');
  return {
    code,
    out,
    logDir,
    ...(existsSync(draft) ? { ruleSet: read('toylang.ruleset.draft.json') as RuleSet } : {}),
    ...(existsSync(join(out, 'results.json')) ? { results: ResultsSchema.parse(read('results.json')) } : {}),
    synthesis: SynthesisReportSchema.parse(read('synthesis.json')),
    ...(existsSync(join(out, 'report.md')) ? { reportMd: readFileSync(join(out, 'report.md'), 'utf8') } : {}),
    ...(existsSync(join(out, 'report.html')) ? { reportHtml: readFileSync(join(out, 'report.html'), 'utf8') } : {}),
  };
}

/** The HTML renderer escapes quotes and ampersands; compare against the escaped form. */
function htmlEscaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The Markdown report's `## Synthesis` section alone. */
function synthesisSection(md: string): string {
  const start = md.indexOf('\n## Synthesis\n');
  expect(start).toBeGreaterThan(-1);
  const end = md.indexOf('\n## ', start + 1);
  return md.slice(start, end === -1 ? undefined : end);
}

/** Every construct's outcome line appears in both report files. */
function expectEveryOutcome(res: Outputs): void {
  const md = synthesisSection(res.reportMd ?? '');
  for (const c of res.synthesis.constructs) {
    expect(md).toContain(`- \`${c.constructId}\``);
    expect(md).toMatch(new RegExp(`- \`${c.constructId}\`[^\n]*\\*\\*${c.status}\\*\\*[^\n]*${String(c.attempts.length)} attempt\\(s\\)`));
    expect(res.reportHtml).toMatch(new RegExp(`<code>${c.constructId}</code>[^<]*&mdash; <strong>${c.status}</strong>`));
  }
}

describe('lsc compile: full toylang compile via FakeProvider (scenario wp09)', () => {
  it('yields a valid draft Rule Set that covers every rule type, all rules validated', async () => {
    const res = await compile('wp09', '--sample', TOYLANG_SAMPLE);
    expect(res.code).toBe(0);
    expect(io.err.join('')).toBe('');
    const ruleSet = res.ruleSet as RuleSet;
    expect(validateRuleSet(ruleSet).ok).toBe(true);
    expect(new Set(ruleSet.rules.map((r) => r.type))).toEqual(new Set(RULE_TYPES));
    expect(ruleSet.rules.every((r) => r.status === 'validated')).toBe(true);
    // Confidence comes from the formula (D8): toylang has ≥5 positive and ≥2 negative examples per construct.
    expect(ruleSet.rules.map((r) => r.confidence)).toEqual(ruleSet.rules.map(() => 'high'));
    expect(ruleSet.rules.every((r) => r.tests.failed === 0 && r.tests.passed >= 9)).toBe(true);
    expect(ruleSet.fileMatchers).toEqual(['**/*.tl']);
    expect(ruleSet.lineComment).toBe('--');
    expect(ruleSet.version).toBe('0.0.0-draft');
    // Provenance: each rule cites its Skill section and every example of its construct.
    const call = ruleSet.rules.find((r) => r.id === 'call');
    expect(call?.sourceEvidence).toEqual([
      expect.objectContaining({ skill: 'call.md', anchor: 'calling-a-procedure' }),
    ]);
    expect(call?.sourceEvidence[0]?.exampleIds).toHaveLength(10);
    // "prefer exact": the recorded answers use exact where it suffices.
    expect(ruleSet.rules.filter((r) => r.engine === 'exact').map((r) => r.id).sort()).toEqual(['db-write', 'entry-point', 'module-declaration']);
  });

  it('passes `lsc validate-ruleset` and writes results.json and synthesis.json', async () => {
    const res = await compile('wp09');
    const draft = join(res.out, 'toylang.ruleset.draft.json');
    io.out = [];
    expect(await runCli('validate-ruleset', draft)).toBe(0);
    expect(res.results?.ok).toBe(true);
    expect(res.results?.coverage.ruleTypesMissing).toEqual([]);
    expect(res.synthesis.status).toBe('completed');
    expect(res.synthesis.summary).toMatchObject({ constructs: 8, validated: 8, rejected: 0, notJustified: 0 });
  });

  it('writes report.md and report.html into --out with the verdict, every outcome and the model source (D25 item 2)', async () => {
    const res = await compile('wp09', '--sample', TOYLANG_SAMPLE);
    const md = res.reportMd as string;
    const html = res.reportHtml as string;
    expect(md).toBeDefined();
    expect(html).toBeDefined();
    // Verdict line, with the unreviewed sample-match count.
    const verdict = /^\*\*(VALIDATED — .*sample match(es)? not yet reviewed.*)\*\*$/m.exec(md)?.[1];
    expect(verdict).toBeDefined();
    expect(html).toContain(htmlEscaped(verdict as string));
    expect(io.out.join('')).toContain(`(verdict: ${verdict as string})`);
    // Lexical settings and every construct's synthesis outcome.
    expect(md).toContain('## Lexical settings');
    expect(md).toContain('**/*.tl');
    expectEveryOutcome(res);
    expect(synthesisSection(md)).toContain('attempt 1: **failed-tests** — read-03 (positive): missed line 1 table="order_lines"');
    // The summary prints both paths.
    const printed = io.out.join('');
    expect(printed).toContain(`Wrote ${join(res.out, 'report.md')}`);
    expect(printed).toContain(`Wrote ${join(res.out, 'report.html')}`);
    expect(printed).toContain(`Report: ${join(res.out, 'report.md')} and ${join(res.out, 'report.html')}`);
    // Provider, model and origin come from the recordings replayed (all hand-written).
    expect(res.synthesis.modelSource).toEqual({
      mode: 'replay',
      configuredProvider: 'fake',
      provider: 'hand-written',
      model: 'hand-written',
      origin: 'hand-written',
      calls: [{ origin: 'hand-written', provider: 'hand-written', model: 'hand-written', calls: 10 }],
      summary: 'replay of hand-written recordings (10 call(s); provider hand-written, model hand-written)',
    });
    expect(printed).toContain('Model source: replay of hand-written recordings (10 call(s)');
  });

  it('a replay mixing recording origins says "mixed", with counts', async () => {
    const dir = join(tempDir(), 'recordings');
    cpSync(recordingsDir('wp09'), dir, { recursive: true });
    // Relabel two recordings as captured; the hash covers only the request, so they still replay.
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().slice(0, 2);
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
      writeFileSync(join(dir, f), JSON.stringify({ ...rec, origin: 'recorded', provider: 'anthropic', model: 'toy-model-1' }));
    }
    const { config } = writeConfig();
    const out = join(tempDir(), 'out');
    expect(await runCli('compile', TOYLANG_SKILLS, '--provider', 'fake', '--recordings', dir, '--config', config, '--out', out)).toBe(0);
    const synthesis = SynthesisReportSchema.parse(JSON.parse(readFileSync(join(out, 'synthesis.json'), 'utf8')));
    expect(synthesis.modelSource).toMatchObject({ mode: 'replay', provider: 'mixed', model: 'mixed', origin: 'mixed' });
    expect(synthesis.modelSource?.calls).toEqual([
      { origin: 'hand-written', provider: 'hand-written', model: 'hand-written', calls: 8 },
      { origin: 'recorded', provider: 'anthropic', model: 'toy-model-1', calls: 2 },
    ]);
    expect(synthesis.modelSource?.summary).toBe('replay of mixed recordings: 2 recorded, 8 hand-written (10 call(s); provider mixed, model mixed)');
  });

  it('logs every request once, and uses every recording exactly once', async () => {
    const res = await compile('wp09');
    const entries = logEntries(res.logDir);
    const recordings = loadRecordings(recordingsDir('wp09'));
    expect(entries).toHaveLength(recordings.length);
    expect(entries.every((e) => e.sent && e.outcome === 'ok')).toBe(true);
    expect(new Set(entries.map((e) => e.requestHash))).toEqual(new Set(recordings.map((r) => r.hash)));
    expect(res.synthesis.usage.calls).toBe(recordings.length);
    expect(res.synthesis.usage.inputTokens).toBe(recordings.reduce((n, r) => n + r.response.usage.inputTokens, 0));
    expect(io.out.join('')).toContain('Model usage: 10 call(s)');
  });

  it('bad first proposal: refinement fixes db-read within the attempt cap', async () => {
    const res = await compile('wp09');
    const dbRead = res.synthesis.constructs.find((c) => c.constructId === 'db-read');
    expect(dbRead?.status).toBe('validated');
    expect(dbRead?.attempts.map((a) => a.outcome)).toEqual(['failed-tests', 'passed']);
    expect(dbRead?.attempts[0]?.tests?.failingExampleIds).toEqual(['read-03']);
    expect(dbRead?.attempts[0]?.problems.join('\n')).toContain('read-03 (positive): missed line 1 table="order_lines"');
    // The refinement request carried the failing example, expected vs actual and the previous pattern.
    const refinement = logEntries(res.logDir).find((e) => e.request.messages.length === 3);
    const feedback = refinement?.request.messages[2]?.content ?? '';
    expect(feedback).toContain('Attempt 1 of 3 failed.');
    expect(feedback).toContain('## read-03 (positive)');
    expect(feedback).toContain('missed: expected a match on line 1 with table="order_lines"');
    expect(feedback).toContain('"multiline":false');
    const rule = res.ruleSet?.rules.find((r) => r.id === 'db-read');
    expect(rule?.engine === 'regex' && rule.regex.multiline).toBe(true);
    expect(rule?.status).toBe('validated');
  });

  it('never sends repository-sample file contents to the model (snippet log)', async () => {
    const res = await compile('wp09', '--sample', TOYLANG_SAMPLE);
    // The sample was really used by the runner...
    expect(res.results?.filesScanned.length).toBeGreaterThan(10);
    expect(res.results?.rules.some((r) => r.sampleMatches.length > 0)).toBe(true);
    // ...but no line that exists only in the sample appears in any request.
    const logText = readdirSync(res.logDir)
      .map((f) => readFileSync(join(res.logDir, f), 'utf8'))
      .join('\n');
    const known = knownDocumentationText();
    const sampleOnlyLines = sampleLines().filter((line) => !known.includes(line));
    expect(sampleOnlyLines.length).toBeGreaterThan(50);
    const leaked = sampleOnlyLines.filter((line) => logText.includes(JSON.stringify(line).slice(1, -1)));
    expect(leaked).toEqual([]);
  });
});

describe('lsc compile: a construct that never converges (scenario wp09-reject)', () => {
  it('ends call as rejected, visibly, and still writes a valid draft', async () => {
    const res = await compile('wp09-reject');
    expect(res.code).toBe(2);
    const call = res.synthesis.constructs.find((c) => c.constructId === 'call');
    expect(call?.status).toBe('rejected');
    expect(call?.attempts.map((a) => a.outcome)).toEqual(['invalid-output', 'invalid-rule', 'failed-tests']);
    expect(call?.attempts[0]?.problems[0]).toMatch(/^invalid_json:/);
    expect(call?.attempts[1]?.problems.join('\n')).toContain('[re2-compile]');
    expect(call?.attempts[2]?.tests?.failingExampleIds).toEqual(['call-02', 'call-07']);
    expect(call?.reason).toContain('no attempt passed within the cap of 3 attempt(s)');
    expect(call?.reason).toContain('expected callee="apply_discount", module="billing" got callee="billing"');

    // Kept in the draft with its last pattern and status rejected; the draft is still valid.
    const rule = res.ruleSet?.rules.find((r) => r.id === 'call');
    expect(rule?.status).toBe('rejected');
    expect(rule?.engine === 'exact' && rule.exact.tokens).toEqual(['CALL', '(?<callee>)']);
    expect(rule?.tests.failingExampleIds).toEqual(['call-02', 'call-07']);
    expect(validateRuleSet(res.ruleSet).ok).toBe(true);

    // Kept in results.json with its failures; results are not ok.
    const result = res.results?.rules.find((r) => r.ruleId === 'call');
    expect(result?.tests.failingExampleIds).toEqual(['call-02', 'call-07']);
    expect(result?.sampleMatches).toEqual([]);
    expect(res.results?.ok).toBe(false);

    expect(io.out.join('')).toMatch(/REJECTED\s+call\s+3 attempt\(s\)/);
  });

  it('the report written by compile shows call as rejected with its reasons, and the REJECTED verdict', async () => {
    const res = await compile('wp09-reject');
    const md = res.reportMd as string;
    const html = res.reportHtml as string;
    const verdict = /^\*\*(REJECTED — .*)\*\*$/m.exec(md)?.[1];
    expect(verdict).toBeDefined();
    expect(verdict).toContain('no unreviewed sample matches'); // no --sample in this run
    expect(html).toContain(htmlEscaped(verdict as string));
    expectEveryOutcome(res);
    const call = res.synthesis.constructs.find((c) => c.constructId === 'call');
    const reason = call?.reason as string;
    const section = synthesisSection(md);
    expect(section).toContain(`- \`call\` (call) — **rejected** (rule \`call\`), 3 attempt(s): ${reason}`);
    expect(section).toContain('attempt 1: **invalid-output** — invalid_json:');
    expect(section).toContain('[re2-compile]');
    expect(section).toContain('expected callee="apply_discount", module="billing" got callee="billing"');
    expect(html).toContain(htmlEscaped(reason));
    expect(section).toMatch(/- `config-flag` \(config_ref\) — \*\*not-justified\*\*[^\n]*exercises the path where the model declines/);
    // The lexical refusal and its reason are visible too.
    expect(res.synthesis.lexical.attempts[0]?.outcome).toBe('unjustified-settings');
  });

  it('records "not justified" as no rule plus the stated reason', async () => {
    const res = await compile('wp09-reject');
    const flag = res.synthesis.constructs.find((c) => c.constructId === 'config-flag');
    expect(flag?.status).toBe('not-justified');
    expect(flag?.attempts).toHaveLength(1);
    expect(flag?.reason).toContain('exercises the path where the model declines');
    expect(res.ruleSet?.rules.some((r) => r.id === 'config-flag')).toBe(false);
    expect(io.out.join('')).toMatch(/NOT JUSTIFIED\s+config-flag/);
    // Everything else still compiles.
    expect(res.synthesis.summary).toMatchObject({ validated: 6, rejected: 1, notJustified: 1 });
  });

  it('refuses lexical settings the documentation does not contain, then accepts the refinement', async () => {
    const res = await compile('wp09-reject');
    expect(res.synthesis.lexical.attempts.map((a) => a.outcome)).toEqual(['unjustified-settings', 'accepted']);
    expect(res.synthesis.lexical.attempts[0]?.problems).toEqual(['lineComment: "//" does not appear in the documentation']);
    expect(res.ruleSet?.lineComment).toBe('--');
  });
});

describe('lsc compile: infrastructure failures stop the compile honestly', () => {
  it('budget exhaustion: stops, lists constructs not attempted, exit 1', async () => {
    const { config, logDir } = writeConfig({ budgets: { maxOutputTokensPerCall: 1024, maxTotalTokensPerCompile: 6000 } });
    const out = join(tempDir(), 'out');
    const code = await runCli('compile', TOYLANG_SKILLS, '--provider', 'fake', '--recordings', recordingsDir('wp09'), '--config', config, '--out', out);
    expect(code).toBe(1);
    const synthesis = SynthesisReportSchema.parse(JSON.parse(readFileSync(join(out, 'synthesis.json'), 'utf8')));
    expect(synthesis.status).toBe('aborted');
    expect(synthesis.error).toMatch(/^BudgetExceededError: per-compile token budget/);
    expect(synthesis.summary.notAttempted).toBeGreaterThan(0);
    expect(synthesis.summary.validated + synthesis.summary.notAttempted).toBe(8);
    // The refused or over-budget request is in the snippet log too.
    expect(logEntries(logDir).some((e) => e.error !== undefined)).toBe(true);
  });

  it('unknown recording: stops before any rule, no Rule Set written, exit 1', async () => {
    const { config } = writeConfig();
    const out = join(tempDir(), 'out');
    const code = await runCli('compile', TOYLANG_SKILLS, '--provider', 'fake', '--recordings', join(recordingsDir('wp09'), '..', 'wp08'), '--config', config, '--out', out);
    expect(code).toBe(1);
    expect(existsSync(join(out, 'toylang.ruleset.draft.json'))).toBe(false);
    const synthesis = SynthesisReportSchema.parse(JSON.parse(readFileSync(join(out, 'synthesis.json'), 'utf8')));
    expect(synthesis.error).toMatch(/^UnknownRecordingError/);
    expect(synthesis.lexical.status).toBe('not-attempted');
    // No Rule Set means no results to report on; the summary says so instead of writing an empty report.
    expect(existsSync(join(out, 'report.md'))).toBe(false);
    expect(io.out.join('')).toContain('Report: not written (no draft Rule Set');
    expect(synthesis.modelSource).toMatchObject({ mode: 'replay', origin: 'none', provider: 'none', calls: [] });
  });

  it('without a provider it fails with a clear message', async () => {
    const { config } = writeConfig();
    expect(await runCli('compile', TOYLANG_SKILLS, '--config', config, '--out', join(tempDir(), 'o'))).toBe(1);
    expect(io.err.join('')).toContain('no model provider configured');
  });
});

// --- helpers ---------------------------------------------------------------

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

function knownDocumentationText(): string {
  const root = join(TOYLANG_SKILLS, '..');
  return [...walk(join(root, 'skills')), ...walk(join(root, 'examples'))].map((f) => readFileSync(f, 'utf8')).join('\n');
}

function sampleLines(): string[] {
  const lines = walk(TOYLANG_SAMPLE).flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/));
  return [...new Set(lines.map((l) => l.trim()).filter((l) => l.length >= 12))];
}
