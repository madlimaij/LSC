# src/examples

**Owner:** `contract-architect` (WP-03).

The `Example` record and its loaders (docs/PLAN.md §6.1). This file is the format reference for WP-05 (runner), WP-06 (ingestion), WP-07 (review CLI) and WP-09 (synthesis). The code is in `schema.ts`; import everything from `src/examples/index.ts`.

## 1. The `Example` record

```ts
{
  id: string,                 // kebab-case, unique across all sources: "proc-01"
  construct: string,          // kebab-case construct id: "proc-definition"
  polarity: 'positive' | 'negative',
  code: string,               // the snippet, "\n" line endings
  expected: { line, type, captures }[],
  source: InlineSource | SidecarSource | ReviewSource,
}
```

- `expected[].line`: 1-based line **within `code`** where the match starts.
- `expected[].type`: a contract rule type (`RULE_TYPES`).
- `expected[].captures`: capture **role** → exact text, e.g. `{ callee: "apply_discount", module: "billing" }`. Roles, not group names, because group names belong to a rule and change with it.

Invariants enforced by `ExampleSchema` (a parsed Example always satisfies them):

1. `code` is not blank, has no `\r\n` and no byte order mark (loaders call `normalizeCode`).
2. positive ⇒ at least one expected match; negative ⇒ none.
3. every `line` is within `code` (`codeLineCount`; a final newline does not add a line).
4. all expected matches of one example have the same `type`, the construct's rule type.
5. each match's captures contain the type's required roles and only its required or optional roles (`RULE_TYPE_SPEC`).
6. no two expected matches are identical.

### Meaning (for the runner, WP-05)

Plan §6.2 applies. Precisely:

- A positive example passes when the rule's matches on `code` are exactly the expected list: same number, and each expected entry is matched by one actual match on the same line whose captures are **equal** to the expected captures. Actual captures are the roles the rule maps whose group took part in the match; a role the rule maps but the example does not list is a difference.
- A negative example passes when the rule produces no match.
- Rules run against the examples of their construct and the negative examples of **every** construct (plan §8 step 4). So a negative example must contain no match of any construct; write negatives from comments, strings, `LET`/`LOG` lines and look-alike identifiers only.
- `code` is scanned like a whole file (masking, `blockEnd`, `multiline` rules), with line 1 being the first line of `code`.

### Sources

| `source.kind` | Fields | Created by |
| --- | --- | --- |
| `inline` | `skill` (path relative to the Skill directory, `/` separators, as in `sourceSkills`), `line` (1-based line of the opening fence) | WP-06 |
| `sidecar` | `file`, `expectFile` (relative to the examples directory, `/` separators) | `loadSidecarExamples` |
| `review` | `file` (reviews.yaml as given), `entry` (0-based index), `ruleId`, `sampleFile`, `sampleLine`, `verdict` | `loadReviews` |

## 2. Inline examples in Skill files (parsed by WP-06)

A fenced code block whose info string has `example=`:

````markdown
```toylang example=positive construct=proc-definition id=proc-01
PROC calc_total(order_id)
ENDPROC
```

```yaml expect
- line: 1
  type: symbol_definition
  captures: { name: calc_total, kind: PROC }
```
````

- Info string: the language tag first, then `key=value` pairs separated by spaces, in any order. Required keys: `example` (`positive` | `negative`), `construct`, `id`. Values contain no spaces.
- Fenced blocks without `example=` are ordinary documentation and are not examples.
- The `yaml expect` block is the next block after the example (blank lines between are fine). Its body is a YAML **list** of expected matches, parsed with `parseExpectBlock(body, skillPath, fenceLine)`, which reports errors at Skill-file lines.
- A negative example has no `yaml expect` block. A positive example without one is an error (`buildExample` reports it).
- Build the record with `buildExample({ id, construct, polarity, code: normalizeCode(body), expected, source })`. Its issues have paths relative to the record (`expected[0].line`).

## 3. Sidecar examples

```
examples/<construct>/<id>.<ext>          code, any extension (toylang: .tl)
examples/<construct>/<id>.expect.yaml    labels
```

`<id>.expect.yaml`:

```yaml
# Free-text notes go in YAML comments.
polarity: positive          # or negative
expected:                   # required for positive; omit or [] for negative
  - line: 4
    type: call
    captures: { callee: apply_discount }
```

Rules checked by `loadSidecarExamples(examplesDir)`, each with a failing fixture in `tests/examples/fixtures/sidecar/`: construct directory and id are kebab-case; files sit directly in a construct directory; each code file has exactly one expect file and the reverse; the code file has an extension; expect files are named `.expect.yaml` (not `.yml`); valid YAML without duplicate keys; only the fields above; all Example invariants; ids unique across construct directories. Names starting with `.` are ignored.

## 4. `reviews.yaml` (D9)

Written by `lsc review` (WP-07) with `stringifyReviews`, read with `loadReviews`.

```yaml
reviews:
  - id: review-call-001            # unique across all examples; convention review-<construct>-<n>
    construct: call
    ruleId: call-statement         # rule whose sample match was reviewed
    verdict: false_positive        # or correct
    sampleFile: orders/dispatch.tl # relative to the sample directory, / separators
    sampleLine: 7                  # line of the match in sampleFile
    code: |                        # becomes the example's code
      CALL DYNAMIC handler_name(order_id)
    reviewedAt: 2026-09-24T10:00:00Z   # optional, UTC
    note: target only known at run time  # optional
```

- `verdict: correct` → positive example; `expected` is required (lines within `code`).
- `verdict: false_positive` → negative example; `expected` must be absent or empty.
- `skip` verdicts are not written; the match stays unreviewed.
- Choosing `code`: the example is judged like any other (§1), so `code` should contain the reviewed match and nothing that would make the example fail for reasons the reviewer did not judge. Recommended: the lines spanned by the match only (usually one line). A ±3-line snippet can contain other matches of the same rule, which a positive example must then list and a negative example must not contain at all.
- One bad entry does not stop the others from loading; `entries` returns the valid entries in file order for writers that append.

### Review examples and the model

Review `code` is repository-sample text. Plan §8 says no repository-sample file is ever sent to the model. Until the project owner decides otherwise, WP-09 should use examples with `source.kind === 'review'` only in the runner (testing), not in prompts. (Open question in the WP-03 completion note.)

## 5. Where the sources are

`exampleLocations(skillsDir)` implements the convention (docs/DECISIONS.md D15):

```
<language>/skills/        the <skills-dir> CLI argument
<language>/examples/      sidecar examples
<language>/reviews.yaml   review verdicts
```

Both example sources are optional; pass `{ allowMissing: true }` to the loaders when absence is fine.

## 6. Errors

Loaders never throw for bad input. They return `{ examples, errors }`; each error is `{ file, line?, message }`, printed by `formatLoadError` as `file:line: field.path: message`, e.g.

```
examples/call/call-01.expect.yaml:5: expected[0].captures: type "call" requires capture "callee"
```

Valid examples are returned even when other files have errors; examples with any error are left out. Results are sorted (examples by construct then id, errors by file then line) so output is deterministic.
