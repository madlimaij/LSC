import { describe, expect, it } from 'vitest';
import { describeSkillHashMismatch, findSkillHashMismatches } from '../../src/report/skill-hash-check.js';

describe('findSkillHashMismatches', () => {
  it('is empty when every Rule Set sourceSkills hash matches the current directory', () => {
    const ruleSet = [{ path: 'module.md', sha256: 'a'.repeat(64) }];
    const current = [{ path: 'module.md', sha256: 'a'.repeat(64) }];
    expect(findSkillHashMismatches(ruleSet, current)).toEqual([]);
  });

  it('flags a differing hash', () => {
    const ruleSet = [{ path: 'module.md', sha256: 'a'.repeat(64) }];
    const current = [{ path: 'module.md', sha256: 'b'.repeat(64) }];
    const mismatches = findSkillHashMismatches(ruleSet, current);
    expect(mismatches).toEqual([{ path: 'module.md', ruleSetSha256: 'a'.repeat(64), currentSha256: 'b'.repeat(64) }]);
  });

  it('flags a Skill file the Rule Set cites but no longer present under --skills-dir', () => {
    const ruleSet = [{ path: 'removed.md', sha256: 'a'.repeat(64) }];
    const mismatches = findSkillHashMismatches(ruleSet, []);
    expect(mismatches).toEqual([{ path: 'removed.md', ruleSetSha256: 'a'.repeat(64) }]);
  });

  it('describeSkillHashMismatch mentions both hashes or that the file is missing', () => {
    expect(describeSkillHashMismatch({ path: 'module.md', ruleSetSha256: 'aa', currentSha256: 'bb' })).toContain('sha256 differs');
    expect(describeSkillHashMismatch({ path: 'removed.md', ruleSetSha256: 'aa' })).toContain('not found');
  });
});
