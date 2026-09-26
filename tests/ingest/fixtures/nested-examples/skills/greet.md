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

Some traps are easier to show as a list:

- `SAYING` is just a variable name, not a use of `SAY`:

  ```toylang example=negative construct=say id=say-neg-list
  LET SAYING = 1
  ```

Others read better as a quoted note:

> A commented-out call is not a real one:
>
> ```toylang example=negative construct=say id=say-neg-quote
> -- SAY "hi"
> ```

More examples are in `examples/say/`.
