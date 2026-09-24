import { readFileSync } from 'node:fs';

export interface PackageInfo {
  readonly name: string;
  readonly version: string;
}

let cached: PackageInfo | undefined;

/**
 * Reads name and version from the repository's package.json.
 * The relative path is the same from `src/cli/` (tsx, Vitest) and
 * `dist/cli/` (built output), so both resolve to the package root.
 */
export function getPackageInfo(): PackageInfo {
  if (cached === undefined) {
    const url = new URL('../../package.json', import.meta.url);
    const parsed: unknown = JSON.parse(readFileSync(url, 'utf8'));
    const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
      string,
      unknown
    >;
    const { name, version } = record;
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error(`package.json at ${url.pathname} lacks a string name or version`);
    }
    cached = { name, version };
  }
  return cached;
}
