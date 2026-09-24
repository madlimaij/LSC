# toylang specification

toylang is the synthetic language `lsc` is developed and tested with (D5). It is small, but it has the features that make real legacy languages hard to scan with patterns: case-insensitive keywords, keywords inside comments, strings and identifiers, statements continued over several lines, nested blocks, and dynamic constructs. Every one of those traps is listed in §6 with the examples that cover it.

This file is the reference for people and tests. The Skill files in `skills/` describe the same language the way a team would document it; the compiler only ever sees the Skill files and examples, never this file.

## Contents

1. Layout
2. Lexical rules
3. Statements
4. Constructs, rule types and labelling conventions
5. Example counts
6. Traps and the examples that cover them
7. Sample repository traps not covered by examples
8. The fixture Rule Set

## 1. Layout

| Path | Content |
| --- | --- |
| `SPEC.md` | this file |
| `skills/*.md` | Skill files: `language-basics.md` (no examples) and one file per construct, with inline examples (plan §6.1) |
| `examples/<construct>/<id>.tl` + `<id>.expect.yaml` | sidecar examples |
| `sample-repo/` | unlabelled repository sample (20 `.tl` files plus one non-toylang file) |
| `.gitattributes` | keeps the CRLF line endings of `sample-repo/legacy/dos_export.tl` |

There is no `reviews.yaml` yet; `lsc review` creates it next to `skills/` (`src/examples/README.md`). The example format itself is specified in `src/examples/README.md`.

## 2. Lexical rules

- **Files:** extension `.tl`, lower case. Encoding UTF-8. Line endings `\n`; `\r\n` also occurs.
- **Case:** keywords are case-insensitive. Identifiers are reported exactly as written.
- **Identifiers:** `[A-Za-z_][A-Za-z0-9_]*`. Keywords are not reserved inside identifiers (`PROCESSOR`, `RECALL_x`).
- **Line comment:** `--` to end of line.
- **Block comment:** `/*` … `*/`, may span lines, does not nest.
- **String literal:** `"` … `"`, on one line, no escape sequences.
- **Delimiters inside each other:** inside a string, `--` and `/*` are text; inside a comment, `"` and `/*` (in a line comment) are text.
- **Statement separator:** `;` between statements on one line.
- **Continuation:** a line ending with `&` (optionally followed by spaces or a line comment) continues on the next line. `&` may appear between any two parts of a statement.

These map to the Rule Set fields `fileMatchers: ["**/*.tl"]`, `lineComment: "--"`, `blockComment: {"/*", "*/"}` and `stringDelimiters: [{"\"", "\""}]`, which is exactly the masking model of contract/CONTRACT.md §6.3.

## 3. Statements

Keywords are shown in upper case; `[ ]` is optional, `…` repeats.

```
MODULE name
INCLUDE "path"
PROC name(params) … ENDPROC
FUNC name(params) RETURNS type … ENDFUNC
LET var = expr
READ table [WHERE cond] [INTO var]
WRITE table SET col = expr[, col = expr …] [WHERE cond]
CALL [module.]name(args) [INTO var]
CALL DYNAMIC var(args)
IF cond THEN … [ELSE …] ENDIF
WHILE cond DO … ENDWHILE
LOG expr
EXEC "statement"
RETURN [expr]
ENTRY job -> [module.]proc
```

Expressions: literals, identifiers, `+ - * /`, `= <> < > <= >=`, `AND OR NOT`, parentheses, built-ins `FLAG("key")`, `LEN(x)`, `NOW()`, `UPPER(x)`, `ROWCOUNT()`. User procedures are never called inside expressions.

Rules that matter for scanning:
- `MODULE`, `PROC`, `FUNC`, `INCLUDE` start their line (after indentation). `MODULE` comes first in a file, after comments.
- `PROC`/`FUNC` do not nest; they end at `ENDPROC`/`ENDFUNC`. `IF` and `WHILE` nest freely inside them.
- `CALL`, `READ`, `WRITE`, `FLAG` may follow `;`, `THEN` and so on; several may share a line.
- `CALL` always has parentheses. `CALL DYNAMIC var(args)` calls a procedure whose name is in `var`; the target is unknown statically.
- `EXEC "…"` runs a statement built at run time; its content is not a static read, write or call.
- `FLAG(var)` with a variable key is not a static configuration reference.
- A `MODULE` has no end marker.

