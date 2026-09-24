import type { Command } from 'commander';
import { getPackageInfo } from '../package-info.js';

export const name = 'version';
export const description = 'Print the lsc version';

export function configure(cmd: Command): void {
  cmd.action(() => {
    process.stdout.write(`${getPackageInfo().version}\n`);
  });
}
