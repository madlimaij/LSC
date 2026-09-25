/**
 * SHA-256 hashing for Skill files (`sourceSkills`, docs/PLAN.md §5.1).
 * Hashes the exact bytes read from disk, so a one-character change in a
 * Skill file changes its hash and nothing else about the ingestion result.
 */
import { createHash } from 'node:crypto';

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
