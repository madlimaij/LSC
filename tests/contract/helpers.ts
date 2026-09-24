import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VALIDATION_RULES, type ValidationRule } from '../../src/contract/index.js';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');
export const VALID_FIXTURE = resolve(REPO_ROOT, 'contract/fixtures/toylang.ruleset.json');
export const INVALID_DIR = resolve(REPO_ROOT, 'contract/fixtures/invalid');

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export interface InvalidFixture {
  readonly file: string;
  readonly path: string;
  /** Validation rule the fixture violates, taken from the file name `<rule>--<variant>.json`. */
  readonly rule: ValidationRule;
}

/** Every invalid fixture. Throws if a file name does not start with a known rule code. */
export function invalidFixtures(): InvalidFixture[] {
  return readdirSync(INVALID_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const code = file.split('--')[0];
      const rule = VALIDATION_RULES.find((r) => r === code);
      if (rule === undefined || !file.includes('--')) {
        throw new Error(`Invalid fixture ${file} must be named <rule>--<variant>.json with a known rule`);
      }
      return { file, path: resolve(INVALID_DIR, file), rule };
    });
}

/** Rules whose violations are structural (also rejected by the JSON Schema). */
export const STRUCTURAL_RULES: readonly ValidationRule[] = ['schema', 'contract-version'];
