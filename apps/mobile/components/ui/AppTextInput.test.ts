import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ TextInput: () => null }));
vi.mock("@muthoy/constants", () => ({ colors: { midGray: "#6B7280", brandGreen: "#059669" } }));

const { fixedHeightInputStyle } = await import("./AppTextInput");

describe("fixedHeightInputStyle (digits clipped in fixed-height boxes, 2026-11-27)", () => {
  it("centres a single-line field that fixes its height and sets no vertical padding", () => {
    // The cart's quantity box: "1" rendered as "⊥".
    expect(
      fixedHeightInputStyle("h-10 w-16 rounded-lg border text-center font-mono text-base", false),
    ).toEqual({ paddingVertical: 0, includeFontPadding: false, textAlignVertical: "center" });
    expect(fixedHeightInputStyle("h-11 px-3", undefined)).not.toBeNull();
    expect(fixedHeightInputStyle("h-[52px] px-3", undefined)).not.toBeNull();
  });

  it("leaves fields that pad themselves, grow, or have no fixed height alone", () => {
    expect(fixedHeightInputStyle("h-12 py-2 px-3", false)).toBeNull();
    expect(fixedHeightInputStyle("h-12 p-3", false)).toBeNull();
    expect(fixedHeightInputStyle("h-12 pt-1", false)).toBeNull();
    expect(fixedHeightInputStyle("min-h-48 p-4", true)).toBeNull();
    expect(fixedHeightInputStyle("h-12", true)).toBeNull();
    expect(fixedHeightInputStyle("rounded-2xl px-4 py-3", false)).toBeNull();
    expect(fixedHeightInputStyle("min-h-12 px-3", false)).toBeNull();
    expect(fixedHeightInputStyle(undefined, false)).toBeNull();
  });
});
