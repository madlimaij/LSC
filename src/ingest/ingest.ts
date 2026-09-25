/**
 * Turns a folder of Skill Markdown files into constructs with prose and
 * examples (WP-06). Combines inline examples (parsed here) with sidecar
 * examples and `reviews.yaml` (WP-03 loaders), by construct id.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FastGlob from 'fast-glob';
import {
  compareExamples,
  exampleLocations,
  type Example,
  type ExampleLoadError,
  loadReviews,
  loadSidecarExamples,
  normalizeCode,
} from '../examples/index.js';
import { compareConstructs, DEFAULT_PROSE_CHAR_LIMIT, type Construct, ruleTypeHintOf, sectionText, truncateProse } from './construct.js';
import { compareErrors } from './diagnostics.js';
import { type ConstructAnchor, extractInline, type HeadingInfo } from './inline.js';
import { sha256Hex } from './hash.js';
import { parseMarkdown } from './markdown.js';

export interface SourceSkill {
  /** Path relative to the Skill directory, `/` separators. */
  readonly path: string;
  readonly sha256: string;
}

export interface IngestOptions {
  /** Character cap on each construct's `prose`. Default `DEFAULT_PROSE_CHAR_LIMIT`. */
  readonly proseCharLimit?: number;
  /** Overrides the sidecar examples directory (default: sibling `examples/` of `skillsDir`, WP-03 D15). */
  readonly examplesDir?: string;
  /** Overrides the `reviews.yaml` path (default: sibling of `skillsDir`, WP-03 D15). */
  readonly reviewsFile?: string;
}

export interface IngestResult {
  readonly constructs: Construct[];
  readonly sourceSkills: SourceSkill[];
  readonly diagnostics: ExampleLoadError[];
}

interface FileRecord {
  readonly path: string;
  readonly headings: HeadingInfo[];
  readonly text: string;
}

