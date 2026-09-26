/**
 * Where the model answers of one compile came from (D25 item 2: "the report
 * also shows the provider, model and recording origin (hand-written or
 * recorded)"). Written into `synthesis.json` as `modelSource`.
 *
 * - Live runs (`anthropic`, with or without recording mode): provider and
 *   model come from the provider configuration; origin `live`.
 * - Replays (`--provider fake --recordings <dir>`): provider, model and origin
 *   come from the recordings actually used, looked up by each attempt's
 *   request hash (every successful call is one attempt). Distinct values give
 *   `mixed`, with per-origin/provider/model call counts in `calls`.
 */
import { z } from 'zod';
import type { Recording } from '../llm/index.js';

export const CallOriginSchema = z.enum(['live', 'recorded', 'hand-written']);
export type CallOrigin = z.infer<typeof CallOriginSchema>;

export const ModelSourceSchema = z.strictObject({
  /** `live`: calls to a real provider. `live-recording`: the same, each call saved as a recording. `replay`: FakeProvider replaying recordings. */
  mode: z.enum(['live', 'live-recording', 'replay']),
  /** Provider name from the configuration (`anthropic`, `fake`, …). */
  configuredProvider: z.string().min(1),
  /** Provider that produced the answers; `mixed` when a replay used recordings from several; `none` when no call succeeded. */
  provider: z.string().min(1),
  /** Model that produced the answers; `mixed` / `none` as for `provider`. */
  model: z.string().min(1),
  /** `live` for live runs; for replays the recordings' `origin`, `mixed` when they differ, `none` when no call succeeded. */
  origin: z.enum(['live', 'recorded', 'hand-written', 'mixed', 'none']),
  /** Successful calls grouped by origin, provider and model (sorted), so `mixed` always comes with counts. */
  calls: z.array(
    z.strictObject({
      origin: CallOriginSchema,
      provider: z.string().min(1),
      model: z.string().min(1),
      calls: z.int().min(1),
    }),
  ),
  /** One readable line, e.g. "replay of hand-written recordings (10 call(s); provider hand-written, model hand-written)". */
  summary: z.string().min(1),
});
export type ModelSource = z.infer<typeof ModelSourceSchema>;

/** What `lsc compile` knows before the run: the configured provider, and for a replay the recordings loaded. */
export type ModelSourceInput =
  | { readonly mode: 'live' | 'live-recording'; readonly provider: string; readonly model: string }
  | {
      readonly mode: 'replay';
      readonly provider: string;
      readonly recordings: readonly Pick<Recording, 'hash' | 'origin' | 'provider' | 'model'>[];
    };

function distinct(values: readonly string[], none: string): string {
  const set = [...new Set(values)];
  return set.length === 0 ? none : set.length === 1 ? (set[0] as string) : 'mixed';
}

/** Builds `modelSource` from the configuration and the request hash of every successful call. */
export function buildModelSource(input: ModelSourceInput, requestHashes: readonly string[]): ModelSource {
  const used: { origin: CallOrigin; provider: string; model: string }[] = [];
  if (input.mode === 'replay') {
    const byHash = new Map(input.recordings.map((r) => [r.hash, r] as const));
    for (const hash of requestHashes) {
      const rec = byHash.get(hash);
      // Every successful replayed call has a recording; a missing one would be a bug, so fail loudly rather than guess.
      if (rec === undefined) throw new Error(`internal error: no recording loaded for request ${hash}`);
      used.push({ origin: rec.origin, provider: rec.provider, model: rec.model });
    }
  } else {
    // One live call per attempt.
    used.push(...requestHashes.map(() => ({ origin: 'live' as const, provider: input.provider, model: input.model })));
  }

  const groups = new Map<string, { origin: CallOrigin; provider: string; model: string; calls: number }>();
  for (const u of used) {
    const key = JSON.stringify([u.origin, u.provider, u.model]);
    const g = groups.get(key);
    if (g !== undefined) g.calls++;
    else groups.set(key, { ...u, calls: 1 });
  }
  const calls = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, g]) => g);

  const provider = input.mode === 'replay' ? distinct(used.map((u) => u.provider), 'none') : input.provider;
  const model = input.mode === 'replay' ? distinct(used.map((u) => u.model), 'none') : input.model;
  const origin: ModelSource['origin'] = input.mode === 'replay' ? (distinct(used.map((u) => u.origin), 'none') as ModelSource['origin']) : 'live';

  return { mode: input.mode, configuredProvider: input.provider, provider, model, origin, calls, summary: summarize(input.mode, provider, model, origin, used) };
}

function summarize(mode: ModelSource['mode'], provider: string, model: string, origin: ModelSource['origin'], used: readonly { origin: CallOrigin }[]): string {
  const n = `${String(used.length)} call(s)`;
  const who = `provider ${provider}, model ${model}`;
  if (mode !== 'replay') {
    return `live calls to ${provider} (${n}; model ${model}${mode === 'live-recording' ? '; each call saved as a recording' : ''})`;
  }
  if (origin === 'none') return 'replay of recordings; no call succeeded';
  if (origin === 'mixed') {
    const counts = CallOriginSchema.options
      .map((o) => [o, used.filter((u) => u.origin === o).length] as const)
      .filter(([, c]) => c > 0)
      .map(([o, c]) => `${String(c)} ${o}`)
      .join(', ');
    return `replay of mixed recordings: ${counts} (${n}; ${who})`;
  }
  return `replay of ${origin} recordings (${n}; ${who})`;
}
