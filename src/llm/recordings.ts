import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { RecordingFormatError } from './errors.js';
import { LlmRequestSchema, requestHash } from './request.js';
import type { LlmRequest, LlmResponse } from './types.js';

/**
 * Recording file format (`fixtures/recordings/<set>/<hash>.json`). One file per
 * distinct request; the file name is the request hash (`requestHash`).
 * Recordings contain toylang content only (D5); never real-language code.
 */
export const RECORDING_FORMAT_VERSION = 1;

export const RecordingSchema = z.strictObject({
  formatVersion: z.literal(RECORDING_FORMAT_VERSION),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * `recorded`: captured from a real provider by `RecordingProvider`.
   * `hand-written`: authored for a test (e.g. an invalid-JSON answer); says so openly.
   */
  origin: z.enum(['recorded', 'hand-written']),
  provider: z.string().min(1),
  model: z.string().min(1),
  recordedAt: z.iso.datetime(),
  /** Free text: what this recording is for. */
  note: z.string().optional(),
  request: LlmRequestSchema,
  response: z.strictObject({
    text: z.string(),
    usage: z.strictObject({
      inputTokens: z.number().int().min(0),
      outputTokens: z.number().int().min(0),
    }),
    stopReason: z.enum(['end', 'max_tokens', 'other']),
    rawStopReason: z.string().optional(),
  }),
});

export type Recording = z.infer<typeof RecordingSchema>;

export function recordingFileName(hash: string): string {
  return `${hash}.json`;
}

/** Parses and checks one recording. The stored hash must match the stored request. */
export function parseRecording(value: unknown, source: string): Recording {
  const parsed = RecordingSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new RecordingFormatError(`${source}: invalid recording: ${detail}`);
  }
  const rec = parsed.data;
  const actual = requestHash(rec.request);
  if (actual !== rec.hash) {
    throw new RecordingFormatError(
      `${source}: stored hash ${rec.hash} does not match its request (hash ${actual}); ` +
        'the request was edited after recording — re-record it instead of editing',
    );
  }
  return rec;
}

/** Loads every `*.json` recording in `dir` (not recursive), sorted by file name. */
export function loadRecordings(dir: string): Recording[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    throw new RecordingFormatError(`cannot read recordings directory ${dir}: ${(err as Error).message}`, {
      cause: err,
    });
  }
  return files.map((file) => {
    const path = join(dir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      throw new RecordingFormatError(`${path}: not valid JSON: ${(err as Error).message}`, { cause: err });
    }
    const rec = parseRecording(raw, path);
    if (file !== recordingFileName(rec.hash)) {
      throw new RecordingFormatError(`${path}: file name must be ${recordingFileName(rec.hash)}`);
    }
    return rec;
  });
}

export interface NewRecording {
  readonly origin: Recording['origin'];
  readonly provider: string;
  readonly model: string;
  readonly request: LlmRequest;
  readonly response: LlmResponse;
  readonly note?: string;
  readonly recordedAt?: Date;
}

export function buildRecording(input: NewRecording): Recording {
  const { request, response } = input;
  const rec: Recording = {
    formatVersion: RECORDING_FORMAT_VERSION,
    hash: requestHash(request),
    origin: input.origin,
    provider: input.provider,
    model: input.model,
    recordedAt: (input.recordedAt ?? new Date()).toISOString(),
    ...(input.note !== undefined ? { note: input.note } : {}),
    request: {
      system: request.system,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      maxOutputTokens: request.maxOutputTokens,
    },
    response: {
      text: response.text,
      usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
      stopReason: response.stopReason,
      ...(response.rawStopReason !== undefined ? { rawStopReason: response.rawStopReason } : {}),
    },
  };
  return parseRecording(rec, 'new recording');
}

/** Writes a recording to `dir/<hash>.json` (pretty-printed, trailing newline). Returns the path. */
export function writeRecording(dir: string, rec: Recording): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, recordingFileName(rec.hash));
  writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`, 'utf8');
  return path;
}
