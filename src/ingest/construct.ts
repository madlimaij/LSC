/**
 * The `Construct` record (WP-06 brief): one language feature documented in
 * the Skill files, with the prose and examples that justify its rule(s).
 */
import { compareExamples, exampleRuleType, type Example } from '../examples/index.js';
import type { RuleType } from '../contract/index.js';
import type { HeadingInfo } from './inline.js';

/** Default cap on `prose` (characters). Configurable via `IngestOptions.proseCharLimit`. */
export const DEFAULT_PROSE_CHAR_LIMIT = 4000;

export const TRUNCATION_MARKER = '\n\n… [truncated]';

export interface Construct {
  readonly id: string;
  /** The rule type its positive examples agree on, when they do (see diagnostics for disagreement). */
  readonly ruleTypeHint?: RuleType;
  /** Skill file the construct was first introduced in, relative to the Skill directory (`/` separators). */
  readonly skillPath: string;
  /** Stable heading slug, e.g. `procedure.md#defining-a-procedure`. */
  readonly anchor: string;
  /** The heading's section text (heading + body, including nested subsections), capped at the prose limit. */
  readonly prose: string;
  readonly examples: Example[];
}

/** Section text owned by the heading at `headingIndex`: from that heading to the next heading at the same or a shallower depth, or the end of the file. */
export function sectionText(fileText: string, headings: readonly HeadingInfo[], headingIndex: number): string {
  const heading = headings[headingIndex];
  if (heading === undefined) return '';
  let end = fileText.length;
  for (let j = headingIndex + 1; j < headings.length; j += 1) {
    const candidate = headings[j];
    if (candidate === undefined) break;
    if (candidate.depth <= heading.depth) {
      end = candidate.offset;
      break;
    }
  }
  return fileText.slice(heading.offset, end);
}

/** Caps `text` at `limit` characters, appending a truncation marker when it was cut. */
export function truncateProse(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + TRUNCATION_MARKER;
}

/**
 * The rule type a construct's positive examples agree on, or `undefined`
 * when there are none. `conflicting` lists any type that differs from the
 * first one found, for a diagnostic.
 */
export function ruleTypeHintOf(examples: readonly Example[]): { type: RuleType | undefined; conflicting: RuleType[] } {
  const types: RuleType[] = [];
  for (const example of examples) {
    if (example.polarity !== 'positive') continue;
    const type = exampleRuleType(example);
    if (type !== undefined) types.push(type);
  }
  const first = types[0];
  const conflicting = [...new Set(types.filter((t) => t !== first))];
  return { type: first, conflicting };
}

/** Sorts constructs by id (deterministic output). */
export function compareConstructs(a: Pick<Construct, 'id'>, b: Pick<Construct, 'id'>): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Re-exported for callers that need to sort a construct's examples the same way loaders do. */
export { compareExamples };
