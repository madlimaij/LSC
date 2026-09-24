/**
 * YAML parsing that remembers where each value came from, so schema errors can
 * point at a line in the file.
 */
import { isNode, LineCounter, parseDocument, type Document } from 'yaml';
import type { ExampleLoadError, IssuePath, PathIssue } from './errors.js';
import { describePathIssue } from './errors.js';

export interface ParsedYaml {
  readonly data: unknown;
  /** 1-based line of the value at `path`, or of its nearest existing ancestor. */
  lineOf(path: IssuePath): number | undefined;
}

export type YamlParseResult =
  | { readonly ok: true; readonly yaml: ParsedYaml }
  | { readonly ok: false; readonly errors: ExampleLoadError[] };

/**
 * Parses YAML text. `file` is used only in error messages. Syntax errors and
 * duplicate keys are errors; the document is not used when there are any.
 * `lineOffset` is added to every reported line (for YAML embedded in another
 * file, e.g. a `yaml expect` block in a Skill file).
 */
export function parseYaml(text: string, file: string, lineOffset = 0): YamlParseResult {
  const lineCounter = new LineCounter();
  let doc: Document.Parsed;
  try {
    doc = parseDocument(text, { lineCounter, uniqueKeys: true, prettyErrors: false });
  } catch (error) {
    // parseDocument reports problems in doc.errors; this is only a safety net.
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [{ file, message: `invalid YAML: ${reason}` }] };
  }
  const lineAt = (offset: number): number => lineCounter.linePos(offset).line + lineOffset;
  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((e) => ({
        file,
        line: lineAt(e.pos[0]),
        message: `invalid YAML: ${firstLine(e.message)}`,
      })),
    };
  }
  const lineOf = (path: IssuePath): number | undefined => {
    for (let depth = path.length; depth >= 0; depth -= 1) {
      const node: unknown = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
      if (isNode(node) && node.range !== undefined && node.range !== null) return lineAt(node.range[0]);
    }
    return undefined;
  };
  return { ok: true, yaml: { data: doc.toJS({ maxAliasCount: 100 }) as unknown, lineOf } };
}

function firstLine(message: string): string {
  const line = message.split('\n')[0] ?? message;
  // The yaml package appends " at line N, column M"; the line is reported separately.
  return line.replace(/ at line \d+, column \d+:?$/, '');
}

/** Maps path issues inside a YAML document to load errors with line numbers. */
export function yamlIssuesToErrors(
  yaml: ParsedYaml,
  file: string,
  issues: readonly PathIssue[],
  pathPrefix: IssuePath = [],
): ExampleLoadError[] {
  return issues.map((issue) => {
    const line = yaml.lineOf([...pathPrefix, ...issue.path]);
    const message = describePathIssue({ path: [...pathPrefix, ...issue.path], message: issue.message });
    return line === undefined ? { file, message } : { file, line, message };
  });
}
