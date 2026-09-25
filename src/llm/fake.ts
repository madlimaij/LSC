import { UnknownRecordingError, RecordingFormatError } from './errors.js';
import { loadRecordings, type Recording } from './recordings.js';
import { requestHash } from './request.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.js';

const PREVIEW_CHARS = 160;

/**
 * Replays recorded responses keyed by `requestHash` (D7). A request without a
 * recording throws `UnknownRecordingError`; there is no default answer.
 * Deterministic: the same request always gets the same response.
 */
export class FakeProvider implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'recorded';
  private readonly byHash = new Map<string, Recording>();
  private readonly used = new Set<string>();

  constructor(
    recordings: readonly Recording[],
    /** Where the recordings came from, for error messages. */
    readonly source = 'in-memory recordings',
  ) {
    for (const rec of recordings) {
      if (this.byHash.has(rec.hash)) {
        throw new RecordingFormatError(`${source}: duplicate recording for request ${rec.hash}`);
      }
      this.byHash.set(rec.hash, rec);
    }
  }

  /** Loads all recordings in a directory (e.g. `fixtures/recordings/wp08`). */
  static fromDirectory(dir: string): FakeProvider {
    return new FakeProvider(loadRecordings(dir), dir);
  }

  get size(): number {
    return this.byHash.size;
  }

  has(request: Pick<LlmRequest, 'system' | 'messages'>): boolean {
    return this.byHash.has(requestHash(request));
  }

  /** Recordings never requested so far; lets a test detect stale recordings. */
  unusedHashes(): string[] {
    return [...this.byHash.keys()].filter((h) => !this.used.has(h)).sort();
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    const hash = requestHash(request);
    const rec = this.byHash.get(hash);
    if (rec === undefined) {
      const last = request.messages[request.messages.length - 1]?.content ?? '';
      const preview = last.length > PREVIEW_CHARS ? `${last.slice(0, PREVIEW_CHARS)}…` : last;
      return Promise.reject(
        new UnknownRecordingError(
          hash,
          `FakeProvider: no recording for request ${hash} in ${this.source} ` +
            `(${this.byHash.size} recording(s) loaded). Last message starts: ${JSON.stringify(preview)}. ` +
            'If the prompt changed on purpose, re-record with a real provider on toylang ' +
            '(lsc.config.json "recording": { "dir": ... }); never hand-edit a recorded request.',
        ),
      );
    }
    this.used.add(hash);
    const { response } = rec;
    return Promise.resolve({
      text: response.text,
      usage: { ...response.usage },
      stopReason: response.stopReason,
      ...(response.rawStopReason !== undefined ? { rawStopReason: response.rawStopReason } : {}),
      model: rec.model,
    });
  }
}
