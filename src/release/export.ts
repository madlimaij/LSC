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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CONTRACT_VERSION, formatIssue, validateRuleSet, type RuleSet } from '../contract/index.js';
import { loadRuleSetFile } from '../contract/load.js';
import { entryHeading, prependChangelogEntry, renderChangelogEntry } from './changelog.js';
import { isReleaseVersion, nextVersion } from './content-version.js';
import { diffRuleSets, type RuleSetDiff } from './diff.js';

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
  const diff = diffRuleSets(previous, candidate);

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
  /** False when the CHANGELOG already had this version's entry, or nothing changed. */
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

/** Reads the inputs, exports, writes the Rule Set and prepends the CHANGELOG entry. Shared by `lsc export` and `lsc compile --export`. */
export function exportFiles(options: ExportFilesOptions): ExportFilesResult {
  const outPath = resolve(options.outPath);
  const changelogPath = resolve(options.changelogPath ?? defaultChangelogPath(outPath));
  if (typeof options.draft === 'string' && resolve(options.draft) === outPath) {
    throw new ExportError('--out must not be the draft file itself');
  }
  if (changelogPath === outPath) throw new ExportError('the CHANGELOG path must differ from --out');
  if (options.previousPath === undefined && existsSync(outPath)) {
    throw new ExportError(
      `${options.outPath} already exists; pass --previous <file> (normally that same file) so the new version is derived from it, or remove it to start again at 1.0.0`,
    );
  }

  const draft = typeof options.draft === 'string' ? loadRuleSet(options.draft, 'draft') : options.draft;
  const previous = options.previousPath !== undefined ? loadRuleSet(options.previousPath, 'previous Rule Set') : undefined;
  const result = exportRuleSet({ draft, ...(previous !== undefined ? { previous } : {}) });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(result.ruleSet, null, 2)}\n`, 'utf8');

  let changelogUpdated = false;
  if (result.changelogEntry !== undefined) {
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : undefined;
    const { text, added } = prependChangelogEntry(existing, result.changelogEntry, entryHeading(result.ruleSet.languageId, result.version));
    if (added) {
      mkdirSync(dirname(changelogPath), { recursive: true });
      writeFileSync(changelogPath, text, 'utf8');
      changelogUpdated = true;
    }
  }
  return { ...result, outPath, changelogPath, changelogUpdated };
}
