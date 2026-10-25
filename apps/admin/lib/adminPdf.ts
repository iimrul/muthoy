// Batch 3 §8.10 — the PDF writer. PURE and DEPENDENCY-FREE.
//
// WHY BY HAND. A PDF generator is a large dependency with a large attack
// surface, and what this needs is narrow: a table of already-formatted text,
// Helvetica, a title, a range, repeated column headers and page numbers. The
// whole PDF 1.4 feature set is not required, so none of it is carried.
//
// The structure is the minimum a conforming reader needs:
//
//   1   Catalog   -> Pages
//   2   Pages     -> every Page
//   3   Font      Helvetica, a PDF base-14 font, so nothing is embedded
//   4.. Page + its Contents stream, two objects per page
//
// THE XREF TABLE IS THE PART THAT BREAKS. Every entry is a BYTE OFFSET from the
// start of the file, formatted as exactly ten digits, and a reader rejects the
// file outright if one is wrong. So the offsets are MEASURED while the body is
// assembled rather than computed from an assumed layout, and the test parses
// the output back and checks each offset lands on its `N 0 obj` header. A
// corrupted-xref mutation check proves the test can tell.
//
// LATIN-1 ONLY, STATED HONESTLY. Helvetica with the standard encoding cannot
// render Bangla, and embedding a Unicode font is a different piece of work. So
// a character outside printable Latin-1 becomes '?', and the CSV export — UTF-8
// with a BOM — is the complete one. The page offering the PDF says so. Silently
// dropping those characters would turn one pharmacy's name into another's.

const PDF_VERSION = '%PDF-1.4';
const POINTS_PER_INCH = 72;
/** A4 in points, the paper this will be printed on. */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = Math.round(POINTS_PER_INCH * 0.6);
const TITLE_SIZE = 16;
const BODY_SIZE = 9;
const LINE_HEIGHT = 13;
const HEADER_GAP = 6;

export interface PdfTable {
  title: string;
  /** Printed under the title: the date range, the filters, the row count. */
  subtitle: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

/**
 * Escapes a PDF string literal and forces it into printable Latin-1.
 *
 * `\`, `(` and `)` are the three characters that terminate or nest a literal;
 * an unescaped `)` ends the string early and every byte after it is read as
 * operators, which is how a hand-written PDF becomes unopenable.
 */
export function pdfText(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '\\' || character === '(' || character === ')') {
      out += '\\' + character;
    } else if (code >= 0x20 && code <= 0x7e) {
      out += character;
    } else if (code >= 0xa0 && code <= 0xff) {
      // Octal escape: a raw high byte would depend on the reader's guess.
      out += '\\' + code.toString(8).padStart(3, '0');
    } else {
      out += '?';
    }
  }
  return out;
}

/** Rows per page, derived from the geometry rather than guessed. */
export function rowsPerPage(): number {
  const top = PAGE_HEIGHT - MARGIN - TITLE_SIZE - LINE_HEIGHT - HEADER_GAP;
  const usable = top - MARGIN - LINE_HEIGHT;
  return Math.max(1, Math.floor(usable / LINE_HEIGHT));
}

function columnXs(columnCount: number): readonly number[] {
  const usable = PAGE_WIDTH - 2 * MARGIN;
  const width = usable / Math.max(1, columnCount);
  return Array.from({ length: columnCount }, (_unused, index) => MARGIN + index * width);
}

/** One page's content stream: the title block, the header row, then the rows. */
function contentStream(
  table: PdfTable,
  rows: readonly (readonly string[])[],
  pageNumber: number,
  pageCount: number,
): string {
  const xs = columnXs(table.headers.length);
  const parts: string[] = ['BT'];

  let y = PAGE_HEIGHT - MARGIN - TITLE_SIZE;
  parts.push(`/F1 ${TITLE_SIZE} Tf`, `1 0 0 1 ${MARGIN} ${y} Tm`, `(${pdfText(table.title)}) Tj`);

  y -= LINE_HEIGHT + HEADER_GAP;
  parts.push(`/F1 ${BODY_SIZE} Tf`, `1 0 0 1 ${MARGIN} ${y} Tm`, `(${pdfText(table.subtitle)}) Tj`);

  // The column headers repeat on EVERY page: a continuation sheet with no
  // headers is a sheet whose columns have to be guessed.
  y -= LINE_HEIGHT;
  for (const [index, heading] of table.headers.entries()) {
    parts.push(`1 0 0 1 ${Math.round(xs[index] ?? MARGIN)} ${y} Tm`, `(${pdfText(heading)}) Tj`);
  }

  for (const row of rows) {
    y -= LINE_HEIGHT;
    for (const [index, cell] of row.entries()) {
      parts.push(`1 0 0 1 ${Math.round(xs[index] ?? MARGIN)} ${y} Tm`, `(${pdfText(cell)}) Tj`);
    }
  }

  parts.push(
    `1 0 0 1 ${MARGIN} ${MARGIN} Tm`,
    `(${pdfText('Page ' + pageNumber + ' of ' + pageCount)}) Tj`,
    'ET',
  );
  return parts.join('\n');
}

function paginate(
  rows: readonly (readonly string[])[],
): readonly (readonly (readonly string[])[])[] {
  const perPage = rowsPerPage();
  if (rows.length === 0) return [[]];
  const pages: (readonly string[])[][] = [];
  for (let index = 0; index < rows.length; index += perPage) {
    pages.push([...rows.slice(index, index + perPage)]);
  }
  return pages;
}

/**
 * The whole document, as a string whose every character is one byte.
 *
 * A string rather than a Uint8Array because every character written here is in
 * the 0x00–0xFF range by construction — `pdfText` guarantees it — and a string
 * is what the test can read back. The route encodes it as latin1.
 */
export function toPdf(table: PdfTable): string {
  const pages = paginate(table.rows);
  const pageCount = pages.length;

  // Object numbering: 1 Catalog, 2 Pages, 3 Font, then two per page.
  const firstPageObject = 4;
  const pageObjectNumbers = pages.map((_unused, index) => firstPageObject + index * 2);

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectNumbers
      .map((number) => `${number} 0 R`)
      .join(' ')}] >>\nendobj\n`,
  );
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica'
    + ' /Encoding /WinAnsiEncoding >>\nendobj\n',
  );

  pages.forEach((rows, index) => {
    const pageNumber = pageObjectNumbers[index] ?? firstPageObject;
    const contentNumber = pageNumber + 1;
    const stream = contentStream(table, rows, index + 1, pageCount);
    objects.push(
      `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R`
      + ` /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}]`
      + ` /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${contentNumber} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });

  // Offsets are MEASURED as the body is assembled. Computing them from an
  // assumed layout is how an xref drifts by the length of one changed string.
  let body = PDF_VERSION + '\n';
  const offsets: number[] = [];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }

  const xrefOffset = body.length;
  const entries = ['0000000000 65535 f \n'];
  for (const offset of offsets) {
    entries.push(String(offset).padStart(10, '0') + ' 00000 n \n');
  }

  return body
    + `xref\n0 ${objects.length + 1}\n`
    + entries.join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`;
}

export const PDF_CONTENT_TYPE = 'application/pdf';

/** The honest limit, rendered beside any PDF download link. */
export const PDF_LATIN1_NOTICE =
  'The PDF uses Helvetica and can only render Latin characters; '
  + 'any other character appears as "?". Use the CSV export for a complete file.';
