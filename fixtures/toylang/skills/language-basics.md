# Toylang basics

This page is the starting point for anyone reading or changing toylang code. It covers the rules that apply to every statement. Each construct (procedures, calls, database access, and so on) has its own page in this folder.

> Toylang is our in-house batch language. The interpreter is old and forgiving, so the code base contains styles from several decades. When in doubt, check how the interpreter behaves, not how the code "looks".

## Files and modules

- Source files end in `.tl` (lower case). Other files in a repository are not toylang, even if they contain toylang keywords (design notes, exported listings, ...).
- One module per file. The module name is declared at the top with `MODULE` (see `module.md`).

## Case

Keywords are case-insensitive: `PROC`, `proc` and `Proc` are the same keyword. The house style is upper case, but older modules use lower case throughout, and some mix both.

Identifiers (procedure, table, variable names) keep the case they are written in. Tools must report them exactly as written.

## Identifiers

Identifiers are letters, digits and underscores, and do not start with a digit: `calc_total`, `RECALL_x`, `PROCESSOR`, `order_lines2`.

Keywords are not reserved inside identifiers. `PROCESSOR`, `RECALL_x`, `ALREADY_read`, `MODULE_COUNT` and `ENTRY_count` are ordinary names, and none of them contains the keyword it seems to contain. Anything that searches the code must respect word boundaries.

## Comments

- `--` starts a line comment. It runs to the end of the line.
- `/*` starts a block comment, which ends at the next `*/`. Block comments may span many lines and do not nest.
- Inside a line comment, `/*` does not start a block comment.
- Commented-out code is common. Keywords inside comments mean nothing.

## Strings

- String literals are written in double quotes: `"shipped"`.
- There are no escape sequences. A string ends at the next `"`, and a string never continues onto the next line.
- `--` and `/*` inside a string are ordinary characters, not comment markers: `LOG "-- pricing v2 --"` logs that text.
- Keywords inside strings mean nothing, with two exceptions where the string itself is the point: the file name after `INCLUDE` (see `include.md`) and the key inside `FLAG("...")` (see `config-flag.md`).

## Statements and lines

- Normally one statement per line.
- Several statements may share a line when separated by `;`: `call reset_totals(); CALL log_event("reset")`.
- A statement may continue on the next line when the line ends with `&` (only spaces or a line comment may follow the `&`). The continuation line is usually indented. The `&` may stand between any two parts of a statement, so the keyword and the name that belongs to it can end up on different lines:

  ```
  READ &
      order_lines WHERE order_id = oid
  ```

## Statements at a glance

| Statement | Meaning | Page |
| --- | --- | --- |
| `MODULE name` | module declaration | `module.md` |
| `INCLUDE "file.tl"` | textual include | `include.md` |
| `PROC name(...)` … `ENDPROC` | procedure | `procedure.md` |
| `FUNC name(...) RETURNS type` … `ENDFUNC` | function | `procedure.md` |
| `CALL [module.]name(...) [INTO var]` | call | `call.md` |
| `READ table [WHERE ...] [INTO var]` | database read | `db-read.md` |
| `WRITE table SET col = expr, ... [WHERE ...]` | database write | `db-write.md` |
| `FLAG("key")` | feature flag lookup (an expression) | `config-flag.md` |
| `ENTRY job -> proc` | scheduler entry point | `entry-point.md` |
| `LET var = expr` | assignment | — |
| `IF cond THEN` … `[ELSE]` … `ENDIF` | condition, may be nested | — |
| `WHILE cond DO` … `ENDWHILE` | loop | — |
| `LOG expr` | write a message to the job log | — |
| `EXEC "statement"` | run a statement built at run time | — |
| `RETURN [expr]` | leave a procedure or function | — |

Expressions use `+ - * /`, comparisons `= <> < > <= >=`, `AND`, `OR`, `NOT`, and the built-in functions `FLAG`, `LEN`, `NOW`, `UPPER` and `ROWCOUNT`. User procedures and functions are never called inside an expression; they are always invoked with `CALL`.

## EXEC

`EXEC` runs a statement held in a string, for example `EXEC "READ audit_log WHERE day = today"`. The interpreter parses that string only at run time. Static tools cannot know what it does, and we do not count the statement inside the string as a read, write or call.
