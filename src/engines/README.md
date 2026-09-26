# src/engines

**Owner:** `engine-builder` (WP-04; WP-12 if needed).

Exact and regex (RE2) engines, comment/string masking, block tracking.

## Modules

- `lines.ts` — line-ending normalisation, line-start table, offset → line/column (contract/CONTRACT.md §6.2).
- `masking.ts` — comment/string masking, full mask and comment mask (§6.3).
- `prepare.ts` — `prepareFile`: builds both masked views of a file once.
- `regex-run.ts` — runs one RE2 pattern per line or over the whole text (§6.4).
- `match-rule.ts` — `matchRule` (engine interface `match(rule, preparedFile) -> Match[]`) and `matchBlockEnd`; the exact engine is its equivalent regex (`exactToRegex` from `src/contract`), run per line.
- `blocks.ts` — `scanFile`: runs a rule list against a prepared file and tracks `blockEnd` scopes (D4, §6.6), assigning `enclosingSymbol`. An unnamed definition (missing or empty `name` capture, D19 c/D20 §6.6) opens no scope, even with `blockEnd`; its `blockEnd` match still closes the innermost open scope of the same rule as usual (LIFO per rule id).
- `mapping.ts` — `mapMatches(matches, rules, file)`: `Match[]` → Navigator-shaped records (`NavigatorAnalysis`) using `RULE_TYPE_SPEC`, plus `uncertainties` (contract/CONTRACT.md §4.1, added by D20). A missing-or-empty required capture (any role, any type) produces only an `ambiguous-capture` uncertainty. A `call`/`include`/`db_read`/`db_write`/`config_ref` match's source is the innermost enclosing symbol, else the last *named* `module_declaration` match earlier in the same `matches` list (regardless of `blockEnd`/closed status), else `file` (that file's repository-relative path, `/` separators) — always a normal record, never a `missing-source-symbol` uncertainty (D19 b removed that reason).
- `types.ts` — `Match`, `BlockWarning`, `ScanResult`.

`fileMatchers` glob selection is not implemented here (not in the WP-04 brief); `src/runner` (WP-05) selects which rules apply to which file and calls `scanFile`/`mapMatches` per file.
