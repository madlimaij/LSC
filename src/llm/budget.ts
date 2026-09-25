import { BudgetExceededError } from './errors.js';
import { totalTokens, type LlmUsage } from './types.js';

export interface TokenBudgetLimits {
  readonly maxOutputTokensPerCall: number;
  readonly maxTotalTokensPerCompile: number;
}

/**
 * Token accounting for one compile run.
 *
 * - `checkBefore` refuses a call whose `maxOutputTokens` exceeds the per-call
 *   cap, or which could push the run over the total cap even if the model
 *   used only its output allowance (input tokens are unknown before the call,
 *   so this is a lower bound on what the call will cost).
 * - `record` adds actual usage after the call and throws when the run is now
 *   over the total cap, so the compile stops instead of making another call.
 *
 * Requests are never silently shrunk to fit.
 */
export class TokenBudget {
  private used = { inputTokens: 0, outputTokens: 0 };
  private calls = 0;

  constructor(readonly limits: TokenBudgetLimits) {
    for (const [key, value] of Object.entries(limits)) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(`budget ${key} must be a positive integer (got ${String(value)})`);
      }
    }
  }

  get usage(): LlmUsage {
    return { ...this.used };
  }

  get totalUsed(): number {
    return totalTokens(this.used);
  }

  get remaining(): number {
    return Math.max(0, this.limits.maxTotalTokensPerCompile - this.totalUsed);
  }

  get callCount(): number {
    return this.calls;
  }

  checkBefore(maxOutputTokens: number): void {
    const { maxOutputTokensPerCall, maxTotalTokensPerCompile } = this.limits;
    if (maxOutputTokens > maxOutputTokensPerCall) {
      throw new BudgetExceededError(
        'per-call-output',
        maxOutputTokensPerCall,
        maxOutputTokens,
        `per-call output budget exceeded: request asks for ${maxOutputTokens} output tokens, ` +
          `budgets.maxOutputTokensPerCall is ${maxOutputTokensPerCall}`,
      );
    }
    const worstFloor = this.totalUsed + maxOutputTokens;
    if (worstFloor > maxTotalTokensPerCompile) {
      throw new BudgetExceededError(
        'per-compile-total',
        maxTotalTokensPerCompile,
        worstFloor,
        `per-compile token budget exhausted: ${this.totalUsed} of ${maxTotalTokensPerCompile} tokens used ` +
          `after ${this.calls} call(s); the next call may need ${maxOutputTokens} output tokens ` +
          `(raise budgets.maxTotalTokensPerCompile to continue)`,
      );
    }
  }

  record(usage: LlmUsage): void {
    this.calls++;
    this.used = {
      inputTokens: this.used.inputTokens + usage.inputTokens,
      outputTokens: this.used.outputTokens + usage.outputTokens,
    };
    const { maxTotalTokensPerCompile } = this.limits;
    if (this.totalUsed > maxTotalTokensPerCompile) {
      throw new BudgetExceededError(
        'per-compile-total',
        maxTotalTokensPerCompile,
        this.totalUsed,
        `per-compile token budget exceeded: ${this.totalUsed} of ${maxTotalTokensPerCompile} tokens used ` +
          `after ${this.calls} call(s) (raise budgets.maxTotalTokensPerCompile to continue)`,
      );
    }
  }
}
