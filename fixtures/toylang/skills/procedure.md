# Procedures and functions

Procedures (`PROC`) and functions (`FUNC`) are the units of work in toylang. The scheduler starts procedures (see `entry-point.md`), procedures call each other with `CALL`, and every read, write and call belongs to the procedure or function it appears in.

## Defining a procedure

A procedure starts with `PROC name(parameters)` and ends with `ENDPROC`. A function starts with `FUNC name(parameters) RETURNS type` and ends with `ENDFUNC`. Apart from the return value they behave the same, and tools should treat both as definitions. Report which keyword was used, because the two are listed separately in our documentation.

Rules:
- `PROC` / `FUNC` must be the first word on its line (indentation is allowed).
- Keywords are case-insensitive: `proc` … `endproc` is fine.
- The parameter list is always present, even when empty: `PROC refresh_stock()`. A space before `(` is allowed.
- Procedures and functions do not nest. The block ends at the first `ENDPROC` or `ENDFUNC`.
- `IF … ENDIF` and `WHILE … ENDWHILE` blocks inside a procedure can be nested as deep as needed. Their end keywords do **not** end the procedure.
- A long parameter list may be continued with `&` (see `language-basics.md`); the name always stays on the first line.

A typical procedure:

```toylang example=positive construct=proc-definition id=proc-01
PROC calc_total(order_id)
  READ orders WHERE id = order_id
  RETURN
ENDPROC
```

```yaml expect
- line: 1
  type: symbol_definition
  captures: { name: calc_total, kind: PROC }
```

A function:

```toylang example=positive construct=proc-definition id=proc-02
FUNC net_price(amount) RETURNS NUMBER
  RETURN amount * 0.8
ENDFUNC
```

```yaml expect
- line: 1
  type: symbol_definition
  captures: { name: net_price, kind: FUNC }
```

Two procedures in one file, lower case, with nested `IF` blocks. `ENDIF` does not end `apply_discount`; `endproc` does:

```toylang example=positive construct=proc-definition id=proc-03
proc apply_discount(order_id)
  IF discount_allowed THEN
    IF order_total > 100 THEN
      LET rate = 0.1
    ENDIF
  ENDIF
endproc

PROC log_discount(order_id)
  LOG "discount applied"
ENDPROC
```

```yaml expect
- line: 1
  type: symbol_definition
  captures: { name: apply_discount, kind: proc }
- line: 9
  type: symbol_definition
  captures: { name: log_discount, kind: PROC }
```

### Traps

- Names that start with the keyword are just names: `PROCESSOR`, `PROC_count`, `processed`.
- Old versions of procedures are often left in block comments.
- `PROC` inside a log message is text.

```toylang example=negative construct=proc-definition id=proc-neg-01
LET PROCESSOR = "batch-7"
LET processed = processed + 1
```

More examples are in `examples/proc-definition/`.
