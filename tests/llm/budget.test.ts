import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  FakeProvider,
  TokenBudget,
  createSession,
  readSnippetLog,
  structured,
} from '../../src/llm/index.js';
import { z } from 'zod';
import { FIXED_NOW, fakeConfig } from './helpers.js';
import { WP08_RECORDINGS_DIR, requests } from './wp08-recordings.js';

describe('TokenBudget', () => {
  it('refuses a call asking for more output than the per-call cap', () => {
    const b = new TokenBudget({ maxOutputTokensPerCall: 100, maxTotalTokensPerCompile: 1000 });
    expect(() => b.checkBefore(101)).toThrow(BudgetExceededError);
    expect(() => b.checkBefore(100)).not.toThrow();
  });

  it('accumulates usage and throws once the total cap is passed', () => {
    const b = new TokenBudget({ maxOutputTokensPerCall: 100, maxTotalTokensPerCompile: 1000 });
    b.record({ inputTokens: 500, outputTokens: 100 });
    expect(b.totalUsed).toBe(600);
    expect(b.remaining).toBe(400);
    expect(() => b.record({ inputTokens: 350, outputTokens: 100 })).toThrow(/1050 of 1000/);
  });

  it('refuses a call that could not fit even its output allowance', () => {
    const b = new TokenBudget({ maxOutputTokensPerCall: 200, maxTotalTokensPerCompile: 1000 });
    b.record({ inputTokens: 800, outputTokens: 50 });
    let err: unknown;
    try {
      b.checkBefore(200);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).kind).toBe('per-compile-total');
    expect((err as BudgetExceededError).message).toMatch(/raise budgets\.maxTotalTokensPerCompile/);
  });

  it('rejects non-positive limits', () => {
    expect(() => new TokenBudget({ maxOutputTokensPerCall: 0, maxTotalTokensPerCompile: 10 })).toThrow(RangeError);
  });
});

describe('budget exhaustion through the guarded provider', () => {
  const Any = z.unknown();

  it('stops the run with a clear error when the per-compile budget is exceeded', async () => {
    const config = fakeConfig({ budgets: { maxOutputTokensPerCall: 512, maxTotalTokensPerCompile: 1200 } });
    const session = createSession(config, { provider: FakeProvider.fromDirectory(WP08_RECORDINGS_DIR), now: FIXED_NOW });

    // Call 1: 420 + 180 = 600 tokens. Fine.
    await structured(session.provider, Any, requests.validFenced);
    expect(session.budget.totalUsed).toBe(600);

    // Call 2: pre-check 600 + 512 <= 1200 passes; actual 400 + 150 = 550 -> 1150. Fine.
    await structured(session.provider, Any, requests.validBare);
    expect(session.budget.totalUsed).toBe(1150);

    // Call 3: pre-check 1150 + 512 > 1200 -> refused before sending.
    await expect(structured(session.provider, Any, requests.proseOnly)).rejects.toThrow(
      /per-compile token budget exhausted: 1150 of 1200 tokens used after 2 call\(s\)/,
    );

    const log = readSnippetLog(session.log.path);
    expect(log.map((e) => [e.outcome, e.sent])).toEqual([
      ['ok', true],
      ['ok', true],
      ['refused', false],
    ]);
    expect(log[2]?.error).toMatch(/budget exhausted/);
  });

  it('throws after a call whose actual usage pushes the run over the cap', async () => {
    // maxOutputTokens 100 keeps the pre-check low; the recording used 420 + 180.
    const config = fakeConfig({ budgets: { maxOutputTokensPerCall: 100, maxTotalTokensPerCompile: 500 } });
    const session = createSession(config, { provider: FakeProvider.fromDirectory(WP08_RECORDINGS_DIR), now: FIXED_NOW });
    const err = await session.provider.complete({ ...requests.validFenced, maxOutputTokens: 100 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).attempted).toBe(600);
    const [entry] = readSnippetLog(session.log.path);
    expect(entry?.outcome).toBe('ok');
    expect(entry?.usage).toEqual({ inputTokens: 420, outputTokens: 180 });
    expect(entry?.error).toMatch(/budget exceeded/);
    // Nothing else may be sent afterwards.
    await expect(session.provider.complete({ ...requests.validBare, maxOutputTokens: 1 })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
  });

  it('refuses a request above the per-call output cap without sending it', async () => {
    const config = fakeConfig({ budgets: { maxOutputTokensPerCall: 256, maxTotalTokensPerCompile: 10_000 } });
    const session = createSession(config, { provider: FakeProvider.fromDirectory(WP08_RECORDINGS_DIR), now: FIXED_NOW });
    const err = await session.provider.complete(requests.validBare).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).kind).toBe('per-call-output');
    expect((err as Error).message).toMatch(/asks for 512 output tokens, budgets\.maxOutputTokensPerCall is 256/);
    expect(session.budget.callCount).toBe(0);
    expect(readSnippetLog(session.log.path)[0]).toMatchObject({ outcome: 'refused', sent: false });
  });
});
