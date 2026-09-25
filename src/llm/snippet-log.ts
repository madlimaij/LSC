import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LlmMessageSchema } from './request.js';

/**
 * Snippet log (plan §8 "cost and safety controls"): one JSONL file per compile
 * run at `<log dir>/<run-id>.jsonl`. Every request that reaches the guarded
 * provider gets exactly one line, including requests refused by the budget and
 * calls that failed, so the log is a complete record of what was (or would
 * have been) sent. Lines are appended synchronously so a crash loses nothing.
 */

const UsageSchema = z.strictObject({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});

export const SnippetLogEntrySchema = z.strictObject({
  timestamp: z.iso.datetime(),
  runId: z.string(),
  /** 1-based position of this request in the run. */
  seq: z.number().int().positive(),
  provider: z.string(),
  model: z.string(),
  requestHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** True when the request was passed to the provider (false when refused by the budget). */
  sent: z.boolean(),
  outcome: z.enum(['ok', 'refused', 'error']),
  /** Full request text. */
  request: z.strictObject({
    system: z.string(),
    messages: z.array(LlmMessageSchema),
    maxOutputTokens: z.number().int(),
  }),
  usage: UsageSchema.optional(),
  stopReason: z.string().optional(),
  responseText: z.string().optional(),
  error: z.string().optional(),
  /** Run totals after this request. */
  budget: z.strictObject({
    totalUsed: z.number().int().min(0),
    maxTotalTokensPerCompile: z.number().int().positive(),
  }),
});

export type SnippetLogEntry = z.infer<typeof SnippetLogEntrySchema>;
export type SnippetLogRecord = Omit<SnippetLogEntry, 'timestamp' | 'runId' | 'seq'>;

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `20260925T101530Z-3fa9c1`: sortable by time, unique enough for one machine. */
export function newRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export interface SnippetLogOptions {
  /** Directory for log files, e.g. `.lsc/logs`. Created if missing. */
  readonly dir: string;
  /** Run id; defaults to `newRunId()`. Must be a safe file name. */
  readonly runId?: string;
  /** Clock, injectable for tests. */
  readonly now?: () => Date;
}

export class SnippetLog {
  readonly runId: string;
  readonly path: string;
  private seq = 0;
  private readonly now: () => Date;

  constructor(options: SnippetLogOptions) {
    this.now = options.now ?? ((): Date => new Date());
    this.runId = options.runId ?? newRunId(this.now());
    if (!RUN_ID_PATTERN.test(this.runId)) {
      throw new RangeError(`invalid run id ${JSON.stringify(this.runId)}: use letters, digits, ".", "_", "-"`);
    }
    mkdirSync(options.dir, { recursive: true });
    this.path = join(options.dir, `${this.runId}.jsonl`);
  }

  get count(): number {
    return this.seq;
  }

  append(record: SnippetLogRecord): SnippetLogEntry {
    this.seq++;
    const entry: SnippetLogEntry = {
      timestamp: this.now().toISOString(),
      runId: this.runId,
      seq: this.seq,
      ...record,
    };
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }
}

/** Reads and validates a snippet log file (used by tests and audits). */
export function readSnippetLog(path: string): SnippetLogEntry[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, i) => {
      const parsed = SnippetLogEntrySchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`${path}:${i + 1}: invalid snippet log entry: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}
