# Includes

## Including a file

`INCLUDE "path"` pastes another toylang file into this one when the module is loaded. We use it for shared constants and helper procedures.

- `INCLUDE` must be the first word on its line (indentation allowed). It is case-insensitive.
- The path is a string literal, relative to the repository's `src` root, with `/` separators.
- The path is the part inside the quotes. Report it without the quotes.
- The path is ordinary string content: it may contain characters that look like comment markers, e.g. `"legacy--compat.tl"`.
- Includes normally sit right after `MODULE`, but they are allowed anywhere at top level.

```toylang example=positive construct=include id=include-01
INCLUDE "common.tl"
```

```yaml expect
- line: 1
  type: include
  captures: { target: common.tl }
```

Paths may have directories. Lower case works too, and a comment may follow:

```toylang example=positive construct=include id=include-02
include "lib/dates.tl"   -- date helpers
```

```yaml expect
- line: 1
  type: include
  captures: { target: lib/dates.tl }
```

The usual header of a module:

```toylang example=positive construct=include id=include-03
MODULE billing
INCLUDE "common.tl"
INCLUDE "billing/rates.tl"
```

```yaml expect
- line: 2
  type: include
  captures: { target: common.tl }
- line: 3
  type: include
  captures: { target: billing/rates.tl }
```

### Traps

Because the target is a string, a tool cannot simply ignore strings for includes. It still must not treat every string that mentions `INCLUDE` as an include, and it must ignore commented-out includes:

```toylang example=negative construct=include id=include-neg-01
LOG "INCLUDE common.tl failed"
-- INCLUDE "old.tl"
```

More examples are in `examples/include/`.
