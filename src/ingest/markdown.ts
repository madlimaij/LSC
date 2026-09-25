/**
 * Markdown parsing (unified + remark-parse, never regex over Markdown, per
 * CLAUDE.md). Everything downstream works on the resulting mdast tree.
 */
import type { Code, Heading, Root, RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

const processor = unified().use(remarkParse);

/** Parses Markdown text into an mdast tree (syntax only, no transforms). */
export function parseMarkdown(text: string): Root {
  return processor.parse(text);
}

export function isHeading(node: RootContent): node is Heading {
  return node.type === 'heading';
}

export function isCode(node: RootContent): node is Code {
  return node.type === 'code';
}

/** Plain text of a heading, the way a reader would say it: inline formatting is flattened. */
export function headingText(node: Heading): string {
  return node.children.map(inlineText).join('');
}

function inlineText(node: { type: string; value?: string; children?: unknown[] }): string {
  if (typeof node.value === 'string') return node.value;
  if (Array.isArray(node.children)) {
    return node.children.map((child) => inlineText(child as { type: string; value?: string; children?: unknown[] })).join('');
  }
  return '';
}

/** 1-based start line of a node; `0` if position information is missing (should not happen for parsed input). */
export function startLine(node: RootContent): number {
  return node.position?.start.line ?? 0;
}

/** Start byte offset of a node into the parsed text; `0` if missing. */
export function startOffset(node: RootContent): number {
  return node.position?.start.offset ?? 0;
}
