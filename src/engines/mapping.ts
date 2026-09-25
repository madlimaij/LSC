/**
 * Match-to-Navigator mapping (WP-04 deliverable): turns `Match[]` into the
 * Navigator collections `RULE_TYPE_SPEC` describes (contract/CONTRACT.md
 * §4), using each match's rule for its `confidence` and type spec.
 *
 * `NormalizedFileAnalysis` itself is Legacy Navigator's type, not part of
 * this contract (contract/CONTRACT.md and src/contract/ do not export it).
 * `NavigatorAnalysis` below has the shape CONTRACT.md §4 describes; see the
 * WP-04 completion note for the mapping choices this makes where the
 * contract leaves the answer open (§9 Q2, Q3).
 */
import { RULE_TYPE_SPEC, type CaptureRole, type Rule, type RuleType } from '../contract/index.js';
import type { Match } from './types.js';

export interface SymbolRecord {
  readonly kind: 'module' | 'function' | 'procedure';
  readonly name: string;
  readonly line: number;
  readonly ruleId: string;
}

export type RelationRecord =
  | {
      readonly kind: 'calls';
      readonly source: string;
      readonly callee: string;
      readonly module?: string;
      readonly line: number;
      readonly ruleId: string;
    }
  | {
      readonly kind: 'includes';
      readonly source: string;
      readonly target: string;
      readonly line: number;
      readonly ruleId: string;
    };

export interface DbAccessRecord {
  readonly mode: 'read' | 'write';
  readonly source: string;
  readonly table: string;
  readonly line: number;
  readonly ruleId: string;
}

export interface ConfigRefRecord {
  readonly source: string;
  readonly key: string;
  readonly line: number;
  readonly ruleId: string;
}

export interface EntryPointRecord {
  readonly name: string;
  readonly kind?: string;
  readonly line: number;
  readonly ruleId: string;
}

/**
 * Why a match also (or only) produced an `uncertainties` record
 * (contract/CONTRACT.md §4):
 * - `low-confidence`: the rule's confidence is `low`; the primary record is
 *   still produced alongside this one.
 * - `ambiguous-capture`: a required capture role's group did not take part
 *   in the match (§9 Q3's proposal: no primary record, an uncertainty instead).
 * - `missing-source-symbol`: the match needs a source symbol (relations,
 *   dbAccesses, configRefs; §4) but no definition scope was open at its
 *   position — same treatment as `ambiguous-capture`. The contract does not
 *   name this case explicitly; see the completion note.
 */
export type UncertaintyReason = 'low-confidence' | 'ambiguous-capture' | 'missing-source-symbol';

export interface UncertaintyRecord {
  readonly ruleId: string;
  readonly type: RuleType;
  readonly line: number;
  readonly reason: UncertaintyReason;
  readonly captures: Partial<Record<CaptureRole, string>>;
}

export interface NavigatorAnalysis {
  readonly symbols: SymbolRecord[];
  readonly relations: RelationRecord[];
  readonly dbAccesses: DbAccessRecord[];
  readonly configRefs: ConfigRefRecord[];
  readonly entryPoints: EntryPointRecord[];
  readonly uncertainties: UncertaintyRecord[];
}

const RECORDS_NEEDING_SOURCE = new Set(['relations', 'dbAccesses', 'configRefs']);

/**
 * `symbol_definition`'s Navigator kind (`function` vs `procedure`) from the
 * optional `kind` capture. Not decided by the contract (§9 Q2); this is the
 * proposal it records: the capture text is recognised case-insensitively by
 * its first four letters (`func...` / `function` → `function`), default to
 * `procedure` otherwise, so it covers both toylang's `FUNC`/`PROC` keywords
 * and the full words, without a per-language mapping field (which does not
 * exist yet).
 */
function resolveSymbolKind(kindCapture: string | undefined): 'function' | 'procedure' {
  return kindCapture !== undefined && kindCapture.toLowerCase().startsWith('func') ? 'function' : 'procedure';
}

