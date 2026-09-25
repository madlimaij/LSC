/**
 * Stable heading slugs for Construct anchors (WP-06 brief: "anchors are
 * stable heading slugs"). The algorithm only depends on the heading text and
 * on how many earlier headings in the same file produced the same slug, so
 * editing unrelated parts of a Skill file never changes an existing anchor.
 */

/** Lower-cases, strips punctuation (keeping word characters, spaces and `-`), and hyphenates. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Tracks slugs already used in one file and appends `-1`, `-2`, ... to later
 * duplicates (GitHub's heading-anchor convention), so two headings with the
 * same text still get distinct, stable anchors.
 */
export class SlugCounter {
  private readonly counts = new Map<string, number>();

  next(text: string): string {
    const base = slugify(text) || 'section';
    const count = this.counts.get(base) ?? 0;
    this.counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${String(count)}`;
  }
}
