import { describe, expect, it } from "vitest";
import {
  LIVE_TEXT_EMPTY_REPEAT_MS,
  liveTextResultKey,
  toOcrTextLines,
  type LiveTextResult,
} from "./liveTextFrame";

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

const genericBlock = {
  lines: [
    { lineText: "Paracetamol 500 mg", lineFrame: box(42, 200, 280, 22) },
    { lineText: "   ", lineFrame: box(0, 0, 4, 4) },
  ],
};

const napaFrame: LiveTextResult = {
  resultText: "Napa Extra\nParacetamol 500 mg",
  blocks: [{ lines: [{ lineText: "Napa Extra", lineFrame: box(40, 120, 300, 64) }] }, genericBlock],
};

describe("toOcrTextLines", () => {
  it("flattens every block's lines in reading order with their heights", () => {
    expect(toOcrTextLines(napaFrame)).toEqual([
      { text: "Napa Extra", height: 64 },
      { text: "Paracetamol 500 mg", height: 22 },
    ]);
  });

  it("drops blank lines and never reports a negative height", () => {
    const lines = toOcrTextLines({
      resultText: "x",
      blocks: [{ lines: [{ lineText: "Flacol", lineFrame: box(0, 0, 10, -3) }, { lineText: "", lineFrame: box(0, 0, 1, 1) }] }],
    });
    expect(lines).toEqual([{ text: "Flacol", height: 0 }]);
  });

  it("returns no lines for an empty reading", () => {
    expect(toOcrTextLines({ resultText: "", blocks: [] })).toEqual([]);
  });
});

describe("liveTextResultKey", () => {
  it("gives a repeated (cached) result the same key", () => {
    const repeat: LiveTextResult = JSON.parse(JSON.stringify(napaFrame));
    expect(liveTextResultKey(repeat, 5_000)).toBe(liveTextResultKey(napaFrame, 1_000));
  });

  it("tells two real readings of the same text apart by a one-pixel box move", () => {
    const moved: LiveTextResult = {
      ...napaFrame,
      blocks: [{ lines: [{ lineText: "Napa Extra", lineFrame: box(41, 120, 300, 64) }] }, genericBlock],
    };
    expect(liveTextResultKey(moved, 1_000)).not.toBe(liveTextResultKey(napaFrame, 1_000));
  });

  it("tells readings apart by text even when the boxes match", () => {
    const other: LiveTextResult = { ...napaFrame, resultText: "Napa Extend\nParacetamol 665 mg" };
    expect(liveTextResultKey(other, 1_000)).not.toBe(liveTextResultKey(napaFrame, 1_000));
  });

  it("passes 'nothing in view' on once per repeat window", () => {
    const empty: LiveTextResult = { resultText: "", blocks: [] };
    const start = 10 * LIVE_TEXT_EMPTY_REPEAT_MS;
    expect(liveTextResultKey(empty, start)).toBe(liveTextResultKey(empty, start + LIVE_TEXT_EMPTY_REPEAT_MS - 1));
    expect(liveTextResultKey(empty, start + LIVE_TEXT_EMPTY_REPEAT_MS)).not.toBe(liveTextResultKey(empty, start));
  });

  it("never gives an empty reading the same key as a reading with text", () => {
    const empty: LiveTextResult = { resultText: "", blocks: [] };
    expect(liveTextResultKey(empty, 0)).not.toBe(liveTextResultKey(napaFrame, 0));
  });
});
