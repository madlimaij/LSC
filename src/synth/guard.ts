/**
 * Recording guard (D19 d): `lsc compile` refuses recording mode when the
 * environment variable `LSC_REAL_INPUTS` is set, or when any input lies
 * outside `fixtures/toylang/`. Recordings are committed to the repository,
 * and only toylang may ever be recorded (D5, CLAUDE.md).
 *
 * The check runs before any provider is constructed, so a refused compile
 * sends nothing.
 */
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REAL_INPUTS_ENV = 'LSC_REAL_INPUTS';

/** `<package root>/fixtures/toylang` (same relative path from `src/synth/` and `dist/synth/`). */
export const TOYLANG_ROOT = fileURLToPath(new URL('../../fixtures/toylang/', import.meta.url));

export class RecordingRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingRefusedError';
  }
}

/** Resolves symlinks of the longest existing prefix, so a link into or out of the fixture tree cannot fool the check. */
function canonical(path: string): string {
  const abs = resolve(path);
  if (existsSync(abs)) return realpathSync(abs);
  const parent = dirname(abs);
  return parent === abs ? abs : join(canonical(parent), basename(abs));
}

export function isInside(path: string, root: string): boolean {
  const rel = relative(canonical(root), canonical(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export interface RecordingGuardInput {
  /** True when `lsc.config.json` enables `recording`. */
  readonly recording: boolean;
  /** Every input path of the compile: Skill dir, examples dir, reviews file, sample dir. */
  readonly inputs: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly toylangRoot?: string;
}

/** Throws `RecordingRefusedError` when recording mode must not run. No-op when recording is off. */
export function assertRecordingAllowed(input: RecordingGuardInput): void {
  if (!input.recording) return;
  const env = input.env ?? process.env;
  if (env[REAL_INPUTS_ENV] !== undefined) {
    throw new RecordingRefusedError(
      `recording mode refused: ${REAL_INPUTS_ENV} is set, so this may be a real-language run; ` +
        'recordings are committed and may contain only toylang (D19 d). Remove "recording" from lsc.config.json.',
    );
  }
  const root = input.toylangRoot ?? TOYLANG_ROOT;
  const outside = input.inputs.filter((p) => !isInside(p, root));
  if (outside.length > 0) {
    throw new RecordingRefusedError(
      `recording mode refused: input(s) outside ${root}: ${outside.map((p) => resolve(p)).join(', ')}; ` +
        'only toylang inputs may be recorded (D19 d). Remove "recording" from lsc.config.json.',
    );
  }
}
