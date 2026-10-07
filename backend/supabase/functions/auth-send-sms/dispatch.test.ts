import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DAILY_CAP, readDispatchConfig } from "./config.ts";
import { CLAIM_TIMEOUT_MS, RECORD_TIMEOUT_MS } from "./handler.ts";
import {
  dispatchKeys,
  LEDGER_TIMEOUT,
  LedgerUnavailableError,
  parseClaimDecision,
  type RpcCaller,
  rpcDispatchLedger,
} from "./ledger.ts";
import { normalizeBdPhone } from "../sync/_shared/phone.ts";
import { otpMessage, SINGLE_SEGMENT_LIMIT, SMS_SAFE_TEXT } from "./message.ts";
import { parseSmsHookPayload } from "./payload.ts";

// The pieces of one send that are not REVE and not the signature: what the
// hook reads from GoTrue, the one message it writes, its own settings, and the
// keys and calls it makes against the dispatch ledger.

function hookBody(sms: Record<string, unknown>, user: Record<string, unknown> | null = null): string {
  return JSON.stringify({ ...(user ? { user } : {}), sms });
}

describe("the Send SMS hook payload", () => {
  it("sends to sms.phone — GoTrue's destination for every OTP type — before user.phone", () => {
    const result = parseSmsHookPayload(hookBody(
      { otp: "123456", phone: "8801712345678" },
      { phone: "8801899999999" },
    ));
    expect(result).toEqual({
      ok: true,
      delivery: { canonicalPhone: "+8801712345678", recipient: "8801712345678", otp: "123456" },
    });
  });

  it("falls back to user.phone only when sms.phone is absent altogether", () => {
    const result = parseSmsHookPayload(hookBody({ otp: "123456" }, { phone: "8801712345678" }));
    expect(result).toEqual({
      ok: true,
      delivery: { canonicalPhone: "+8801712345678", recipient: "8801712345678", otp: "123456" },
    });
  });

  it.each(["+911712345678", "abc8801712345678", "+8801712345678", "8801712345678 "])(
    "holds the user.phone fallback to GoTrue's exact form too: refuses %j",
    (phone) => {
      expect(parseSmsHookPayload(hookBody({ otp: "123456" }, { phone })))
        .toEqual({ ok: false, reason: "phone_unsupported" });
    },
  );

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["null", null],
    ["a number, not a string", 8801712345678],
    ["an object", { phone: "8801712345678" }],
    ["an array", ["8801712345678"]],
    ["foreign", "+911712345678"],
    ["not a number", "not-a-number"],
    ["one digit short", "880171234567"],
    ["one digit long", "88017123456789"],
    ["not a mobile prefix", "8801212345678"],
  ])("fails closed on a present but %s sms.phone — a valid user.phone never rescues it", (_label, phone) => {
    expect(parseSmsHookPayload(hookBody({ otp: "123456", phone }, { phone: "8801712345678" })))
      .toEqual({ ok: false, reason: "phone_unsupported" });
  });

  // Junk around or inside 8801712345678 that the shared, forgiving normalizer
  // strips away — which is exactly why it is not the gate. Each is refused.
  it.each([
    ["letters before the number", "abc8801712345678"],
    ["letters after the number", "8801712345678abc"],
    ["a letter inside the number", "880171234x5678"],
    ["a + inside the number", "8801+712345678"],
    ["a leading +", "+8801712345678"],
    ["a leading space", " 8801712345678"],
    ["a trailing space", "8801712345678 "],
    ["a leading tab", "\t8801712345678"],
    ["a trailing newline", "8801712345678\n"],
    ["a tel: prefix", "tel:8801712345678"],
    ["separators", "880-1712-345678"],
    ["a zero-width space inside", `8801712${String.fromCharCode(0x200b)}345678`],
    ["no 880 (the local form)", "01712345678"],
  ])("refuses an sms.phone with %s instead of normalizing it away — user.phone never rescues it", (_label, phone) => {
    expect(normalizeBdPhone(phone)).toBe("+8801712345678");
    expect(parseSmsHookPayload(hookBody({ otp: "123456", phone }, { phone: "8801712345678" })))
      .toEqual({ ok: false, reason: "phone_unsupported" });
  });

  it.each(["8801312345678", "8801712345678", "8801912345678"])(
    "reads %s — exactly the form GoTrue sends — as the canonical subscriber",
    (phone) => {
      expect(parseSmsHookPayload(hookBody({ otp: "123456", phone }))).toEqual({
        ok: true,
        delivery: { canonicalPhone: `+${phone}`, recipient: phone, otp: "123456" },
      });
    },
  );

  it.each([
    "+911712345678",
    "+1712345678",
    "447700900123",
    "8801212345678",
    "88017123456789",
    "not-a-number",
  ])("refuses %j before anything is claimed or sent", (phone) => {
    expect(parseSmsHookPayload(hookBody({ otp: "123456", phone })))
      .toEqual({ ok: false, reason: "phone_unsupported" });
  });

  it("refuses a payload with no number at all", () => {
    expect(parseSmsHookPayload(hookBody({ otp: "123456" }, { id: "user-1" })))
      .toEqual({ ok: false, reason: "phone_unsupported" });
  });

  it.each([["12345"], ["1234567"], ["12345a"], [123456], [null], ["١٢٣٤٥٦"]])(
    "refuses the code %j — the app accepts exactly six ASCII digits",
    (otp) => {
      expect(parseSmsHookPayload(hookBody({ otp, phone: "8801712345678" })))
        .toEqual({ ok: false, reason: "otp_invalid" });
    },
  );

  it.each([["not json"], ["[]"], ['{"user":{}}'], ['{"sms":"123456"}']])(
    "refuses the body %j",
    (body) => {
      expect(parseSmsHookPayload(body)).toEqual({ ok: false, reason: "payload_invalid" });
    },
  );
});

