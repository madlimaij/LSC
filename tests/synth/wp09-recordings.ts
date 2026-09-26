/**
 * Source of the hand-written WP-09 recordings in fixtures/recordings/wp09/
 * and fixtures/recordings/wp09-reject/.
 *
 * These are NOT captured from a real provider (origin "hand-written"; no API
 * key was available while WP-09 was built). The answers were written by the
 * llm-integrator agent for toylang only (D5). Requests are produced by the
 * real synthesis pipeline (`compileLanguage`) over fixtures/toylang/skills,
 * so they are exactly what `lsc compile` sends; only the answers are
 * scripted. Token usage in these recordings is an estimate (characters / 4),
 * not a provider's count.
 *
 * Scenarios:
 * - `wp09`: a full toylang compile. `db-read` gets a bad first proposal (a
 *   per-line pattern that misses the continued read `read-03`, trap T8) and
 *   is fixed by refinement on attempt 2.
 * - `wp09-reject`: the same compile, except that the lexical settings first
 *   name a comment marker the documentation does not contain (refused by the
 *   runner, fixed on attempt 2); `call` never converges (invalid JSON, then a
 *   lookahead RE2 refuses, then a rule that captures the module as callee)
 *   and ends `rejected`; `config-flag` is answered "not justified".
 *
 * Regenerate after a prompt change:  npx tsx tests/synth/wp09-recordings.ts
 * tests/synth/recordings.test.ts checks that the files on disk match.
 */
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRecording,
  writeRecording,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type Recording,
} from '../../src/llm/index.js';
import { compileLanguage, DEFAULT_MAX_OUTPUT_TOKENS } from '../../src/synth/index.js';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TOYLANG_SKILLS = resolve(REPO_ROOT, 'fixtures/toylang/skills');
export const TOYLANG_SAMPLE = resolve(REPO_ROOT, 'fixtures/toylang/sample-repo');

export const SCENARIOS = ['wp09', 'wp09-reject'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export function recordingsDir(scenario: Scenario): string {
  return resolve(REPO_ROOT, 'fixtures/recordings', scenario);
}

const json = (value: unknown): string => JSON.stringify(value);

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

const LEXICAL_OK = json({
  fileMatchers: ['**/*.tl'],
  lineComment: '--',
  blockComment: { start: '/*', end: '*/' },
  stringDelimiters: [{ start: '"', end: '"' }],
});

const RULES: Record<string, string> = {
  'module-declaration': json({
    rules: [
      {
        engine: 'exact',
        exact: { tokens: ['MODULE', '(?<name>)'], caseSensitive: false },
        captures: { name: 'name' },
        rationale: 'A module is declared as MODULE followed by the name; keywords are case-insensitive and there is no ENDMODULE, so no blockEnd.',
      },
    ],
  }),
  'proc-definition': json({
    rules: [
      {
        engine: 'regex',
        regex: { pattern: `^\\s*(?<kind>PROC|FUNC)\\s+(?<name>${IDENT})`, flags: 'i', multiline: false },
        captures: { name: 'name', kind: 'kind' },
        blockEnd: { pattern: '^\\s*END(?:PROC|FUNC)\\b', flags: 'i', multiline: false },
        rationale:
          'PROC or FUNC is the first word on its line and is followed by the name; the keyword used is reported as kind. The block ends at ENDPROC or ENDFUNC, not at ENDIF or ENDWHILE. Two keywords need a regex.',
      },
    ],
  }),
  call: json({
    rules: [
      {
        engine: 'regex',
        regex: { pattern: `\\bCALL\\s+(?:(?<module>${IDENT})\\.)?(?<callee>${IDENT})\\s*\\(`, flags: 'i', multiline: false },
        captures: { callee: 'callee', module: 'module' },
        rationale:
          'CALL is followed by an optional module prefix with a dot, the procedure name and a parenthesised argument list; the optional module needs a regex.',
      },
    ],
  }),
  include: json({
    rules: [
      {
        engine: 'regex',
        regex: { pattern: '^\\s*INCLUDE\\s+"(?<target>[^"]+)"', flags: 'i', multiline: false },
        captures: { target: 'target' },
        searchStrings: true,
        rationale: 'INCLUDE starts its line and names the file in a string literal, which is the value to report, so strings are searched.',
      },
    ],
  }),
  'db-write': json({
    rules: [
      {
        engine: 'exact',
        exact: { tokens: ['WRITE', '(?<table>)'], caseSensitive: false },
        captures: { table: 'table' },
        rationale: 'The table is the identifier right after WRITE; keywords are case-insensitive.',
      },
    ],
  }),
  'config-flag': json({
    rules: [
      {
        engine: 'regex',
        regex: { pattern: '\\bFLAG\\s*\\(\\s*"(?<key>[^"]+)"\\s*\\)', flags: 'i', multiline: false },
        captures: { key: 'key' },
        searchStrings: true,
        rationale: 'A flag lookup is FLAG("key") with the key in a string literal; FLAG(variable) is not a static reference, so the quotes are required.',
      },
    ],
  }),
  'entry-point': json({
    rules: [
      {
        engine: 'exact',
        exact: { tokens: ['ENTRY', '(?<name>)', '->'], caseSensitive: false },
        captures: { name: 'name' },
        rationale: 'An entry point is ENTRY, the job name, then -> and the target; the job name is reported.',
      },
    ],
  }),
};

const DB_READ_BAD = json({
  rules: [
    {
      engine: 'regex',
      regex: { pattern: `\\bREAD\\s+(?<table>${IDENT})`, flags: 'i', multiline: false },
      captures: { table: 'table' },
      rationale: 'The table is the identifier right after READ.',
    },
  ],
});

const DB_READ_FIXED = json({
  rules: [
    {
      engine: 'regex',
      regex: { pattern: `\\bREAD\\s+(?:&\\s+)?(?<table>${IDENT})`, flags: 'i', multiline: true },
      captures: { table: 'table' },
      rationale:
        'The documentation says a read may be split with & right after the keyword, putting the table on the next line; the whole-text pattern allows an & and a line break between READ and the table, and the match is reported on the READ line.',
    },
  ],
});

/** Answers per scenario: target (construct id or "lexical") → answer for attempt 1, 2, 3. */
const SCRIPTS: Record<Scenario, Record<string, string[]>> = {
  wp09: {
    lexical: [LEXICAL_OK],
    ...Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, [v]])),
    'db-read': [DB_READ_BAD, DB_READ_FIXED],
  },
  'wp09-reject': {
    lexical: [json({ fileMatchers: ['**/*.tl'], lineComment: '//', blockComment: { start: '/*', end: '*/' } }), LEXICAL_OK],
    ...Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, [v]])),
    'db-read': [DB_READ_BAD, DB_READ_FIXED],
    call: [
      // 1: not JSON (single quotes, trailing comma)
      "{'rules': [{'engine': 'regex', 'regex': {'pattern': '\\\\bCALL\\\\s+(?<callee>\\\\w+)', 'flags': 'i', 'multiline': false},}]}",
      // 2: valid JSON, but a lookahead: RE2 refuses it
      json({
        rules: [
          {
            engine: 'regex',
            regex: { pattern: `\\bCALL\\s+(?<callee>${IDENT})(?=\\s*\\()`, flags: 'i', multiline: false },
            captures: { callee: 'callee' },
            rationale: 'CALL, the name, and a parenthesis that must follow.',
          },
        ],
      }),
      // 3: valid rule that ignores the module prefix: captures the module as callee (trap T15)
      json({
        rules: [
          {
            engine: 'exact',
            exact: { tokens: ['CALL', '(?<callee>)'], caseSensitive: false },
            captures: { callee: 'callee' },
            rationale: 'CALL followed by the procedure name.',
          },
        ],
      }),
    ],
    'config-flag': [
      json({
        rules: [],
        notJustified: 'Hand-written test answer: exercises the path where the model declines to propose a rule.',
      }),
    ],
  },
};

