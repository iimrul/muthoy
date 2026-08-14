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
import { resendOtp, sendOtp, verifyOtp } from "./otp";

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

  it("propagates OTP verification failures", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: new Error("expired"),
    });

    await expect(
      verifyOtp("+8801700000000", "123456"),
    ).rejects.toThrow("expired");
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
});
