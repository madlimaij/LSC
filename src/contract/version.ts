/**
 * Contract version handling (docs/PLAN.md §5.1, contract/CONTRACT.md §2).
 *
 * `CONTRACT_VERSION` is the version of the Rule Set *format*. It changes only
 * through the procedure in contract/CONTRACT.md §8: bump here, re-export the
 * JSON Schema (`npm run contract:export`) and add a docs/DECISIONS.md entry.
 */

export const CONTRACT_VERSION = '1.0.2';

/** Semantic Versioning 2.0.0 (https://semver.org), capture groups made non-capturing. */
export const SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][a-zA-Z0-9-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

export interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Parses the `major.minor.patch` core of a semver string; returns undefined if it is not semver. */
export function parseVersion(version: string): ParsedVersion | undefined {
  if (!SEMVER_PATTERN.test(version)) return undefined;
  const core = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (core === null) return undefined;
  return { major: Number(core[1]), minor: Number(core[2]), patch: Number(core[3]) };
}

function mustParse(version: string): ParsedVersion {
  const parsed = parseVersion(version);
  if (parsed === undefined) throw new Error(`Invalid built-in contract version ${version}`);
  return parsed;
}

const CURRENT = mustParse(CONTRACT_VERSION);

/**
 * `contractVersion` values this validator accepts: same major, a minor not newer
 * than ours, any patch, no pre-release or build suffix. Newer minors may carry
 * rule types or fields this validator does not know, so they are rejected
 * instead of being half-understood (contract/CONTRACT.md §2).
 */
function supportedMinorAlternation(maxMinor: number): string {
  const minors = Array.from({ length: maxMinor + 1 }, (_, i) => String(i));
  return minors.length === 1 ? (minors[0] ?? '0') : `(?:${minors.join('|')})`;
}

export const SUPPORTED_CONTRACT_VERSION_PATTERN = new RegExp(
  `^${String(CURRENT.major)}\\.${supportedMinorAlternation(CURRENT.minor)}\\.(?:0|[1-9]\\d*)$`,
);

/** Human-readable description of the accepted range, used in error messages. */
export const SUPPORTED_CONTRACT_VERSION_RANGE =
  CURRENT.minor === 0
    ? `${String(CURRENT.major)}.0.x`
    : `${String(CURRENT.major)}.0.x – ${String(CURRENT.major)}.${String(CURRENT.minor)}.x`;

export function isSupportedContractVersion(version: string): boolean {
  return SUPPORTED_CONTRACT_VERSION_PATTERN.test(version);
}
