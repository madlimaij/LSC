/**
 * Export (WP-10 brief, plan §7 `lsc export`): turns a draft Rule Set into the
 * Rule Set delivered to Navigator.
 *
 * - Only `validated` rules are kept (plan §5.2; D25 item 5).
 * - `version` is assigned from the diff against the previous export
 *   (contract/CONTRACT.md §3); the first export is `1.0.0`. A draft's
 *   `0.0.0-draft` never survives (D24 g, D25 item 5).
 * - `contractVersion` is stamped with the current `CONTRACT_VERSION`.
 * - Nothing changed since the previous export: the previous Rule Set is
 *   returned as it is (same version, same bytes), so one version always
 *   means one content.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CONTRACT_VERSION, formatIssue, validateRuleSet, type RuleSet } from '../contract/index.js';
import { loadRuleSetFile } from '../contract/load.js';
import { entryHeading, findChangelogEntry, prependChangelogEntry, renderChangelogEntry } from './changelog.js';
import { isReleaseVersion, nextVersion } from './content-version.js';
import { canonicalJson, diffRuleSets, type RuleSetDiff } from './diff.js';

export class ExportError extends Error {
  override readonly name = 'ExportError';
}

export interface ExportInput {
  /** The draft written by `lsc compile` (or any valid Rule Set). */
  readonly draft: RuleSet;
  /** The Rule Set exported last time for this language; omit for the first export. */
  readonly previous?: RuleSet;
}

export interface ExportResult {
  readonly ruleSet: RuleSet;
  readonly version: string;
  readonly previousVersion?: string;
  readonly diff: RuleSetDiff;
  /** Ids of draft rules left out because they are `rejected`. */
  readonly droppedRejected: string[];
  /** True when nothing changed: `ruleSet` is `previous` unchanged and no CHANGELOG entry is due. */
  readonly unchanged: boolean;
  /** The CHANGELOG entry for this version; absent when `unchanged`. */
  readonly changelogEntry?: string;
}

/** Pure export: no file access. Throws `ExportError` for inputs that must not be exported. */
export function exportRuleSet(input: ExportInput): ExportResult {
  const { draft, previous } = input;
  const draftCheck = validateRuleSet(draft);
  if (!draftCheck.ok) {
    throw new ExportError(`the draft is not a valid Rule Set:\n${draftCheck.issues.map((i) => `  ${formatIssue(i)}`).join('\n')}`);
  }
  if (previous !== undefined) {
    const prevCheck = validateRuleSet(previous);
    if (!prevCheck.ok) {
      throw new ExportError(`the previous Rule Set is not valid:\n${prevCheck.issues.map((i) => `  ${formatIssue(i)}`).join('\n')}`);
    }
    if (!isReleaseVersion(previous.version)) {
      throw new ExportError(
        `the previous Rule Set has version ${previous.version}, which is not an exported version; pass the Rule Set written by the last \`lsc export\`, not a draft`,
      );
    }
    if (previous.rules.some((r) => r.status !== 'validated')) {
      throw new ExportError('the previous Rule Set contains rejected rules, so it was not written by `lsc export`; pass the last exported Rule Set');
    }
    if (previous.languageId !== draft.languageId) {
      throw new ExportError(`the previous Rule Set is for language ${previous.languageId}, the draft for ${draft.languageId}`);
    }
  }

  const validated = draft.rules.filter((r) => r.status === 'validated');
  const droppedRejected = draft.rules.filter((r) => r.status !== 'validated').map((r) => r.id);
  if (validated.length === 0) {
    throw new ExportError(
      `the draft has no validated rule${droppedRejected.length > 0 ? ` (rejected: ${droppedRejected.join(', ')})` : ''}; nothing to export`,
    );
  }

  const candidate: RuleSet = { ...draft, contractVersion: CONTRACT_VERSION, rules: validated };
  // The diff gets the full draft: it compares only validated rules anyway, and it needs the
  // rejected ones to say "removed (rejected in the new draft)" in the CHANGELOG.
  const diff = diffRuleSets(previous, { ...draft, contractVersion: CONTRACT_VERSION });

  if (previous !== undefined && diff.bump === 'none') {
    return { ruleSet: previous, version: previous.version, previousVersion: previous.version, diff, droppedRejected, unchanged: true };
  }

  const version = nextVersion(previous?.version, diff.bump);
  const ruleSet: RuleSet = { ...candidate, version };
  const check = validateRuleSet(ruleSet);
  if (!check.ok) {
    // The draft was valid and only `version`, `contractVersion` and the rule list changed: a failure is a bug here.
    throw new Error(`internal error: the exported Rule Set is invalid:\n${check.issues.map(formatIssue).join('\n')}`);
  }
  const changelogEntry = renderChangelogEntry({
    languageId: ruleSet.languageId,
    version,
    ...(previous !== undefined ? { previousVersion: previous.version } : {}),
    compiledAt: ruleSet.compiledAt,
    diff,
    ruleCount: validated.length,
    droppedRejected,
  });
  return {
    ruleSet: check.ruleSet,
    version,
    ...(previous !== undefined ? { previousVersion: previous.version } : {}),
    diff,
    droppedRejected,
    unchanged: false,
    changelogEntry,
  };
}

