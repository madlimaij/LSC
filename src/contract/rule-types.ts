/**
 * Rule types and their mapping to Legacy Navigator records (docs/PLAN.md §5.3).
 *
 * `branch_marker` and `exit` are deliberately absent (D1). Adding a rule type
 * later is a minor contract version bump (contract/CONTRACT.md §8).
 */

export const RULE_TYPES = [
  'module_declaration',
  'symbol_definition',
  'call',
  'include',
  'db_read',
  'db_write',
  'config_ref',
  'entry_point',
] as const;

export type RuleType = (typeof RULE_TYPES)[number];

/** Every capture role any rule type uses. */
export const CAPTURE_ROLES = ['name', 'kind', 'callee', 'module', 'target', 'table', 'key'] as const;

export type CaptureRole = (typeof CAPTURE_ROLES)[number];

/** Top-level collections of Navigator's `NormalizedFileAnalysis`. */
export type NavigatorRecord =
  | 'symbols'
  | 'relations'
  | 'dbAccesses'
  | 'configRefs'
  | 'entryPoints';

export interface RuleTypeSpec {
  /** Navigator collection a match of this type is written to. */
  readonly navigatorRecord: NavigatorRecord;
  /**
   * Field of the Navigator record that carries the kind/mode (`kind` or `mode`),
   * or null when the record has no such field set by the mapping.
   */
  readonly navigatorKindField: 'kind' | 'mode' | null;
  /**
   * Values of `navigatorKindField`:
   * - one value: fixed for every match (e.g. `calls`, `read`);
   * - several values (`symbol_definition`): chosen per match from the optional
   *   `kind` capture (mapping is an open question, contract/CONTRACT.md §9 Q2);
   * - empty with a kind field (`entry_point`): the optional `kind` capture's
   *   text is passed through when present.
   */
  readonly navigatorKinds: readonly string[];
  /** Roles every rule of this type must map in `captures`. */
  readonly requiredRoles: readonly CaptureRole[];
  /** Roles a rule of this type may additionally map. No other roles are allowed. */
  readonly optionalRoles: readonly CaptureRole[];
  /** Whether rules of this type may declare `blockEnd` (D4). */
  readonly allowsBlockEnd: boolean;
}

export const RULE_TYPE_SPEC: Readonly<Record<RuleType, RuleTypeSpec>> = {
  module_declaration: {
    navigatorRecord: 'symbols',
    navigatorKindField: 'kind',
    navigatorKinds: ['module'],
    requiredRoles: ['name'],
    optionalRoles: [],
    allowsBlockEnd: true,
  },
  symbol_definition: {
    navigatorRecord: 'symbols',
    navigatorKindField: 'kind',
    navigatorKinds: ['function', 'procedure'],
    requiredRoles: ['name'],
    optionalRoles: ['kind'],
    allowsBlockEnd: true,
  },
  call: {
    navigatorRecord: 'relations',
    navigatorKindField: 'kind',
    navigatorKinds: ['calls'],
    requiredRoles: ['callee'],
    optionalRoles: ['module'],
    allowsBlockEnd: false,
  },
  include: {
    navigatorRecord: 'relations',
    navigatorKindField: 'kind',
    navigatorKinds: ['includes'],
    requiredRoles: ['target'],
    optionalRoles: [],
    allowsBlockEnd: false,
  },
  db_read: {
    navigatorRecord: 'dbAccesses',
    navigatorKindField: 'mode',
    navigatorKinds: ['read'],
    requiredRoles: ['table'],
    optionalRoles: [],
    allowsBlockEnd: false,
  },
  db_write: {
    navigatorRecord: 'dbAccesses',
    navigatorKindField: 'mode',
    navigatorKinds: ['write'],
    requiredRoles: ['table'],
    optionalRoles: [],
    allowsBlockEnd: false,
  },
  config_ref: {
    navigatorRecord: 'configRefs',
    navigatorKindField: null,
    navigatorKinds: [],
    requiredRoles: ['key'],
    optionalRoles: [],
    allowsBlockEnd: false,
  },
  entry_point: {
    navigatorRecord: 'entryPoints',
    navigatorKindField: 'kind',
    navigatorKinds: [],
    requiredRoles: ['name'],
    optionalRoles: ['kind'],
    allowsBlockEnd: false,
  },
};

/** Rule types whose rules may declare `blockEnd`. */
export const BLOCK_END_RULE_TYPES: readonly RuleType[] = RULE_TYPES.filter(
  (type) => RULE_TYPE_SPEC[type].allowsBlockEnd,
);
