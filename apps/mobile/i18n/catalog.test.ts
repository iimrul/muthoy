import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";

describe("locale catalog", () => {
  it("has Bangla/English key parity and no blank translations", () => {
    expect(Object.keys(catalog.bn).sort()).toEqual(
      Object.keys(catalog.en).sort(),
    );
    expect(Object.values(catalog.bn).every(Boolean)).toBe(true);
    expect(Object.values(catalog.en).every(Boolean)).toBe(true);
  });
});