## 4. Constructs, rule types and labelling conventions

| Construct id | Skill file (anchor) | Rule type | Captures in expected matches |
| --- | --- | --- | --- |
| `module-declaration` | `skills/module.md` (`declaring-a-module`) | `module_declaration` | `name` |
| `proc-definition` | `skills/procedure.md` (`defining-a-procedure`) | `symbol_definition` | `name`; `kind` = the keyword as written (`PROC`, `func`, …) |
| `call` | `skills/call.md` (`calling-a-procedure`) | `call` | `callee`; `module` when qualified (`CALL m.p()`) |
| `include` | `skills/include.md` (`including-a-file`) | `include` | `target` = path without quotes |
| `db-read` | `skills/db-read.md` (`reading-a-table`) | `db_read` | `table` |
| `db-write` | `skills/db-write.md` (`writing-a-table`) | `db_write` | `table` |
| `config-flag` | `skills/config-flag.md` (`feature-flags`) | `config_ref` | `key` = text inside the quotes |
| `entry-point` | `skills/entry-point.md` (`declaring-an-entry-point`) | `entry_point` | `name` = job name (left of `->`) |

Labelling conventions:
- The expected `line` is the line where the match starts: the keyword's line, also when the captured name is on a continuation line (`read-03`).
- A positive example lists **every** match of its construct in the code; other constructs in the same code are not listed (plan §6.2).
- A negative example contains no match of **any** construct, because the runner applies every rule to every negative example (plan §8 step 4, WP-05). This is why negatives use only `LET`, `LOG`, `EXEC`, comments and strings.
- The `entry_point` role `kind` is not used by toylang (it has one kind of entry point).

## 5. Example counts

Inline examples are in the Skill files; sidecar examples in `examples/<construct>/`.

| Construct | Positive (inline + sidecar) | Negative (inline + sidecar) | Example ids |
| --- | --- | --- | --- |
| `module-declaration` | 6 (3 + 3) | 3 (1 + 2) | `module-01`…`module-06`, `module-neg-01`…`module-neg-03` |
| `proc-definition` | 6 (3 + 3) | 3 (1 + 2) | `proc-01`…`proc-06`, `proc-neg-01`…`proc-neg-03` |
| `call` | 7 (4 + 3) | 3 (1 + 2) | `call-01`…`call-07`, `call-neg-01`…`call-neg-03` |
| `include` | 6 (3 + 3) | 3 (1 + 2) | `include-01`…`include-06`, `include-neg-01`…`include-neg-03` |
| `db-read` | 7 (4 + 3) | 3 (1 + 2) | `read-01`…`read-07`, `read-neg-01`…`read-neg-03` |
| `db-write` | 6 (3 + 3) | 3 (1 + 2) | `write-01`…`write-06`, `write-neg-01`…`write-neg-03` |
| `config-flag` | 6 (3 + 3) | 3 (1 + 2) | `flag-01`…`flag-06`, `flag-neg-01`…`flag-neg-03` |
| `entry-point` | 6 (3 + 3) | 3 (1 + 2) | `entry-01`…`entry-06`, `entry-neg-01`…`entry-neg-03` |
| **Total** | **50** (26 + 24) | **24** (8 + 16) | 74 examples |

Every rule type in the contract has at least 6 positive and 3 negative examples, enough for `high` confidence (plan §6.3).

## 6. Traps and the examples that cover them

Each row is one trap. "Covered by" lists examples where getting the trap wrong makes the example fail. The table is checked by `tests/examples/toylang.test.ts` (every id must exist, every row must list one).

