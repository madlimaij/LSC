/**
 * Extracts inline examples (docs/PLAN.md §6.1, src/examples/README.md §2) and
 * headings from one Skill file's mdast tree, with provenance for every
 * example and a stable anchor for every construct it introduces.
 */
import type { Code, Root, RootContent } from 'mdast';
import {
  buildExample,
  describePathIssue,
  type Example,
  type ExampleLoadError,
  type ExpectedMatch,
  normalizeCode,
  type ParsedYaml,
  parseExpectBlock,
  parseYaml,
  type PathIssue,
  yamlIssuesToErrors,
} from '../examples/index.js';
import { parseInfoString } from './info-string.js';
import { headingText, isCode, isHeading, startLine, startOffset } from './markdown.js';
import { SlugCounter } from './slug.js';

/** One heading found in a Skill file, in document order. */
export interface HeadingInfo {
  readonly depth: number;
  readonly text: string;
  readonly slug: string;
  readonly line: number;
  readonly offset: number;
}

/** Where a construct's owning heading is; first occurrence wins, so it stays stable as later text is added. */
export interface ConstructAnchor {
  readonly anchor: string;
  readonly headingOffset: number;
  readonly headingDepth: number;
}

export interface InlineExtractionResult {
  readonly examples: Example[];
  readonly diagnostics: ExampleLoadError[];
  readonly headings: HeadingInfo[];
  /** First heading under which each construct id was introduced, by construct id. */
  readonly constructAnchors: Map<string, ConstructAnchor>;
}

const REQUIRED_KEYS = ['example', 'construct', 'id'] as const;

/**
 * `skillPath` is the file's path relative to the Skill directory (`/`
 * separators), used in diagnostics and in every inline example's `source`.
 * `text` must already be normalised (`normalizeCode`) before parsing.
 */
export function extractInline(root: Root, skillPath: string): InlineExtractionResult {
  const examples: Example[] = [];
  const diagnostics: ExampleLoadError[] = [];
  const headings: HeadingInfo[] = [];
  const constructAnchors = new Map<string, ConstructAnchor>();
  const slugs = new SlugCounter();
  const stack: HeadingInfo[] = [];

  walk(root.children, skillPath, stack, slugs, headings, examples, diagnostics, constructAnchors);

  return { examples, diagnostics, headings, constructAnchors };
}

/**
 * Nodes whose `children` are ordinary block content (mdast `BlockContent |
 * DefinitionContent`, a subset of `RootContent`): list items, list
 * containers, blockquotes and footnote definitions. Fenced examples inside
 * any of these (nested arbitrarily deep, e.g. a negative example inside a
 * blockquote inside a list item) are found by recursing into their children
 * the same way as the document root, so provenance (file, line, the
 * enclosing heading's anchor) stays correct: the heading stack and the
 * "next sibling must be the expect block" rule both apply within whichever
 * children array the code fence sits in.
 *
 * Node types with only inline/phrasing children (paragraphs, emphasis,
 * links, table cells, headings themselves) are deliberately not recursed
 * into: they cannot contain a fenced code block per CommonMark/GFM, so there
 * is nothing to find and nothing is silently dropped.
 */
function blockChildrenOf(node: RootContent): RootContent[] | undefined {
  switch (node.type) {
    case 'blockquote':
    case 'list':
    case 'listItem':
    case 'footnoteDefinition':
      return (node as { children: RootContent[] }).children;
    default:
      return undefined;
  }
}

function walk(
  children: RootContent[],
  skillPath: string,
  stack: HeadingInfo[],
  slugs: SlugCounter,
  headings: HeadingInfo[],
  examples: Example[],
  diagnostics: ExampleLoadError[],
  constructAnchors: Map<string, ConstructAnchor>,
): void {
  let i = 0;
  while (i < children.length) {
    const node = children[i];
    if (node === undefined) break;

    if (isHeading(node)) {
      const text = headingText(node);
      const info: HeadingInfo = {
        depth: node.depth,
        text,
        slug: slugs.next(text),
        line: startLine(node),
        offset: startOffset(node),
      };
      headings.push(info);
      let top = stack[stack.length - 1];
      while (top !== undefined && top.depth >= info.depth) {
        stack.pop();
        top = stack[stack.length - 1];
      }
      stack.push(info);
      i += 1;
      continue;
    }

    if (isCode(node)) {
      i += handleCode(node, children[i + 1], skillPath, stack, examples, diagnostics, constructAnchors);
      continue;
    }

    const nested = blockChildrenOf(node);
    if (nested !== undefined) {
      walk(nested, skillPath, stack, slugs, headings, examples, diagnostics, constructAnchors);
    }

    i += 1;
  }
}

