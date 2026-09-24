/**
 * `reviews.yaml`: human verdicts on repository-sample matches, turned into
 * labelled examples for the next compile (D9).
 *
 * - verdict `correct` → positive example; `expected` lists the reviewed match
 *   (and any other match of the same rule in `code`);
 * - verdict `false_positive` → negative example; no `expected`.
 *
 * Writers (the review CLI, WP-07) should build entries with `ReviewEntry` and
 * serialise them with `stringifyReviews`, so the file always loads back.
 */
import { existsSync, readFileSync } from 'node:fs';
import { stringify } from 'yaml';
import { z } from 'zod';
import { KEBAB_CASE_PATTERN } from '../contract/index.js';
import { buildExample } from './build.js';
import { type ExampleLoadError, PARSE_OPTIONS, type PathIssue, zodPathIssues } from './errors.js';
import {
  ConstructIdSchema,
  ExampleIdSchema,
  ExpectedMatchListSchema,
  normalizeCode,
  ReviewVerdictSchema,
  compareExamples,
  type Example,
  type Polarity,
  type ReviewVerdict,
} from './schema.js';
import { compareErrors, type LoadExamplesResult } from './sidecar.js';
import { parseYaml, yamlIssuesToErrors, type ParsedYaml } from './yaml-file.js';

const RelativePathSchema = z
  .string({ error: 'must be a string' })
  .min(1, { error: 'must not be empty' })
  .refine((p) => !p.startsWith('/') && !p.includes('\\') && !/^[A-Za-z]:/.test(p), {
    error: 'must be relative to the sample directory and use / separators',
  });

export const ReviewEntrySchema = z.strictObject({
  /** Example id, unique across all examples; by convention `review-<construct>-<n>`. */
  id: ExampleIdSchema,
  construct: ConstructIdSchema,
  /** Rule whose match was reviewed. */
  ruleId: z
    .string({ error: 'must be a string' })
    .regex(KEBAB_CASE_PATTERN, { error: 'must be a kebab-case rule id' }),
  verdict: ReviewVerdictSchema,
  /** Where the match was found in the repository sample. */
  sampleFile: RelativePathSchema,
  sampleLine: z.int({ error: 'must be a whole number' }).min(1, { error: 'must be 1 or greater' }),
  /** The snippet that becomes the example's code. See README.md "reviews.yaml". */
  code: z.string({ error: 'must be a string' }),
  /** Required for verdict `correct`; must be absent or empty for `false_positive`. Lines are within `code`. */
  expected: ExpectedMatchListSchema.optional(),
  /** ISO 8601 date-time of the verdict, informational. */
  reviewedAt: z.iso.datetime({ error: 'must be an ISO 8601 date-time in UTC, e.g. 2026-09-24T10:00:00Z' }).optional(),
  /** Free-text reason, informational. */
  note: z.string({ error: 'must be a string' }).optional(),
});

export const ReviewsFileSchema = z.strictObject({
  reviews: z.array(ReviewEntrySchema),
});

export type ReviewEntry = z.infer<typeof ReviewEntrySchema>;
export type ReviewsFile = z.infer<typeof ReviewsFileSchema>;

const ReviewsEnvelopeSchema = z.strictObject({
  reviews: z.array(z.unknown(), { error: 'must be a list of review entries' }),
});

export const VERDICT_POLARITY: Readonly<Record<ReviewVerdict, Polarity>> = {
  correct: 'positive',
  false_positive: 'negative',
};

export interface LoadReviewsOptions {
  /** When true, a missing file gives no examples and no error. Default false. */
  readonly allowMissing?: boolean;
}

export interface LoadReviewsResult extends LoadExamplesResult {
  /** Valid entries as written in the file, in file order (for writers that append). */
  readonly entries: ReviewEntry[];
}

/** Loads `reviews.yaml` into examples. Never throws for bad input. */
export function loadReviews(file: string, options: LoadReviewsOptions = {}): LoadReviewsResult {
  const empty: LoadReviewsResult = { examples: [], entries: [], errors: [] };
  if (!existsSync(file)) {
    if (options.allowMissing === true) return empty;
    return { ...empty, errors: [{ file, message: 'reviews file does not exist' }] };
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ...empty, errors: [{ file, message: `cannot read file: ${reason}` }] };
  }
  return parseReviews(text, file);
}

