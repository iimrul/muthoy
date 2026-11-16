import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  random: vi.fn(),
  digest: vi.fn(),
  importKey: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  fromParts: vi.fn(),
  ciphertext: vi.fn(),
}));
vi.mock("expo-crypto", () => ({
  getRandomBytesAsync: api.random,
  getRandomBytes: () => {
    throw new Error("Weak development RNG must not be called");
  },
  digest: api.digest,
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  AESEncryptionKey: { import: api.importKey },
  AESSealedData: { fromParts: api.fromParts },
  aesEncryptAsync: api.encrypt,
  aesDecryptAsync: api.decrypt,
}));
const { nativeRecoveryCipher } = await import("./recoveryCrypto");
beforeEach(() => {
  vi.resetAllMocks();
  api.random.mockImplementation(async (n) => new Uint8Array(n).fill(1));
  api.importKey.mockResolvedValue("synthetic-native-key-handle");
  api.ciphertext.mockResolvedValue(new Uint8Array([1, 2, 3]));
  api.encrypt.mockResolvedValue({ ciphertext: api.ciphertext });
  api.fromParts.mockReturnValue("synthetic-sealed-handle");
  api.decrypt.mockResolvedValue(new Uint8Array([5, 6]));
});
// Boundary plumbing only. Real AES fault tests run separately using Node
// WebCrypto; native Expo AES must still be exercised on an approved native build.
describe("installed Expo AES recovery adapter contract", () => {
  it("uses only the asynchronous secure RNG and propagates its refusal", async () => {
    expect(await nativeRecoveryCipher.random(32)).toHaveLength(32);
    expect(api.random).toHaveBeenCalledWith(32);
    api.random.mockRejectedValueOnce(new Error("synthetic entropy refusal"));
    await expect(nativeRecoveryCipher.random(32)).rejects.toThrow(
      "entropy refusal",
    );
  });
  it("binds exact nonce/AAD and a 16-byte authentication tag without changing plaintext", async () => {
    const key = new Uint8Array(32).fill(2),
      nonce = new Uint8Array(12).fill(3),
      data = new Uint8Array([10, 20]),
      aad = new Uint8Array([30]);
    expect(await nativeRecoveryCipher.seal(key, nonce, data, aad)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(api.importKey).toHaveBeenCalledWith(key);
    expect(api.encrypt).toHaveBeenCalledWith(
      data,
      "synthetic-native-key-handle",
      { nonce: { bytes: nonce }, additionalData: aad, tagLength: 16 },
    );
    expect(api.ciphertext).toHaveBeenCalledWith({ includeTag: true });
  });
  it("restores separate nonce/ciphertext/tag and authenticates exact AAD", async () => {
    const key = new Uint8Array(32).fill(2),
      nonce = new Uint8Array(12).fill(3),
      ciphertext = new Uint8Array(24),
      aad = new Uint8Array([30]);
    expect(
      await nativeRecoveryCipher.open(key, nonce, ciphertext, aad),
    ).toEqual(new Uint8Array([5, 6]));
    expect(api.fromParts).toHaveBeenCalledWith(nonce, ciphertext, 16);
    expect(api.decrypt).toHaveBeenCalledWith(
      "synthetic-sealed-handle",
      "synthetic-native-key-handle",
      { additionalData: aad, output: "bytes" },
    );
    api.decrypt.mockRejectedValueOnce(
      new Error("synthetic authentication failed"),
    );
    await expect(
      nativeRecoveryCipher.open(key, nonce, ciphertext, aad),
    ).rejects.toThrow("authentication failed");
  });
  it("copies exact digest input into an ArrayBuffer and never returns a fallback on key import failure", async () => {
    api.digest.mockResolvedValue(new Uint8Array([1, 2]).buffer);
    expect(await nativeRecoveryCipher.sha256(new Uint8Array([4, 5]))).toEqual(
      new Uint8Array([1, 2]),
    );
    expect(api.digest).toHaveBeenCalledWith("SHA-256", expect.any(ArrayBuffer));
    expect(Array.from(new Uint8Array(api.digest.mock.calls[0]![1]))).toEqual([
      4, 5,
    ]);
    api.importKey.mockRejectedValue(new Error("synthetic key import refused"));
    await expect(
      nativeRecoveryCipher.seal(
        new Uint8Array(32),
        new Uint8Array(12),
        new Uint8Array(),
        new Uint8Array(),
      ),
    ).rejects.toThrow("key import refused");
    expect(api.encrypt).not.toHaveBeenCalled();
  });
});
