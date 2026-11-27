import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('handles quoted commas, escaped quotes, and CRLF', () => {
    expect(parseCsv('name,note\r\n"A, B","say ""hi"""\r\n')).toEqual([['name', 'note'], ['A, B', 'say "hi"']]);
  });
  it('rejects excess data rows', () => expect(() => parseCsv('a\n1\n2', 1)).toThrow('data rows'));
  it('rejects inconsistent columns', () => expect(() => parseCsv('a,b\n1')).toThrow('inconsistent'));
  it('drops blank lines by default', () => {
    expect(parseCsv('a,b\n\n1,2\n,\n3,4\n')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  describe('keepBlankRows', () => {
    it('keeps each blank line as an empty row so rows number as in the sheet', () => {
      expect(parseCsv('a,b\n\n1,2\n,\n3,4', undefined, { keepBlankRows: true })).toEqual([
        ['a', 'b'], [], ['1', '2'], [], ['3', '4'],
      ]);
    });
    it('does not count blank rows toward the row limit or the width check', () => {
      expect(parseCsv('a,b\n1,2\n\n\n\n', 1, { keepBlankRows: true }).filter((row) => row.length > 0)).toHaveLength(2);
      expect(() => parseCsv('a,b\n1,2\n\n3,4', 1, { keepBlankRows: true })).toThrow('data rows');
    });
  });

  it('allowRaggedRows returns rows of differing widths instead of refusing', () => {
    expect(parseCsv('a,b\nx,y,z\n1', undefined, { allowRaggedRows: true })).toEqual([['a', 'b'], ['x', 'y', 'z'], ['1']]);
  });
});
