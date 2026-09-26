# fixtures/recordings

**Owner:** `llm-integrator` (WP-08, WP-09).

Recorded model responses replayed by `FakeProvider` (D7). Only toylang content; never real-language code.

- One directory per recording set (e.g. `wp08/`); one file per request, named `<requestHash>.json`.
- Format: `src/llm/recordings.ts` (`RecordingSchema`). The stored hash must match the stored request; edited requests fail to load.
- `origin: "recorded"` = captured from a real provider by `RecordingProvider`; `origin: "hand-written"` = authored for a test and labelled as such.
- `wp08/` is hand-written; its source is `tests/llm/wp08-recordings.ts` (regenerate with `npx tsx tests/llm/wp08-recordings.ts`).
- `wp09/` and `wp09-reject/` are hand-written (no API key was available during WP-09): the requests are produced by the real `compileLanguage` pipeline over `fixtures/toylang/skills`, the answers are scripted in `tests/synth/wp09-recordings.ts`, and token usage is estimated (characters / 4). `wp09/` is a full toylang compile with one refinement (`db-read`); `wp09-reject/` adds a refused lexical proposal, a `call` construct that never converges, and a "not justified" answer. Regenerate with `npx tsx tests/synth/wp09-recordings.ts` after any prompt change; `tests/synth/recordings.test.ts` checks the files match.
