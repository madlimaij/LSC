/**
 * D16 g: examples from reviews.yaml (repository-sample text) are used only by
 * the runner and are never sent to a model provider. Plan §8: no file from
 * the repository sample is ever sent to the model.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuleSet } from '../../src/contract/index.js';
import { buildExample, type Example } from '../../src/examples/index.js';
import type { ExampleResult } from '../../src/runner/index.js';
import { buildRefinementMessage, isPromptSafeExample, selectPromptExamples, type RuleDraft } from '../../src/synth/index.js';
import { copyToylang, io, logEntries, runCli, tempDir, writeConfig } from './helpers.js';
import { recordingsDir, TOYLANG_SAMPLE } from './wp09-recordings.js';

const SENTINEL_CALLEE = 'zz_review_sentinel_proc_4711';
const SENTINEL_VAR = 'zz_review_sentinel_value_4711';
const SENTINEL_SAMPLE = 'zz_sample_sentinel_proc_9913';

const REVIEWS = `reviews:
  - id: review-call-001
    construct: call
    ruleId: call
    verdict: correct
    sampleFile: orders/private.tl
    sampleLine: 3
    code: |
      CALL ${SENTINEL_CALLEE}(order_id)
    expected:
      - line: 1
        type: call
        captures: { callee: ${SENTINEL_CALLEE} }
  - id: review-read-001
    construct: db-read
    ruleId: db-read
    verdict: false_positive
    sampleFile: orders/private.tl
    sampleLine: 9
    code: |
      LET ${SENTINEL_VAR} = 1
`;

function allLogText(logDir: string): string {
  return readdirSync(logDir)
    .map((f) => readFileSync(join(logDir, f), 'utf8'))
    .join('\n');
}

describe('review examples and sample files never reach a prompt', () => {
  it('review examples are tested by the runner but absent from every request (D16 g)', async () => {
    const { languageDir, skillsDir } = copyToylang();
    writeFileSync(join(languageDir, 'reviews.yaml'), REVIEWS);
    const sampleDir = tempDir();
    writeFileSync(join(sampleDir, 'private.tl'), `MODULE private_mod\nPROC p()\n  CALL ${SENTINEL_SAMPLE}(x)\nENDPROC\n`);
    const { config, logDir } = writeConfig();
    const out = join(tempDir(), 'out');

    // The wp09 recordings replay unchanged: every prompt is byte-identical to the
    // compile without reviews.yaml, so no review content can be in any of them.
    const code = await runCli(
      'compile',
      skillsDir,
      '--sample',
      sampleDir,
      '--provider',
      'fake',
      '--recordings',
      recordingsDir('wp09'),
      '--config',
      config,
      '--out',
      out,
    );
    expect(io.err.join('')).toBe('');
    expect(code).toBe(0);

    // The runner did use both review examples and the sample file.
    const ruleSet = JSON.parse(readFileSync(join(out, 'toylang.ruleset.draft.json'), 'utf8')) as RuleSet;
    const call = ruleSet.rules.find((r) => r.id === 'call');
    expect(call?.sourceEvidence[0]?.exampleIds).toContain('review-call-001');
    expect(call?.tests.passed).toBe(11);
    expect(ruleSet.rules.find((r) => r.id === 'db-read')?.sourceEvidence[0]?.exampleIds).toContain('review-read-001');
    const results = JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')) as { rules: { ruleId: string; sampleMatches: { captures: { callee?: string } }[] }[] };
    expect(results.rules.find((r) => r.ruleId === 'call')?.sampleMatches.map((m) => m.captures.callee)).toContain(SENTINEL_SAMPLE);

    // Nothing of it is in the snippet log.
    const logText = allLogText(logDir);
    expect(logEntries(logDir).length).toBe(10);
    for (const secret of [SENTINEL_CALLEE, SENTINEL_VAR, SENTINEL_SAMPLE, 'review-call-001', 'review-read-001', 'private.tl']) {
      expect(logText).not.toContain(secret);
    }
  });

  it('the fixture sample repository is not in any request either', async () => {
    const { config, logDir } = writeConfig();
    await runCli('compile', join(TOYLANG_SAMPLE, '..', 'skills'), '--sample', TOYLANG_SAMPLE, '--provider', 'fake', '--recordings', recordingsDir('wp09'), '--config', config, '--out', join(tempDir(), 'o'));
    const logText = allLogText(logDir);
    expect(logText).not.toContain('sample-repo');
    expect(logText).not.toContain('late_bound_cleanup'); // S3: only in sample-repo/batch/nightly.tl
  });

  it('refinement feedback withholds failing review examples entirely', () => {
    const review = buildExample({
      id: 'review-call-009',
      construct: 'call',
      polarity: 'negative',
      code: `LET ${SENTINEL_VAR} = "x"\n`,
      expected: [],
      source: { kind: 'review', file: 'reviews.yaml', entry: 0, ruleId: 'call', sampleFile: 'secret/file.tl', sampleLine: 4, verdict: 'false_positive' },
    });
    expect(review.ok).toBe(true);
    const example = (review as { ok: true; example: Example }).example;
    expect(isPromptSafeExample(example)).toBe(false);
    const failing: ExampleResult = {
      exampleId: example.id,
      construct: 'call',
      polarity: 'negative',
      role: 'own',
      passed: false,
      missed: [],
      unexpected: [{ line: 1, column: 5, captures: { callee: SENTINEL_VAR } }],
      wrongCaptures: [],
    };
    const draft: RuleDraft = {
      engine: 'exact',
      exact: { tokens: ['LET', '(?<callee>)'], caseSensitive: false },
      captures: { callee: 'callee' },
      rationale: 'test',
    };
    const message = buildRefinementMessage({
      attempt: 1,
      maxAttempts: 3,
      failure: { kind: 'failed-tests', draft, ownPassed: 3, ownTotal: 4, failing: [failing] },
      examplesById: new Map([[example.id, example]]),
    });
    expect(message).not.toContain(SENTINEL_VAR);
    expect(message).not.toContain('review-call-009');
    expect(message).not.toContain('secret/file.tl');
    expect(message).toContain('1 failing example(s) come from human review of repository samples; their content is not shown');
  });

  it('proposal prompts never select review examples', () => {
    const review = buildExample({
      id: 'review-call-010',
      construct: 'call',
      polarity: 'positive',
      code: `CALL ${SENTINEL_CALLEE}()\n`,
      expected: [{ line: 1, type: 'call', captures: { callee: SENTINEL_CALLEE } }],
      source: { kind: 'review', file: 'reviews.yaml', entry: 0, ruleId: 'call', sampleFile: 'a.tl', sampleLine: 1, verdict: 'correct' },
    });
    const example = (review as { ok: true; example: Example }).example;
    const construct = { id: 'call', skillPath: 'call.md', anchor: 'call.md#x', prose: 'CALL docs', examples: [example] };
    expect(selectPromptExamples(construct).shown).toEqual([]);
  });
});
