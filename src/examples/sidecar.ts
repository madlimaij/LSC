/**
 * Sidecar example loader (docs/PLAN.md §6.1).
 *
 * Layout: `<examplesDir>/<construct>/<id>.<ext>` holds the code and
 * `<examplesDir>/<construct>/<id>.expect.yaml` holds the labels. Every code
 * file needs exactly one expect file and the reverse. Files and directories
 * whose names start with `.` are ignored.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildExample, SidecarExpectSchema } from './build.js';
import { describePathIssue, type ExampleLoadError, PARSE_OPTIONS, zodPathIssues } from './errors.js';
import {
  compareExamples,
  CONSTRUCT_ID_PATTERN,
  EXAMPLE_ID_PATTERN,
  normalizeCode,
  type Example,
} from './schema.js';
import { parseYaml, yamlIssuesToErrors } from './yaml-file.js';

export const EXPECT_SUFFIX = '.expect.yaml';

export interface LoadExamplesResult {
  /** Valid examples, sorted by construct then id. */
  readonly examples: Example[];
  /** Every problem found, sorted by file then line. Empty when all files are valid. */
  readonly errors: ExampleLoadError[];
}

export interface LoadSidecarOptions {
  /** When true, a missing examples directory gives no examples and no error. Default false. */
  readonly allowMissing?: boolean;
}

interface Pair {
  codeFiles: string[];
  expectFile?: string;
}

/** Loads every sidecar example under `examplesDir`. Never throws for bad input. */
export function loadSidecarExamples(examplesDir: string, options: LoadSidecarOptions = {}): LoadExamplesResult {
  const errors: ExampleLoadError[] = [];
  const examples: Example[] = [];

  const rootEntries = listDir(examplesDir);
  if (rootEntries === undefined) {
    if (options.allowMissing !== true) {
      errors.push({ file: examplesDir, message: 'examples directory does not exist or cannot be read' });
    }
    return { examples, errors };
  }

  for (const construct of rootEntries) {
    const constructPath = join(examplesDir, construct);
    if (!isDirectory(constructPath)) {
      errors.push({
        file: constructPath,
        message: 'sidecar files must be inside a construct directory: examples/<construct>/<id>.<ext>',
      });
      continue;
    }
    if (!CONSTRUCT_ID_PATTERN.test(construct)) {
      errors.push({
        file: constructPath,
        message: `construct directory name "${construct}" must be a kebab-case construct id, e.g. "proc-definition"`,
      });
      continue;
    }
    const pairs = collectPairs(constructPath, construct, errors);
    for (const [id, pair] of pairs) {
      const example = loadPair(examplesDir, construct, id, pair, errors);
      if (example !== undefined) examples.push(example);
    }
  }

  const unique = dropDuplicateIds(examples, examplesDir, errors);
  unique.sort(compareExamples);
  errors.sort(compareErrors);
  return { examples: unique, errors };
}

