import { describe, expect, it } from "vitest";
import {
  canonicalRecoveryJson,
  generateRecoveryCode,
  openRecoverySnapshot,
  recoveryCodeBytes,
  recoveryHex,
  recoveryUtf8,
  sealRecoverySnapshot,
  validateRecoverySnapshot,
  type RecoveryCipher,
} from "./recoveryArchive";

import {
  webRecoveryCipher,
  syntheticRecoveryCode,
  protocolSnapshot,
} from "../tests/recoveryTestSupport";

describe("authenticated encrypted business recovery protocol", () => {
  it("roundtrips a complete tenant snapshot with real AES-256-GCM", async () => {
    const snapshot = protocolSnapshot(),
      archive = await sealRecoverySnapshot(
        snapshot,
        syntheticRecoveryCode,
        webRecoveryCipher,
      );
    expect(archive).not.toContain("owner_id");
    expect(
      await openRecoverySnapshot(
        archive,
        syntheticRecoveryCode,
        snapshot.header.shopId,
        webRecoveryCipher,
      ),
    ).toEqual(snapshot);
  });
  it("uses fresh nonces and independent random owner codes", async () => {
    const snapshot = protocolSnapshot(),
      a = await sealRecoverySnapshot(
        snapshot,
        syntheticRecoveryCode,
        webRecoveryCipher,
      ),
      b = await sealRecoverySnapshot(
        snapshot,
        syntheticRecoveryCode,
        webRecoveryCipher,
      );
    expect(JSON.parse(a).nonceHex).not.toBe(JSON.parse(b).nonceHex);
    const first = await generateRecoveryCode(webRecoveryCipher),
      second = await generateRecoveryCode(webRecoveryCipher);
    expect(recoveryCodeBytes(first)).toHaveLength(32);
    expect(first).not.toBe(second);
  });
  it.each(["", "1234", "00".repeat(32), "ff".repeat(31), "zz".repeat(32)])(
    "rejects weak or malformed owner factors (%#)",
    (code) => {
      expect(() => recoveryCodeBytes(code)).toThrow();
    },
  );
  it("refuses failed secure randomness instead of using a weak fallback", async () => {
    await expect(
      generateRecoveryCode({
        ...webRecoveryCipher,
        random: async (n) => new Uint8Array(n),
      }),
    ).rejects.toThrow("Secure random unavailable");
    await expect(
      generateRecoveryCode({
        ...webRecoveryCipher,
        random: async () => {
          throw new Error("RNG unavailable");
        },
      }),
    ).rejects.toThrow("RNG unavailable");
  });
  it("wrong owner factor cannot decrypt the archive", async () => {
    const s = protocolSnapshot(),
      archive = await sealRecoverySnapshot(
        s,
        syntheticRecoveryCode,
        webRecoveryCipher,
      );
    await expect(
      openRecoverySnapshot(
        archive,
        "b2".repeat(32),
        s.header.shopId,
        webRecoveryCipher,
      ),
    ).rejects.toThrow();
  });
  it.each([
    "shopId",
    "ownerId",
    "deviceId",
    "archiveId",
    "watermark",
    "previousSha256",
    "createdAt",
  ] as const)("authenticates changed %s metadata", async (key) => {
    const s = protocolSnapshot(),
      e = JSON.parse(
        await sealRecoverySnapshot(s, syntheticRecoveryCode, webRecoveryCipher),
      );
    e.header[key] =
      key === "watermark"
        ? 1
        : key === "createdAt"
          ? "2026-11-12T01:00:00.000Z"
          : key === "previousSha256"
            ? "aa".repeat(32)
            : "79000000-0000-4000-8000-000000000099";
    await expect(
      openRecoverySnapshot(
        JSON.stringify(e),
        syntheticRecoveryCode,
        e.header.shopId,
        webRecoveryCipher,
      ),
    ).rejects.toThrow();
  });
  it.each(["nonce", "ciphertext", "tag", "truncated", "extra"] as const)(
    "refuses %s corruption",
    async (kind) => {
      const s = protocolSnapshot(),
        e = JSON.parse(
          await sealRecoverySnapshot(
            s,
            syntheticRecoveryCode,
            webRecoveryCipher,
          ),
        );
      if (kind === "nonce") e.nonceHex = "ff".repeat(12);
      if (kind === "ciphertext")
        e.ciphertextHex =
          (e.ciphertextHex[0] === "0" ? "1" : "0") + e.ciphertextHex.slice(1);
      if (kind === "tag")
        e.ciphertextHex =
          e.ciphertextHex.slice(0, -2) +
          (e.ciphertextHex.endsWith("00") ? "01" : "00");
      if (kind === "truncated") e.ciphertextHex = e.ciphertextHex.slice(0, -10);
      if (kind === "extra") e.extra = "untrusted";
      await expect(
        openRecoverySnapshot(
          JSON.stringify(e),
          syntheticRecoveryCode,
          s.header.shopId,
          webRecoveryCipher,
        ),
      ).rejects.toThrow();
    },
  );
  it("rejects cross-tenant plaintext before encryption", async () => {
    const s = protocolSnapshot();
    s.tables.credits = [
      { id: "credit", shop_id: "other", amount: 100, balance: 100 },
    ];
    await expect(
      sealRecoverySnapshot(s, syntheticRecoveryCode, webRecoveryCipher),
    ).rejects.toThrow("Cross-shop");
  });
  it.each([1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    "rejects unsafe money %#",
    (amount) => {
      const s = protocolSnapshot();
      s.tables.credits = [
        { id: "credit", shop_id: s.header.shopId, amount, balance: 100 },
      ];
      expect(() => validateRecoverySnapshot(s)).toThrow(
        "Unsafe recovery numeric",
      );
    },
  );
  it("refuses missing tables, duplicate IDs and secrets rather than discarding them", () => {
    const s = protocolSnapshot();
    delete (s.tables as Partial<typeof s.tables>).sales;
    expect(() => validateRecoverySnapshot(s)).toThrow(
      "Incomplete recovery table set",
    );
    const a = protocolSnapshot();
    a.tables.users.push({ ...a.tables.users[0]! });
    expect(() => validateRecoverySnapshot(a)).toThrow(
      "Duplicate recovery identity",
    );
    const b = protocolSnapshot();
    b.tables.users[0]!.pin_hash = "not-a-recoverable-credential";
    expect(() => validateRecoverySnapshot(b)).toThrow("Credentials");
  });
  it("independently pins authenticated AAD bytes and rejects a disabled-AAD decrypt control", async () => {
    const s = protocolSnapshot(),
      archive = await sealRecoverySnapshot(
        s,
        syntheticRecoveryCode,
        webRecoveryCipher,
      ),
      e = JSON.parse(archive);
    expect(canonicalRecoveryJson(e.header)).toBe(
      canonicalRecoveryJson(s.header),
    );
    const ignoredAad: RecoveryCipher = {
      ...webRecoveryCipher,
      open: (key, nonce, ct) =>
        webRecoveryCipher.open(key, nonce, ct, new Uint8Array()),
    };
    await expect(
      openRecoverySnapshot(
        archive,
        syntheticRecoveryCode,
        s.header.shopId,
        ignoredAad,
      ),
    ).rejects.toThrow();
    expect(
      recoveryHex(await webRecoveryCipher.sha256(recoveryUtf8("abc"))),
    ).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("independent nested conflict credential refusal", () => {
  it.each(["pin_hash", "pin_lookup_tag", "device_secret", "access_token", "refresh_token", "recovery_code"])("rejects serialized superseded %s before sealing", async (key) => {
    const snapshot = protocolSnapshot();
    snapshot.tables.conflict_queue.push({ id: "synthetic-conflict", shop_id: snapshot.header.shopId, local_value: "{}", remote_value: "{}", superseded_payloads: JSON.stringify([{ id: "synthetic-outbox", seq: 1, op: "update", payload: JSON.stringify({ [key]: "synthetic-secret" }) }]) });
    await expect(sealRecoverySnapshot(snapshot, syntheticRecoveryCode, webRecoveryCipher)).rejects.toThrow("Credentials are not recoverable business data");
  });
  it.each(["{}", '[{"payload":"not-json"}]', '[{"payload":"[]"}]', '[{"payload":null}]'])("rejects malformed serialized conflict history %s", (history) => {
    const snapshot = protocolSnapshot();
    snapshot.tables.conflict_queue.push({ id: "synthetic-conflict", shop_id: snapshot.header.shopId, local_value: "{}", remote_value: "{}", superseded_payloads: history });
    expect(() => validateRecoverySnapshot(snapshot)).toThrow();
  });
});
