import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEV_PROJECT_REF } from "../config/environmentPolicy";
const state = vi.hoisted(() => ({
  url: "https://btfprhticjgeihcngpif.supabase.co",
  upload: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
  environment: vi.fn(),
}));
vi.mock("./supabaseClient", () => ({
  get supabaseUrl() {
    return state.url;
  },
  ensureCloudStartupAllowed: state.environment,
  supabase: { storage: { from: state.from } },
}));
const { createDevRecoveryStorage, DEV_RECOVERY_BUCKET } =
  await import("./recoveryStorage");
const path = `79000000-0000-4000-8000-000000000001/79000000-0000-4000-8000-000000000002/79000000-0000-4000-8000-000000000003.${"ab".repeat(32)}.mr1`;
beforeEach(() => {
  state.url = "https://btfprhticjgeihcngpif.supabase.co";
  state.upload.mockReset().mockResolvedValue({ error: null });
  state.download
    .mockReset()
    .mockResolvedValue({ data: new Blob(["encrypted archive"]), error: null });
  state.from
    .mockReset()
    .mockReturnValue({ upload: state.upload, download: state.download });
  state.environment.mockReset().mockResolvedValue(undefined);
});
describe("DEV private immutable recovery Storage SDK boundary", () => {
  it("uses the existing environment-bound client and exact immutable ArrayBuffer upload", async () => {
    const storage = createDevRecoveryStorage();
    await storage.putImmutable(path, "encrypted archive");
    expect(state.from).toHaveBeenCalledWith(DEV_RECOVERY_BUCKET);
    expect(state.environment).toHaveBeenCalledTimes(1);
    expect(state.upload).toHaveBeenCalledWith(path, expect.any(ArrayBuffer), {
      contentType: "application/octet-stream",
      upsert: false,
      cacheControl: "0",
    });
    expect(new TextDecoder().decode(state.upload.mock.calls[0]![1])).toBe(
      "encrypted archive",
    );
    expect(await storage.download(path)).toBe("encrypted archive");
  });
  it.each([
    "https://production.supabase.co",
    "http://btfprhticjgeihcngpif.supabase.co",
    "https://btfprhticjgeihcngpif.supabase.co/other",
    "https://btfprhticjgeihcngpif.supabase.co?token=invalid",
    "https://invalid@btfprhticjgeihcngpif.supabase.co",
  ])("refuses a different or ambiguous destination %#", (url) => {
    state.url = url;
    expect(() => createDevRecoveryStorage()).toThrow("approved DEV project");
    expect(state.from).not.toHaveBeenCalled();
  });
  it("refuses traversal before calling the SDK", async () => {
    const storage = createDevRecoveryStorage();
    await expect(
      storage.putImmutable("../" + path, "encrypted"),
    ).rejects.toThrow("path");
    await expect(storage.download(path + "/extra")).rejects.toThrow("path");
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });
  it("preserves environment refusal and performs no upload or download", async () => {
    const storage = createDevRecoveryStorage();
    state.environment.mockRejectedValue(
      new Error("synthetic environment mismatch"),
    );
    await expect(storage.putImmutable(path, "encrypted")).rejects.toThrow(
      "environment mismatch",
    );
    await expect(storage.download(path)).rejects.toThrow(
      "environment mismatch",
    );
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });
  it("treats duplicate only as a readback candidate and surfaces other upload failures", async () => {
    const storage = createDevRecoveryStorage();
    state.upload.mockResolvedValueOnce({
      error: { statusCode: 409, message: "already exists" },
    });
    await storage.putImmutable(path, "encrypted");
    expect(state.download).not.toHaveBeenCalled(); // protection requires the publishing controller's independent verification
    state.upload.mockResolvedValueOnce({
      error: { statusCode: 403, message: "denied" },
    });
    await expect(storage.putImmutable(path, "encrypted")).rejects.toThrow(
      "refused",
    );
  });
  it("refuses unavailable independent data instead of returning a local substitute", async () => {
    const storage = createDevRecoveryStorage();
    state.download.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    await expect(storage.download(path)).rejects.toThrow(
      "Independent recovery copy unavailable",
    );
  });
});

describe("the approved DEV origin", () => {
  it("is derived from the environment policy, never restated as a literal", () => {
    // L3 (2026-11-16 review). A second copy of the DEV ref here would drift the
    // moment the policy moved, while the policy-backed copy cannot.
    const source = readFileSync(resolve("apps/mobile/sync/recoveryStorage.ts"), "utf8");
    expect(source).not.toContain(DEV_PROJECT_REF);
    expect(source).toContain('from "../config/environmentPolicy"');
  });
});