/** Ingests every `*.md` file under `skillsDir` (recursively), plus its sidecar examples and reviews. Never throws. */
export function ingestSkills(skillsDir: string, options: IngestOptions = {}): IngestResult {
  const proseCharLimit = options.proseCharLimit ?? DEFAULT_PROSE_CHAR_LIMIT;
  const diagnostics: ExampleLoadError[] = [];

  const files = FastGlob.sync('**/*.md', { cwd: skillsDir }).sort();

  const inlineExamples: Example[] = [];
  const constructAnchors = new Map<string, ConstructAnchor & { skillPath: string }>();
  const fileRecords: FileRecord[] = [];
  const sourceSkills: SourceSkill[] = [];

  for (const relPath of files) {
    const absPath = join(skillsDir, relPath);
    let raw: Buffer;
    try {
      raw = readFileSync(absPath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      diagnostics.push({ file: relPath, message: `cannot read file: ${reason}` });
      continue;
    }
    sourceSkills.push({ path: relPath, sha256: sha256Hex(raw) });

    const text = normalizeCode(raw.toString('utf8'));
    const root = parseMarkdown(text);
    const extracted = extractInline(root, relPath);

    diagnostics.push(...extracted.diagnostics);
    inlineExamples.push(...extracted.examples);
    fileRecords.push({ path: relPath, headings: extracted.headings, text });

    for (const [construct, anchorInfo] of extracted.constructAnchors) {
      if (!constructAnchors.has(construct)) {
        constructAnchors.set(construct, { ...anchorInfo, skillPath: relPath });
      }
    }
  }

  const knownConstructs = new Set(constructAnchors.keys());

  const locations = exampleLocations(skillsDir);
  const examplesDir = options.examplesDir ?? locations.examplesDir;
  const reviewsFile = options.reviewsFile ?? locations.reviewsFile;

  const sidecar = loadSidecarExamples(examplesDir, { allowMissing: true });
  const reviews = loadReviews(reviewsFile, { allowMissing: true });
  diagnostics.push(...sidecar.errors, ...reviews.errors);

  const { known: knownSidecar, orphans: orphanSidecar } = partitionByConstruct(sidecar.examples, knownConstructs);
  const { known: knownReviews, orphans: orphanReviews } = partitionByConstruct(reviews.examples, knownConstructs);

  for (const example of [...orphanSidecar, ...orphanReviews]) {
    diagnostics.push({
      file: sourceOf(example),
      message: `example "${example.id}" refers to construct "${example.construct}", which no Skill file documents (no inline example uses construct=${example.construct})`,
    });
  }

  const merged = [...inlineExamples, ...knownSidecar, ...knownReviews];
  const { examples: deduped, diagnostics: dedupeDiagnostics } = dropCrossSourceDuplicates(merged);
  diagnostics.push(...dedupeDiagnostics);

  const byConstruct = new Map<string, Example[]>();
  for (const example of deduped) {
    const list = byConstruct.get(example.construct) ?? [];
    list.push(example);
    byConstruct.set(example.construct, list);
  }

  const fileByPath = new Map(fileRecords.map((f) => [f.path, f] as const));
  const constructs: Construct[] = [];
  for (const [id, anchorInfo] of [...constructAnchors].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const examples = (byConstruct.get(id) ?? []).slice().sort(compareExamples);
    const { type, conflicting } = ruleTypeHintOf(examples);

    if (type === undefined) {
      diagnostics.push({
        file: anchorInfo.skillPath,
        message: `construct "${id}" has no positive example; no rule can be synthesised for it`,
      });
    }
    if (conflicting.length > 0) {
      diagnostics.push({
        file: anchorInfo.skillPath,
        message: `construct "${id}" has positive examples with different rule types (${type as string} and ${conflicting.join(', ')}); a construct must map to one rule type`,
      });
    }

    const file = fileByPath.get(anchorInfo.skillPath);
    const headingIndex = file?.headings.findIndex((h) => h.offset === anchorInfo.headingOffset) ?? -1;
    const prose =
      file !== undefined && headingIndex >= 0 ? truncateProse(sectionText(file.text, file.headings, headingIndex), proseCharLimit) : '';

    constructs.push({
      id,
      ...(type !== undefined ? { ruleTypeHint: type } : {}),
      skillPath: anchorInfo.skillPath,
      anchor: anchorInfo.anchor === '' ? anchorInfo.skillPath : `${anchorInfo.skillPath}#${anchorInfo.anchor}`,
      prose,
      examples,
    });
  }
  constructs.sort(compareConstructs);

  return {
    constructs,
    sourceSkills: sourceSkills.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    diagnostics: diagnostics.sort(compareErrors),
  };
}

function partitionByConstruct(examples: readonly Example[], known: ReadonlySet<string>): { known: Example[]; orphans: Example[] } {
  const knownList: Example[] = [];
  const orphans: Example[] = [];
  for (const example of examples) {
    if (known.has(example.construct)) knownList.push(example);
    else orphans.push(example);
  }
  return { known: knownList, orphans };
}

function sourceOf(example: Example): string {
  switch (example.source.kind) {
    case 'inline':
      return example.source.skill;
    case 'sidecar':
      return example.source.file;
    case 'review':
      return example.source.file;
  }
}

/** Removes every example whose id occurs more than once across the merged (inline + sidecar + review) set. */
function dropCrossSourceDuplicates(examples: readonly Example[]): { examples: Example[]; diagnostics: ExampleLoadError[] } {
  const byId = new Map<string, Example[]>();
  for (const example of examples) byId.set(example.id, [...(byId.get(example.id) ?? []), example]);
  const diagnostics: ExampleLoadError[] = [];
  const duplicated = new Set<string>();
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    duplicated.add(id);
    const files = list.map(sourceOf).sort();
    diagnostics.push({
      file: files[0] ?? id,
      message: `example id "${id}" is used more than once across Skill files, sidecar examples and reviews (${files.join(', ')}); ids must be unique`,
    });
  }
  return { examples: examples.filter((e) => !duplicated.has(e.id)), diagnostics };
}
