import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRecordings } from '../../src/llm/index.js';
import { WP08_RECORDINGS_DIR, wp08Recordings } from './wp08-recordings.js';

const RECORDINGS_ROOT = fileURLToPath(new URL('../../fixtures/recordings/', import.meta.url));

describe('fixtures/recordings', () => {
  it('wp08/ matches tests/llm/wp08-recordings.ts (regenerate with npx tsx tests/llm/wp08-recordings.ts)', () => {
    const expected = wp08Recordings().sort((a, b) => a.hash.localeCompare(b.hash));
    expect(loadRecordings(WP08_RECORDINGS_DIR)).toEqual(expected);
  });

  it('every recording set under fixtures/recordings/ is valid', () => {
    const sets = readdirSync(RECORDINGS_ROOT)
      .map((name) => join(RECORDINGS_ROOT, name))
      .filter((p) => statSync(p).isDirectory());
    expect(sets.length).toBeGreaterThan(0);
    for (const dir of sets) {
      expect(() => loadRecordings(dir), dir).not.toThrow();
    }
  });
});