| Id | Trap | What goes wrong if ignored | Covered by |
| --- | --- | --- | --- |
| T1 | Keyword inside a line comment | commented-out code is reported | `module-neg-02`, `proc-04`, `call-neg-02`, `include-neg-01`, `read-06`, `read-neg-02`, `write-neg-02`, `flag-06`, `flag-neg-02`, `entry-neg-02` |
| T2 | Keyword inside a block comment, often spanning several lines | old code kept in comments is reported | `module-03`, `module-neg-03`, `proc-neg-02`, `call-neg-03`, `include-neg-03`, `read-neg-02`, `entry-neg-03` |
| T3 | Keyword inside a string literal | log messages are reported | `module-06`, `module-neg-02`, `proc-04`, `proc-neg-03`, `call-neg-02`, `read-neg-01`, `write-05`, `write-neg-02`, `entry-neg-02` |
| T4 | Identifier containing a keyword (`RECALL_x`, `PROCESSOR`, `ALREADY_read`, `MODULE_COUNT`) | word-boundary-less patterns match variables | `module-neg-01`, `proc-neg-01`, `proc-neg-03`, `call-neg-01`, `include-neg-02`, `read-neg-01`, `read-neg-02`, `write-neg-01`, `flag-neg-01`, `entry-neg-01` |
| T5 | Identifier containing a keyword used as a real name (`CALL RECALL_orders(…)`) | the name is cut or the call is missed | `call-06` |
| T6 | Case-insensitive keywords | lower- or mixed-case code is missed | `module-02`, `proc-03`, `proc-06`, `call-03`, `call-07`, `include-02`, `read-02`, `read-07`, `write-03`, `flag-02`, `entry-02` |
| T7 | Statement continued over two lines, name on the first line | the rule anchors on the whole statement and misses it | `proc-06`, `call-06`, `write-02` |
| T8 | Statement continued right after the keyword: the captured name is on the next line | per-line rules miss the read | `read-03` |
| T9 | Nested `IF` blocks inside a `PROC`; `ENDIF` is not the end of the procedure | block end matches `END…` and closes the procedure early | `proc-03`, `call-05`, `read-05`, `flag-04` |
| T10 | Several matches on one line (`;` separator, two lookups in one condition) | only the first match is found | `call-03`, `read-04`, `flag-02` |
| T11 | `--` inside a string is not a comment | the rest of the line is masked, the match after the string is missed, or a key/path is cut | `call-05`, `include-05`, `flag-05` |
| T12 | `/*` inside a line comment does not open a block comment | the following lines are masked | `call-04` |
| T13 | The capture itself is inside a string (include path, flag key) | masking strings hides the match; rules need `searchStrings` | `include-01`, `include-05`, `flag-01`, `flag-05` |
| T14 | A quoted path or key inside a trailing comment | a second, commented-out match is reported | `include-06`, `flag-06` |
| T15 | Cross-module call `CALL m.p()` | `callee` captured as `m` | `call-02`, `call-07` |
| T16 | Two definition keywords (`PROC`/`FUNC`) with a `kind` capture | functions are missed | `proc-02`, `proc-06` |
| T17 | Dynamic constructs are not static references: `EXEC "READ …"`, `FLAG(var)` | reads, writes or flags reported that the code does not statically contain | `read-neg-03`, `write-neg-03`, `flag-neg-03` |
| T18 | Tabs and runs of spaces between tokens | single-space patterns miss them | `module-05`, `proc-05`, `include-04`, `read-07`, `write-06`, `entry-06` |
| T19 | Several definitions in one file | only the first is found, or blocks run together | `proc-03` |
| T20 | Entry target in another module (`-> orders.close_day`) | the name capture swallows the target | `entry-05` |

## 7. Sample repository traps not covered by examples

`sample-repo/` is unlabelled. It contains ordinary code plus the traps below, which no example covers, so that the repository-sample review (D9, WP-07) has something to find. "Fixture Rule Set" says how `contract/fixtures/toylang.ruleset.json` behaves on it; a synthesised Rule Set may behave differently.

