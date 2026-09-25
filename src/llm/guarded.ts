import { BudgetExceededError, LlmError, ProviderError } from './errors.js';
import { assertValidRequest, requestHash } from './request.js';
import type { SnippetLog, SnippetLogRecord } from './snippet-log.js';
import type { TokenBudget } from './budget.js';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.js';

/**
 * Wraps any provider with the cost and safety controls of plan §8:
 * request validation, per-call and per-compile token budgets, and one
 * snippet-log line per request. All model calls of a compile go through one
 * `GuardedProvider` (one budget, one log file).
 *
 * Order per call:
 * 1. validate the request shape (malformed requests throw `InvalidRequestError`
 *    and are not logged, because they are never sent);
 * 2. budget pre-check; a refusal is logged with `sent: false` and thrown;
 * 3. provider call; a failure is logged with `outcome: "error"` and thrown
 *    (non-`LlmError`s are wrapped in `ProviderError`);
 * 4. usage is recorded and logged; if the run is now over budget the response
 *    is logged but `BudgetExceededError` is thrown so the compile stops.
 */
export class GuardedProvider implements LlmProvider {
  readonly name: string;
  readonly model: string;

  constructor(
    readonly inner: LlmProvider,
    readonly budget: TokenBudget,
    readonly log: SnippetLog,
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    assertValidRequest(request);
    const base = {
      provider: this.inner.name,
      model: this.inner.model,
      requestHash: requestHash(request),
      request: {
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        maxOutputTokens: request.maxOutputTokens,
      },
    };
    const totals = (): SnippetLogRecord['budget'] => ({
      totalUsed: this.budget.totalUsed,
      maxTotalTokensPerCompile: this.budget.limits.maxTotalTokensPerCompile,
    });

    try {
      this.budget.checkBefore(request.maxOutputTokens);
    } catch (err) {
      this.log.append({ ...base, sent: false, outcome: 'refused', error: messageOf(err), budget: totals() });
      throw err;
    }

    let response: LlmResponse;
    try {
      response = await this.inner.complete(request);
    } catch (err) {
      this.log.append({ ...base, sent: true, outcome: 'error', error: messageOf(err), budget: totals() });
      if (err instanceof LlmError) throw err;
      throw new ProviderError(this.inner.name, `provider call failed: ${messageOf(err)}`, undefined, { cause: err });
    }

    let overBudget: BudgetExceededError | undefined;
    try {
      this.budget.record(response.usage);
    } catch (err) {
      if (!(err instanceof BudgetExceededError)) throw err;
      overBudget = err;
    }
    this.log.append({
      ...base,
      model: response.model ?? this.inner.model,
      sent: true,
      outcome: 'ok',
      usage: { inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens },
      stopReason: response.rawStopReason ?? response.stopReason,
      responseText: response.text,
      ...(overBudget ? { error: overBudget.message } : {}),
      budget: totals(),
    });
    if (overBudget) throw overBudget;
    return response;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
