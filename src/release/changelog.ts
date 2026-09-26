/**
 * CHANGELOG entries generated from a Rule Set diff (WP-10 brief). One
 * Markdown file per exported Rule Set, newest entry first.
 */
import type { Bump, Change, RuleSetDiff } from './diff.js';

export const CHANGELOG_TITLE = '# Changelog';

export interface ChangelogEntryInput {
  readonly languageId: string;
  readonly version: string;
  readonly previousVersion?: string;
  /** `compiledAt` of the exported Rule Set; its date is the entry's date. */
  readonly compiledAt: string;
  readonly diff: RuleSetDiff;
  readonly ruleCount: number;
  /** Ids of draft rules left out because they are `rejected`. */
  readonly droppedRejected: readonly string[];
}

const BUMP_TEXT: Record<Exclude<Bump, 'none'>, string> = {
  major: 'Major: a rule was removed or renamed, or its output meaning changed. Review before adopting.',
  minor: 'Minor: rules or scanned files were added; existing output is unchanged. Safe to adopt.',
  patch: 'Patch: patterns, settings or provenance were refined; no change in meaning. Safe to adopt.',
};

/** The heading an entry starts with; also used to avoid writing the same entry twice. */
export function entryHeading(languageId: string, version: string): string {
  return `## ${languageId} ${version}`;
}

function section(title: string, changes: readonly Change[]): string[] {
  return changes.length === 0 ? [] : ['', `### ${title}`, '', ...changes.map((c) => `- ${c.summary}`)];
}

/** Renders one entry. Sections are grouped by bump, so the largest change is read first. */
export function renderChangelogEntry(input: ChangelogEntryInput): string {
  const { diff } = input;
  const date = input.compiledAt.slice(0, 10);
  const lines = [`${entryHeading(input.languageId, input.version)} (${date})`, ''];
  if (input.previousVersion === undefined) {
    lines.push(`First export: ${String(input.ruleCount)} validated rule(s).`);
  } else if (diff.bump === 'none') {
    lines.push(`No changes since ${input.previousVersion}.`);
  } else {
    lines.push(`${BUMP_TEXT[diff.bump]} Previous version: ${input.previousVersion}. ${String(input.ruleCount)} validated rule(s).`);
  }
  lines.push(
    ...section('Breaking (major)', diff.changes.filter((c) => c.bump === 'major')),
    ...section('Added (minor)', diff.changes.filter((c) => c.bump === 'minor')),
    ...section('Refined (patch)', diff.changes.filter((c) => c.bump === 'patch')),
  );
  if (input.droppedRejected.length > 0) {
    lines.push('', `Not exported (status \`rejected\` in the draft): ${input.droppedRejected.map((id) => `\`${id}\``).join(', ')}.`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Inserts `entry` below the title of an existing CHANGELOG text (or starts a
 * new one). If an entry with the same heading is already there, the text is
 * returned unchanged: re-exporting the same version adds nothing.
 */
export function prependChangelogEntry(existing: string | undefined, entry: string, heading: string): { text: string; added: boolean } {
  if (existing === undefined || existing.trim() === '') {
    return { text: `${CHANGELOG_TITLE}\n\n${entry}`, added: true };
  }
  const alreadyThere = existing.split('\n').some((line) => line === heading || line.startsWith(`${heading} `));
  if (alreadyThere) return { text: existing, added: false };
  const normalized = existing.endsWith('\n') ? existing : `${existing}\n`;
  if (normalized.startsWith(`${CHANGELOG_TITLE}\n`)) {
    const rest = normalized.slice(CHANGELOG_TITLE.length + 1).replace(/^\n+/, '');
    return { text: `${CHANGELOG_TITLE}\n\n${entry}${rest === '' ? '' : `\n${rest}`}`, added: true };
  }
  return { text: `${CHANGELOG_TITLE}\n\n${entry}\n${normalized}`, added: true };
}

/**
 * The entry headed `heading` in a CHANGELOG text (from its heading line up to
 * the next `## ` heading or the end, trailing blank lines removed), or
 * undefined when there is none.
 */
export function findChangelogEntry(text: string | undefined, heading: string): string | undefined {
  if (text === undefined) return undefined;
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start < 0) return undefined;
  let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  if (end < 0) end = lines.length;
  return `${lines.slice(start, end).join('\n').replace(/\s+$/, '')}\n`;
}
