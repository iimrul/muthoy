import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hookSecretKey,
  MAX_SECRET_BYTES,
  MIN_SECRET_BYTES,
  SIGNATURE_TOLERANCE_SECONDS,
  verifyHookSignature,
} from "./signature.ts";

// The signature is the ONLY gate in front of a paid SMS: the function runs with
// verify_jwt = false. Every expected signature below is computed independently
// with node:crypto, so the Web Crypto implementation is checked against a
// second implementation rather than against itself.

const KEY = Buffer.alloc(32, 0x5a);
const SECRET = `v1,whsec_${KEY.toString("base64")}`;
const NOW = 1_800_000_000;
const ID = "4f5c9a52-6a0b-4d1f-9e1d-0d6b7a1c2e3f";
const BODY = JSON.stringify({
  user: { phone: "8801712345678" },
  sms: { otp: "123456", phone: "8801712345678" },
});

function sign(id: string, timestamp: number | string, body: string, key: Buffer = KEY): string {
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

function request(overrides: Partial<{
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  body: string;
}> = {}) {
  return {
    webhookId: ID,
    webhookTimestamp: String(NOW),
    webhookSignature: sign(ID, NOW, BODY),
    body: BODY,
    ...overrides,
  };
}

describe("Standard Webhooks verification", () => {
  it("matches the Standard Webhooks reference vector", async () => {
    await expect(verifyHookSignature(
      {
        webhookId: "msg_p5jXN8AQM9LWM0D4loKWxJek",
        webhookTimestamp: "1614265330",
        webhookSignature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
        body: '{"test": 2432232314}',
      },
      "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
      1614265330,
    )).resolves.toEqual({ ok: true, webhookId: "msg_p5jXN8AQM9LWM0D4loKWxJek" });
  });

  it("accepts a request signed the way Supabase Auth signs it", async () => {
    await expect(verifyHookSignature(request(), SECRET, NOW))
      .resolves.toEqual({ ok: true, webhookId: ID });
  });

  it.each([
    ["v1,whsec_<base64>", SECRET],
    ["whsec_<base64>", `whsec_${KEY.toString("base64")}`],
  ])("reads the secret written as %s", async (_label, secret) => {
    expect((await verifyHookSignature(request(), secret, NOW)).ok).toBe(true);
  });

  it.each([MIN_SECRET_BYTES, MAX_SECRET_BYTES])("accepts a %i-byte key, the Standard Webhooks bound", async (bytes) => {
    const key = Buffer.alloc(bytes, 0x42);
    const signed = request({ webhookSignature: sign(ID, NOW, BODY, key) });
    expect(MIN_SECRET_BYTES).toBe(24);
    expect(MAX_SECRET_BYTES).toBe(64);
    await expect(verifyHookSignature(signed, `v1,whsec_${key.toString("base64")}`, NOW))
      .resolves.toEqual({ ok: true, webhookId: ID });
  });

  it("accepts GoTrue's multi-signature header when any one signature matches", async () => {
    const other = sign(ID, NOW, BODY, Buffer.alloc(32, 0x11));
    const header = `${other}, ${sign(ID, NOW, BODY)}`;
    expect((await verifyHookSignature(request({ webhookSignature: header }), SECRET, NOW)).ok).toBe(true);
  });

  it.each([
    ["a body changed by one character", { body: BODY.replace("123456", "123457") }],
    ["a different webhook id", { webhookId: "4f5c9a52-6a0b-4d1f-9e1d-0d6b7a1c2e40" }],
    ["a different timestamp", { webhookTimestamp: String(NOW + 1) }],
    ["a signature made with another secret", { webhookSignature: sign(ID, NOW, BODY, Buffer.alloc(32, 1)) }],
    ["an unknown signature version", { webhookSignature: sign(ID, NOW, BODY).replace("v1,", "v2,") }],
    ["a truncated signature", { webhookSignature: sign(ID, NOW, BODY).slice(0, -4) }],
  ])("refuses %s", async (_label, overrides) => {
    await expect(verifyHookSignature(request(overrides), SECRET, NOW))
      .resolves.toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it.each([
    ["webhook-id", { webhookId: null }],
    ["webhook-timestamp", { webhookTimestamp: null }],
    ["webhook-signature", { webhookSignature: null }],
    ["an empty webhook-id", { webhookId: "" }],
    ["an oversized webhook-id", { webhookId: "x".repeat(201) }],
  ])("refuses a request missing %s", async (_label, overrides) => {
    await expect(verifyHookSignature(request(overrides), SECRET, NOW))
      .resolves.toEqual({ ok: false, reason: "signature_headers_missing" });
  });

  it.each(["soon", "-1", "1.5", ""])("refuses the timestamp %j", async (timestamp) => {
    const result = await verifyHookSignature(
      request({ webhookTimestamp: timestamp, webhookSignature: sign(ID, timestamp, BODY) }),
      SECRET,
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("bounds a replay in time on both sides, inclusive of the tolerance", async () => {
    for (const offset of [-SIGNATURE_TOLERANCE_SECONDS, SIGNATURE_TOLERANCE_SECONDS]) {
      const timestamp = NOW + offset;
      const signed = request({ webhookTimestamp: String(timestamp), webhookSignature: sign(ID, timestamp, BODY) });
      expect((await verifyHookSignature(signed, SECRET, NOW)).ok).toBe(true);
    }
    for (const offset of [-SIGNATURE_TOLERANCE_SECONDS - 1, SIGNATURE_TOLERANCE_SECONDS + 1]) {
      const timestamp = NOW + offset;
      const signed = request({ webhookTimestamp: String(timestamp), webhookSignature: sign(ID, timestamp, BODY) });
      await expect(verifyHookSignature(signed, SECRET, NOW))
        .resolves.toEqual({ ok: false, reason: "signature_timestamp_out_of_tolerance" });
    }
  });

  // H-5 review P1: only a canonical whsec_ secret of 24-64 bytes. Every other
  // shape fails closed — and each one below is given a key the request really
  // was signed with, so the refusal is the FORMAT's, not a signature mismatch.
  const b64 = (bytes: Buffer) => bytes.toString("base64");
  const KEY_25 = Buffer.alloc(25, 0x42); // base64 ends in "==" — padding is required
  it.each([
    ["an empty secret", "", KEY],
    ["a prefix with no key", "v1,whsec_", KEY],
    ["text that is not base64", "v1,whsec_not base64!", KEY],
    ["bare base64 with no whsec_ prefix", b64(KEY), KEY],
    ["v1, with no whsec_", `v1,${b64(KEY)}`, KEY],
    ["another version prefix", `v2,whsec_${b64(KEY)}`, KEY],
    ["the version prefix twice", `v1,v1,whsec_${b64(KEY)}`, KEY],
    ["an upper-case prefix", `v1,WHSEC_${b64(KEY)}`, KEY],
    ["a leading space", ` v1,whsec_${b64(KEY)}`, KEY],
    ["a trailing newline", `v1,whsec_${b64(KEY)}\n`, KEY],
    ["two secrets joined", `v1,whsec_${b64(KEY)} v1,whsec_${b64(KEY)}`, KEY],
    ["URL-safe base64", `v1,whsec_${Buffer.alloc(32, 0xfb).toString("base64url")}`, Buffer.alloc(32, 0xfb)],
    ["base64 missing its padding", `v1,whsec_${b64(KEY_25).replace(/=+$/, "")}`, KEY_25],
    // "…Qg==" → "…Qh==": decodes to the same bytes, but is not their canonical spelling.
    ["base64 with stray trailing bits", `v1,whsec_${b64(KEY_25).replace(/g==$/, "h==")}`, KEY_25],
    ["a 23-byte key, one under the floor", `v1,whsec_${b64(Buffer.alloc(23, 1))}`, Buffer.alloc(23, 1)],
    ["a 65-byte key, one over the ceiling", `v1,whsec_${b64(Buffer.alloc(65, 1))}`, Buffer.alloc(65, 1)],
  ])("refuses to verify anything with %s", async (_label, secret, signingKey) => {
    expect(hookSecretKey(secret)).toBeNull();
    const signed = request({ webhookSignature: sign(ID, NOW, BODY, signingKey) });
    await expect(verifyHookSignature(signed, secret, NOW))
      .resolves.toEqual({ ok: false, reason: "hook_secret_invalid" });
  });

  it("decodes a canonical secret to exactly its key bytes", () => {
    expect(Buffer.from(hookSecretKey(SECRET)!)).toEqual(KEY);
    expect(Buffer.from(hookSecretKey(`whsec_${b64(KEY_25)}`)!)).toEqual(KEY_25);
  });
});
