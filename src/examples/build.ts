/**
 * Building and checking `Example` records, and parsing the expected-match YAML
 * shared by all three example sources.
 */
import { z } from 'zod';
import { type ExampleLoadError, PARSE_OPTIONS, type PathIssue, zodPathIssues } from './errors.js';
import {
  ExampleSchema,
  ExpectedMatchListSchema,
  PolaritySchema,
  type Example,
  type ExpectedMatch,
} from './schema.js';
import { parseYaml, yamlIssuesToErrors } from './yaml-file.js';

export type BuildExampleResult =
  | { readonly ok: true; readonly example: Example }
  | { readonly ok: false; readonly issues: PathIssue[] };

/**
 * Validates candidate example fields against `ExampleSchema` (including its
 * cross-field checks). Issue paths are relative to the Example record, e.g.
 * `['expected', 0, 'line']`. Every loader, including WP-06's inline parser,
 * should create examples through this function.
 */
export function buildExample(input: unknown): BuildExampleResult {
  const parsed = ExampleSchema.safeParse(input, PARSE_OPTIONS);
  if (parsed.success) return { ok: true, example: parsed.data };
  return { ok: false, issues: zodPathIssues(parsed.error) };
}

export type ParseExpectedResult =
  | { readonly ok: true; readonly expected: ExpectedMatch[] }
  | { readonly ok: false; readonly errors: ExampleLoadError[] };

/**
 * Parses the body of an inline `yaml expect` block (docs/PLAN.md §6.1): a YAML
 * list of expected matches. An empty body gives an empty list.
 *
 * `file` names the Skill file in errors; `lineOffset` is the number of lines
 * before the block body in that file (the line of the opening fence), so
 * reported lines point into the Skill file.
 *
 * This checks only the shape of each match. Cross-field checks (line within
 * the code, capture roles, polarity) run when the Example is built with
 * `buildExample`.
 */
export function parseExpectBlock(text: string, file: string, lineOffset = 0): ParseExpectedResult {
  const parsed = parseYaml(text, file, lineOffset);
  if (!parsed.ok) return parsed;
  const data = parsed.yaml.data ?? [];
  const result = ExpectedMatchListSchema.safeParse(data, PARSE_OPTIONS);
  if (result.success) return { ok: true, expected: result.data };
  return {
    ok: false,
    errors: yamlIssuesToErrors(parsed.yaml, file, zodPathIssues(result.error)),
  };
}

/**
 * Content of a sidecar `<id>.expect.yaml` file. `expected` is required for a
 * positive example and may be omitted (or `[]`) for a negative one.
 */
export const SidecarExpectSchema = z.strictObject({
  polarity: PolaritySchema,
  expected: ExpectedMatchListSchema.optional(),
});

export type SidecarExpect = z.infer<typeof SidecarExpectSchema>;
