# Decisions log

Append-only. D1–D9 are defined in docs/PLAN.md §4. Add new decisions below as D10, D11, … with date, author (agent or owner), decision, reason, and affected work packages.

## D1–D9 (copied from docs/PLAN.md §4 by WP-01; the plan remains authoritative)

| ID | Decision | Reason |
| --- | --- | --- |
| D1 | `branch_marker` and `exit` rule types are left out of the MVP contract | Navigator's `NormalizedFileAnalysis` has no field for them and no MVP view needs them; adding them later is a minor contract version |
| D2 | Captures are named groups (`(?<name>...)`), not numeric indexes | Numeric indexes break silently when a pattern is edited |
| D3 | All regex patterns must be RE2-compatible and are executed with an RE2 engine | Prevents ReDoS on large repositories; LLM-written patterns are otherwise unbounded |
| D4 | Definition rules may declare a `blockEnd` pattern; the adapter attributes calls, reads and writes to the innermost open definition | Navigator relations need a source symbol, which a single-line match cannot supply |
| D5 | Development uses the synthetic `toylang`; the real language is used only from Wave 5 | Lets the whole pipeline be built without employer code; separates tool bugs from language-knowledge gaps |
| D6 | Token-matcher and state-machine engines are deferred to WP-12, built only if real-language evidence shows exact + regex are insufficient | Deviation from the specification's engine list; avoids building engines no rule needs yet |
| D7 | Tests use a `FakeProvider` replaying recorded model responses; real providers are used only in manual compile runs | Deterministic, free, offline tests |
| D8 | Confidence is computed by a fixed formula (§6.3), never assigned by the model | Confidence must reflect evidence, not model self-assessment |
| D9 | Human review of repository-sample matches is saved as labelled examples (`reviews.yaml`) and feeds the next compile | Turns reviewed false positives into negative examples, so they stay fixed |

## D10 — Minimum Node.js version is 22.22.2 (not 20)

- **Date:** 2026-09-24
- **Author:** `contract-architect` (WP-01)
- **Decision:** `package.json` `engines.node` is `^22.22.2 || ^24.15.0 || >=26.0.0`; `.nvmrc` pins 22.
- **Reason:** WP-01 asks for "Node.js 20+ LTS". Node.js 20 reached end of life on 2026-04-30. The current releases of required dependencies no longer support it: `re2` 1.25+ requires `^22.22.2 || ^24.15.0 || >=26`, `commander` 15 requires `>=22.12`, `vitest` 5 requires `^22.12 || ^24 || >=26`. Supporting Node 20 would mean pinning an older native `re2` binding (the ReDoS safeguard, D3) and older tooling on an unsupported runtime. The engines range is the `re2` range, the strictest dependency.
- **Affects:** WP-01 (root config); every environment that runs `lsc`, including Legacy Navigator's CI if it runs the compiler. Navigator consuming the JSON Rule Set is unaffected.
- **Reversible:** yes — pin `re2@~1.24`, `commander@^14`, `vitest@^4`, `eslint@^9` and widen `engines` if the project owner requires Node 20.
