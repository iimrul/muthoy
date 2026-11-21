import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type GradleProperty = { type: "property"; key: string; value: string } | { type: "comment"; value: string };

const require = createRequire(import.meta.url);
const { applyMinSdk, MIN_SDK_VERSION } = require("../plugins/withAndroidMinSdk.js") as {
  applyMinSdk: (properties: GradleProperty[]) => GradleProperty[];
  MIN_SDK_VERSION: string;
};

describe("Android 8.0 minimum (founder decision 2026-11-21)", () => {
  it("sets android.minSdkVersion to 26, replacing any earlier value, without touching other properties", () => {
    const properties: GradleProperty[] = [
      { type: "comment", value: "generated" },
      { type: "property", key: "android.minSdkVersion", value: "24" },
      { type: "property", key: "newArchEnabled", value: "true" },
    ];
    const result = applyMinSdk(structuredClone(properties));
    expect(MIN_SDK_VERSION).toBe("26");
    expect(result.filter((item) => item.type === "property" && item.key === "android.minSdkVersion")).toEqual([
      { type: "property", key: "android.minSdkVersion", value: "26" },
    ]);
    expect(result).toContainEqual(properties[0]);
    expect(result).toContainEqual(properties[2]);
    expect(applyMinSdk(structuredClone(result))).toEqual(result);
  });

  it("is wired into the shipping Expo config next to the frame-processor OCR plugin", () => {
    const config = JSON.parse(readFileSync("apps/mobile/app.json", "utf8")) as {
      expo: { plugins: (string | [string, unknown])[] };
    };
    expect(config.expo.plugins).toContain("./plugins/withAndroidMinSdk");
    expect(config.expo.plugins).toContainEqual([
      "react-native-vision-camera-ocr-plus",
      { disableTranslate: true, disableNonLatinTextRecognition: true },
    ]);
  });
});
