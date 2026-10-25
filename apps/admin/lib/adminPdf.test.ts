// Batch 3 §8.10 — the PDF writer, verified by PARSING THE OUTPUT BACK.
//
// A PDF test that only checks the file starts with %PDF proves nothing: the
// failure mode is an xref offset wrong by a few bytes, which produces a file a
// reader refuses to open and a test happily accepts. So this walks the xref
// table, resolves every offset, and checks it lands exactly on its `N 0 obj`
// header. The corrupted-xref mutation proves the walk can tell the difference.

import { describe, expect, test } from 'vitest';
import { PDF_CONTENT_TYPE, PDF_LATIN1_NOTICE, pdfText, rowsPerPage, toPdf } from './adminPdf';

const TABLE = {
  title: 'Pharmacy registrations',
  subtitle: '1 Jan 2026 to 25 Oct 2026 - 3 rows',
  headers: ['Pharmacy', 'District', 'Registered'],
  rows: [
    ['Banani Pharmacy', 'Dhaka', '12 Feb 2026'],
    ['Mirpur Medico', 'Dhaka', '03 Mar 2026'],
    ['Agrabad Drugs', 'Chattogram', '21 Jun 2026'],
  ],
};

/** The xref table, parsed: entry index -> byte offset. */
function parseXref(pdf: string): { offsets: number[]; startxref: number; size: number } {
  const startMatch = /startxref\s+(\d+)\s+%%EOF/.exec(pdf);
  expect(startMatch, 'no startxref').not.toBeNull();
  const startxref = Number(startMatch?.[1]);

  const header = /xref\s+0 (\d+)\s/.exec(pdf.slice(startxref));
  expect(header, 'startxref does not point at an xref table').not.toBeNull();
  const size = Number(header?.[1]);

  const body = pdf.slice(startxref + (header?.[0].length ?? 0));
  const offsets: number[] = [];
  const entry = /(\d{10}) (\d{5}) ([nf])/g;
  let match = entry.exec(body);
  while (match !== null && offsets.length < size) {
    if (match[3] === 'n') offsets.push(Number(match[1]));
    match = entry.exec(body);
  }
  return { offsets, startxref, size };
}

function landsOnHeader(pdf: string, offset: number, objectNumber: number): boolean {
  return pdf.slice(offset, offset + String(objectNumber).length + 6) === `${objectNumber} 0 obj`;
}

