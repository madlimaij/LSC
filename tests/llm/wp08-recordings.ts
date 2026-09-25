/**
 * Source of the hand-written WP-08 recordings in fixtures/recordings/wp08/.
 *
 * These are NOT captured from a real provider (origin "hand-written"): they
 * exercise FakeProvider, budgets and structured() with fixed answers, including
 * deliberately broken ones. All content is toylang (D5).
 *
 * Regenerate after editing:  npx tsx tests/llm/wp08-recordings.ts
 * tests/llm/recordings.test.ts checks that the files on disk match this module.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecording, writeRecording, type LlmRequest, type LlmResponse, type Recording } from '../../src/llm/index.js';

export const WP08_RECORDINGS_DIR = fileURLToPath(new URL('../../fixtures/recordings/wp08/', import.meta.url));

const SYSTEM =
  'You write deterministic detection rules for the language toylang. ' +
  'Answer with one JSON object and nothing else.';

function ask(construct: string, snippet: string): LlmRequest {
  return {
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content:
          `Construct: ${construct}\n` +
          'Propose rules as {"rules": [{"id": string, "engine": "regex", "pattern": string}], "notJustified"?: string}.\n' +
          `Positive example:\n${snippet}`,
      },
    ],
    maxOutputTokens: 512,
  };
}

function answer(text: string, inputTokens: number, outputTokens: number, stop: LlmResponse['stopReason'] = 'end'): LlmResponse {
  return {
    text,
    usage: { inputTokens, outputTokens },
    stopReason: stop,
    rawStopReason: stop === 'end' ? 'end_turn' : stop === 'max_tokens' ? 'max_tokens' : 'refusal',
  };
}

export const requests = {
  validFenced: ask('call', 'CALL apply_discount(order_id)'),
  validBare: ask('include', 'INCLUDE "common/util.tl"'),
  invalidJson: ask('db-read', 'READ customers WHERE id = cid INTO cust'),
  proseOnly: ask('db-write', 'WRITE orders SET status = "paid" WHERE id = oid'),
  schemaMismatch: ask('config-flag', 'IF FLAG("new_pricing") THEN'),
  truncated: ask('module-declaration', 'MODULE billing'),
  twoBlocks: ask('entry-point', 'ENTRY nightly_billing -> calc_total'),
  notJustified: ask('proc-definition', 'PROC apply_discount(order_id)'),
} satisfies Record<string, LlmRequest>;

export type Wp08RequestName = keyof typeof requests;

const responses: Record<Wp08RequestName, { note: string; response: LlmResponse }> = {
  validFenced: {
    note: 'valid rule inside a ```json fence with surrounding prose',
    response: answer(
      'Here is the rule:\n```json\n{"rules": [{"id": "call-statement", "engine": "regex", "pattern": "(?i)\\\\bCALL\\\\s+(?<callee>[A-Za-z_][A-Za-z0-9_]*)\\\\s*\\\\("}]}\n```\n',
      420,
      180,
    ),
  },
  validBare: {
    note: 'valid rule as a bare JSON document',
    response: answer(
      '{"rules": [{"id": "include-statement", "engine": "regex", "pattern": "(?i)^\\\\s*INCLUDE\\\\s+\\"(?<target>[^\\"]+)\\""}]}',
      400,
      150,
    ),
  },
  invalidJson: {
    note: 'JavaScript object literal, not JSON: unquoted keys, single quotes, trailing comma',
    response: answer("{rules: [{id: 'db-read', engine: 'regex', pattern: 'READ\\\\s+(?<table>\\\\w+)'},]}", 410, 60),
  },
  proseOnly: {
    note: 'prose without any JSON',
    response: answer('A WRITE statement starts with WRITE followed by the table name, so a regex on WRITE should work.', 405, 40),
  },
  schemaMismatch: {
    note: 'valid JSON that misses the required "engine" field and uses a numeric id',
    response: answer('{"rules": [{"id": 7, "pattern": "FLAG\\\\(\\"(?<key>[^\\"]+)\\"\\\\)"}]}', 400, 50),
  },
  truncated: {
    note: 'answer cut off at maxOutputTokens',
    response: answer('{"rules": [{"id": "module-declaration", "engine": "regex", "pattern": "(?i)^\\\\s*MODULE', 400, 512, 'max_tokens'),
  },
  twoBlocks: {
    note: 'two fenced JSON blocks; structured() must not pick one',
    response: answer(
      'Option A:\n```json\n{"rules": []}\n```\nOption B:\n```json\n{"rules": [{"id": "entry", "engine": "regex", "pattern": "ENTRY"}]}\n```\n',
      400,
      70,
    ),
  },
  notJustified: {
    note: 'model declines: no rules plus a reason',
    response: answer('{"rules": [], "notJustified": "One example is not enough to tell PROC from FUNC headers."}', 400, 30),
  },
};

const RECORDED_AT = new Date('2026-09-25T00:00:00.000Z');

export function wp08Recordings(): Recording[] {
  return (Object.keys(requests) as Wp08RequestName[]).map((name) =>
    buildRecording({
      origin: 'hand-written',
      provider: 'hand-written',
      model: 'hand-written',
      note: `WP-08 ${name}: ${responses[name].note}`,
      request: requests[name],
      response: responses[name].response,
      recordedAt: RECORDED_AT,
    }),
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const rec of wp08Recordings()) {
    console.log(writeRecording(WP08_RECORDINGS_DIR, rec));
  }
}
