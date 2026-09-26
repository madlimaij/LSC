/** `modelSource` in synthesis.json (D25 item 2): provider, model and recording origin. */
import { describe, expect, it } from 'vitest';
import { buildModelSource, ModelSourceSchema, type ModelSourceInput } from '../../src/synth/index.js';

const h = (n: number): string => n.toString(16).padStart(64, '0');

describe('buildModelSource', () => {
  it('live: provider and model from the configuration, origin live', () => {
    const source = buildModelSource({ mode: 'live', provider: 'anthropic', model: 'toy-model-1' }, [h(1), h(2)]);
    expect(ModelSourceSchema.parse(source)).toEqual({
      mode: 'live',
      configuredProvider: 'anthropic',
      provider: 'anthropic',
      model: 'toy-model-1',
      origin: 'live',
      calls: [{ origin: 'live', provider: 'anthropic', model: 'toy-model-1', calls: 2 }],
      summary: 'live calls to anthropic (2 call(s); model toy-model-1)',
    });
  });

  it('live-recording says each call is being saved', () => {
    const source = buildModelSource({ mode: 'live-recording', provider: 'anthropic', model: 'm' }, [h(1)]);
    expect(source.summary).toBe('live calls to anthropic (1 call(s); model m; each call saved as a recording)');
  });

  it('replay: counts each call by the recording it used, including repeats', () => {
    const input: ModelSourceInput = {
      mode: 'replay',
      provider: 'fake',
      recordings: [
        { hash: h(1), origin: 'recorded', provider: 'anthropic', model: 'm1' },
        { hash: h(2), origin: 'recorded', provider: 'anthropic', model: 'm1' },
        { hash: h(3), origin: 'hand-written', provider: 'hand-written', model: 'hand-written' },
      ],
    };
    expect(buildModelSource(input, [h(1), h(2), h(1)])).toMatchObject({
      provider: 'anthropic',
      model: 'm1',
      origin: 'recorded',
      calls: [{ origin: 'recorded', provider: 'anthropic', model: 'm1', calls: 3 }],
      summary: 'replay of recorded recordings (3 call(s); provider anthropic, model m1)',
    });
    const mixed = buildModelSource(input, [h(1), h(3)]);
    expect(mixed).toMatchObject({ provider: 'mixed', model: 'mixed', origin: 'mixed' });
    expect(mixed.summary).toBe('replay of mixed recordings: 1 recorded, 1 hand-written (2 call(s); provider mixed, model mixed)');
  });

  it('replay with no successful call: none', () => {
    expect(buildModelSource({ mode: 'replay', provider: 'fake', recordings: [] }, [])).toMatchObject({
      provider: 'none',
      model: 'none',
      origin: 'none',
      calls: [],
      summary: 'replay of recordings; no call succeeded',
    });
  });

  it('a replayed call without a loaded recording is an internal error, never guessed', () => {
    expect(() => buildModelSource({ mode: 'replay', provider: 'fake', recordings: [] }, [h(9)])).toThrow(/no recording loaded/);
  });
});
