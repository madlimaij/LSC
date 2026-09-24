# Writing to the database

## Writing a table

`WRITE table SET column = value, ...` inserts or updates rows (the interpreter decides based on the key). An optional `WHERE` restricts which rows are updated.

What to report: the table name right after `WRITE`, exactly as written.

- `WRITE` may appear at the start of a line or after `;`. Case-insensitive.
- Long writes are split with `&`, normally before `SET`, so the table name stays on the `WRITE` line.
- Spaces or tabs may separate `WRITE` and the table.

```toylang example=positive construct=db-write id=write-01
WRITE invoices SET total = t
```

```yaml expect
- line: 1
  type: db_write
  captures: { table: invoices }
```

```toylang example=positive construct=db-write id=write-02
WRITE invoices &
  SET total = t, paid = 0
```

```yaml expect
- line: 1
  type: db_write
  captures: { table: invoices }
```

```toylang example=positive construct=db-write id=write-03
write orders SET status = "shipped" WHERE id = oid
```

```yaml expect
- line: 1
  type: db_write
  captures: { table: orders }
```

### Traps

- `REWRITE_count`, `write_mode` and similar names are variables.
- `WRITE` in comments and log messages is not a write, and neither is `EXEC "WRITE ..."`.

```toylang example=negative construct=db-write id=write-neg-01
LET REWRITE_count = 0
LET write_mode = "append"
```

More examples are in `examples/db-write/`.
