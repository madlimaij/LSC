/**
 * Provider-neutral request/response types for the model layer (WP-08).
 *
 * The interface is deliberately small: a single `complete` call with a system
 * prompt, a list of text messages and an output-token cap. Adding an approved
 * or locally hosted model at Gate G4 means writing one class that implements
 * `LlmProvider`.
 */

export type LlmRole = 'user' | 'assistant';

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: string;
}

export interface LlmRequest {
  /** System prompt. May be empty. */
  readonly system: string;
  /** Conversation; must start with a `user` message. */
  readonly messages: readonly LlmMessage[];
  /** Upper bound on output tokens for this call. Checked against the per-call budget. */
  readonly maxOutputTokens: number;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Why the model stopped. `max_tokens` means the text is truncated; `other`
 * covers refusals and provider-specific reasons (the raw value is kept in
 * `LlmResponse.rawStopReason`).
 */
export type LlmStopReason = 'end' | 'max_tokens' | 'other';

export interface LlmResponse {
  readonly text: string;
  readonly usage: LlmUsage;
  readonly stopReason: LlmStopReason;
  /** Provider's own stop reason string, for the log. */
  readonly rawStopReason?: string;
  /** Model that actually answered, when the provider reports it (e.g. the model stored in a recording). */
  readonly model?: string;
}

export interface LlmProvider {
  /** Short provider name for logs, e.g. `anthropic`, `fake`. */
  readonly name: string;
  /** Configured model identifier, for logs. */
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export function totalTokens(usage: LlmUsage): number {
  return usage.inputTokens + usage.outputTokens;
}
