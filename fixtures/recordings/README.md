# fixtures/recordings

**Owner:** `llm-integrator` (WP-08, WP-09).

Recorded model responses replayed by `FakeProvider` (D7). Only toylang content; never real-language code.

- One directory per recording set (e.g. `wp08/`); one file per request, named `<requestHash>.json`.
- Format: `src/llm/recordings.ts` (`RecordingSchema`). The stored hash must match the stored request; edited requests fail to load.
- `origin: "recorded"` = captured from a real provider by `RecordingProvider`; `origin: "hand-written"` = authored for a test and labelled as such.
- `wp08/` is hand-written; its source is `tests/llm/wp08-recordings.ts` (regenerate with `npx tsx tests/llm/wp08-recordings.ts`).
