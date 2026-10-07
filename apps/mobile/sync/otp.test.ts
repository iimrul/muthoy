import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireConfiguration: vi.fn(),
  signOut: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("./supabaseClient", () => ({
  requireSupabaseConfiguration: mocks.requireConfiguration,
  supabase: {
    auth: {
      signOut: mocks.signOut,
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
    },
  },
}));

// Vitest mocks must be registered before importing the module under test.
// eslint-disable-next-line import/first
import { OtpPhoneError, resendOtp, sendOtp, verifyOtp } from "./otp";
// eslint-disable-next-line import/first
import {
  OtpCodeRejectedError,
  OtpRateLimitedError,
  OtpSendFailedError,
  OtpVerifyFailedError,
} from "./otpPolicy";

/** The shape of a Supabase AuthApiError: a status, an error code, a message. */
function authError(status: number, code: string | undefined, message = "server text") {
  return Object.assign(new Error(message), { status, code, name: "AuthApiError" });
}

describe("OTP requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    });
  });

  it("clears the local session before the initial OTP request", async () => {
    await sendOtp("+8801700000000");

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      phone: "+8801700000000",
    });
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signInWithOtp.mock.invocationCallOrder[0]!,
    );
  });

  it("resends without destroying an existing verified session", async () => {
    await resendOtp("+8801700000000");

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      phone: "+8801700000000",
    });
  });

  it("returns the verified Supabase session", async () => {
    const session = await verifyOtp("+8801700000000", "123456");

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      phone: "+8801700000000",
      token: "123456",
      type: "sms",
    });
    expect(session.user.id).toBe("user-1");
  });

  // H-5. Failures are typed by status and code, never by message text — the
  // old "message includes expired" check read every wrong code as expired,
  // because Supabase answers both with the same "has expired or is invalid".
  describe("typed failures", () => {
    it.each([
      ["a refused code", authError(403, "otp_expired", "Token has expired or is invalid"), OtpCodeRejectedError],
      ["too many attempts", authError(429, "over_request_rate_limit"), OtpRateLimitedError],
      ["a server error", authError(500, "unexpected_failure"), OtpVerifyFailedError],
      ["no network", Object.assign(new Error("Failed to fetch"), { status: 0, name: "AuthRetryableFetchError" }), OtpVerifyFailedError],
      ["a malformed request", authError(400, "validation_failed"), OtpVerifyFailedError],
      // A refusal that names something other than the code is not about the code.
      ["a bad API key", authError(401, "no_authorization"), OtpVerifyFailedError],
      ["phone sign-in switched off", authError(403, "phone_provider_disabled"), OtpVerifyFailedError],
      ["an unknown future code", authError(403, "some_new_code"), OtpVerifyFailedError],
    ])("verification: %s", async (_label, error, expected) => {
      mocks.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error });
      const failure = await verifyOtp("+8801700000000", "123456").catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(expected);
      expect((failure as Error).cause).toBe(error);
    });

    // H-5 review P1: a status with no code is not a verdict on the code. Only an
    // explicit otp_expired may say "incorrect" or "expired"; anything else says
    // the code could not be checked, so a right code is never called wrong.
    it.each([400, 401, 403])("verification: a bare %i with no code could not be checked", async (status) => {
      const error = authError(status, undefined, "Token has expired or is invalid");
      mocks.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error });
      const failure = await verifyOtp("+8801700000000", "123456").catch((cause: unknown) => cause);
      expect(failure).toBeInstanceOf(OtpVerifyFailedError);
      expect(failure).not.toBeInstanceOf(OtpCodeRejectedError);
    });

    it("verification: an empty code string is no code at all", async () => {
      mocks.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: authError(403, "") });
      await expect(verifyOtp("+8801700000000", "123456")).rejects.toBeInstanceOf(OtpVerifyFailedError);
    });

    it("types a verification that throws instead of returning an error", async () => {
      mocks.verifyOtp.mockRejectedValue(new TypeError("Network request failed"));
      await expect(verifyOtp("+8801700000000", "123456")).rejects.toBeInstanceOf(OtpVerifyFailedError);
    });

    it.each([
      ["Supabase's per-number interval", authError(429, "over_sms_send_rate_limit"), OtpRateLimitedError],
      ["the hook's daily cap, a bare 429", authError(429, undefined), OtpRateLimitedError],
      ["a failed provider send", authError(500, undefined, "SMS could not be sent"), OtpSendFailedError],
      ["a failed provider send reported as 503", authError(503, undefined), OtpSendFailedError],
      ["a refused number", authError(400, undefined, "SMS could not be sent"), OtpSendFailedError],
    ])("send and resend: %s", async (_label, error, expected) => {
      mocks.signInWithOtp.mockResolvedValue({ data: { user: null, session: null }, error });
      await expect(sendOtp("+8801700000000")).rejects.toBeInstanceOf(expected);
      await expect(resendOtp("+8801700000000")).rejects.toBeInstanceOf(expected);
    });

    it("types a send that throws instead of returning an error", async () => {
      mocks.signInWithOtp.mockRejectedValue(new TypeError("Network request failed"));
      await expect(sendOtp("+8801700000000")).rejects.toBeInstanceOf(OtpSendFailedError);
    });

    it("requests no code at all when the old local session cannot be cleared", async () => {
      mocks.signOut.mockResolvedValue({ error: new Error("storage locked") });
      await expect(sendOtp("+8801700000000")).rejects.toBeInstanceOf(OtpSendFailedError);
      expect(mocks.signInWithOtp).not.toHaveBeenCalled();
    });

    it("never carries the server's message text as its own", async () => {
      mocks.signInWithOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: authError(500, undefined, "provider detail for +8801700000000"),
      });
      const failure = await sendOtp("+8801700000000").catch((cause: unknown) => cause);
      expect((failure as Error).message).not.toContain("8801700000000");
    });
  });

  it("rejects a successful response without a session", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    await expect(
      verifyOtp("+8801700000000", "123456"),
    ).rejects.toThrow("without creating a session");
  });

  describe("final phone guard", () => {
    it.each([
      ["local", "01712345678"],
      ["national, typed after a fixed +880", "1712345678"],
      ["country code without the plus", "8801712345678"],
      ["full E.164", "+8801712345678"],
    ])("sends, resends and verifies a %s number in the canonical form", async (_label, input) => {
      await sendOtp(input);
      await resendOtp(input);
      await verifyOtp(input, "123456");

      expect(mocks.signInWithOtp).toHaveBeenNthCalledWith(1, { phone: "+8801712345678" });
      expect(mocks.signInWithOtp).toHaveBeenNthCalledWith(2, { phone: "+8801712345678" });
      expect(mocks.verifyOtp).toHaveBeenCalledWith({
        phone: "+8801712345678",
        token: "123456",
        type: "sms",
      });
    });

    it.each(["+911712345678", "+1712345678", "(+1) 712345678", "0171234567", "", "not-a-number"])(
      "refuses %j before touching the provider or the local session",
      async (input) => {
        await expect(sendOtp(input)).rejects.toBeInstanceOf(OtpPhoneError);
        await expect(resendOtp(input)).rejects.toBeInstanceOf(OtpPhoneError);
        await expect(verifyOtp(input, "123456")).rejects.toBeInstanceOf(OtpPhoneError);

        expect(mocks.signOut).not.toHaveBeenCalled();
        expect(mocks.signInWithOtp).not.toHaveBeenCalled();
        expect(mocks.verifyOtp).not.toHaveBeenCalled();
      },
    );
  });
});
