/**
 * Writes contract/rule-set.schema.json. Run with `npm run contract:export`.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSON_SCHEMA_RELATIVE_PATH, serializeRuleSetJsonSchema } from './json-schema.js';

const target = fileURLToPath(new URL(`../../${JSON_SCHEMA_RELATIVE_PATH}`, import.meta.url));
writeFileSync(target, serializeRuleSetJsonSchema(), 'utf8');
process.stdout.write(`wrote ${target}\n`);
