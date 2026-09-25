# src/ingest

**Owner:** `skill-ingester` (WP-06).

Turns a folder of Skill Markdown files into `Construct` records: prose and
labelled examples with exact provenance, for WP-09 (synthesis) to send to the
model. Import everything from `src/ingest/index.ts`.

## 1. `ingestSkills(skillsDir, options?)`

```ts
const result = ingestSkills('fixtures/toylang/skills');
// { constructs: Construct[], sourceSkills: { path, sha256 }[], diagnostics: ExampleLoadError[] }
```

- Every `*.md` file under `skillsDir` (recursively, `fast-glob`) is parsed with `unified` + `remark-parse` (never regex over Markdown).
- Each file is SHA-256 hashed over its exact bytes (`sourceSkills`), so a one-character change changes only that file's hash.
- Sidecar examples and `reviews.yaml` are loaded from their conventional location next to `skillsDir` (`src/examples` D15) and merged in by construct id, unless `options.examplesDir` / `options.reviewsFile` override them.
- Never throws for malformed input: every problem becomes a diagnostic (`{ file, line?, message }`, the `ExampleLoadError` shape from `src/examples`), and ingestion continues.

`IngestOptions.proseCharLimit` (default `DEFAULT_PROSE_CHAR_LIMIT` = 4000) caps each construct's `prose`.

## 2. `Construct`

```ts
{
  id: string,                 // kebab-case, e.g. "proc-definition"
  ruleTypeHint?: RuleType,     // the type its positive examples agree on; absent if none
  skillPath: string,          // Skill file the construct was first introduced in, "/" separators
  anchor: string,              // "<skillPath>#<heading-slug>", e.g. "procedure.md#defining-a-procedure"
  prose: string,               // the owning heading's section text (incl. nested subsections), capped
  examples: Example[],         // inline + sidecar + review examples for this construct, sorted by id
}
```

- **Anchor**: the construct's owning heading is the nearest heading (any depth) above the *first* inline example that declares `construct=<id>` in its info string, in document order. The anchor stays stable as long as that first example and the headings above it are not reordered; later examples of the same construct (e.g. a `### Traps` negative example nested under the same heading) do not change it.
- **Prose**: the raw text of that heading's section — from the heading itself to the next heading at the same or a shallower depth (or end of file). This naturally includes a nested `### Traps` subsection. Truncated at `proseCharLimit` characters with a trailing marker; this is deliberately what WP-09 sends to the model (plan §8 step 2), so it is bounded.
- **`ruleTypeHint`**: the rule type (`expected[].type`) every positive example of the construct agrees on. `undefined` when the construct has no positive example (a diagnostic is also emitted, see below). Disagreement between positive examples is itself a diagnostic; `ruleTypeHint` is then the first type found.
- A construct only exists if at least one inline example declares it (`construct=` in a Skill file); a sidecar or review example for an unknown construct is dropped with an "example without construct" diagnostic, not turned into a construct of its own.

## 3. Inline examples

Parsed per docs/PLAN.md §6.1 and `src/examples/README.md` §2:

- A fenced code block whose info string has `example=` (any language tag) is a candidate. Its info string is `key=value` tokens separated by spaces; `example`, `construct` and `id` are required. A block without `example=` is ordinary documentation.
- For a positive example, the **immediately following sibling block** (blank lines in between are fine, since Markdown blank lines are not nodes) must be a fenced ` ```yaml expect ` block; anything else means the example has no expected matches, which fails Example's invariant (positive ⇒ ≥1 expected match) and is reported at the example's own line.
- A ` ```yaml expect ` block that is not immediately preceded by a positive example fence is an orphan and is reported on its own line ("yaml expect block has no preceding positive inline example").
- The `Example` record is built with `buildExample` (src/examples), exactly like every other source. Cross-field issues (e.g. a capture role the construct's type does not allow) are mapped back to the line inside the `yaml expect` block when possible, otherwise to the example fence's line.

## 4. Diagnostics

Never a crash; every problem is `{ file, line?, message }` (same shape and `formatLoadError` as `src/examples`), sorted by file then line. Diagnostics found by this package, each with a fixture in `tests/ingest/fixtures/`:

- a code fence with `example=` missing `construct=` or `id=` (`missing-info-keys`)
- a `yaml expect` block with no preceding positive example (`orphan-expect-block`)
- a positive example, sidecar file or `reviews.yaml` entry with a schema/shape problem (mapped to a line where possible) (`malformed-expect-yaml`)
- an example (sidecar or review) whose `construct` no Skill file documents (`example-without-construct`)
- an example id reused across Skill files, sidecar examples and reviews (`duplicate-id`)
- a construct with no positive example (`no-positive-example`)
- a construct whose positive examples disagree on rule type (`conflicting-types`)

Sidecar and `reviews.yaml` loading errors (from `src/examples`) pass through unchanged.

## 5. CLI

`lsc ingest <skills-dir> [--json] [--prose-limit <chars>]` (`src/cli/commands/ingest.ts`) prints every construct (id, rule type hint, example counts by polarity, anchor) and every diagnostic; exit code 1 when there is at least one diagnostic.

## 6. Anchors and stability

An anchor is `<skillPath>#<slug>`. `slugify` is a GitHub-style heading slug (lower-case, punctuation stripped, spaces to `-`); `SlugCounter` appends `-1`, `-2`, ... to a repeated heading text within one file, so the same heading text always produces the same slug and two headings with identical text in one file still get distinct, stable anchors.