function isExpectFence(node: RootContent | undefined): node is Code {
  return node !== undefined && node.type === 'code' && node.lang === 'yaml' && (node.meta ?? '').trim() === 'expect';
}

/** Handles the `code` node at the current position; returns how many sibling nodes were consumed (1 or 2). */
function handleCode(
  node: Code,
  next: RootContent | undefined,
  skillPath: string,
  stack: HeadingInfo[],
  examples: Example[],
  diagnostics: ExampleLoadError[],
  constructAnchors: Map<string, ConstructAnchor>,
): number {
  const fenceLine = startLine(node);
  const { fields } = parseInfoString(node.meta);

  if (fields['example'] === undefined) {
    // Not an example fence. A `yaml expect` block that reaches here was not
    // consumed by a preceding positive example: it is an orphan.
    if (isExpectFence(node)) {
      diagnostics.push({
        file: skillPath,
        line: fenceLine,
        message: 'yaml expect block has no preceding positive inline example',
      });
    }
    return 1;
  }

  const missing = REQUIRED_KEYS.filter((key) => fields[key] === undefined);
  if (missing.length > 0) {
    diagnostics.push({
      file: skillPath,
      line: fenceLine,
      message: `inline example info string is missing ${missing.join(', ')} (got "${node.meta ?? ''}")`,
    });
    return 1;
  }

  const polarityValue = fields['example'];
  const constructValue = fields['construct'];
  const idValue = fields['id'];
  if (polarityValue === undefined || constructValue === undefined || idValue === undefined) {
    // Unreachable: `missing` above is empty here, so every required field is present.
    return 1;
  }
  const polarity = polarityValue;
  const construct = constructValue;
  const id = idValue;

  const owner = stack[stack.length - 1];
  if (!constructAnchors.has(construct)) {
    constructAnchors.set(construct, {
      anchor: owner !== undefined ? owner.slug : '',
      headingOffset: owner !== undefined ? owner.offset : 0,
      headingDepth: owner !== undefined ? owner.depth : 0,
    });
  }

  const bodyText = normalizeCode(`${node.value}\n`);
  let expected: ExpectedMatch[] = [];
  let consumed = 1;
  let expectYaml: ParsedYaml | undefined;
  let expectLine: number | undefined;
  let expectAlreadyReported = false;

  if (polarity === 'positive' && isExpectFence(next)) {
    expectLine = startLine(next);
    const expectBody = next.value;
    consumed = 2;
    const parsed = parseExpectBlock(expectBody, skillPath, expectLine);
    if (parsed.ok) {
      expected = parsed.expected;
      const reparsed = parseYaml(expectBody, skillPath, expectLine);
      expectYaml = reparsed.ok ? reparsed.yaml : undefined;
    } else {
      diagnostics.push(...parsed.errors);
      expectAlreadyReported = true;
    }
  }

  const built = buildExample({
    id,
    construct,
    polarity,
    code: bodyText,
    expected,
    source: { kind: 'inline', skill: skillPath, line: fenceLine },
  });

  if (built.ok) {
    examples.push(built.example);
  } else if (!expectAlreadyReported) {
    diagnostics.push(...issuesToDiagnostics(built.issues, skillPath, fenceLine, expectLine, expectYaml));
  }
  // else: the expect block's own YAML/shape was already reported; the
  // resulting "needs at least one expected match" cross-field issue would
  // only repeat that, so it is not reported again.

  return consumed;
}

function issuesToDiagnostics(
  issues: readonly PathIssue[],
  skillPath: string,
  fenceLine: number,
  expectLine: number | undefined,
  expectYaml: ParsedYaml | undefined,
): ExampleLoadError[] {
  return issues.map((issue) => {
    const [head] = issue.path;
    if (head === 'expected') {
      const mapped = expectYaml !== undefined ? yamlIssuesToErrors(expectYaml, skillPath, [issue])[0] : undefined;
      return mapped ?? { file: skillPath, line: expectLine ?? fenceLine, message: describePathIssue(issue) };
    }
    return { file: skillPath, line: fenceLine, message: describePathIssue(issue) };
  });
}
