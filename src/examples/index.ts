/**
 * Public API of the example format (docs/PLAN.md §6.1). Other modules import
 * from here. Format reference: src/examples/README.md.
 */
export * from './schema.js';
export * from './errors.js';
export * from './build.js';
export * from './sidecar.js';
export * from './reviews.js';
export * from './locations.js';
export { parseYaml, yamlIssuesToErrors, type ParsedYaml, type YamlParseResult } from './yaml-file.js';
