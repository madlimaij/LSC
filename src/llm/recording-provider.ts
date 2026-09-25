import { buildRecording, writeRecording } from './recordings.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.js';

/**
 * Recording mode: forwards each request to a real provider and saves the
 * request/response pair as a recording that `FakeProvider` can replay.
 *
 * Use only on toylang (D5, CLAUDE.md). Real-language code must never be
 * recorded; the orchestrator must not enable `recording` for Wave 5 runs.
 */
export class RecordingProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;
  readonly written: string[] = [];

  constructor(
    readonly inner: LlmProvider,
    readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.inner.complete(request);
    const rec = buildRecording({
      origin: 'recorded',
      provider: this.inner.name,
      model: response.model ?? this.inner.model,
      request,
      response,
      recordedAt: this.now(),
    });
    this.written.push(writeRecording(this.dir, rec));
    return response;
  }
}