describe('the file is a PDF', () => {
  const pdf = toPdf(TABLE);

  test('begins with the version header', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
  });

  test('ends with %%EOF', () => {
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  test('declares a catalog, a page tree and a Helvetica font', () => {
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Type /Pages');
    expect(pdf).toContain('/BaseFont /Helvetica');
    // A base-14 font, so nothing is embedded and the file stays small.
    expect(pdf).not.toContain('/FontFile');
  });

  test('every character is a single byte, so latin1 encoding is lossless', () => {
    for (const character of pdf) {
      expect(character.codePointAt(0) ?? 0).toBeLessThan(0x100);
    }
  });
});

describe('the xref table resolves', () => {
  const pdf = toPdf(TABLE);
  const { offsets, size } = parseXref(pdf);

  test('startxref points at a real xref table', () => {
    expect(offsets.length).toBeGreaterThan(3);
    expect(size).toBe(offsets.length + 1);
  });

  test('EVERY offset lands exactly on its object header', () => {
    offsets.forEach((offset, index) => {
      expect(landsOnHeader(pdf, offset, index + 1), 'object ' + (index + 1) + ' offset is wrong')
        .toBe(true);
    });
  });

  test('the trailer Size matches the entry count', () => {
    const trailer = /\/Size (\d+)/.exec(pdf);
    expect(Number(trailer?.[1])).toBe(size);
  });

  test('MUTATION: a corrupted xref offset is CAUGHT', () => {
    // Shift one offset by a single byte. The walk above must reject it —
    // otherwise it is not checking what it claims to check.
    const target = offsets[1] ?? 0;
    const broken = pdf.replace(
      String(target).padStart(10, '0') + ' 00000 n',
      String(target + 1).padStart(10, '0') + ' 00000 n',
    );
    expect(broken).not.toBe(pdf);

    const mutated = parseXref(broken);
    const landed = mutated.offsets.map((offset, index) => landsOnHeader(broken, offset, index + 1));

    expect(landed).toContain(false);
  });
});

describe('the content', () => {
  const pdf = toPdf(TABLE);

  test('carries the title and the subtitle', () => {
    expect(pdf).toContain('(Pharmacy registrations) Tj');
    expect(pdf).toContain('1 Jan 2026 to 25 Oct 2026');
  });

  test('carries every header and every cell', () => {
    for (const heading of TABLE.headers) expect(pdf).toContain(`(${heading}) Tj`);
    for (const row of TABLE.rows) {
      for (const cell of row) expect(pdf).toContain(`(${cell}) Tj`);
    }
  });

  test('numbers its pages', () => {
    expect(pdf).toContain('(Page 1 of 1) Tj');
  });

  test('a long table paginates, and EVERY page repeats the column headers', () => {
    const perPage = rowsPerPage();
    const many = {
      ...TABLE,
      rows: Array.from({ length: perPage * 2 + 1 }, (_unused, index) => [
        'Shop ' + index,
        'Dhaka',
        '01 Jan 2026',
      ]),
    };

    const long = toPdf(many);
    const { offsets } = parseXref(long);

    expect(long).toContain('(Page 1 of 3) Tj');
    expect(long).toContain('(Page 3 of 3) Tj');
    // A continuation sheet with no headers is a sheet whose columns have to be
    // guessed, so the heading appears once per page.
    expect(long.split('(Pharmacy) Tj').length - 1).toBe(3);
    expect(long).toContain('/Count 3');
    // Three fixed objects plus two per page.
    expect(offsets).toHaveLength(3 + 2 * 3);
  });

  test('an empty table still produces one valid page', () => {
    const empty = toPdf({ ...TABLE, rows: [] });
    const { offsets } = parseXref(empty);

    expect(empty).toContain('(Page 1 of 1) Tj');
    expect(offsets).toHaveLength(5);
    expect(empty).toContain('/Count 1');
  });
});

describe('string escaping', () => {
  test('the three literal-breaking characters are escaped', () => {
    // An unescaped ')' ends the string early and every byte after it is read as
    // operators, which is how a hand-written PDF becomes unopenable.
    expect(pdfText('a(b)c')).toBe('a\\(b\\)c');
    expect(pdfText('back\\slash')).toBe('back\\\\slash');
  });

  test('a Latin-1 accent survives as an octal escape', () => {
    expect(pdfText('café')).toBe('caf\\351');
  });

  test('BANGLA BECOMES ?, and that limit is stated rather than hidden', () => {
    // Helvetica with the standard encoding cannot render it. Silently dropping
    // the characters would turn one pharmacy's name into another's.
    expect(pdfText('ওষুধ')).toBe('????');
    expect(PDF_LATIN1_NOTICE).toContain('CSV');
    expect(PDF_LATIN1_NOTICE).toContain('?');
  });

  test('a Bangla pharmacy name cannot break the file it is written into', () => {
    const bangla = toPdf({ ...TABLE, rows: [['বনানী ফার্মেসি', 'ঢাকা', '12 Feb 2026']] });
    const { offsets } = parseXref(bangla);

    offsets.forEach((offset, index) => {
      expect(landsOnHeader(bangla, offset, index + 1)).toBe(true);
    });
  });

  test('a control character is replaced, not emitted raw', () => {
    expect(pdfText('a\u0000b')).toBe('a?b');
    expect(pdfText('a\u0007b')).toBe('a?b');
  });
});

describe('the response header', () => {
  test('is application/pdf', () => {
    expect(PDF_CONTENT_TYPE).toBe('application/pdf');
  });
});
