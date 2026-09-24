import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type * as CliIndex from '../../src/cli/index.js';
import { createProgram, isCommandFile, loadCommands } from '../../src/cli/index.js';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const commandSource = (name: string, output: string): string => `
export const name = ${JSON.stringify(name)};
export const description = 'test command ${name}';
export function configure(cmd) {
  cmd.action(() => { globalThis.__lscTestOutput = ${JSON.stringify(output)}; });
}
`;

interface TestGlobal {
  __lscTestOutput?: string;
}

describe('command auto-registration', () => {
  it('registers the built-in version command from src/cli/commands', async () => {
    const program = await createProgram();
    expect(program.commands.map((c) => c.name())).toContain('version');
  });

  it('adding one file to src/cli/commands adds a command without editing any other file', async () => {
    // Work on an untouched copy of the real CLI sources so the repository tree is never modified.
    const root = makeTempDir('lsc-cli-copy-');
    cpSync(join(REPO_ROOT, 'src/cli'), join(root, 'src/cli'), { recursive: true });
    cpSync(join(REPO_ROOT, 'package.json'), join(root, 'package.json'));
    symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'), 'dir');

    // The only change: one new TypeScript file in src/cli/commands/.
    writeFileSync(
      join(root, 'src/cli/commands/hello-world.ts'),
      `import type { Command } from 'commander';
export const name = 'hello-world';
export const description = 'Say hello';
export function configure(cmd: Command): void {
  cmd.action(() => { (globalThis as { __lscTestOutput?: string }).__lscTestOutput = 'hello'; });
}
`,
    );

    const copied = (await import(
      pathToFileURL(join(root, 'src/cli/index.ts')).href
    )) as typeof CliIndex;
    const program = await copied.createProgram();
    expect(program.commands.map((c) => c.name())).toEqual(['hello-world', 'version']);

    const g = globalThis as TestGlobal;
    delete g.__lscTestOutput;
    await program.parseAsync(['node', 'lsc', 'hello-world']);
    expect(g.__lscTestOutput).toBe('hello');

    // The real program is unaffected.
    const real = await createProgram();
    expect(real.commands.map((c) => c.name())).not.toContain('hello-world');
  });

  it('discovers commands from an arbitrary directory in sorted order', async () => {
    const dir = makeTempDir('lsc-commands-');
    writeFileSync(join(dir, 'zeta.mjs'), commandSource('zeta', 'z'));
    writeFileSync(join(dir, 'alpha.mjs'), commandSource('alpha', 'a'));
    const program = await createProgram({ commandsDir: dir });
    expect(program.commands.map((c) => c.name())).toEqual(['alpha', 'zeta']);
  });

  it('accepts a default-exported command object', async () => {
    const dir = makeTempDir('lsc-commands-');
    writeFileSync(
      join(dir, 'dflt.mjs'),
      `export default { name: 'dflt', description: 'd', configure(cmd) { cmd.action(() => {}); } };`,
    );
    const mods = await loadCommands(dir);
    expect(mods.map((m) => m.name)).toEqual(['dflt']);
  });

  it('ignores declaration files, source maps, tests and underscore-prefixed helpers', () => {
    expect(isCommandFile('version.js')).toBe(true);
    expect(isCommandFile('version.ts')).toBe(true);
    expect(isCommandFile('version.d.ts')).toBe(false);
    expect(isCommandFile('version.js.map')).toBe(false);
    expect(isCommandFile('version.test.ts')).toBe(false);
    expect(isCommandFile('_shared.ts')).toBe(false);
    expect(isCommandFile('README.md')).toBe(false);
  });

  it('fails loudly on a command file missing a description', async () => {
    const dir = makeTempDir('lsc-commands-');
    writeFileSync(join(dir, 'broken.mjs'), `export const name = 'broken'; export function configure() {}`);
    await expect(loadCommands(dir)).rejects.toThrow(/description/);
  });

  it('fails loudly on a command file missing configure', async () => {
    const dir = makeTempDir('lsc-commands-');
    writeFileSync(join(dir, 'broken.mjs'), `export const name = 'broken'; export const description = 'x';`);
    await expect(loadCommands(dir)).rejects.toThrow(/configure/);
  });

  it('rejects non-kebab-case command names', async () => {
    const dir = makeTempDir('lsc-commands-');
    writeFileSync(join(dir, 'bad.mjs'), commandSource('BadName', 'x'));
    await expect(loadCommands(dir)).rejects.toThrow(/kebab-case/);
  });

  it('rejects the reserved name "help"', async () => {
    const dir = makeTempDir('lsc-commands-');
    writeFileSync(join(dir, 'help.mjs'), commandSource('help', 'x'));
    await expect(loadCommands(dir)).rejects.toThrow(/reserved/);
  });

  it('rejects two files declaring the same command name', async () => {
    const dir = makeTempDir('lsc-commands-');
    writeFileSync(join(dir, 'a.mjs'), commandSource('same', 'a'));
    writeFileSync(join(dir, 'b.mjs'), commandSource('same', 'b'));
    await expect(loadCommands(dir)).rejects.toThrow(/Duplicate command name "same"/);
  });
});
