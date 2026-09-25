# Greeting

## Saying hello

Two positive examples of the same construct that disagree on rule type (a documentation bug):

```toylang example=positive construct=say id=say-01
SAY "hi"
```

```yaml expect
- line: 1
  type: call
  captures: { callee: hi }
```

```toylang example=positive construct=say id=say-02
READ hi
```

```yaml expect
- line: 1
  type: db_read
  captures: { table: hi }
```
