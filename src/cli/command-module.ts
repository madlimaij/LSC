import type { Command } from 'commander';

/**
 * Shape every file in `src/cli/commands/` must export.
 *
 * A command file either uses named exports:
 *
 *   export const name = 'ingest';
 *   export const description = 'Parse Skill files ...';
 *   export function configure(cmd: Command): void { ... }
 *
 * or a default export of an object with the same three members.
 *
 * `configure` receives a commander `Command` that already has its name and
 * description set; it adds arguments, options and the action handler.
 */
export interface CommandModule {
  readonly name: string;
  readonly description: string;
  configure(cmd: Command): void | Promise<void>;
}

/** Command names are kebab-case, e.g. `validate-ruleset`. */
export const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Names commander reserves or that would shadow built-in behaviour. */
const RESERVED_NAMES = new Set(['help']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Extracts a CommandModule from an imported ES module namespace.
 * Throws a descriptive error if the module does not follow the contract,
 * so a malformed command file fails loudly instead of being skipped.
 */
export function toCommandModule(namespace: unknown, source: string): CommandModule {
  const ns = asRecord(namespace);
  const candidate = asRecord(ns?.['default']) ?? ns;
  if (candidate === undefined) {
    throw new Error(`Command file ${source} did not export a module object`);
  }
  const { name, description, configure } = candidate;
  if (typeof name !== 'string' || !COMMAND_NAME_PATTERN.test(name)) {
    throw new Error(
      `Command file ${source} must export a kebab-case string \`name\` (got ${JSON.stringify(name)})`,
    );
  }
  if (RESERVED_NAMES.has(name)) {
    throw new Error(`Command file ${source} uses reserved command name "${name}"`);
  }
  if (typeof description !== 'string' || description.trim() === '') {
    throw new Error(`Command file ${source} must export a non-empty string \`description\``);
  }
  if (typeof configure !== 'function') {
    throw new Error(`Command file ${source} must export a function \`configure(cmd)\``);
  }
  return {
    name,
    description,
    configure: configure as CommandModule['configure'],
  };
}
