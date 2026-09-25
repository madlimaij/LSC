import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeProvider, UnknownRecordingError, extractJson, parseStructured, structured } from '../../src/llm/index.js';
import { WP08_RECORDINGS_DIR, requests } from './wp08-recordings.js';

/** Test-local stand-in for WP-09's response schema. */
const ProposalSchema = z.strictObject({
  rules: z.array(z.strictObject({ id: z.string(), engine: z.enum(['exact', 'regex']), pattern: z.string() })),
  notJustified: z.string().optional(),
});

const fake = (): FakeProvider => FakeProvider.fromDirectory(WP08_RECORDINGS_DIR);

describe('structured()', () => {
  it('returns a typed value from a fenced JSON block', async () => {
    const res = await structured(fake(), ProposalSchema, requests.validFenced);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.rules[0]?.id).toBe('call-statement');
    expect(res.value.rules[0]?.pattern).toBe('(?i)\\bCALL\\s+(?<callee>[A-Za-z_][A-Za-z0-9_]*)\\s*\\(');
    expect(res.response.usage.outputTokens).toBe(180);
  });

  it('returns a typed value from a bare JSON document', async () => {
    const res = await structured(fake(), ProposalSchema, requests.validBare);
    expect(res.ok && res.value.rules[0]?.id).toBe('include-statement');
  });

  it('passes through "no rule plus a reason"', async () => {
    const res = await structured(fake(), ProposalSchema, requests.notJustified);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.rules).toEqual([]);
    expect(res.value.notJustified).toMatch(/not enough/);
  });

  it('invalid JSON is a typed error, not a repaired value', async () => {
    const res = await structured(fake(), ProposalSchema, requests.invalidJson);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('invalid_json');
    expect(res.error.rawText).toContain("{rules: [{id: 'db-read'");
    expect(res.response.usage).toEqual({ inputTokens: 410, outputTokens: 60 });
  });

  it('prose without JSON is no_json', async () => {
    const res = await structured(fake(), ProposalSchema, requests.proseOnly);
    expect(!res.ok && res.error.kind).toBe('no_json');
  });

  it('JSON that does not match the schema is a schema error with issues', async () => {
    const res = await structured(fake(), ProposalSchema, requests.schemaMismatch);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.kind).toBe('schema');
    const paths = res.error.issues?.map((i) => i.path) ?? [];
    expect(paths).toContain('rules.0.id');
    expect(paths).toContain('rules.0.engine');
  });

  it('a truncated answer is a truncated error', async () => {
    const res = await structured(fake(), ProposalSchema, requests.truncated);
    expect(!res.ok && res.error.kind).toBe('truncated');
  });

  it('two fenced JSON blocks are ambiguous; neither is chosen', async () => {
    const res = await structured(fake(), ProposalSchema, requests.twoBlocks);
    expect(!res.ok && res.error.kind).toBe('ambiguous_json');
  });

  it('throws (does not return) infrastructure errors such as an unknown recording', async () => {
    const req = { ...requests.validBare, messages: [{ role: 'user' as const, content: 'unrecorded' }] };
    await expect(structured(fake(), ProposalSchema, req)).rejects.toBeInstanceOf(UnknownRecordingError);
  });

  it('a non-end stop reason is a stopped error', () => {
    const res = parseStructured(ProposalSchema, {
      text: '{"rules": []}',
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'other',
      rawStopReason: 'refusal',
    });
    expect(!res.ok && res.error.message).toMatch(/refusal/);
  });
});

describe('extractJson', () => {
  it.each([
    ['bare object', '  {"a": 1}\n', { a: 1 }],
    ['bare array', '[1, 2]', [1, 2]],
    ['json fence', 'text\n```json\n{"a": 1}\n```\nmore text', { a: 1 }],
    ['unlabelled fence', '```\n{"a": 1}\n```', { a: 1 }],
    ['fence plus non-json fence', '```toylang\nCALL x()\n```\n```json\n{"a": 2}\n```', { a: 2 }],
  ])('accepts %s', (_name, text, expected) => {
    expect(extractJson(text)).toEqual({ ok: true, json: expected });
  });

  it.each([
    ['prose with inline braces', 'The answer is {"a": 1} I think', 'no_json'],
    ['trailing comma', '{"a": 1,}', 'invalid_json'],
    ['bare JSON followed by prose', '{"a": 1}\nHope this helps', 'invalid_json'],
    ['unterminated fence', '```json\n{"a": 1}\n', 'no_json'],
  ])('rejects %s', (_name, text, kind) => {
    const res = extractJson(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe(kind);
  });
});
