import { describe, expect, it } from 'vitest';
import { loadRecordings } from '../../src/llm/index.js';
import { recordingsDir, SCENARIOS, wp09Recordings } from './wp09-recordings.js';

describe('WP-09 recordings', () => {
  it.each(SCENARIOS)('%s/ matches tests/synth/wp09-recordings.ts (regenerate with npx tsx tests/synth/wp09-recordings.ts)', async (scenario) => {
    expect(loadRecordings(recordingsDir(scenario))).toEqual(await wp09Recordings(scenario));
  });

  it.each(SCENARIOS)('%s/ is openly hand-written, toylang only', (scenario) => {
    const recordings = loadRecordings(recordingsDir(scenario));
    expect(recordings.length).toBeGreaterThan(0);
    for (const rec of recordings) {
      expect(rec.origin).toBe('hand-written');
      expect(rec.provider).toBe('hand-written');
      expect(rec.request.messages[0]?.content).toContain('Language: toylang');
    }
  });
});
