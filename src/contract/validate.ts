/**
 * Full Rule Set validation: structure (Zod, same as the JSON Schema) plus the
 * cross-field rules JSON Schema cannot express (contract/CONTRACT.md §5).
 *
 * Every issue carries a stable `rule` code so tests, the CLI and Navigator can
 * tell which contract rule was violated.
 */
import RE2 from 're2';
import type { z } from 'zod';
import { exactPlaceholderNames, exactToRegex, parseExactToken } from './exact.js';
import { scanNamedGroups } from './regex-groups.js';
import { RULE_TYPE_SPEC, type CaptureRole } from './rule-types.js';
import { RuleSchema, RuleSetSchema, type RegexConfig, type Rule, type RuleSet } from './schema.js';
import {
  CONTRACT_VERSION,
  isSupportedContractVersion,
  SUPPORTED_CONTRACT_VERSION_RANGE,
} from './version.js';

/** Stable codes of the validation rules (contract/CONTRACT.md §5). */
export const VALIDATION_RULES = [
  /** Structure violates the JSON Schema (wrong type, missing or unknown field, bad format). */
  'schema',
  /** contractVersion is a string but not a version this validator supports. */
  'contract-version',
  /** Two rules share the same id. */
  'duplicate-rule-id',
  /** A capture role required by the rule type is missing from `captures`. */
  'captures-required-roles',
  /** `captures` maps a role that is neither required nor optional for the rule type. */
  'capture-role-not-allowed',
  /** `captures` references a group name that does not exist in the pattern / exact tokens. */
  'capture-group-missing',
  /** `blockEnd` on a type other than module_declaration or symbol_definition. */
  'block-end-type',
  /** A regex pattern (rule or blockEnd) does not compile under RE2 with its flags. */
  're2-compile',
  /** A named group uses the (?P<name>...) form instead of (?<name>...). */
  'named-group-syntax',
  /** Exact tokens have no literal token, or repeat a placeholder name. */
  'exact-tokens',
] as const;

export type ValidationRule = (typeof VALIDATION_RULES)[number];

export type IssuePath = readonly (string | number)[];

export interface ValidationIssue {
  readonly rule: ValidationRule;
  /** Path to the offending value inside the Rule Set. */
  readonly path: IssuePath;
  readonly message: string;
}

