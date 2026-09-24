# Configuration flags

## Feature flags

`FLAG("key")` is a built-in function that returns true when the feature flag `key` is switched on in the scheduler configuration. Operations wants a list of every flag the code depends on, so every flag lookup must be found.

- `FLAG` is used inside expressions, typically in `IF` conditions or `LET` assignments. Case-insensitive.
- The key is a string literal. Report the text inside the quotes. Keys may contain dots and hyphens (`vat.v2`, `beta-ui`) and, in a few old modules, even `--`, which is just text inside the string.
- Spaces are allowed around the parentheses: `FLAG ( "beta-ui" )`.
- One line may contain several lookups.
- Only literal keys count. `FLAG(flag_name)` with a variable cannot be resolved statically and is not reported as a flag reference.

```toylang example=positive construct=config-flag id=flag-01
IF FLAG("new_pricing") THEN
  LET rate = 0.9
ENDIF
```

```yaml expect
- line: 1
  type: config_ref
  captures: { key: new_pricing }
```

```toylang example=positive construct=config-flag id=flag-02
IF flag("eu_vat") AND FLAG("vat.v2") THEN
  LET vat = 0.2
ENDIF
```

```yaml expect
- line: 1
  type: config_ref
  captures: { key: eu_vat }
- line: 1
  type: config_ref
  captures: { key: vat.v2 }
```

```toylang example=positive construct=config-flag id=flag-03
LET beta = FLAG ( "beta-ui" )
```

```yaml expect
- line: 1
  type: config_ref
  captures: { key: beta-ui }
```

### Traps

- `FLAGSHIP_store`, `flags` and the like are variables.
- Mentions of flags in comments and log messages are not lookups.
- `FLAG(variable)` is dynamic (see above).

```toylang example=negative construct=config-flag id=flag-neg-01
LET FLAGSHIP_store = "berlin"
LET flags = 0
```

More examples are in `examples/config-flag/`.