const MARKER_CONSTRUCT = /^Construct: (\S+)$/m;

/** Which scripted target a request is for, and which attempt. */
export function targetOf(request: LlmRequest): { target: string; attempt: number } {
  const first = request.messages[0]?.content ?? '';
  const construct = MARKER_CONSTRUCT.exec(first);
  const target = construct?.[1] ?? (first.includes('lexical settings') ? 'lexical' : 'unknown');
  const attempt = request.messages.filter((m) => m.role === 'user').length;
  return { target, attempt };
}

const estimate = (chars: number): number => Math.ceil(chars / 4);

/** Answers from the script; any other request is an error (never a default answer). */
export class ScriptedProvider implements LlmProvider {
  readonly name = 'hand-written';
  readonly model = 'hand-written';
  readonly pairs: { request: LlmRequest; response: LlmResponse; note: string }[] = [];

  constructor(readonly scenario: Scenario) {}

  complete(request: LlmRequest): Promise<LlmResponse> {
    const { target, attempt } = targetOf(request);
    const text = SCRIPTS[this.scenario][target]?.[attempt - 1];
    if (text === undefined) {
      return Promise.reject(new Error(`no scripted answer for ${this.scenario} ${target} attempt ${String(attempt)}`));
    }
    const inputChars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
    const response: LlmResponse = {
      text,
      usage: { inputTokens: estimate(inputChars), outputTokens: estimate(text.length) },
      stopReason: 'end',
      rawStopReason: 'end_turn',
    };
    this.pairs.push({ request, response, note: `WP-09 ${this.scenario}: ${target}, attempt ${String(attempt)} (hand-written answer; usage estimated)` });
    return Promise.resolve(response);
  }
}

const RECORDED_AT = new Date('2026-09-26T00:00:00.000Z');

/** Runs the real pipeline with scripted answers and returns the recordings it produces, sorted by hash. */
export async function wp09Recordings(scenario: Scenario): Promise<Recording[]> {
  const provider = new ScriptedProvider(scenario);
  await compileLanguage({
    skillsDir: TOYLANG_SKILLS,
    languageId: 'toylang',
    provider,
    maxAttempts: 3,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    compilerVersion: '0.0.0-test',
    now: () => RECORDED_AT,
  });
  return provider.pairs
    .map(({ request, response, note }) =>
      buildRecording({ origin: 'hand-written', provider: 'hand-written', model: 'hand-written', note, request, response, recordedAt: RECORDED_AT }),
    )
    .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const scenario of SCENARIOS) {
    const dir = recordingsDir(scenario);
    rmSync(dir, { recursive: true, force: true });
    for (const rec of await wp09Recordings(scenario)) console.log(writeRecording(dir, rec));
  }
}
