/**
 * Reading a Rule Set file from disk, with readable errors. Used by
 * `lsc validate-ruleset` and by any command that takes a Rule Set path.
 */
import { readFileSync } from 'node:fs';
import { validateRuleSet, type RuleSetValidation } from './validate.js';

export type RuleSetFileResult =
  | RuleSetValidation
  | { readonly ok: false; readonly fileError: string; readonly issues: readonly [] };

/** Reads and validates a Rule Set JSON file. Never throws for bad input. */
export function loadRuleSetFile(path: string): RuleSetFileResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, fileError: `cannot read ${path}: ${reason}`, issues: [] };
  }
  let data: unknown;
  try {
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, fileError: `${path} is not valid JSON: ${reason}`, issues: [] };
  }
  return validateRuleSet(data);
}
