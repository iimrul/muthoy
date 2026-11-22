// domain/liveTextFrame.ts — one frame-processor OCR result -> the strip matcher's
// lines, plus the test for "is this a NEW reading?".
//
// Both functions run inside the camera's frame worklet (native/LiveTextCamera.tsx)
// for every camera frame, so they carry the 'worklet' directive, import nothing
// at runtime and stay allocation-light.

import type { OcrTextLine } from "./stripMatcher";

export interface LiveTextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LiveTextLine {
  lineText: string;
  lineFrame: LiveTextBox;
}
export interface LiveTextBlock {
  lines: readonly LiveTextLine[];
}
/** The subset of react-native-vision-camera-ocr-plus's RecognizedText used here. */
export interface LiveTextResult {
  resultText: string;
  blocks: readonly LiveTextBlock[];
}

/** How often "nothing readable in view" is passed on (see liveTextResultKey). */
export const LIVE_TEXT_EMPTY_REPEAT_MS = 150;

/** ML Kit lines -> matcher lines: text plus rendered height (the brand is the biggest print). */
export function toOcrTextLines(result: LiveTextResult): OcrTextLine[] {
  "worklet";
  const lines: OcrTextLine[] = [];
  for (const block of result.blocks) {
    for (const line of block.lines) {
      if (line.lineText.trim().length === 0) continue;
      lines.push({ text: line.lineText, height: Math.max(0, line.lineFrame.height) });
    }
  }
  return lines;
}

/**
 * The OCR plugin answers EVERY camera frame with its last COMPLETED result, so
 * most frames repeat the previous answer. A repeat must not reach the scan
 * session: it would count as a second, independent sighting, and
 * domain/stripScanSession.ts waits for two before acting on a weak, ambiguous
 * or not-found read. Two real readings of a hand-held strip differ in at least
 * one pixel of some text box; a repeat is identical, so the key is the text plus
 * every line box. A frame where the boxes happen to match exactly is only
 * delayed to the next reading, never counted twice.
 *
 * A reading with no text has no boxes to tell repeats apart, so it gets a key
 * that changes every LIVE_TEXT_EMPTY_REPEAT_MS instead: "nothing in view" is what
 * releases a scanned medicine for re-scanning, and repeating it can never add
 * anything to the cart.
 */
export function liveTextResultKey(result: LiveTextResult, now: number): string {
  "worklet";
  if (result.blocks.length === 0) return `empty:${Math.floor(now / LIVE_TEXT_EMPTY_REPEAT_MS)}`;
  let key = result.resultText;
  for (const block of result.blocks) {
    for (const line of block.lines) {
      const box = line.lineFrame;
      key += `|${box.x},${box.y},${box.width},${box.height}`;
    }
  }
  return key;
}
