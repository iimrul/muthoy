// native/scanner.ts — the ONLY code touching ML Kit (DEVELOPMENT_RULES.md:
// "native/ — the ONLY code that imports native modules"). P1 (post-beta
// fast-follow, Volume 0's scope lock) — manual entry/search covers Beta.
// TECH_STACK.md / Volume 4 OCR+BARCODE: "ML Kit (on-device) — barcode
// scanning AND text recognition (OCR); ONE engine, two APIs, not two
// separate libraries" — hence one file, not native/ocr.ts + native/barcode.ts.
// Needs an Expo development build, not Expo Go (TECH_STACK.md's native
// module constraints note) — confirmed on Day 1's EAS dev build config.
//
// Both scanning modes share the same two usage contexts (Volume 4):
//   - Sales screen: read-only lookup, matches scanned text/code against
//     local inventory (db/sales.ts's searchMedicinesForSale).
//   - Add Medicine: prefills form fields, REQUIRES user confirmation before
//     saving — never auto-saves a scanned value (Volume 4 OCR).

export interface BarcodeScanResult {
  data: string;
  format: string;
}

// TODO(P1): ML Kit barcode scanning API.
export async function scanBarcode(): Promise<BarcodeScanResult | null> {
  throw new Error('TODO: implement ML Kit barcode scanning (P1 — post-beta, Volume 4 BARCODE)');
}

export interface TextScanResult {
  recognizedText: string;
}

// TODO(P1): ML Kit text recognition (OCR) API — same underlying engine as
// scanBarcode above, different ML Kit API surface.
export async function scanText(): Promise<TextScanResult | null> {
  throw new Error('TODO: implement ML Kit text recognition (P1 — post-beta, Volume 4 OCR)');
}
