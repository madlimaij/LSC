import { describe, expect, it } from 'vitest';
import {
  BLOCK_END_RULE_TYPES,
  CAPTURE_ROLES,
  RULE_TYPE_SPEC,
  RULE_TYPES,
  RuleTypeSchema,
} from '../../src/contract/index.js';

describe('RULE_TYPE_SPEC (plan §5.3)', () => {
  it('has exactly one entry per rule type', () => {
    expect(Object.keys(RULE_TYPE_SPEC).sort()).toEqual([...RULE_TYPES].sort());
  });

  it('does not contain branch_marker or exit (D1)', () => {
    expect(RULE_TYPES).not.toContain('branch_marker');
    expect(RULE_TYPES).not.toContain('exit');
    expect(RuleTypeSchema.safeParse('branch_marker').success).toBe(false);
    expect(RuleTypeSchema.safeParse('exit').success).toBe(false);
  });

  it('matches the mapping table in the plan', () => {
    const table = Object.fromEntries(
      RULE_TYPES.map((t) => {
        const s = RULE_TYPE_SPEC[t];
        return [t, [s.navigatorRecord, s.navigatorKinds.join('/'), s.requiredRoles.join(','), s.optionalRoles.join(',')]];
      }),
    );
    expect(table).toEqual({
      module_declaration: ['symbols', 'module', 'name', ''],
      symbol_definition: ['symbols', 'function/procedure', 'name', 'kind'],
      call: ['relations', 'calls', 'callee', 'module'],
      include: ['relations', 'includes', 'target', ''],
      db_read: ['dbAccesses', 'read', 'table', ''],
      db_write: ['dbAccesses', 'write', 'table', ''],
      config_ref: ['configRefs', '', 'key', ''],
      entry_point: ['entryPoints', '', 'name', 'kind'],
    });
  });

  it('allows blockEnd only on module_declaration and symbol_definition (D4)', () => {
    expect([...BLOCK_END_RULE_TYPES]).toEqual(['module_declaration', 'symbol_definition']);
  });

  it('uses only known capture roles, with required and optional disjoint', () => {
    for (const type of RULE_TYPES) {
      const { requiredRoles, optionalRoles } = RULE_TYPE_SPEC[type];
      for (const role of [...requiredRoles, ...optionalRoles]) expect(CAPTURE_ROLES).toContain(role);
      expect(requiredRoles.filter((r) => optionalRoles.includes(r))).toEqual([]);
      expect(requiredRoles.length).toBeGreaterThan(0);
    }
  });
});
