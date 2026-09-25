# Greeting

## Saying hello

The expect block below has a capture role `say` does not allow:

```toylang example=positive construct=say id=say-01
SAY "hi"
```

```yaml expect
- line: 1
  type: call
  captures: { callee: hi, table: orders }
```
