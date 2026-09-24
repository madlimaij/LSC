# Modules

Every toylang file is one module. The module name is what other teams see in the scheduler, in the job log and in cross-module calls (`CALL billing.apply_discount(...)`), so it matters more than the file name.

## Declaring a module

Write `MODULE` followed by the module name, normally as the first statement of the file. Only comments and blank lines may come before it.

- The keyword is case-insensitive (`module billing` is fine, just not house style).
- The name follows the identifier rules in `language-basics.md`.
- There is no `ENDMODULE`: the module runs to the end of the file.
- Spaces or tabs may separate the keyword and the name, and a line comment may follow.

The simplest case:

```toylang example=positive construct=module-declaration id=module-01
MODULE billing
```

```yaml expect
- line: 1
  type: module_declaration
  captures: { name: billing }
```

Older files often start with a comment banner, and some use lower case:

```toylang example=positive construct=module-declaration id=module-02
-- Billing helpers, owned by the finance team
module invoice_utils
```

```yaml expect
- line: 2
  type: module_declaration
  captures: { name: invoice_utils }
```

When a module was renamed, people like to leave the old name in a block comment above the declaration. Only the real declaration counts:

```toylang example=positive construct=module-declaration id=module-03
/* MODULE legacy_billing was split in 2019:
   see MODULE billing_v2 below */
MODULE billing_v2
INCLUDE "common.tl"
```

```yaml expect
- line: 3
  type: module_declaration
  captures: { name: billing_v2 }
```

### Traps

`MODULE` is not reserved inside identifiers. Counters and variables like these are not module declarations:

```toylang example=negative construct=module-declaration id=module-neg-01
LET MODULE_COUNT = 3
LET submodule = "orders"
```

The word also shows up in comments and log messages. More examples are in `examples/module-declaration/`.
