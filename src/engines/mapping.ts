/**
 * Match-to-Navigator mapping (WP-04 deliverable): turns `Match[]` into the
 * Navigator collections `RULE_TYPE_SPEC` describes (contract/CONTRACT.md
 * §4), using each match's rule for its `confidence` and type spec.
 *
 * `NormalizedFileAnalysis` itself is Legacy Navigator's type, not part of
 * this contract (contract/CONTRACT.md and src/contract/ do not export it).
 * `NavigatorAnalysis` below has the shape CONTRACT.md §4 describes; see the
 * WP-04 completion note for the mapping choices this makes where the
 * contract leaves the answer open (§9 Q2), and contract/CONTRACT.md §4.1
 * (normative "Mapping rules", added by D20) for the rest, implemented here.
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
 * (contract/CONTRACT.md §4.1):
 * - `low-confidence`: the rule's confidence is `low`; the primary record is
 *   still produced alongside this one (§4.1 item 1).
 * - `ambiguous-capture`: a required capture role's group did not take part
 *   in the match, or captured the empty string (§4.1 item 2, §6.5) — no
 *   primary record. For `module_declaration`/`symbol_definition` this is an
 *   unnamed definition (D19 c): it also opens no scope (`src/engines/blocks.ts`).
 *
 * D19 b / D20 removed the earlier `missing-source-symbol` reason: a
 * relation, db-access or config-ref match with no enclosing symbol now
 * always gets a fallback source (§4.1 item 4) and produces a normal record,
 * never an uncertainty for lack of a source.
 */
export type UncertaintyReason = 'low-confidence' | 'ambiguous-capture';

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

/**
 * A required capture role's value is missing when its group did not take
 * part in the match (`undefined`) or captured the empty string
 * (contract/CONTRACT.md §6.5, §4.1 item 2).
 */
function isBlank(value: string | undefined): boolean {
  return value === undefined || value === '';
}

/**
 * Maps every match to its Navigator record(s), using `rules` for confidence
 * and type spec.
 *
 * `matches` must be one file's matches in file order (as `scanFile`
 * returns them). `file` is that file's repository-relative path with `/`
 * separators (the same string `fileMatchers`, §6.1, matches against) — the
 * fallback source (§4.1 item 4) when a relation/dbAccess/configRef match has
 * no enclosing symbol and no preceding named `module_declaration` match.
 */
export function mapMatches(matches: readonly Match[], rules: readonly Rule[], file: string): NavigatorAnalysis {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule] as const));
  const out = emptyAnalysis();
  // Last *named* module_declaration match seen so far, in file order (§4.1 item 4, §6.6):
  // used regardless of that rule's blockEnd or whether its scope is still open.
  let lastModuleName: string | undefined;

  for (const match of matches) {
    const rule = ruleById.get(match.ruleId);
    if (rule === undefined) continue; // defensive: a match for a rule not in this scan's rule list

    const spec = RULE_TYPE_SPEC[match.type];
    const missingRequired = spec.requiredRoles.some((role) => isBlank(match.captures[role]));

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

    if (match.type === 'module_declaration') lastModuleName = match.captures.name;

    const source = RECORDS_NEEDING_SOURCE.has(spec.navigatorRecord) ? (match.enclosingSymbol ?? lastModuleName ?? file) : undefined;
    pushRecord(out, match, source);
  }

  return out;
}

/**
 * Reads a value the caller has already checked is present (a required
 * capture role, or the resolved source for a record that needs one).
 * Throws rather than silently mapping `undefined` in if that check is ever
 * wrong; callers only reach here once `pushRecord`'s precondition holds.
 */
function required(value: string | undefined, what: string): string {
  if (value === undefined) throw new Error(`internal: ${what} missing after required-value check`);
  return value;
}

/**
 * `source` is the resolved source (§4.1 item 4: enclosing symbol, fallback
 * module name, or the file itself) for `call`, `include`, `db_read`,
 * `db_write` and `config_ref` matches; `undefined` for every other type,
 * which does not use it.
 */
function pushRecord(out: NavigatorAnalysis, match: Match, source: string | undefined): void {
  const { ruleId, line, captures } = match;
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
        source: required(source, 'source'),
        callee: required(captures.callee, 'callee'),
        ...(captures.module !== undefined ? { module: captures.module } : {}),
        line,
        ruleId,
      });
      return;
    case 'include':
      out.relations.push({
        kind: 'includes',
        source: required(source, 'source'),
        target: required(captures.target, 'target'),
        line,
        ruleId,
      });
      return;
    case 'db_read':
      out.dbAccesses.push({
        mode: 'read',
        source: required(source, 'source'),
        table: required(captures.table, 'table'),
        line,
        ruleId,
      });
      return;
    case 'db_write':
      out.dbAccesses.push({
        mode: 'write',
        source: required(source, 'source'),
        table: required(captures.table, 'table'),
        line,
        ruleId,
      });
      return;
    case 'config_ref':
      out.configRefs.push({
        source: required(source, 'source'),
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