describe("the OTP message", () => {
  it("is exactly the locked English text", () => {
    expect(otpMessage("123456")).toBe("Muthoy code: 123456. Valid 5 minutes. Never share this code.");
  });

  it.each(["000000", "999999", "504193"])("stays one GSM-7 segment for %s", (otp) => {
    const text = otpMessage(otp);
    expect(text).toMatch(SMS_SAFE_TEXT);
    expect(text.length).toBeLessThanOrEqual(SINGLE_SEGMENT_LIMIT);
  });

  it.each(["12345", "1234567", "abcdef", ""])("refuses to write a message for %j", (otp) => {
    expect(() => otpMessage(otp)).toThrow();
  });
});

describe("the hook's own settings", () => {
  const HASH_KEY = Buffer.alloc(32, 3).toString("base64");
  const reader = (env: Record<string, string | undefined>) => (name: string) => env[name];

  it("defaults the per-number cap to the locked ten", () => {
    const result = readDispatchConfig(reader({ SMS_DISPATCH_HASH_KEY: HASH_KEY }));
    expect(result).toMatchObject({ ok: true, config: { dailyCap: DEFAULT_DAILY_CAP } });
    expect(DEFAULT_DAILY_CAP).toBe(10);
  });

  it.each([["1", 1], ["2", 2], ["10", 10]])("lets a DEV project lower the cap to %s", (value, expected) => {
    expect(readDispatchConfig(reader({ SMS_DISPATCH_HASH_KEY: HASH_KEY, OTP_SMS_DAILY_CAP_PER_PHONE: value })))
      .toMatchObject({ ok: true, config: { dailyCap: expected } });
  });

  it.each(["11", "0", "-1", "2.5", "ten", "100"])("fails closed on the cap %j instead of guessing", (value) => {
    expect(readDispatchConfig(reader({ SMS_DISPATCH_HASH_KEY: HASH_KEY, OTP_SMS_DAILY_CAP_PER_PHONE: value })))
      .toEqual({ ok: false, problem: "daily_cap_invalid" });
  });

  it.each([
    ["missing", undefined],
    ["not base64", "not base64!"],
    ["only 16 bytes", Buffer.alloc(16, 1).toString("base64")],
  ])("fails closed when the hash key is %s", (_label, value) => {
    expect(readDispatchConfig(reader({ SMS_DISPATCH_HASH_KEY: value })))
      .toEqual({ ok: false, problem: "dispatch_hash_key_invalid" });
  });

  it("has no previous key outside a rotation", () => {
    expect(readDispatchConfig(reader({ SMS_DISPATCH_HASH_KEY: HASH_KEY })))
      .toMatchObject({ ok: true, config: { previousHashKey: null } });
    expect(readDispatchConfig(reader({ SMS_DISPATCH_HASH_KEY: HASH_KEY, SMS_DISPATCH_HASH_KEY_PREVIOUS: "" })))
      .toMatchObject({ ok: true, config: { previousHashKey: null } });
  });

  it("reads the previous key during a rotation", () => {
    const previous = Buffer.alloc(32, 4);
    const result = readDispatchConfig(reader({
      SMS_DISPATCH_HASH_KEY: HASH_KEY,
      SMS_DISPATCH_HASH_KEY_PREVIOUS: previous.toString("base64"),
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(Buffer.from(result.config.previousHashKey as Uint8Array)).toEqual(previous);
  });

  it.each([
    ["not base64", "not base64!"],
    ["only 16 bytes", Buffer.alloc(16, 1).toString("base64")],
    ["the current key again", Buffer.alloc(32, 3).toString("base64")],
  ])("fails closed when the previous key is %s", (_label, value) => {
    expect(readDispatchConfig(reader({ SMS_DISPATCH_HASH_KEY: HASH_KEY, SMS_DISPATCH_HASH_KEY_PREVIOUS: value })))
      .toEqual({ ok: false, problem: "dispatch_previous_hash_key_invalid" });
  });
});

describe("the ledger keys", () => {
  const KEY = Buffer.alloc(32, 9);
  const hmacHex = (message: string) => createHmac("sha256", KEY).update(message).digest("hex");

  it("are HMAC-SHA256 under the hook's key — never the number or the code itself", async () => {
    const keys = await dispatchKeys(KEY, "+8801712345678", "123456");
    expect(keys).toEqual({
      keyId: hmacHex("key-id|h5-sms-dispatch").slice(0, 16),
      phoneKey: hmacHex("phone|+8801712345678"),
      contentKey: hmacHex("otp|+8801712345678|123456"),
    });
    expect(keys.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(keys.phoneKey).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.contentKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it("name their hash key the same way for every number, and differently per key", async () => {
    const one = await dispatchKeys(KEY, "+8801712345678", "123456");
    const other = await dispatchKeys(KEY, "+8801812345678", "654321");
    const rotated = await dispatchKeys(Buffer.alloc(32, 8), "+8801712345678", "123456");
    expect(other.keyId).toBe(one.keyId);
    expect(rotated.keyId).not.toBe(one.keyId);
    // A fingerprint, not the key: nothing of the key's bytes appears in it.
    expect(one.keyId).not.toContain(KEY.toString("hex").slice(0, 8));
  });

  it("separate numbers, separate codes, and the two key spaces", async () => {
    const base = await dispatchKeys(KEY, "+8801712345678", "123456");
    const otherNumber = await dispatchKeys(KEY, "+8801812345678", "123456");
    const otherCode = await dispatchKeys(KEY, "+8801712345678", "654321");
    expect(otherNumber.phoneKey).not.toBe(base.phoneKey);
    expect(otherNumber.contentKey).not.toBe(base.contentKey);
    expect(otherCode.phoneKey).toBe(base.phoneKey);
    expect(otherCode.contentKey).not.toBe(base.contentKey);
    expect(base.contentKey).not.toBe(base.phoneKey);
  });

  it("change completely under another hash key", async () => {
    const first = await dispatchKeys(KEY, "+8801712345678", "123456");
    const second = await dispatchKeys(Buffer.alloc(32, 8), "+8801712345678", "123456");
    expect(second.phoneKey).not.toBe(first.phoneKey);
  });
});

describe("the ledger calls", () => {
  const KEYS = { keyId: "1".repeat(16), phoneKey: "a".repeat(64), contentKey: "b".repeat(64) };
  const PREVIOUS = { keyId: "2".repeat(16), phoneKey: "c".repeat(64), contentKey: "d".repeat(64) };
  const OWNER = "00000000-0000-4000-8000-000000000001";
  const CLAIM = { webhookId: "msg_1", owner: OWNER, keys: KEYS, previousKeys: null, dailyCap: 10 };
  const HANDLE = { webhookId: "msg_1", owner: OWNER };
  const AMBIGUOUS = {
    status: "ambiguous", reason: "provider_timeout", providerStatus: null, providerMessageId: null,
  } as const;

  it.each([
    [{ decision: "send", resumed: false }, { decision: "send", resumed: false }],
    [{ decision: "send", resumed: true }, { decision: "send", resumed: true }],
    [{ decision: "capped" }, { decision: "capped" }],
    [{ decision: "unknown_key" }, { decision: "unknown_key" }],
    [{ decision: "duplicate", status: "accepted" }, { decision: "duplicate", status: "accepted" }],
    [{ decision: "duplicate", status: "pending" }, { decision: "duplicate", status: "pending" }],
  ])("reads the claim reply %j", (data, expected) => {
    expect(parseClaimDecision(data)).toEqual(expected);
  });

  it.each([
    [null],
    [[]],
    ["send"],
    [{ decision: "send!" }],
    // The ledger always says whether a send is a resumed one; without that it
    // is not the ledger this build was written against.
    [{ decision: "send" }],
    [{ decision: "send", resumed: "yes" }],
    [{ decision: "duplicate", status: "sent" }],
  ])("treats the claim reply %j as no answer at all", (data) => {
    expect(parseClaimDecision(data)).toBeNull();
  });

  it("claims with exactly the function's parameter names, owner included", async () => {
    const rpc = vi.fn<RpcCaller>(async () => ({ data: { decision: "send", resumed: false }, error: null }));
    const ledger = rpcDispatchLedger(rpc);
    await expect(ledger.claim(CLAIM, CLAIM_TIMEOUT_MS)).resolves.toEqual({ decision: "send", resumed: false });
    expect(rpc).toHaveBeenCalledWith("h5_claim_sms_dispatch", {
      p_webhook_id: "msg_1",
      p_claim_owner: OWNER,
      p_key_id: KEYS.keyId,
      p_phone_key: KEYS.phoneKey,
      p_content_key: KEYS.contentKey,
      p_previous_key_id: null,
      p_previous_phone_key: null,
      p_previous_content_key: null,
      p_daily_cap: 10,
    }, expect.any(AbortSignal));
  });

  it("passes the previous key's whole set during a rotation", async () => {
    const rpc = vi.fn<RpcCaller>(async () => ({ data: { decision: "send", resumed: false }, error: null }));
    await rpcDispatchLedger(rpc).claim({ ...CLAIM, previousKeys: PREVIOUS }, CLAIM_TIMEOUT_MS);
    expect(rpc).toHaveBeenCalledWith("h5_claim_sms_dispatch", expect.objectContaining({
      p_previous_key_id: PREVIOUS.keyId,
      p_previous_phone_key: PREVIOUS.phoneKey,
      p_previous_content_key: PREVIOUS.contentKey,
    }), expect.any(AbortSignal));
  });

  it("refuses to treat a failed or malformed claim as permission to send", async () => {
    const failing = rpcDispatchLedger(async () => ({
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    }));
    const failure = await failing.claim(CLAIM, CLAIM_TIMEOUT_MS).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(LedgerUnavailableError);
    expect(failure).toMatchObject({ step: "claim", code: "57014" });
    // The database's own text never travels further than this boundary.
    expect((failure as Error).message).not.toMatch(/statement timeout/);

    const malformed = rpcDispatchLedger(async () => ({ data: { decision: "maybe" }, error: null }));
    await expect(malformed.claim(CLAIM, CLAIM_TIMEOUT_MS)).rejects.toBeInstanceOf(LedgerUnavailableError);
  });

  it("reports a thrown transport failure with nothing of its message", async () => {
    const thrown = rpcDispatchLedger(async () => {
      throw new TypeError("error sending request for url (https://project.supabase.co/rest/v1/rpc)");
    });
    const failure = await thrown.claim(CLAIM, CLAIM_TIMEOUT_MS).catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ step: "claim", code: null });
    expect((failure as Error).message).not.toMatch(/supabase|https/);
  });

  it("records an outcome with exactly the function's parameter names, owner included", async () => {
    const rpc = vi.fn<RpcCaller>(async () => ({ data: true, error: null }));
    const ledger = rpcDispatchLedger(rpc);
    await expect(ledger.record(HANDLE, {
      status: "accepted",
      reason: null,
      providerStatus: "0",
      providerMessageId: "444",
    }, RECORD_TIMEOUT_MS)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("h5_record_sms_dispatch", {
      p_webhook_id: "msg_1",
      p_claim_owner: OWNER,
      p_status: "accepted",
      p_reason: null,
      p_provider_status: "0",
      p_provider_message_id: "444",
    }, expect.any(AbortSignal));
  });

  it("reports an unsettled record as false, and a failed one as an error", async () => {
    const unsettled = rpcDispatchLedger(async () => ({ data: false, error: null }));
    await expect(unsettled.record(HANDLE, AMBIGUOUS, RECORD_TIMEOUT_MS)).resolves.toBe(false);

    const failing = rpcDispatchLedger(async () => ({ data: null, error: { code: "23514" } }));
    await expect(failing.record(HANDLE, AMBIGUOUS, RECORD_TIMEOUT_MS))
      .rejects.toMatchObject({ step: "record", code: "23514" });
  });

  describe("bounded by the wait they are given", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** An RPC whose reply lands `delayMs` after it is called; it keeps the signal it got. */
    function replyingAfter(delayMs: number, data: unknown) {
      const signals: AbortSignal[] = [];
      const rpc = vi.fn<RpcCaller>((_name, _args, signal) => {
        signals.push(signal);
        return new Promise((resolve) => setTimeout(() => resolve({ data, error: null }), delayMs));
      });
      return { rpc, signals };
    }

    it("waits out a cold claim that answers in 1.2 s, and reads its decision", async () => {
      const { rpc, signals } = replyingAfter(1_200, { decision: "send", resumed: false });
      const claimed = rpcDispatchLedger(rpc).claim(CLAIM, CLAIM_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(1_200);
      await expect(claimed).resolves.toEqual({ decision: "send", resumed: false });
      expect(signals[0]!.aborted).toBe(false);
    });

    it("NEGATIVE CONTROL: the 750 ms it used to get gives up on that same claim", async () => {
      const { rpc } = replyingAfter(1_200, { decision: "send", resumed: false });
      const claimed = rpcDispatchLedger(rpc).claim(CLAIM, 750).catch((cause: unknown) => cause);
      await vi.advanceTimersByTimeAsync(1_200);
      expect(await claimed).toMatchObject({ step: "claim", code: LEDGER_TIMEOUT });
    });

    it("gives up at its wait, aborts the request, and never takes the late reply as a decision", async () => {
      const { rpc, signals } = replyingAfter(2_500, { decision: "send", resumed: false });
      const claimed = rpcDispatchLedger(rpc).claim(CLAIM, CLAIM_TIMEOUT_MS).catch((cause: unknown) => cause);
      await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS);
      const failure = await claimed;
      expect(failure).toBeInstanceOf(LedgerUnavailableError);
      expect(failure).toMatchObject({ step: "claim", code: LEDGER_TIMEOUT });
      expect(signals[0]!.aborted).toBe(true);
      // The reply that lands afterwards changes nothing.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await claimed).toBe(failure);
    });

    it("bounds the record the same way", async () => {
      const { rpc, signals } = replyingAfter(5_000, true);
      const recorded = rpcDispatchLedger(rpc).record(HANDLE, AMBIGUOUS, RECORD_TIMEOUT_MS)
        .catch((cause: unknown) => cause);
      await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS);
      expect(await recorded).toMatchObject({ step: "record", code: LEDGER_TIMEOUT });
      expect(signals[0]!.aborted).toBe(true);
    });
  });
});
