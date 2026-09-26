/**
 * Public API of the validation report (docs/PLAN.md §7, WP-07 brief).
 * `src/cli/commands/report.ts` and `review.ts` import from here.
 */
export * from './model.js';
export * from './build.js';
export * from './markdown.js';
export * from './html.js';
export * from './confidence-reason.js';
export * from './rule-status.js';
export * from './pattern.js';
export * from './example-location.js';
export * from './review-session.js';
export * from './load-results.js';
