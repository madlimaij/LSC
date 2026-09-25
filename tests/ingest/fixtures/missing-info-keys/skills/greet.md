# Greeting

## Saying hello

This example is missing `construct=`:

```toylang example=positive id=say-01
SAY "hi"
```

```yaml expect
- line: 1
  type: call
  captures: { callee: hi }
```
