# src/contract

**Owner:** `contract-architect` (WP-02). Frozen after Gate G1: changes need a `contractVersion` bump, a JSON Schema re-export and a `docs/DECISIONS.md` entry (contract/CONTRACT.md §8).

Rule Set contract (docs/PLAN.md §5). Import from `src/contract/index.ts`.

| File | Contents |
| --- | --- |
| `version.ts` | `CONTRACT_VERSION`, semver pattern, supported `contractVersion` range |
| `rule-types.ts` | `RULE_TYPES`, `CAPTURE_ROLES`, `RULE_TYPE_SPEC` (Navigator mapping, required/optional roles, `blockEnd`) |
| `schema.ts` | Zod schemas and inferred types (`RuleSet`, `Rule`, `ExactRule`, `RegexRule`, …) |
| `exact.ts` | Normative exact-engine definition: placeholders, `exactToRegex` |
| `regex-groups.ts` | Named-group scanner for regex patterns |
| `validate.ts` | `validateRuleSet`, `validateRule`, `checkRule`, rule codes, issue formatting |
| `load.ts` | `loadRuleSetFile` (read + parse + validate, readable errors) |
| `json-schema.ts`, `export-json-schema.ts` | JSON Schema build and `npm run contract:export` |