export type RuleSetValidation =
  | { readonly ok: true; readonly ruleSet: RuleSet; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export type RuleValidation =
  | { readonly ok: true; readonly rule: Rule; readonly issues: readonly [] }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/** Formats a path as a JSONPath-style string, e.g. `$.rules[2].regex.pattern`. */
export function formatPath(path: IssuePath): string {
  let out = '$';
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${String(segment)}]`;
    else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) out += `.${segment}`;
    else out += `[${JSON.stringify(segment)}]`;
  }
  return out;
}

/** One line per issue: `<path>: [<rule>] <message>`. */
export function formatIssue(issue: ValidationIssue): string {
  return `${formatPath(issue.path)}: [${issue.rule}] ${issue.message}`;
}

function zodIssues(error: z.ZodError, prefix: IssuePath): ValidationIssue[] {
  return error.issues.map((issue) => ({
    rule: 'schema' as const,
    path: [
      ...prefix,
      ...issue.path.map((p) => (typeof p === 'number' ? p : String(p))),
    ],
    message: friendlyZodMessage(issue),
  }));
}

function friendlyZodMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) {
    return `required field is missing (expected ${issue.expected})`;
  }
  return issue.message;
}

function re2Error(pattern: string, flags: string): string | undefined {
  try {
    new RE2(pattern, flags);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function checkRegexCompiles(config: RegexConfig, path: IssuePath): ValidationIssue[] {
  const error = re2Error(config.pattern, config.flags);
  return error === undefined
    ? []
    : [
        {
          rule: 're2-compile',
          path: [...path, 'pattern'],
          message: `pattern does not compile under RE2 with flags "${config.flags}": ${error}`,
        },
      ];
}

function checkCaptureRoles(rule: Rule, path: IssuePath): ValidationIssue[] {
  const spec = RULE_TYPE_SPEC[rule.type];
  const issues: ValidationIssue[] = [];
  const allowed = new Set<CaptureRole>([...spec.requiredRoles, ...spec.optionalRoles]);
  for (const role of Object.keys(rule.captures) as CaptureRole[]) {
    if (!allowed.has(role)) {
      const list = [...allowed].map((r) => `"${r}"`).join(', ');
      issues.push({
        rule: 'capture-role-not-allowed',
        path: [...path, 'captures', role],
        message: `capture role "${role}" is not allowed for type "${rule.type}" (allowed: ${list})`,
      });
    }
  }
  for (const role of spec.requiredRoles) {
    if (rule.captures[role] === undefined) {
      issues.push({
        rule: 'captures-required-roles',
        path: [...path, 'captures'],
        message: `type "${rule.type}" requires capture role "${role}"`,
      });
    }
  }
  return issues;
}

function checkBlockEnd(rule: Rule, path: IssuePath): ValidationIssue[] {
  if (rule.blockEnd === undefined) return [];
  const issues: ValidationIssue[] = [];
  if (!RULE_TYPE_SPEC[rule.type].allowsBlockEnd) {
    issues.push({
      rule: 'block-end-type',
      path: [...path, 'blockEnd'],
      message: `blockEnd is only allowed on module_declaration and symbol_definition, not on "${rule.type}"`,
    });
  }
  issues.push(...checkRegexCompiles(rule.blockEnd, [...path, 'blockEnd']));
  return issues;
}

function missingGroups(
  rule: Rule,
  available: ReadonlySet<string>,
  where: string,
  path: IssuePath,
  skip: ReadonlySet<string> = new Set(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [role, group] of Object.entries(rule.captures)) {
    if (group === undefined || available.has(group) || skip.has(group)) continue;
    issues.push({
      rule: 'capture-group-missing',
      path: [...path, 'captures', role],
      message: `capture role "${role}" references group "${group}", which does not exist in the ${where}`,
    });
  }
  return issues;
}

function checkRegexEngine(rule: Rule & { engine: 'regex' }, path: IssuePath): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { pattern } = rule.regex;
  const compileIssues = checkRegexCompiles(rule.regex, [...path, 'regex']);
  if (compileIssues.length > 0) return compileIssues;

  const scan = scanNamedGroups(pattern);
  for (const name of scan.pythonStyleNames) {
    issues.push({
      rule: 'named-group-syntax',
      path: [...path, 'regex', 'pattern'],
      message: `named group "${name}" must be written (?<${name}>...), not (?P<${name}>...)`,
    });
  }
  issues.push(
    ...missingGroups(rule, new Set(scan.names), 'regex pattern', path, new Set(scan.pythonStyleNames)),
  );
  return issues;
}

function checkExactEngine(rule: Rule & { engine: 'exact' }, path: IssuePath): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { tokens } = rule.exact;
  const tokensPath = [...path, 'exact', 'tokens'];

  if (!tokens.some((t) => parseExactToken(t).kind === 'literal')) {
    issues.push({
      rule: 'exact-tokens',
      path: tokensPath,
      message: 'exact tokens must contain at least one literal token (not only placeholders)',
    });
  }
  const names = exactPlaceholderNames(tokens);
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      issues.push({
        rule: 'exact-tokens',
        path: tokensPath,
        message: `placeholder (?<${name}>) appears more than once`,
      });
    }
    seen.add(name);
  }
  issues.push(...missingGroups(rule, seen, 'exact token placeholders', path));

  if (issues.length === 0) {
    // Defensive: the equivalent regex is built from escaped literals and
    // validated names, so this should always compile.
    const equivalent = exactToRegex(rule.exact);
    const error = re2Error(equivalent.pattern, equivalent.flags);
    if (error !== undefined) {
      issues.push({
        rule: 're2-compile',
        path: tokensPath,
        message: `equivalent regex ${equivalent.pattern} does not compile under RE2: ${error}`,
      });
    }
  }
  return issues;
}

/**
 * Cross-field checks for one structurally valid rule. `path` is prefixed to
 * every issue (e.g. `['rules', 3]`).
 */
export function checkRule(rule: Rule, path: IssuePath = []): ValidationIssue[] {
  return [
    ...checkCaptureRoles(rule, path),
    ...checkBlockEnd(rule, path),
    ...(rule.engine === 'regex' ? checkRegexEngine(rule, path) : checkExactEngine(rule, path)),
  ];
}

/** Cross-field checks for a structurally valid Rule Set. */
export function checkRuleSet(ruleSet: RuleSet): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firstIndex = new Map<string, number>();
  ruleSet.rules.forEach((rule, index) => {
    const first = firstIndex.get(rule.id);
    if (first === undefined) {
      firstIndex.set(rule.id, index);
    } else {
      issues.push({
        rule: 'duplicate-rule-id',
        path: ['rules', index, 'id'],
        message: `rule id "${rule.id}" is already used by rules[${String(first)}]`,
      });
    }
  });
  ruleSet.rules.forEach((rule, index) => {
    issues.push(...checkRule(rule, ['rules', index]));
  });
  return issues;
}

function contractVersionIssue(input: unknown): ValidationIssue | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const version = (input as Record<string, unknown>)['contractVersion'];
  if (typeof version !== 'string' || isSupportedContractVersion(version)) return undefined;
  return {
    rule: 'contract-version',
    path: ['contractVersion'],
    message: `unsupported contractVersion "${version}": this validator implements contract ${CONTRACT_VERSION} and accepts ${SUPPORTED_CONTRACT_VERSION_RANGE}`,
  };
}

/**
 * Validates an unknown value (e.g. parsed JSON) as a Rule Set.
 *
 * Order: an unsupported `contractVersion` stops validation (the rest of the
 * file may follow a different format); then structure; cross-field rules run
 * only on a structurally valid Rule Set, so each problem is reported once.
 */
export function validateRuleSet(input: unknown): RuleSetValidation {
  const versionIssue = contractVersionIssue(input);
  if (versionIssue !== undefined) return { ok: false, issues: [versionIssue] };

  const parsed = RuleSetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error, []) };

  const issues = checkRuleSet(parsed.data);
  return issues.length === 0 ? { ok: true, ruleSet: parsed.data, issues: [] } : { ok: false, issues };
}

/** Validates a single rule (structure + cross-field), e.g. a model-proposed draft. */
export function validateRule(input: unknown, path: IssuePath = []): RuleValidation {
  const parsed = RuleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error, path) };
  const issues = checkRule(parsed.data, path);
  return issues.length === 0 ? { ok: true, rule: parsed.data, issues: [] } : { ok: false, issues };
}
