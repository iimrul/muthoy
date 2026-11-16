import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as bcrypt from "bcryptjs";

const text = (path: string) => readFileSync("apps/mobile/" + path, "utf8");
const json = (path: string) => JSON.parse(text(path));
const native = vi.hoisted(() => ({ require: vi.fn() }));
vi.mock("expo", () => ({ requireNativeModule: native.require }));

// These are source/configuration and JavaScript-boundary tests. They do NOT
// execute Swift, Keychain, SQLCipher or CoreBluetooth. XCTest needs Xcode.
describe("same-app iOS native integration source contracts", () => {
  for (const [module, cls] of [
    ["db-key", "MuthoyDbKey"],
    ["pin-crypto", "MuthoyPinCrypto"],
    ["ble-printer", "MuthoyBlePrinter"],
  ]) {
    it(`registers ${module} on both platforms with an Apple pod`, () => {
      const config = json(`modules/muthoy-${module}/expo-module.config.json`);
      expect(config.platforms).toEqual(["android", "apple"]);
      expect(config.apple.modules).toEqual([cls + "Module"]);
      expect(config.android.modules).toHaveLength(1);
      const pod = text(`modules/muthoy-${module}/ios/${cls}.podspec`);
      expect(pod).toContain("s.dependency 'ExpoModulesCore'");
      expect(pod).toContain("s.platforms = { :ios => '16.4' }");
      expect(text(`modules/muthoy-${module}/ios/${cls}Module.swift`)).toContain(
        `Name("${cls}")`,
      );
    });
  }
  it("enables SQLCipher separately on iOS while retaining Android configuration", () => {
    const app = json("app.json").expo;
    const sqlite = app.plugins.find(
      (p: unknown) => Array.isArray(p) && p[0] === "expo-sqlite",
    );
    expect(sqlite[1]).toEqual({
      android: { useSQLCipher: true },
      ios: { useSQLCipher: true },
    });
    expect(app.ios.infoPlist.NSBluetoothAlwaysUsageDescription).toContain(
      "receipt printer",
    );
    expect(app.android.permissions).toContain(
      "android.permission.BLUETOOTH_CONNECT",
    );
  });
  it("pins every vendored bcrypt byte to the approved fixed commit", () => {
    const base = "modules/muthoy-pin-crypto/ios/Vendor/BCryptSwift/";
    const provenance = json(base + "PROVENANCE.json");
    expect(provenance.commit).toBe("7cebf3c0d9b507912f572a0ad9b4d6af764d8b1a");
    expect(Object.keys(provenance.files)).toHaveLength(7);
    for (const [name, hashes] of Object.entries(provenance.files) as [
      string,
      { gitBlobSha1: string; sha256: string },
    ][]) {
      const data = readFileSync("apps/mobile/" + base + name);
      expect(createHash("sha256").update(data).digest("hex")).toBe(
        hashes.sha256,
      );
      expect(
        createHash("sha1")
          .update(`blob ${data.length}\0`)
          .update(data)
          .digest("hex"),
      ).toBe(hashes.gitBlobSha1);
    }
    expect(text(base + "LICENSE")).toContain("Apache License");
    const adapter = text(
      "modules/muthoy-pin-crypto/ios/MuthoyPinCryptoModule.swift",
    );
    expect(adapter).not.toContain("verifyPasswordWithLegacySupport");
    expect(adapter).toContain("rounds: 10");
    expect(adapter).toContain(".runOnQueue(queue)");
  });
  it("keeps device keys nonsynchronizing, fails closed and uses no-clobber database rename", () => {
    for (const module of ["db-key", "pin-crypto"]) {
      const cls = module === "db-key" ? "MuthoyDbKey" : "MuthoyPinCrypto";
      const source = text(`modules/muthoy-${module}/ios/${cls}Module.swift`);
      expect(source).toContain(
        "kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly",
      );
      expect(source).toContain("kSecAttrSynchronizable as String: false");
      expect(source).toContain("SecRandomCopyBytes");
      expect(source).not.toMatch(/print\(|NSLog\(|SecItemDelete/);
    }
    const source = text("modules/muthoy-db-key/ios/MuthoyDbKeyModule.swift");
    expect(source).toContain("MU_DBKEY_UNRECOVERABLE");
    expect(source).toContain(
      "renameatx_np(fd, from, fd, to, UInt32(RENAME_EXCL))",
    );
    expect(source).toContain("fsync(fd)");
    expect(source).toContain("AT_SYMLINK_NOFOLLOW");
  });
  it("initializes installation custody before JS and excludes the installed SQLite/MMKV paths", () => {
    const config = json("modules/muthoy-db-key/expo-module.config.json");
    expect(config.apple.appDelegateSubscribers).toEqual(["MuthoyDataProtectionSubscriber"]);
    const source = text("modules/muthoy-db-key/ios/MuthoyDbKeyModule.swift");
    expect(source).toContain("subscriberDidRegister()");
    expect(source).toContain('documents.appendingPathComponent("SQLite")');
    expect(source).toContain('documents.appendingPathComponent("mmkv")');
    expect(source).toContain("values.isExcludedFromBackup = true");
    expect(source).toContain("O_EXCL | O_NOFOLLOW");
    expect(source).toContain("try AppleInstallationState.currentID()");
    expect(source).toContain("previousRaw: raw");
    const pin = text("modules/muthoy-pin-crypto/ios/MuthoyPinCryptoModule.swift");
    expect(pin).toContain("MuthoyInstallation/installation-v1");
    expect(pin).toContain("try muthoyPinInstallationID()");
    const attrs = text("modules/muthoy-pin-crypto/ios/Vendor/BCryptSwift/.gitattributes");
    expect(attrs).toContain("*.swift text eol=lf");
    expect(attrs).toContain("LICENSE text eol=lf");
    expect(attrs).toContain("PROVENANCE.json text eol=lf");
  });
  it("preserves independent synthetic bcrypt/HMAC golden values used by native XCTest", () => {
    const hash = "$2a$10$abcdefghijklmnopqrstuu03XQq4uczTxEDPe3ML4iARROHzHJ0n6";
    expect(bcrypt.hashSync("1234", "$2a$10$abcdefghijklmnopqrstuu")).toBe(hash);
    expect(bcrypt.compareSync("1235", hash)).toBe(false);
    const tag = createHmac(
      "sha256",
      Buffer.from(Array.from({ length: 32 }, (_, i) => i)),
    )
      .update("muthoy:device-pin-lookup:v1")
      .update(Buffer.from([0]))
      .update("1234")
      .digest("base64url");
    expect(tag).toBe("LElEKCnhMYkFpIOnpzKxz_h5jZWMVzd4H-GPkg5P1b8");
    const nativeTests = text(
      "modules/muthoy-pin-crypto/ios/Tests/MuthoyPinCryptoContractTests.swift",
    );
    expect(nativeTests).toContain(hash);
    expect(nativeTests).toContain(tag);
  });
});

describe("real shared JavaScript module boundary", () => {
  it("keeps database API fail-closed when its native module is unavailable", async () => {
    vi.resetModules();
    native.require.mockReset().mockImplementation(() => {
      throw new Error("Native module unavailable");
    });
    const db = await import("../modules/muthoy-db-key/src");
    expect(() => db.getOrCreateDatabaseKeyHexNative()).toThrow(
      "Native module unavailable",
    );
    expect(() => db.beginDatabaseKeyRecoveryNative()).toThrow(
      "Native module unavailable",
    );
    expect(native.require).toHaveBeenCalledWith("MuthoyDbKey");
  });
  it("forwards the unchanged database key/recovery/rename API", async () => {
    vi.resetModules();
    const api = {
      hasDatabaseKeyAsync: vi.fn().mockResolvedValue(true),
      getOrCreateDatabaseKeyHexAsync: vi
        .fn()
        .mockResolvedValue("ab".repeat(32)),
      hasPendingDatabaseKeyRecoveryAsync: vi.fn().mockResolvedValue(false),
      beginDatabaseKeyRecoveryAsync: vi.fn().mockResolvedValue("cd".repeat(32)),
      completeDatabaseKeyRecoveryAsync: vi.fn().mockResolvedValue(undefined),
      atomicRenameDatabaseFile: vi.fn(),
    };
    native.require.mockReturnValue(api);
    const db = await import("../modules/muthoy-db-key/src");
    expect(await db.hasDatabaseKeyNative()).toBe(true);
    expect(await db.getOrCreateDatabaseKeyHexNative()).toBe("ab".repeat(32));
    expect(await db.hasPendingDatabaseKeyRecoveryNative()).toBe(false);
    expect(await db.beginDatabaseKeyRecoveryNative()).toBe("cd".repeat(32));
    await db.completeDatabaseKeyRecoveryNative();
    db.atomicRenameDatabaseFileNative("muthoy.restore.db", "muthoy.db");
    expect(api.atomicRenameDatabaseFile).toHaveBeenCalledWith(
      "muthoy.restore.db",
      "muthoy.db",
    );
  });
  it("does not fall back to weaker JavaScript PIN crypto when native is missing", async () => {
    vi.resetModules();
    native.require.mockImplementation(() => {
      throw new Error("Native module unavailable");
    });
    const pin = await import("../modules/muthoy-pin-crypto/src");
    expect(() => pin.hashPinNative("synthetic", 10)).toThrow(
      "Native module unavailable",
    );
    expect(() => pin.createPinLookupTagNative("synthetic")).toThrow(
      "Native module unavailable",
    );
  });
});
