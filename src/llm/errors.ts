/**
 * Errors of the model layer. Infrastructure problems (configuration, budget,
 * unknown recording, provider failure) are thrown; problems with the content
 * of a model answer are returned as `StructuredError` by `structured()`.
 */

export class LlmError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** `lsc.config.json` is missing required values or does not match the schema. */
export class LlmConfigError extends LlmError {}

/** The request itself is malformed (empty messages, first message not `user`, …). */
export class InvalidRequestError extends LlmError {}

export type BudgetKind = 'per-call-output' | 'per-compile-total';

/** A token budget would be or has been exceeded. The compile must stop. */
export class BudgetExceededError extends LlmError {
  constructor(
    readonly kind: BudgetKind,
    readonly limit: number,
    readonly attempted: number,
    message: string,
  ) {
    super(message);
  }
}

/** `FakeProvider` received a request that has no recording (D7: fail loudly). */
export class UnknownRecordingError extends LlmError {
  constructor(
    readonly requestHash: string,
    message: string,
  ) {
    super(message);
  }
}

/** A recording file is malformed or inconsistent. */
export class RecordingFormatError extends LlmError {}

/** The provider call failed (network, HTTP error, unexpected response shape). */
export class ProviderError extends LlmError {
  constructor(
    readonly provider: string,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** A real provider client was about to be constructed inside the test runner (D7). */
export class RealProviderInTestError extends LlmError {}
