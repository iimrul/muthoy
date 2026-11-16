import { webcrypto } from "node:crypto";
import {
  RECOVERY_TABLES,
  type RecoveryCipher,
  type RecoverySnapshot,
} from "../domain/recoveryArchive";

// Real Node WebCrypto AES-GCM/SHA256. This is not an Expo-native runtime test.
export const webRecoveryCipher: RecoveryCipher = {
  async random(n) {
    return webcrypto.getRandomValues(new Uint8Array(n));
  },
  async sha256(data) {
    return new Uint8Array(
      await webcrypto.subtle.digest("SHA-256", data as BufferSource),
    );
  },
  async seal(key, nonce, data, aad) {
    const k = await webcrypto.subtle.importKey(
      "raw",
      key as BufferSource,
      "AES-GCM",
      false,
      ["encrypt"],
    );
    return new Uint8Array(
      await webcrypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nonce as BufferSource,
          additionalData: aad as BufferSource,
          tagLength: 128,
        },
        k,
        data as BufferSource,
      ),
    );
  },
  async open(key, nonce, data, aad) {
    const k = await webcrypto.subtle.importKey(
      "raw",
      key as BufferSource,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    return new Uint8Array(
      await webcrypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: nonce as BufferSource,
          additionalData: aad as BufferSource,
          tagLength: 128,
        },
        k,
        data as BufferSource,
      ),
    );
  },
};
export const syntheticRecoveryCode = "a1".repeat(32);
export function protocolSnapshot(): RecoverySnapshot {
  const shop = "79000000-0000-4000-8000-000000000001",
    owner = "79000000-0000-4000-8000-000000000002";
  const tables = Object.fromEntries(
    RECOVERY_TABLES.map((t) => [t, []]),
  ) as unknown as RecoverySnapshot["tables"];
  tables.shops = [{ id: shop, owner_id: owner }];
  tables.users = [{ id: owner, shop_id: shop }];
  tables.roles = [];
  return {
    header: {
      version: 1,
      schemaVersion: 35,
      shopId: shop,
      ownerId: owner,
      deviceId: "79000000-0000-4000-8000-000000000003",
      archiveId: "79000000-0000-4000-8000-000000000004",
      watermark: 0,
      previousSha256: null,
      createdAt: "2026-11-11T01:00:00.000Z",
    },
    tables,
  };
}
