import { describe, expect, it } from "vitest";
import { encodeLocalizedText, localizeStoredText } from "./localizedText";

describe("localized stored notification text", () => {
  it("renders known bilingual payloads and preserves unknown literal text", () => {
    const value = encodeLocalizedText("Low stock", "কম স্টক");
    expect(localizeStoredText(value, "en")).toBe("Low stock");
    expect(localizeStoredText(value, "bn")).toBe("কম স্টক");
    expect(localizeStoredText("Server literal", "bn")).toBe("Server literal");
  });
});
