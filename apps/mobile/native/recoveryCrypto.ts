import {
  AESEncryptionKey,
  AESSealedData,
  aesEncryptAsync,
  aesDecryptAsync,
  digest,
  CryptoDigestAlgorithm,
  getRandomBytesAsync,
} from "expo-crypto";
import type { RecoveryCipher } from "../domain/recoveryArchive";

// Always asynchronous secure randomness. Expo's synchronous development RNG
// fallback must never generate an owner recovery secret or GCM nonce.
export const nativeRecoveryCipher: RecoveryCipher = {
  random: getRandomBytesAsync,
  async sha256(data) {
    return new Uint8Array(
      await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(data).buffer),
    );
  },
  async seal(rawKey, nonce, plaintext, aad) {
    const key = await AESEncryptionKey.import(rawKey);
    const sealed = await aesEncryptAsync(plaintext, key, {
      nonce: { bytes: nonce },
      additionalData: aad,
      tagLength: 16,
    });
    return sealed.ciphertext({ includeTag: true });
  },
  async open(rawKey, nonce, ciphertext, aad) {
    const key = await AESEncryptionKey.import(rawKey);
    return aesDecryptAsync(
      AESSealedData.fromParts(nonce, ciphertext, 16),
      key,
      { additionalData: aad, output: "bytes" },
    );
  },
};
