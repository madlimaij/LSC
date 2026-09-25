/**
 * Shapes shared across the engines (WP-04 deliverable: the engine interface).
 */
import type { CaptureRole, RuleType } from '../contract/index.js';

/** One match of one rule against one file. */
export interface Match {
  readonly ruleId: string;
  readonly type: RuleType;
  /** 1-based. */
  readonly line: number;
  /** 1-based. Not part of the Rule Set contract (CONTRACT.md §6.2), kept here for engine consumers (e.g. the report). */
  readonly column: number;
  readonly captures: Partial<Record<CaptureRole, string>>;
  /** Name of the innermost open definition scope at this match's start (D4), when any is open. */
  readonly enclosingSymbol?: string;
}

/** A block-tracking problem that must not fail a scan (contract/CONTRACT.md §6.6: "warnings, not errors"). */
export interface BlockWarning {
  readonly kind: 'unclosed-block' | 'unmatched-block-end';
  readonly ruleId: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface ScanResult {
  readonly matches: readonly Match[];
  readonly warnings: readonly BlockWarning[];
}
