# Reading from the database

## Reading a table

`READ table` fetches rows from a database table. The optional `WHERE` clause filters rows, and `INTO var` stores the result in a variable; without `INTO` the rows go into the implicit cursor.

```
READ orders WHERE id = order_id
READ customers WHERE id = cid INTO cust
```

What to report: the table name, exactly as written. It is always the identifier right after `READ`.

Rules:
- `READ` may appear at the start of a line, after `;`, or on its own line inside `IF` / `WHILE` blocks. Keywords are case-insensitive.
- Long reads are often split with `&`. Sometimes the split comes right after the keyword, so the table name is on the **next** line. That is still one read of that table, and it belongs to the line where `READ` is.
- Several reads may share a line with `;`.

```toylang example=positive construct=db-read id=read-01
READ orders WHERE id = order_id
```

```yaml expect
- line: 1
  type: db_read
  captures: { table: orders }
```

```toylang example=positive construct=db-read id=read-02
read customers WHERE id = cid INTO cust
```

```yaml expect
- line: 1
  type: db_read
  captures: { table: customers }
```

The table on the continuation line:

```toylang example=positive construct=db-read id=read-03
READ &
    order_lines WHERE order_id = oid
```

```yaml expect
- line: 1
  type: db_read
  captures: { table: order_lines }
```

Two reads on one line:

```toylang example=positive construct=db-read id=read-04
READ rates; READ currencies WHERE code = cur
```

```yaml expect
- line: 1
  type: db_read
  captures: { table: rates }
- line: 1
  type: db_read
  captures: { table: currencies }
```

### Traps

- Words that contain `READ` are not reads: `ALREADY_read`, `READ_ONLY`, `unread`.
- `READ` inside strings and comments is not a read.
- `EXEC "READ ..."` is dynamic and not counted (see `language-basics.md`).

```toylang example=negative construct=db-read id=read-neg-01
LET ALREADY_read = 1
LOG "READ orders"
```

More examples are in `examples/db-read/`.
