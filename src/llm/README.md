# src/llm

**Owner:** `llm-integrator` (WP-08).

Provider-neutral model layer: one small interface, hard token budgets, a full
snippet log, and offline replay for tests (D7). Import everything from
`src/llm/index.ts`.

## Pieces

| File | What |
| --- | --- |
| `types.ts` | `LlmProvider.complete({ system, messages, maxOutputTokens }) → { text, usage, stopReason }` |
| `request.ts` | Request Zod schema; `requestHash` (sha256 of canonical `system` + `messages`) |
| `config.ts` | `lsc.config.json` schema (strict), `loadConfig`, `parseConfig` |
| `budget.ts` | `TokenBudget`: per-call output cap, per-compile total cap |
| `snippet-log.ts` | `SnippetLog`: `<log.dir>/<run-id>.jsonl`, one line per request; `readSnippetLog` |
| `guarded.ts` | `GuardedProvider`: validation → budget → provider → log, around any provider |
| `anthropic.ts` | `AnthropicProvider` (`@anthropic-ai/sdk`); the only file that imports the SDK |
| `fake.ts` | `FakeProvider`: replays recordings by request hash; unknown request → `UnknownRecordingError` |
| `recordings.ts` | Recording file format, load/write, hash verification |
| `recording-provider.ts` | Recording mode: wraps a real provider and writes each pair as a recording |
| `structured.ts` | `structured(provider, zodSchema, request)` → typed value or typed `StructuredError` |
| `factory.ts` | `createProvider(config)`, `createSession(config)` (one budget + one log per compile) |

## Usage (WP-09)

```ts
const config = loadConfig();                 // ./lsc.config.json or defaults
const session = createSession(config);       // GuardedProvider + TokenBudget + SnippetLog
const res = await structured(session.provider, ProposalSchema, request);
if (!res.ok) { /* res.error.kind: truncated | stopped | no_json | ambiguous_json | invalid_json | schema → failed attempt */ }
```

Thrown, not returned (they stop the compile): `BudgetExceededError`,
`UnknownRecordingError`, `ProviderError`, `LlmConfigError`,
`InvalidRequestError`, `RealProviderInTestError`.

`structured()` accepts only (1) a response that is entirely one JSON
document, or (2) exactly one fenced code block labelled `json` (or unlabelled).
No brace scanning or JSON repair: bad output is a failed attempt.

## `lsc.config.json`

```json
{
  "provider": {
    "name": "anthropic",
    "model": "<model id>",
    "apiKeyEnv": "ANTHROPIC_API_KEY",
    "baseUrl": "https://api.example.internal",
    "timeoutMs": 120000,
    "maxRetries": 2,
    "temperature": 0
  },
  "budgets": {
    "maxOutputTokensPerCall": 4096,
    "maxTotalTokensPerCompile": 200000,
    "maxAttemptsPerConstruct": 3
  },
  "log": { "dir": ".lsc/logs" },
  "recording": { "dir": "fixtures/recordings/<set>" }
}
```

- `provider.model` is required; no model is hard-coded.
- The API key is read from the environment variable named by `apiKeyEnv`
  (default `ANTHROPIC_API_KEY`). A key in the file is rejected (unknown key).
- `baseUrl` omitted → SDK default, which honours `ANTHROPIC_BASE_URL`.
- `{ "name": "fake", "recordingsDir": "..." }` replays recordings offline.
- `recording` saves every real call as a recording. **toylang only.** Never
  enable it for real-language runs.
- Relative paths resolve against the directory of the config file. Without a
  config file: no provider, default budgets, logs in `.lsc/logs`.
- `maxAttemptsPerConstruct` is read by WP-09, not enforced here.

## Budgets

Before each call: `maxOutputTokens ≤ maxOutputTokensPerCall`, and
`used + maxOutputTokens ≤ maxTotalTokensPerCompile` (input size is unknown
before the call). After each call: actual input + output tokens are added; if
the total cap is exceeded the call is logged and `BudgetExceededError` is
thrown. Requests are never shrunk to fit.

## Snippet log entry

`{ timestamp, runId, seq, provider, model, requestHash, sent, outcome: ok|refused|error, request: { system, messages, maxOutputTokens }, usage?, stopReason?, responseText?, error?, budget: { totalUsed, maxTotalTokensPerCompile } }`.
Malformed requests (`InvalidRequestError`) are never sent and not logged.

## Adding a provider (G4)

One class implementing `LlmProvider`, one variant in `ProviderConfigSchema`,
one `case` in `createProvider`. Budgets, logging, recording and `structured()`
work unchanged.

## Test safety (D7)

`defaultAnthropicClientFactory` throws `RealProviderInTestError` when
`VITEST` is set (or `LSC_FORBID_REAL_PROVIDER=1`), so any test that would
construct the real client fails. `tests/llm/anthropic.test.ts` also checks that
no other file in `src/` imports the SDK.