export interface ExportFilesOptions {
  /** Path of the draft Rule Set, or the draft itself (as `lsc compile --export` has it in memory). */
  readonly draft: string | RuleSet;
  /** The Rule Set file to write. */
  readonly outPath: string;
  /** The last exported Rule Set; required when `outPath` already exists (it is usually the same file). */
  readonly previousPath?: string;
  /** CHANGELOG file; default `CHANGELOG.md` next to `outPath`. */
  readonly changelogPath?: string;
}

export interface ExportFilesResult extends ExportResult {
  readonly outPath: string;
  readonly changelogPath: string;
  /** False when the CHANGELOG already had this exact entry, or nothing changed. A different entry for the same version is refused. */
  readonly changelogUpdated: boolean;
}

/** Default CHANGELOG path: `CHANGELOG.md` in the directory of the exported Rule Set. */
export function defaultChangelogPath(outPath: string): string {
  return join(dirname(outPath), 'CHANGELOG.md');
}

function loadRuleSet(path: string, what: string): RuleSet {
  const loaded = loadRuleSetFile(path);
  if (loaded.ok) return loaded.ruleSet;
  if ('fileError' in loaded) throw new ExportError(`${what}: ${loaded.fileError}`);
  throw new ExportError(`${what}: ${path} is not a valid Rule Set:\n${loaded.issues.map((i) => `  ${formatIssue(i)}`).join('\n')}`);
}

function samePath(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * Refuses an export target that would lose or contradict a delivered version
 * (D31 b, D30 b). Checks only files that exist before the export, so
 * `lsc compile --export` can call it before any model call.
 *
 * - `outPath` does not exist: nothing to check.
 * - `outPath` exists and `previousPath` is undefined: refused (a forgotten
 *   `--previous` would restart at 1.0.0 and overwrite a later version).
 * - `outPath` exists and is the `previousPath` file itself: fine.
 * - `outPath` exists and is another file: it must be a valid Rule Set with
 *   the same content as `previousPath` (key order and whitespace ignored);
 *   otherwise refused, because the export would overwrite a different, maybe
 *   newer, version with one derived from a stale `--previous`.
 *
 * Does not validate `previousPath` as an exported Rule Set beyond loading it;
 * `exportRuleSet` does that. Throws `ExportError`.
 */
export function checkExportTarget(outPath: string, previousPath?: string): void {
  if (!existsSync(outPath)) return;
  if (previousPath === undefined) {
    throw new ExportError(
      `${outPath} already exists; pass --previous <file> (normally that same file) so the new version is derived from it, or remove it to start again at 1.0.0`,
    );
  }
  if (samePath(outPath, previousPath)) return;
  const previous = loadRuleSet(previousPath, 'previous Rule Set');
  const loaded = loadRuleSetFile(outPath);
  if (!loaded.ok) {
    throw new ExportError(`${outPath} already exists and is not a valid Rule Set; refusing to overwrite it (remove it, or choose another --out)`);
  }
  const existing = loaded.ruleSet;
  if (canonicalJson(existing) !== canonicalJson(previous)) {
    const what =
      existing.languageId !== previous.languageId || existing.version !== previous.version
        ? `holds ${existing.languageId} ${existing.version}, but --previous ${previousPath} is ${previous.languageId} ${previous.version}`
        : `holds ${existing.languageId} ${existing.version} with content different from --previous ${previousPath}`;
    throw new ExportError(
      `${outPath} ${what}; the export would overwrite it with a version derived from a stale --previous. Pass --previous ${outPath} (the file being replaced), or choose another --out`,
    );
  }
}

/** Reads the inputs, exports, writes the Rule Set and prepends the CHANGELOG entry. Shared by `lsc export` and `lsc compile --export`. */
export function exportFiles(options: ExportFilesOptions): ExportFilesResult {
  const outPath = resolve(options.outPath);
  const changelogPath = resolve(options.changelogPath ?? defaultChangelogPath(outPath));
  if (typeof options.draft === 'string' && resolve(options.draft) === outPath) {
    throw new ExportError('--out must not be the draft file itself');
  }
  if (changelogPath === outPath) throw new ExportError('the CHANGELOG path must differ from --out');
  checkExportTarget(outPath, options.previousPath);

  const draft = typeof options.draft === 'string' ? loadRuleSet(options.draft, 'draft') : options.draft;
  const previous = options.previousPath !== undefined ? loadRuleSet(options.previousPath, 'previous Rule Set') : undefined;
  const result = exportRuleSet({ draft, ...(previous !== undefined ? { previous } : {}) });

  // CHANGELOG first, before anything is written: one version must never have two different entries (D31 a, D30 b).
  let changelogText: string | undefined;
  if (result.changelogEntry !== undefined) {
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : undefined;
    const heading = entryHeading(result.ruleSet.languageId, result.version);
    const present = findChangelogEntry(existing, heading);
    if (present !== undefined && present !== result.changelogEntry) {
      throw new ExportError(
        `${changelogPath} already has an entry for ${result.ruleSet.languageId} ${result.version} with different content, so ${result.version} was already exported with other rules; ` +
          `pass the Rule Set of the latest exported version as --previous`,
      );
    }
    if (present === undefined) changelogText = prependChangelogEntry(existing, result.changelogEntry, heading).text;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result.ruleSet, null, 2)}\n`, 'utf8');
  if (changelogText !== undefined) {
    mkdirSync(dirname(changelogPath), { recursive: true });
    writeFileSync(changelogPath, changelogText, 'utf8');
  }
  return { ...result, outPath, changelogPath, changelogUpdated: changelogText !== undefined };
}
