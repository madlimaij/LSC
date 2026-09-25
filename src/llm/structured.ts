import type { z } from 'zod';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.js';

/**
 * Why a model answer could not be turned into a typed value. Each of these is
 * a failed attempt for the caller (plan §8 step 3); nothing is repaired.
 *
 * - `truncated`: the model hit `maxOutputTokens` (stop reason `max_tokens`)
 * - `stopped`: the model stopped for another reason (refusal, tool use, …)
 * - `no_json`: neither the whole text nor a fenced block is JSON
 * - `ambiguous_json`: more than one fenced code block; we do not pick one
 * - `invalid_json`: the JSON text does not parse
 * - `schema`: the JSON parses but does not match the Zod schema
 */
export type StructuredErrorKind = 'truncated' | 'stopped' | 'no_json' | 'ambiguous_json' | 'invalid_json' | 'schema';

export interface StructuredIssue {
  readonly path: string;
  readonly message: string;
}

export interface StructuredError {
  readonly kind: StructuredErrorKind;
  readonly message: string;
  /** Full model text, for the refinement prompt and the report. */
  readonly rawText: string;
  /** Zod issues when `kind === "schema"`. */
  readonly issues?: readonly StructuredIssue[];
}

export type StructuredResult<T> =
  | { readonly ok: true; readonly value: T; readonly response: LlmResponse }
  | { readonly ok: false; readonly error: StructuredError; readonly response: LlmResponse };

export type ExtractResult =
  | { readonly ok: true; readonly json: unknown }
  | { readonly ok: false; readonly kind: 'no_json' | 'ambiguous_json' | 'invalid_json'; readonly message: string };

const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm;

/**
 * Extracts JSON from model text. Accepted forms, nothing else:
 * 1. the whole (trimmed) text is a JSON object or array;
 * 2. the text contains exactly one fenced code block (info string empty or
 *    `json`), whose content is JSON; prose around it is ignored.
 * No brace scanning, no trailing-comma fixing: guessing hides bad output.
 */
export function extractJson(text: string): ExtractResult {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return parseJson(trimmed, 'response text');
  }
  const blocks = [...trimmed.matchAll(FENCE)].filter((m) => {
    const info = (m[2] ?? '').toLowerCase();
    return info === '' || info === 'json';
  });
  if (blocks.length === 0) {
    return {
      ok: false,
      kind: 'no_json',
      message: 'response is neither a JSON document nor contains a ```json fenced block',
    };
  }
  if (blocks.length > 1) {
    return {
      ok: false,
      kind: 'ambiguous_json',
      message: `response contains ${blocks.length} fenced JSON blocks; exactly one is required`,
    };
  }
  return parseJson(blocks[0]?.[3] ?? '', 'fenced block');
}

function parseJson(source: string, where: string): ExtractResult {
  try {
    return { ok: true, json: JSON.parse(source) as unknown };
  } catch (err) {
    return { ok: false, kind: 'invalid_json', message: `${where} is not valid JSON: ${(err as Error).message}` };
  }
}

/** Validates a model text against a schema without calling a provider. */
export function parseStructured<S extends z.ZodType>(
  schema: S,
  response: LlmResponse,
): StructuredResult<z.output<S>> {
  const fail = (
    kind: StructuredErrorKind,
    message: string,
    issues?: readonly StructuredIssue[],
  ): StructuredResult<z.output<S>> => ({
    ok: false,
    response,
    error: { kind, message, rawText: response.text, ...(issues ? { issues } : {}) },
  });

  if (response.stopReason === 'max_tokens') {
    return fail('truncated', 'response was cut off at maxOutputTokens');
  }
  if (response.stopReason === 'other') {
    return fail('stopped', `model stopped before finishing (stop reason: ${response.rawStopReason ?? 'unknown'})`);
  }
  const extracted = extractJson(response.text);
  if (!extracted.ok) {
    return fail(extracted.kind, extracted.message);
  }
  const parsed = schema.safeParse(extracted.json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.map(String).join('.') || '(root)',
      message: i.message,
    }));
    return fail(
      'schema',
      `response JSON does not match the expected schema: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
      issues,
    );
  }
  return { ok: true, value: parsed.data as z.output<S>, response };
}

/**
 * Asks the provider and returns a typed value or a typed `StructuredError`.
 * Infrastructure failures (budget exceeded, unknown recording, provider
 * error) are thrown, not returned, because they must stop the compile rather
 * than count as one failed attempt.
 */
export async function structured<S extends z.ZodType>(
  provider: LlmProvider,
  schema: S,
  request: LlmRequest,
): Promise<StructuredResult<z.output<S>>> {
  const response = await provider.complete(request);
  return parseStructured(schema, response);
}
