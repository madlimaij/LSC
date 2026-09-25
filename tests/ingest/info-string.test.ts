import { describe, expect, it } from 'vitest';
import { parseInfoString } from '../../src/ingest/index.js';

describe('parseInfoString', () => {
  it('parses key=value pairs separated by spaces', () => {
    const { fields, malformed } = parseInfoString('example=positive construct=proc-definition id=proc-01');
    expect(fields).toEqual({ example: 'positive', construct: 'proc-definition', id: 'proc-01' });
    expect(malformed).toEqual([]);
  });

  it('treats a meta of "expect" as one non-key=value token', () => {
    const { fields, malformed } = parseInfoString('expect');
    expect(fields).toEqual({});
    expect(malformed).toEqual(['expect']);
  });

  it('handles null, undefined and blank meta as no fields', () => {
    expect(parseInfoString(null).fields).toEqual({});
    expect(parseInfoString(undefined).fields).toEqual({});
    expect(parseInfoString('   ').fields).toEqual({});
  });

  it('collapses repeated whitespace between tokens', () => {
    const { fields } = parseInfoString('example=positive    construct=call   id=call-01');
    expect(fields).toEqual({ example: 'positive', construct: 'call', id: 'call-01' });
  });

  it('a later duplicate key wins, like a query string', () => {
    const { fields } = parseInfoString('id=first id=second');
    expect(fields['id']).toBe('second');
  });
});