function collectPairs(constructPath: string, construct: string, errors: ExampleLoadError[]): Map<string, Pair> {
  const pairs = new Map<string, Pair>();
  for (const name of listDir(constructPath) ?? []) {
    const filePath = join(constructPath, name);
    if (isDirectory(filePath)) {
      errors.push({
        file: filePath,
        message: `nested directories are not allowed; put files directly in examples/${construct}/`,
      });
      continue;
    }
    const dot = name.indexOf('.');
    const id = dot === -1 ? name : name.slice(0, dot);
    const extension = dot === -1 ? '' : name.slice(dot + 1);
    if (!EXAMPLE_ID_PATTERN.test(id)) {
      errors.push({
        file: filePath,
        message: `file name must be <id>.<ext> or <id>${EXPECT_SUFFIX} with a kebab-case id, e.g. "proc-01.tl"`,
      });
      continue;
    }
    if (extension === 'expect.yml' || extension === 'expect.json') {
      errors.push({ file: filePath, message: `expect files must be named <id>${EXPECT_SUFFIX}` });
      continue;
    }
    if (extension === '') {
      errors.push({ file: filePath, message: 'code file needs an extension: <id>.<ext>' });
      continue;
    }
    const pair = pairs.get(id) ?? { codeFiles: [] };
    if (name.endsWith(EXPECT_SUFFIX) && name === `${id}${EXPECT_SUFFIX}`) pair.expectFile = name;
    else pair.codeFiles.push(name);
    pairs.set(id, pair);
  }
  return new Map([...pairs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function loadPair(
  examplesDir: string,
  construct: string,
  id: string,
  pair: Pair,
  errors: ExampleLoadError[],
): Example | undefined {
  const dir = join(examplesDir, construct);
  const [codeName, ...extraCode] = pair.codeFiles.sort();
  if (pair.expectFile === undefined) {
    for (const name of pair.codeFiles) {
      errors.push({ file: join(dir, name), message: `missing expect file ${id}${EXPECT_SUFFIX}` });
    }
    return undefined;
  }
  const expectPath = join(dir, pair.expectFile);
  if (codeName === undefined) {
    errors.push({ file: expectPath, message: `missing code file ${id}.<ext> for this expect file` });
    return undefined;
  }
  if (extraCode.length > 0) {
    errors.push({
      file: join(dir, codeName),
      message: `more than one code file for example "${id}": ${[codeName, ...extraCode].join(', ')}`,
    });
    return undefined;
  }
  const codePath = join(dir, codeName);

  const codeText = readText(codePath, errors);
  const expectText = readText(expectPath, errors);
  if (codeText === undefined || expectText === undefined) return undefined;

  const parsed = parseYaml(normalizeCode(expectText), expectPath);
  if (!parsed.ok) {
    errors.push(...parsed.errors);
    return undefined;
  }
  const { yaml } = parsed;
  if (yaml.data === null || yaml.data === undefined) {
    errors.push({ file: expectPath, message: 'expect file is empty; it needs at least "polarity"' });
    return undefined;
  }
  const expect = SidecarExpectSchema.safeParse(yaml.data, PARSE_OPTIONS);
  if (!expect.success) {
    errors.push(...yamlIssuesToErrors(yaml, expectPath, zodPathIssues(expect.error)));
    return undefined;
  }

  const built = buildExample({
    id,
    construct,
    polarity: expect.data.polarity,
    code: normalizeCode(codeText),
    expected: expect.data.expected ?? [],
    source: { kind: 'sidecar', file: `${construct}/${codeName}`, expectFile: `${construct}/${pair.expectFile}` },
  });
  if (built.ok) return built.example;

  for (const issue of built.issues) {
    const [head] = issue.path;
    if (head === 'expected' || head === 'polarity') {
      errors.push(...yamlIssuesToErrors(yaml, expectPath, [issue]));
    } else {
      errors.push({ file: codePath, message: describePathIssue(issue) });
    }
  }
  return undefined;
}

/** Removes every example whose id occurs more than once and reports each such id. */
function dropDuplicateIds(examples: readonly Example[], examplesDir: string, errors: ExampleLoadError[]): Example[] {
  const byId = new Map<string, Example[]>();
  for (const example of examples) byId.set(example.id, [...(byId.get(example.id) ?? []), example]);
  const duplicated = new Set<string>();
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    duplicated.add(id);
    const files = list.map((e) => (e.source.kind === 'sidecar' ? e.source.file : e.construct)).sort();
    errors.push({
      file: examplesDir,
      message: `example id "${id}" is used more than once (${files.join(', ')}); ids must be unique across constructs`,
    });
  }
  return examples.filter((e) => !duplicated.has(e.id));
}

function listDir(path: string): string[] | undefined {
  try {
    return readdirSync(path)
      .filter((name) => !name.startsWith('.'))
      .sort();
  } catch {
    return undefined;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readText(path: string, errors: ExampleLoadError[]): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push({ file: path, message: `cannot read file: ${reason}` });
    return undefined;
  }
}

export function compareErrors(a: ExampleLoadError, b: ExampleLoadError): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  return (a.line ?? 0) - (b.line ?? 0);
}