function emptyAnalysis(): NavigatorAnalysis {
  return { symbols: [], relations: [], dbAccesses: [], configRefs: [], entryPoints: [], uncertainties: [] };
}

/** Maps every match to its Navigator record(s), using `rules` for confidence and type spec. */
export function mapMatches(matches: readonly Match[], rules: readonly Rule[]): NavigatorAnalysis {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule] as const));
  const out = emptyAnalysis();

  for (const match of matches) {
    const rule = ruleById.get(match.ruleId);
    if (rule === undefined) continue; // defensive: a match for a rule not in this scan's rule list

    const spec = RULE_TYPE_SPEC[match.type];
    const missingRequired = spec.requiredRoles.some((role) => match.captures[role] === undefined);
    const missingSource = RECORDS_NEEDING_SOURCE.has(spec.navigatorRecord) && match.enclosingSymbol === undefined;

    if (rule.confidence === 'low') {
      out.uncertainties.push({
        ruleId: match.ruleId,
        type: match.type,
        line: match.line,
        reason: 'low-confidence',
        captures: match.captures,
      });
    }

    if (missingRequired) {
      out.uncertainties.push({
        ruleId: match.ruleId,
        type: match.type,
        line: match.line,
        reason: 'ambiguous-capture',
        captures: match.captures,
      });
      continue;
    }
    if (missingSource) {
      out.uncertainties.push({
        ruleId: match.ruleId,
        type: match.type,
        line: match.line,
        reason: 'missing-source-symbol',
        captures: match.captures,
      });
      continue;
    }

    pushRecord(out, match);
  }

  return out;
}

/**
 * Reads a value the caller has already checked is present (a required
 * capture role, or the enclosing symbol for a record that needs a source).
 * Throws rather than silently mapping `undefined` in if that check is ever
 * wrong; callers only reach here once `pushRecord`'s precondition holds.
 */
function required(value: string | undefined, what: string): string {
  if (value === undefined) throw new Error(`internal: ${what} missing after required-value check`);
  return value;
}

function pushRecord(out: NavigatorAnalysis, match: Match): void {
  const { ruleId, line, captures, enclosingSymbol } = match;
  switch (match.type) {
    case 'module_declaration':
      out.symbols.push({ kind: 'module', name: required(captures.name, 'name'), line, ruleId });
      return;
    case 'symbol_definition':
      out.symbols.push({
        kind: resolveSymbolKind(captures.kind),
        name: required(captures.name, 'name'),
        line,
        ruleId,
      });
      return;
    case 'call':
      out.relations.push({
        kind: 'calls',
        source: required(enclosingSymbol, 'enclosingSymbol'),
        callee: required(captures.callee, 'callee'),
        ...(captures.module !== undefined ? { module: captures.module } : {}),
        line,
        ruleId,
      });
      return;
    case 'include':
      out.relations.push({
        kind: 'includes',
        source: required(enclosingSymbol, 'enclosingSymbol'),
        target: required(captures.target, 'target'),
        line,
        ruleId,
      });
      return;
    case 'db_read':
      out.dbAccesses.push({
        mode: 'read',
        source: required(enclosingSymbol, 'enclosingSymbol'),
        table: required(captures.table, 'table'),
        line,
        ruleId,
      });
      return;
    case 'db_write':
      out.dbAccesses.push({
        mode: 'write',
        source: required(enclosingSymbol, 'enclosingSymbol'),
        table: required(captures.table, 'table'),
        line,
        ruleId,
      });
      return;
    case 'config_ref':
      out.configRefs.push({
        source: required(enclosingSymbol, 'enclosingSymbol'),
        key: required(captures.key, 'key'),
        line,
        ruleId,
      });
      return;
    case 'entry_point':
      out.entryPoints.push({
        name: required(captures.name, 'name'),
        ...(captures.kind !== undefined ? { kind: captures.kind } : {}),
        line,
        ruleId,
      });
      return;
  }
}
