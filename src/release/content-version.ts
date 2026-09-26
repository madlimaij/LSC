/**
 * Content version (`version`) assignment (plan §5.1, contract/CONTRACT.md §3).
 * Not the contract version: that is `CONTRACT_VERSION` in src/contract.
 */
import { parseVersion } from '../contract/index.js';
import type { Bump } from './diff.js';

/** Version of the first export of a language (WP-10 brief, CONTRACT.md §3). */
export const FIRST_VERSION = '1.0.0';

export class VersionError extends Error {
  override readonly name = 'VersionError';
}

/**
 * An exported content version: `major.minor.patch`, major ≥ 1, no
 * pre-release or build suffix. `0.0.0-draft` and other suffixed versions
 * belong to drafts.
 */
export function isReleaseVersion(version: string): boolean {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) && (parseVersion(version)?.major ?? 0) >= 1;
}

/**
 * Next content version. `previous` undefined: first export, `1.0.0` whatever
 * the bump. `none`: the previous version is kept (nothing changed).
 */
export function nextVersion(previous: string | undefined, bump: Bump): string {
  if (previous === undefined) return FIRST_VERSION;
  if (!isReleaseVersion(previous)) {
    throw new VersionError(`previous version ${previous} is not an exported version (expected major.minor.patch with major ≥ 1, no suffix)`);
  }
  const v = parseVersion(previous);
  if (v === undefined) throw new VersionError(`previous version ${previous} is not semver`);
  switch (bump) {
    case 'major':
      return `${String(v.major + 1)}.0.0`;
    case 'minor':
      return `${String(v.major)}.${String(v.minor + 1)}.0`;
    case 'patch':
      return `${String(v.major)}.${String(v.minor)}.${String(v.patch + 1)}`;
    case 'none':
      return previous;
  }
}
