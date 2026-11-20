// domain/scanPictureSize.ts — which camera picture size the live strip scanner
// asks for.
//
// The camera's default is its largest still (12 MP or more on most phones). A
// live scanner captures several of those a second, and both the capture and
// ML Kit's recognition scale with pixel count, so the default is the slowest
// possible choice. A long edge of SCAN_MIN_LONG_EDGE still gives strip text
// held at reading distance roughly 30 px per character, comfortably above what
// on-device text recognition needs.

export const SCAN_MIN_LONG_EDGE = 1280;

interface ParsedSize {
  value: string;
  longEdge: number;
  shortEdge: number;
}

function parseSize(value: string): ParsedSize | null {
  const match = /^(\d+)x(\d+)$/.exec(value.trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0 && height > 0)) return null;
  return { value, longEdge: Math.max(width, height), shortEdge: Math.min(width, height) };
}

/**
 * The smallest "WxH" size whose long edge reaches SCAN_MIN_LONG_EDGE (ties go to
 * the larger short edge — more pixels for small print), else the largest size
 * on offer. Null when nothing parses (iOS presets such as "Photo"), which means
 * "leave the camera's default alone".
 */
export function pickScanPictureSize(sizes: readonly string[]): string | null {
  const parsed = sizes.map(parseSize).filter((size): size is ParsedSize => size !== null);
  if (parsed.length === 0) return null;
  const bigEnough = parsed
    .filter((size) => size.longEdge >= SCAN_MIN_LONG_EDGE)
    .sort((a, b) => a.longEdge - b.longEdge || b.shortEdge - a.shortEdge);
  if (bigEnough[0]) return bigEnough[0].value;
  const largest = [...parsed].sort((a, b) => b.longEdge - a.longEdge || b.shortEdge - a.shortEdge);
  return largest[0]?.value ?? null;
}
