/**
 * Block tracking (D4, contract/CONTRACT.md §6.6): definition rules with
 * `blockEnd` open and close scopes; every match gets `enclosingSymbol` =
 * innermost still-open scope (any rule) at its start position.
 *
 * D19 c / D20 (contract/CONTRACT.md §6.6): an **unnamed** definition (its
 * `name` capture missing or empty) opens no scope, even when its rule has
 * `blockEnd` — matches after it keep whatever scope was innermost before it.
 * Its `blockEnd` match, if any, is still processed like any other `blockEnd`
 * of that rule (closes the most recently opened, still-open scope of the
 * same rule; ignored with a warning if none is open) — so with nested
 * same-rule definitions, an unnamed inner definition's end can close the
 * outer scope early. This is the contract's adopted behaviour (§9 Q9 b), not
 * a bug: the alternative (a transparent anonymous scope) would contradict
 * "opens no scope".
 */
import type { Rule } from '../contract/index.js';
import { matchBlockEnd, matchRule } from './match-rule.js';
import type { PreparedFile } from './prepare.js';
import type { BlockWarning, Match, ScanResult } from './types.js';

interface Scope {
  readonly ruleId: string;
  readonly name: string | undefined;
  readonly line: number;
  readonly column: number;
}

interface RuleEventBase {
  readonly line: number;
  readonly column: number;
  /** Position of the owning rule in the input list; used for a stable, deterministic order among events at the same position. */
  readonly ruleIndex: number;
  readonly rule: Rule;
}

type RuleEvent = (RuleEventBase & { readonly kind: 'match'; readonly match: Match }) | (RuleEventBase & { readonly kind: 'close' });

/** `blockEnd` matches are processed before rule matches at the same position (§6.6). */
function eventRank(kind: RuleEvent['kind']): number {
  return kind === 'close' ? 0 : 1;
}

function compareEvents(a: RuleEvent, b: RuleEvent): number {
  return a.line - b.line || a.column - b.column || eventRank(a.kind) - eventRank(b.kind) || a.ruleIndex - b.ruleIndex;
}

/**
 * Applies every rule in `rules` (already selected for this file) to `file`,
 * tracks block scopes across all of them, and returns every match with its
 * `enclosingSymbol` set, plus warnings for unmatched or unclosed blocks.
 * Rules are matched in the order given, but the merged matches are returned
 * in file order (contract/CONTRACT.md §6.6 "processed in order of their
 * start position").
 */
export function scanFile(rules: readonly Rule[], file: PreparedFile): ScanResult {
  const events: RuleEvent[] = [];

  rules.forEach((rule, ruleIndex) => {
    for (const match of matchRule(rule, file)) {
      events.push({ kind: 'match', line: match.line, column: match.column, ruleIndex, rule, match });
    }
    if (rule.blockEnd !== undefined) {
      for (const close of matchBlockEnd(rule, rule.blockEnd, file)) {
        events.push({ kind: 'close', line: close.line, column: close.column, ruleIndex, rule });
      }
    }
  });

  events.sort(compareEvents);

  const perRuleStack = new Map<string, Scope[]>();
  const openScopes: Scope[] = [];
  const warnings: BlockWarning[] = [];
  const matches: Match[] = [];

  for (const event of events) {
    if (event.kind === 'close') {
      const stack = perRuleStack.get(event.rule.id);
      const scope = stack?.pop();
      if (scope === undefined) {
        warnings.push({
          kind: 'unmatched-block-end',
          ruleId: event.rule.id,
          line: event.line,
          column: event.column,
          message: `blockEnd of rule "${event.rule.id}" at line ${String(event.line)} has no open scope of that rule`,
        });
        continue;
      }
      const index = openScopes.indexOf(scope);
      if (index !== -1) openScopes.splice(index, 1);
      continue;
    }

    const { match, rule } = event;
    const innermost = openScopes[openScopes.length - 1];
    matches.push(innermost?.name !== undefined ? { ...match, enclosingSymbol: innermost.name } : match);

    if (rule.blockEnd !== undefined && (rule.type === 'module_declaration' || rule.type === 'symbol_definition')) {
      const rawName = match.captures.name;
      // A missing or empty `name` capture (contract/CONTRACT.md §6.5) is an unnamed definition (D19 c):
      // its scope is tracked for blockEnd pairing (perRuleStack) but never exposed as an enclosing
      // symbol (openScopes), and matches after it keep the previously innermost scope.
      const name = rawName !== undefined && rawName !== '' ? rawName : undefined;
      const scope: Scope = { ruleId: rule.id, name, line: match.line, column: match.column };
      const stack = perRuleStack.get(rule.id);
      if (stack === undefined) perRuleStack.set(rule.id, [scope]);
      else stack.push(scope);
      if (name !== undefined) openScopes.push(scope);
    }
  }

  for (const stack of perRuleStack.values()) {
    for (const scope of stack) {
      warnings.push({
        kind: 'unclosed-block',
        ruleId: scope.ruleId,
        line: scope.line,
        column: scope.column,
        message: `scope opened by rule "${scope.ruleId}" at line ${String(scope.line)} is never closed (end of file)`,
      });
    }
  }

  return { matches, warnings };
}
