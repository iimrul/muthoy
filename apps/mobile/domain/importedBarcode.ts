// domain/importedBarcode.ts — a barcode as it arrives from a spreadsheet
// (founder, 2026-11-27: "বারকোডটাও ঠিক করো").
//
// The scanner matches a scanned code to medicines.barcode exactly, so a code
// Excel mangled is a medicine that never scans. Excel does two things:
//   1. A long number in a General cell is saved as shown: 8941234567896 becomes
//      "8.94123E+12". The digits are gone; it can only be refused, with how to
//      avoid it, never stored.
//   2. Leading zeros are dropped: UPC-A 036000291452 becomes 36000291452. The
//      GTIN check digit is unchanged by leading zeros, so an all-digit code of
//      an impossible GTIN length whose check digit holds is restored to the
//      length the camera reads (UPC-A 12, EAN-8 8). Anything else is kept as
//      typed — a shop's own code is not a GTIN.
// Excel's way of forcing text, ="0123", is unwrapped.
//
// Pure: no React, native or DB imports.

const SCIENTIFIC = /^\d+(?:\.\d+)?e\+?\d+$/i;
const EXCEL_TEXT = /^="(.*)"$/;

/** Unwraps Excel's ="…" text-forcing formula; any other value is returned trimmed. */
export function unwrapExcelText(raw: string): string {
  const text = raw.trim();
  return (EXCEL_TEXT.exec(text)?.[1] ?? text).trim();
}

/** GTIN-8/12/13/14 mod-10 check: weights 3,1,3,… from the digit left of the check digit. */
export function hasValidGtinCheckDigit(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  let sum = 0;
  for (let offset = 0; offset < digits.length - 1; offset += 1) {
    const digit = Number(digits[digits.length - 2 - offset]);
    sum += digit * (offset % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

export type ImportedBarcode = { isLost: false; value: string | null } | { isLost: true };

export function readImportedBarcode(raw: string): ImportedBarcode {
  const text = unwrapExcelText(raw);
  if (!text) return { isLost: false, value: null };
  if (SCIENTIFIC.test(text)) return { isLost: true };
  if (/^\d+$/.test(text) && hasValidGtinCheckDigit(text)) {
    if (text.length === 7) return { isLost: false, value: text.padStart(8, "0") };
    if (text.length >= 9 && text.length <= 11) return { isLost: false, value: text.padStart(12, "0") };
  }
  return { isLost: false, value: text };
}
