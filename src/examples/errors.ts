/**
 * Readable load errors for example files. Loaders never throw for bad input;
 * they return every problem they find as an `ExampleLoadError` and keep going,
 * so one broken file does not hide the others.
 */
import type { z } from 'zod';

export interface ExampleLoadError {
  /** File the problem is in, as given to the loader (joined with the file name). */
  readonly file: string;
  /** 1-based line in that file, when known. */
  readonly line?: number;
  readonly message: string;
}

/** `file:line: message`, or `file: message` when the line is unknown. */
export function formatLoadError(error: ExampleLoadError): string {
  const where = error.line === undefined ? error.file : `${error.file}:${String(error.line)}`;
  return `${where}: ${error.message}`;
}

/**
 * Options for every safeParse whose issues go through `zodPathIssues`: the
 * input is needed to tell a missing field from a value of the wrong type.
 */
export const PARSE_OPTIONS = { reportInput: true } as const;

export type IssuePath = readonly (string | number)[];

export interface PathIssue {
  readonly path: IssuePath;
  readonly message: string;
}

/** Formats a path for messages: `expected[0].captures.name`. */
export function formatFieldPath(path: IssuePath): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${String(segment)}]`;
    else out += out === '' ? segment : `.${segment}`;
  }
  return out;
}

/**
 * Turns Zod issues into path + message pairs with wording aimed at someone
 * editing a YAML file. Unknown keys are reported on the key itself.
 */
export function zodPathIssues(error: z.ZodError): PathIssue[] {
  const out: PathIssue[] = [];
  for (const issue of error.issues) {
    const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol');
    if (issue.code === 'unrecognized_keys') {
      const isCaptures = path[path.length - 1] === 'captures';
      for (const key of issue.keys) {
        out.push({
          path: [...path, key],
          message: isCaptures ? `unknown capture role "${key}"` : `unknown field "${key}"`,
        });
      }
      continue;
    }
    const isTypeOrValue = issue.code === 'invalid_type' || issue.code === 'invalid_value' || issue.code === 'invalid_union';
    if (isTypeOrValue && issue.input === undefined && path.length > 0) {
      out.push({ path, message: 'is required' });
      continue;
    }
    out.push({ path, message: issue.message });
  }
  return out;
}

/** `field: message`, or just the message for the root. */
export function describePathIssue(issue: PathIssue): string {
  const field = formatFieldPath(issue.path);
  return field === '' ? issue.message : `${field}: ${issue.message}`;
}
