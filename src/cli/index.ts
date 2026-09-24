import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { toCommandModule, type CommandModule } from './command-module.js';
import { getPackageInfo } from './package-info.js';

export type { CommandModule } from './command-module.js';

/** Directory scanned for command files by default: `<this dir>/commands`. */
export const DEFAULT_COMMANDS_DIR = fileURLToPath(new URL('./commands/', import.meta.url));

const LOADABLE_EXTENSIONS = ['.js', '.mjs', '.ts', '.mts'];

/**
 * True for files in the commands directory that should be imported as commands.
 * Skips declaration files, source maps, tests, and files starting with `_` or `.`
 * (use `_helper.ts` for a non-command helper, although helpers belong elsewhere).
 */
export function isCommandFile(fileName: string): boolean {
  if (fileName.startsWith('_') || fileName.startsWith('.')) return false;
  if (/\.d\.[cm]?ts$/.test(fileName)) return false;
  if (/\.(test|spec)\.[cm]?[jt]s$/.test(fileName)) return false;
  return LOADABLE_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

/**
 * Imports every command file in `dir`, in sorted (deterministic) order.
 * Throws if a file is malformed or two files declare the same command name.
 */
export async function loadCommands(dir: string = DEFAULT_COMMANDS_DIR): Promise<CommandModule[]> {
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isCommandFile(entry.name))
    .map((entry) => entry.name)
    .sort();

  const modules: CommandModule[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    const fullPath = join(dir, file);
    const namespace: unknown = await import(pathToFileURL(fullPath).href);
    const mod = toCommandModule(namespace, fullPath);
    const previous = seen.get(mod.name);
    if (previous !== undefined) {
      throw new Error(`Duplicate command name "${mod.name}" in ${previous} and ${fullPath}`);
    }
    seen.set(mod.name, fullPath);
    modules.push(mod);
  }
  return modules;
}

export interface CreateProgramOptions {
  /** Directory to discover commands in. Defaults to `DEFAULT_COMMANDS_DIR`. */
  readonly commandsDir?: string;
}

/** Builds the `lsc` commander program with every discovered command registered. */
export async function createProgram(options: CreateProgramOptions = {}): Promise<Command> {
  const info = getPackageInfo();
  const program = new Command('lsc')
    .description(
      'Language Skill Compiler: compiles Skill files and labelled examples into a deterministic Rule Set',
    )
    .version(info.version, '-V, --version', 'print the lsc version');

  for (const mod of await loadCommands(options.commandsDir)) {
    const cmd = program.command(mod.name).description(mod.description);
    await mod.configure(cmd);
  }
  return program;
}

/** Entry point used by `bin/lsc.js`. */
export async function run(argv: readonly string[] = process.argv): Promise<void> {
  const program = await createProgram();
  await program.parseAsync([...argv]);
}
