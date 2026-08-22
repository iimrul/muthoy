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
//
import { recognizeText } from '@infinitered/react-native-mlkit-text-recognition';

export interface BarcodeScanResult {
  data: string;
  format: string;
}

// expo-camera's CameraView delegates barcode recognition to the platform ML
// Kit scanner. Keep normalization in native/ so components never depend on a
// native event shape and blank/whitespace payloads cannot reach a DB lookup.
export function scanBarcode(data: string, format: string): BarcodeScanResult | null {
  const normalized = data.trim();
  return normalized ? { data: normalized, format } : null;
}

export interface TextScanResult {
  recognizedText: string;
}

// Signature intentionally differs from the original stub: ML Kit's
// recognizeText() needs an actual captured photo to process — there is no
// parameterless OCR call. imageUri comes from ScannerCamera's
// captureAsync() (a local file:// URI from expo-camera's takePictureAsync).
// No try/catch here: errors bubble to the caller (MedicineTextScanner),
// which already has an error UI state to show — same thin-wrapper style as
// native/crypto.ts.
export async function scanText(imageUri: string): Promise<TextScanResult | null> {
  const result = await recognizeText(imageUri);
  const recognizedText = result.text.trim();
  return recognizedText ? { recognizedText } : null;
}
