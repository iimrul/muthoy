import { describe, expect, it } from "vitest";
import { pickScanPictureSize } from "./scanPictureSize";

describe("pickScanPictureSize", () => {
  it("picks the smallest size that still reaches 1280 px on the long edge", () => {
    expect(pickScanPictureSize(["4000x3000", "1920x1080", "1280x720", "640x480"])).toBe("1280x720");
  });

  it("prefers the taller of two equally long sizes", () => {
    expect(pickScanPictureSize(["1280x720", "1280x960", "4000x3000"])).toBe("1280x960");
  });

  it("falls back to the largest size when none reaches 1280", () => {
    expect(pickScanPictureSize(["640x480", "1024x768", "352x288"])).toBe("1024x768");
  });

  it("leaves the camera default alone when no size is WxH (iOS presets)", () => {
    expect(pickScanPictureSize(["Photo", "High", "Medium"])).toBeNull();
    expect(pickScanPictureSize([])).toBeNull();
  });

  it("ignores presets mixed in with real sizes", () => {
    expect(pickScanPictureSize(["Photo", "3840x2160", "1280x720"])).toBe("1280x720");
  });
});
