/**
 * Compares a Rule Set's `sourceSkills` (the Skill file hashes it was
 * compiled from) against a freshly-hashed `--skills-dir`, so `lsc report`
 * can warn when they have drifted apart (reviewer Q5, D25 item 4): the
 * Rule Set may no longer reflect the documentation a reader is looking at.
 */
import type { SkillHashMismatch } from './model.js';

export interface SourceSkillLike {
  readonly path: string;
  readonly sha256: string;
}

/** Every Rule Set `sourceSkills` entry whose hash differs from (or is missing in) `currentSourceSkills`. Empty means every hash still matches. */
export function findSkillHashMismatches(
  ruleSetSourceSkills: readonly SourceSkillLike[],
  currentSourceSkills: readonly SourceSkillLike[],
): SkillHashMismatch[] {
  const currentByPath = new Map(currentSourceSkills.map((s) => [s.path, s.sha256] as const));
  const mismatches: SkillHashMismatch[] = [];
  for (const skill of ruleSetSourceSkills) {
    const currentSha256 = currentByPath.get(skill.path);
    if (currentSha256 === skill.sha256) continue;
    mismatches.push({ path: skill.path, ruleSetSha256: skill.sha256, ...(currentSha256 !== undefined ? { currentSha256 } : {}) });
  }
  return mismatches;
}

/** One line per mismatch, for `lsc report`'s stderr warning (D25 item 4). */
export function describeSkillHashMismatch(mismatch: SkillHashMismatch): string {
  return mismatch.currentSha256 === undefined
    ? `${mismatch.path}: in the Rule Set's sourceSkills (sha256 ${mismatch.ruleSetSha256}) but not found under --skills-dir`
    : `${mismatch.path}: sha256 differs (Rule Set ${mismatch.ruleSetSha256}, current ${mismatch.currentSha256})`;
}

/**
 * Every Skill file present under the current `--skills-dir` that the Rule Set's `sourceSkills` does
 * not cite at all (by path) — a Skill file added after this Rule Set was compiled (G2 round, D27
 * defect A4: this case, the mirror image of `findSkillHashMismatches`' "removed" case, previously
 * went unreported on both stderr and in the report).
 */
export function findNewSkillFiles(ruleSetSourceSkills: readonly SourceSkillLike[], currentSourceSkills: readonly SourceSkillLike[]): string[] {
  const ruleSetPaths = new Set(ruleSetSourceSkills.map((s) => s.path));
  return currentSourceSkills.filter((s) => !ruleSetPaths.has(s.path)).map((s) => s.path);
}

/** One line per new Skill file, for `lsc report`'s stderr warning and the report (D27 defect A4). */
export function describeNewSkillFile(path: string): string {
  return `${path}: new Skill file not used by this Rule Set (added since it was compiled — recompile to use it)`;
}
