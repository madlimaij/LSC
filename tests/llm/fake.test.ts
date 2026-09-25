import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FakeProvider,
  RecordingFormatError,
  UnknownRecordingError,
  loadRecordings,
  requestHash,
  writeRecording,
} from '../../src/llm/index.js';
import { tempDir } from './helpers.js';
import { WP08_RECORDINGS_DIR, requests, wp08Recordings } from './wp08-recordings.js';

describe('FakeProvider', () => {
  it('replays the recorded response for a known request', async () => {
    const fake = FakeProvider.fromDirectory(WP08_RECORDINGS_DIR);
    const res = await fake.complete(requests.validBare);
    expect(res.text).toContain('include-statement');
    expect(res.usage).toEqual({ inputTokens: 400, outputTokens: 150 });
    expect(res.stopReason).toBe('end');
    expect(res.model).toBe('hand-written');
  });

  it('is deterministic: the same request gets the same answer', async () => {
    const fake = FakeProvider.fromDirectory(WP08_RECORDINGS_DIR);
    const a = await fake.complete(requests.validFenced);
    const b = await fake.complete(requests.validFenced);
    expect(b).toEqual(a);
  });

  it('keys on system and messages, not on maxOutputTokens', async () => {
    const fake = FakeProvider.fromDirectory(WP08_RECORDINGS_DIR);
    const res = await fake.complete({ ...requests.validBare, maxOutputTokens: 64 });
    expect(res.text).toContain('include-statement');
  });

  it('fails loudly on an unknown request (D7)', async () => {
    const fake = FakeProvider.fromDirectory(WP08_RECORDINGS_DIR);
    const unknown = {
      ...requests.validBare,
      messages: [{ role: 'user' as const, content: 'Construct: call\nCALL other_proc()' }],
    };
    await expect(fake.complete(unknown)).rejects.toBeInstanceOf(UnknownRecordingError);
    await expect(fake.complete(unknown)).rejects.toThrow(requestHash(unknown));
    await expect(fake.complete(unknown)).rejects.toThrow(/never hand-edit/);
  });

  it('a one-character change in the system prompt is an unknown request', async () => {
    const fake = FakeProvider.fromDirectory(WP08_RECORDINGS_DIR);
    await expect(fake.complete({ ...requests.validBare, system: `${requests.validBare.system} ` })).rejects.toBeInstanceOf(
      UnknownRecordingError,
    );
  });

  it('reports recordings that were never requested', async () => {
    const fake = FakeProvider.fromDirectory(WP08_RECORDINGS_DIR);
    expect(fake.unusedHashes()).toHaveLength(fake.size);
    await fake.complete(requests.validBare);
    expect(fake.unusedHashes()).not.toContain(requestHash(requests.validBare));
    expect(fake.unusedHashes()).toHaveLength(fake.size - 1);
  });

  it('rejects duplicate recordings for one request', () => {
    const rec = wp08Recordings()[0];
    expect(rec).toBeDefined();
    if (rec === undefined) return;
    expect(() => new FakeProvider([rec, rec])).toThrow(RecordingFormatError);
  });
});

describe('recording files', () => {
  it('rejects a recording whose request was edited after recording', () => {
    const dir = tempDir();
    const [rec] = wp08Recordings();
    if (rec === undefined) throw new Error('no recording');
    const edited = { ...rec, request: { ...rec.request, system: 'edited' } };
    writeFileSync(join(dir, `${rec.hash}.json`), JSON.stringify(edited));
    expect(() => loadRecordings(dir)).toThrow(/does not match its request/);
  });

  it('rejects a recording stored under the wrong file name', () => {
    const dir = tempDir();
    const [rec] = wp08Recordings();
    if (rec === undefined) throw new Error('no recording');
    writeFileSync(join(dir, 'renamed.json'), JSON.stringify(rec));
    expect(() => loadRecordings(dir)).toThrow(/file name must be/);
  });

  it('rejects a malformed recording with a readable message', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'x.json'), JSON.stringify({ formatVersion: 1 }));
    expect(() => loadRecordings(dir)).toThrow(RecordingFormatError);
    writeFileSync(join(dir, 'x.json'), '{not json');
    expect(() => loadRecordings(dir)).toThrow(/not valid JSON/);
  });

  it('fails on a missing recordings directory', () => {
    expect(() => FakeProvider.fromDirectory(join(tempDir(), 'missing'))).toThrow(/cannot read recordings directory/);
  });

  it('round-trips through writeRecording and loadRecordings', () => {
    const dir = tempDir();
    for (const rec of wp08Recordings()) writeRecording(dir, rec);
    expect(loadRecordings(dir)).toEqual(loadRecordings(WP08_RECORDINGS_DIR));
  });
});
