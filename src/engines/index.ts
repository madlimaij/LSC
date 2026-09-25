/**
 * Public API of the rule engines (docs/PLAN.md §7, contract/CONTRACT.md §6).
 * Other modules (src/runner, src/report, ...) import from here.
 */
export * from './types.js';
export * from './lines.js';
export * from './masking.js';
export * from './prepare.js';
export * from './regex-run.js';
export * from './match-rule.js';
export * from './blocks.js';
export * from './mapping.js';
