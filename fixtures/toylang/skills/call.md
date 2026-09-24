# Calls

## Calling a procedure

Procedures and functions are always invoked with `CALL`. There are no calls inside expressions; the result of a function is stored with `INTO`:

```
CALL apply_discount(order_id)
CALL net_price(amount) INTO price
```

Rules:
- `CALL` is followed by the procedure name and its argument list in parentheses. The parentheses are required, even with no arguments: `CALL sync_warehouse()`. A space before `(` is allowed.
- To call a procedure in another module, prefix it with the module name and a dot: `CALL billing.apply_discount(order_id)`. The name after the dot is the procedure; the name before it is the module.
- `CALL` may appear anywhere a statement may: at the start of a line, after `;`, and after `THEN` or `ELSE` on their own lines.
- Keywords are case-insensitive.
- Report the callee name exactly as written, and the module when there is one.

The plain form:

```toylang example=positive construct=call id=call-01
CALL apply_discount(order_id)
```

```yaml expect
- line: 1
  type: call
  captures: { callee: apply_discount }
```

A cross-module call:

```toylang example=positive construct=call id=call-02
CALL billing.apply_discount(order_id)
```

```yaml expect
- line: 1
  type: call
  captures: { module: billing, callee: apply_discount }
```

Two calls on one line, separated by `;`. Both count. Note that the string argument is only text:

```toylang example=positive construct=call id=call-03
call reset_totals(); CALL log_event("reset")
```

```yaml expect
- line: 1
  type: call
  captures: { callee: reset_totals }
- line: 1
  type: call
  captures: { callee: log_event }
```

A line comment that happens to contain `/*` does not open a block comment, so the call on the next line is real:

```toylang example=positive construct=call id=call-04
LET x = 1 -- CALL old_proc() is gone /* not a block comment
CALL new_proc(x)
```

```yaml expect
- line: 2
  type: call
  captures: { callee: new_proc }
```

### Traps

- `CALL` is not reserved inside identifiers: `RECALL_x`, `CALLBACK_url` are variables. (A procedure may itself be named `RECALL_orders`; then `CALL RECALL_orders(...)` is a call to it.)
- Disabled calls are usually commented out rather than deleted.
- Call-like text in log messages is text.

```toylang example=negative construct=call id=call-neg-01
LET RECALL_x = RECALL_x + 1
LET CALLBACK_url = "https://example.test/cb"
```

More examples, including calls inside nested `IF` blocks, are in `examples/call/`.
