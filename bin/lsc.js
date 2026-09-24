#!/usr/bin/env node
// Thin launcher for the built CLI. `npm install` / `npm ci` run `prepare`,
// which builds `dist/`; run `npm run build` manually after changing sources.
import { existsSync } from 'node:fs';

const entry = new URL('../dist/cli/index.js', import.meta.url);
if (!existsSync(entry)) {
  process.stderr.write('lsc: dist/ not found. Run `npm run build` first.\n');
  process.exit(1);
}
const { run } = await import(entry.href);
try {
  await run(process.argv);
} catch (error) {
  process.stderr.write(`lsc: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
