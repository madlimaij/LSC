import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  JSON_SCHEMA_RELATIVE_PATH,
  serializeRuleSetJsonSchema,
} from '../../src/contract/index.js';
import { invalidFixtures, readJson, REPO_ROOT, STRUCTURAL_RULES, VALID_FIXTURE } from './helpers.js';

const schemaPath = resolve(REPO_ROOT, JSON_SCHEMA_RELATIVE_PATH);

// ajv-formats is CommonJS; depending on interop the default import is the plugin
// itself or the module object carrying it as `default`.
type FormatsPlugin = (ajv: Ajv2020) => unknown;
const addFormats = ((addFormatsModule as unknown as { default?: FormatsPlugin }).default ??
  addFormatsModule) as unknown as FormatsPlugin;

function compile() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv.compile(readJson(schemaPath) as object);
}

describe('contract/rule-set.schema.json', () => {
  it('is up to date with the Zod schema (run `npm run contract:export` if this fails)', () => {
    expect(readFileSync(schemaPath, 'utf8')).toBe(serializeRuleSetJsonSchema());
  });

  it('compiles under a standard JSON Schema 2020-12 validator in strict mode (Ajv)', () => {
    expect(() => compile()).not.toThrow();
  });

  it('accepts the valid fixture', () => {
    const validate = compile();
    const ok = validate(readJson(VALID_FIXTURE));
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });

  const fixtures = invalidFixtures();
  const structural = fixtures.filter((f) => STRUCTURAL_RULES.includes(f.rule));
  const crossField = fixtures.filter((f) => !STRUCTURAL_RULES.includes(f.rule));

  it('has structural and cross-field fixtures to check', () => {
    expect(structural.length).toBeGreaterThan(0);
    expect(crossField.length).toBeGreaterThan(0);
  });

  it.each(structural.map((f) => [f.file, f] as const))('rejects structurally invalid %s', (_f, fixture) => {
    const validate = compile();
    expect(validate(readJson(fixture.path))).toBe(false);
  });

  // These rules are not expressible in JSON Schema (CONTRACT.md §5). The schema
  // accepts the files; only `lsc validate-ruleset` (or a reimplementation) rejects them.
  it.each(crossField.map((f) => [f.file, f] as const))(
    'accepts cross-field fixture %s (needs lsc validate-ruleset)',
    (_f, fixture) => {
      const validate = compile();
      expect(validate(readJson(fixture.path))).toBe(true);
    },
  );
});