/** Parses the text of a reviews file. `file` is used in errors and in each example's source. */
export function parseReviews(text: string, file: string): LoadReviewsResult {
  const parsed = parseYaml(normalizeCode(text), file);
  if (!parsed.ok) return { examples: [], entries: [], errors: parsed.errors };
  const { yaml } = parsed;
  if (yaml.data === null || yaml.data === undefined) return { examples: [], entries: [], errors: [] };

  const envelope = ReviewsEnvelopeSchema.safeParse(yaml.data, PARSE_OPTIONS);
  if (!envelope.success) {
    return {
      examples: [],
      entries: [],
      errors: yamlIssuesToErrors(yaml, file, withRootHint(zodPathIssues(envelope.error))),
    };
  }

  const errors: ExampleLoadError[] = [];
  const entries: ReviewEntry[] = [];
  const examples: Example[] = [];
  const firstIndexById = new Map<string, number>();

  envelope.data.reviews.forEach((raw, index) => {
    const prefix = ['reviews', index] as const;
    const entry = ReviewEntrySchema.safeParse(raw, PARSE_OPTIONS);
    if (!entry.success) {
      errors.push(...yamlIssuesToErrors(yaml, file, zodPathIssues(entry.error), prefix));
      return;
    }
    const earlier = firstIndexById.get(entry.data.id);
    if (earlier !== undefined) {
      errors.push(
        ...yamlIssuesToErrors(
          yaml,
          file,
          [{ path: ['id'], message: `duplicate id "${entry.data.id}" (first used by reviews[${String(earlier)}])` }],
          prefix,
        ),
      );
      return;
    }
    firstIndexById.set(entry.data.id, index);
    const example = entryToExample(entry.data, file, index, yaml, errors);
    if (example === undefined) return;
    entries.push(entry.data);
    examples.push(example);
  });

  examples.sort(compareExamples);
  errors.sort(compareErrors);
  return { examples, entries, errors };
}

function entryToExample(
  entry: ReviewEntry,
  file: string,
  index: number,
  yaml: ParsedYaml,
  errors: ExampleLoadError[],
): Example | undefined {
  const prefix = ['reviews', index] as const;
  const expected = entry.expected ?? [];
  if (entry.verdict === 'correct' && expected.length === 0) {
    errors.push(
      ...yamlIssuesToErrors(
        yaml,
        file,
        [{ path: ['expected'], message: 'verdict "correct" needs at least one expected match' }],
        prefix,
      ),
    );
    return undefined;
  }
  if (entry.verdict === 'false_positive' && expected.length > 0) {
    errors.push(
      ...yamlIssuesToErrors(
        yaml,
        file,
        [{ path: ['expected'], message: 'verdict "false_positive" must not list expected matches' }],
        prefix,
      ),
    );
    return undefined;
  }
  const built = buildExample(reviewEntryToExampleInput(entry, file, index));
  if (built.ok) return built.example;
  errors.push(...yamlIssuesToErrors(yaml, file, built.issues.map(toEntryPath), prefix));
  return undefined;
}

/** Candidate Example fields for a review entry; validate with `buildExample`. */
export function reviewEntryToExampleInput(entry: ReviewEntry, file: string, index: number): unknown {
  return {
    id: entry.id,
    construct: entry.construct,
    polarity: VERDICT_POLARITY[entry.verdict],
    code: normalizeCode(entry.code),
    expected: entry.expected ?? [],
    source: {
      kind: 'review',
      file,
      entry: index,
      ruleId: entry.ruleId,
      sampleFile: entry.sampleFile,
      sampleLine: entry.sampleLine,
      verdict: entry.verdict,
    },
  };
}

/** Example-record paths map onto the same keys of the entry, except polarity → verdict. */
function toEntryPath(issue: PathIssue): PathIssue {
  const [head, ...rest] = issue.path;
  if (head === 'polarity') return { path: ['verdict', ...rest], message: issue.message };
  if (head === 'source') return { path: [], message: issue.message };
  return issue;
}

function withRootHint(issues: PathIssue[]): PathIssue[] {
  return issues.map((issue) =>
    issue.path.length === 0 && !issue.message.startsWith('unknown')
      ? { path: [], message: 'a reviews file must be a mapping with one key, "reviews", holding a list of entries' }
      : issue,
  );
}

/**
 * Serialises entries as a reviews file that `loadReviews` reads back to the
 * same entries. Multi-line code is written as a YAML literal block.
 * Throws if an entry is invalid, because writing a file that cannot be loaded
 * would lose the reviewer's work silently.
 */
export function stringifyReviews(entries: readonly ReviewEntry[]): string {
  const checked = ReviewsFileSchema.parse({ reviews: entries });
  return stringify(checked, { blockQuote: 'literal', lineWidth: 0 });
}
