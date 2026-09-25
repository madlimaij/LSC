# Greeting

## Saying hello

`SAY "text"` writes a greeting to the log. Report the text as the callee, for this test fixture only.

```toylang example=positive construct=say id=say-01
SAY "hi"
```

```yaml expect
- line: 1
  type: call
  captures: { callee: hi }
```

### Traps

`SAYING` is just a variable name, not a use of `SAY`.

```toylang example=negative construct=say id=say-neg-01
LET SAYING = 1
```

More examples are in `examples/say/`.
