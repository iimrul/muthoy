import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes, and CRLF', () => {
    expect(parseCsv('name,note\r\n"A, B","say ""hi"""\r\n')).toEqual([['name', 'note'], ['A, B', 'say "hi"']]);
  });
  it('rejects excess data rows', () => expect(() => parseCsv('a\n1\n2', 1)).toThrow('data rows'));
  it('rejects inconsistent columns', () => expect(() => parseCsv('a,b\n1')).toThrow('inconsistent'));
});
