# Entry points

## Declaring an entry point

The scheduler can only start procedures that a module declares as entry points:

```
ENTRY job_name -> procedure
```

- `job_name` is the name operations sees in the scheduler. This is what to report.
- The target after `->` is a procedure in this module, or `module.procedure` in another one.
- `ENTRY` lines usually sit at the end of the module, one per job. Case-insensitive; spaces or tabs around `->` are optional.

```toylang example=positive construct=entry-point id=entry-01
ENTRY nightly_billing -> calc_total
```

```yaml expect
- line: 1
  type: entry_point
  captures: { name: nightly_billing }
```

```toylang example=positive construct=entry-point id=entry-02
entry month_end->close_month
```

```yaml expect
- line: 1
  type: entry_point
  captures: { name: month_end }
```

```toylang example=positive construct=entry-point id=entry-03
ENTRY nightly_billing -> calc_total
ENTRY retry_billing   -> calc_total  -- rerun after failures
```

```yaml expect
- line: 1
  type: entry_point
  captures: { name: nightly_billing }
- line: 2
  type: entry_point
  captures: { name: retry_billing }
```

### Traps

- `ENTRY_count`, `re_entry` are variables.
- Retired jobs are commented out, sometimes across several lines of a block comment.

```toylang example=negative construct=entry-point id=entry-neg-01
LET ENTRY_count = 0
LET re_entry = 1
```

More examples are in `examples/entry-point/`.
