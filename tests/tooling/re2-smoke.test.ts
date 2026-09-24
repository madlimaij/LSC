import RE2 from 're2';
import { describe, expect, it } from 'vitest';

// D3: every regex pattern runs on the RE2 engine. This smoke test proves the native
// `re2` binding installed and works, including named groups (D2).
describe('re2 native binding', () => {
  it('compiles and runs a pattern with a named capture group', () => {
    const re = new RE2('^PROC\\s+(?<name>[A-Z_][A-Z0-9_]*)', 'm');
    const match = re.exec('-- header\nPROC LOAD_CUSTOMER\n  READ customers\nEND');
    expect(match).not.toBeNull();
    expect(match?.groups?.['name']).toBe('LOAD_CUSTOMER');
  });

  it('rejects constructs RE2 does not support (backreferences, lookahead)', () => {
    expect(() => new RE2('(a)\\1')).toThrow();
    expect(() => new RE2('a(?=b)')).toThrow();
  });
});