| Id | Location | Trap | Correct reading | Fixture Rule Set |
| --- | --- | --- | --- | --- |
| S1 | `sample-repo/orders/dispatch.tl:7` | `CALL DYNAMIC handler_name(order_id)` | a call with a statically unknown target; `DYNAMIC` is not a callee | no match (the pattern requires `(` right after the name) |
| S2 | `sample-repo/customers/messages.tl:4` | `READ inbox WHERE owner = uid AND NOT read` followed by `LET` on the next line | one read of `inbox`; the column `read` is not a read | **false positive**: a second `db_read` with table `LET` on line 4, because the whole-text pattern crosses the line break after `read`. Intended: the review flow should mark it `false_positive` |
| S3 | `sample-repo/batch/nightly.tl:6` | `CALL &` with the callee on the next line | a call of `late_bound_cleanup` on line 6 | **missed** (the call rule is per-line). A miss in the sample is not visible in review; it needs a labelled example |
| S4 | `sample-repo/inventory/warehouse.tl:4` | `LOG "/*"; CALL sync_warehouse(…)`: `/*` inside a string | the string does not open a block comment; the call is real | found |
| S5 | `sample-repo/inventory/warehouse.tl:5` | block comment closed mid-line, code after it | only `place_order` is called; `legacy_reorder` is commented out | found (only `place_order`) |
| S6 | `sample-repo/inventory/warehouse.tl:10` | `"` inside a block comment | the quote does not start a string, so `*/` still ends the comment and the call after it is real | found |
| S7 | `sample-repo/batch/retry.tl:4` | `PROC` without `ENDPROC` (the interpreter closes it at end of file) | procedure `retry_failed` encloses the rest of the file | scope closed at end of file with a warning (contract §6.6) |
| S8 | `sample-repo/legacy/old_billing.tl:17` | stray second `ENDPROC` | ignorable | `blockEnd` match with no open scope: ignored with a warning (contract §6.6) |
| S9 | `sample-repo/legacy/old_billing.tl:2` | a whole retired procedure and entry point inside one block comment (lines 2–12) | nothing in it counts | nothing found in it |
| S10 | `sample-repo/legacy/dos_export.tl:1` | CRLF line endings | same results as with LF | same results (contract §6.2) |
| S11 | `sample-repo/docs/notes.txt:1` | a non-toylang file full of toylang keywords | not scanned | not scanned (`fileMatchers: ["**/*.tl"]`) |
| S12 | `sample-repo/admin/audit.tl:7` | columns named `read` and `write` in a `SET` list (also `customers/messages.tl:10`) | one write of `audit_log`; no read | found correctly |
| S13 | `sample-repo/billing/invoices.tl:6` | one `WRITE` continued over four lines | one write of `invoices` on line 6 | found |
| S14 | `sample-repo/orders/orders.tl:17` | `WHILE … ENDWHILE` inside a procedure (also `inventory/stock.tl:6`) | `ENDWHILE` does not end the procedure | procedure scope unaffected |

## 8. The fixture Rule Set

`contract/fixtures/toylang.ruleset.json` is a hand-written, valid Rule Set for toylang (WP-02, aligned here in WP-03). It has one rule per construct, uses both engines (`module-declaration` and `entry-point` are `exact`), `blockEnd` on `proc-definition`, `searchStrings` on `include-directive` and `config-flag`, and a whole-text (`multiline: true`) regex on `db-read` for trap T8.

- It passes every example in §5 and matches none of the negative examples of any construct. This was checked with a throwaway implementation of contract §6 during WP-03; the runner (WP-05) verifies it automatically.
- Its `sourceSkills` hashes, `sourceEvidence` anchors and example ids match the files in this folder (checked by `tests/examples/toylang.test.ts`). **Editing a Skill file requires updating its hash in the fixture Rule Set.**
- `tests.passed` counts the construct's own examples. Whether the runner also counts cross-construct negatives there is WP-05's convention; the fixture may need updating then.
- On the sample repository it has exactly one false positive (S2) and one known miss (S3), on purpose.
