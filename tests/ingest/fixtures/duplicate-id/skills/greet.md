# Greeting

## Saying hello

```toylang example=positive construct=say id=say-01
SAY "hi"
```

```yaml expect
- line: 1
  type: call
  captures: { callee: hi }
```
