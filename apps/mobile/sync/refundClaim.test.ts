import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimRefundAuthority, REFUND_CLAIM_TIMEOUT_MS, RefundClaimTimeoutError } from "./refundClaim";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), refreshSession: vi.fn() }));

vi.mock("./supabaseClient", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: { refreshSession: mocks.refreshSession },
  },
}));
vi.mock("../native/deviceId", () => ({ getDeviceId: () => "device-a" }));

const input = {
  shopId: "shop-a",
  saleId: "sale-a",
  operationId: "10000000-0000-4000-8000-000000000001",
};

beforeEach(() => vi.clearAllMocks());

describe("online refund authority", () => {
  it("returns only a claim bound to the requested operation and device", async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        claimId: "claim-a",
        claimToken: "token-a",
        operationId: input.operationId,
        deviceId: "device-a",
      },
      error: null,
    });

    await expect(claimRefundAuthority(input)).resolves.toEqual({
      claimId: "claim-a",
      claimToken: "token-a",
      operationId: input.operationId,
      deviceId: "device-a",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("sync", {
      body: {
        action: "refund-claim",
        ...input,
        // A2.3. `deviceId` is the separate, older refund-claim binding and
        // stays. No device IDENTITY is attached: the server derives the
        // installation from the session id inside the token, so a body field
        // naming one would be the caller asserting its own authority.
        deviceId: "device-a",
      },
      signal: expect.any(AbortSignal),
    });
  });

  it("stops waiting after the time limit and says the refund did not happen", async () => {
    vi.useFakeTimers();
    try {
      // A dropped network: the request only ends when it is aborted.
      mocks.invoke.mockImplementation((_name: string, options: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          options.signal.addEventListener("abort", () =>
            resolve({ data: null, error: new Error("FunctionsFetchError: aborted") }));
        }));
      const pending = claimRefundAuthority(input);
      const assertion = expect(pending).rejects.toBeInstanceOf(RefundClaimTimeoutError);
      await vi.advanceTimersByTimeAsync(REFUND_CLAIM_TIMEOUT_MS);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out a claim that answers in time", async () => {
    vi.useFakeTimers();
    try {
      mocks.invoke.mockResolvedValue({
        data: { claimId: "claim-a", claimToken: "token-a", operationId: input.operationId, deviceId: "device-a" },
        error: null,
      });
      await expect(claimRefundAuthority(input)).resolves.toMatchObject({ claimId: "claim-a" });
      await vi.advanceTimersByTimeAsync(REFUND_CLAIM_TIMEOUT_MS * 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a retry after a timeout sends the same operation and gets the same claim back", async () => {
    vi.useFakeTimers();
    try {
      mocks.invoke.mockImplementationOnce((_name: string, options: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          options.signal.addEventListener("abort", () => resolve({ data: null, error: new Error("aborted") }));
        }));
      const first = claimRefundAuthority(input);
      const firstAssertion = expect(first).rejects.toBeInstanceOf(RefundClaimTimeoutError);
      await vi.advanceTimersByTimeAsync(REFUND_CLAIM_TIMEOUT_MS);
      await firstAssertion;

      mocks.invoke.mockResolvedValueOnce({
        data: { claimId: "claim-a", claimToken: "token-a", operationId: input.operationId, deviceId: "device-a" },
        error: null,
      });
      await expect(claimRefundAuthority(input)).resolves.toMatchObject({ claimId: "claim-a" });
      const bodies = mocks.invoke.mock.calls.map((call) => (call[1] as { body: { operationId: string } }).body.operationId);
      expect(bodies).toEqual([input.operationId, input.operationId]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects network failure and malformed/conflicting authority", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: new Error("offline"),
    });
    await expect(claimRefundAuthority(input)).rejects.toThrow("offline");

    mocks.invoke.mockResolvedValueOnce({
      data: {
        claimId: "claim-a",
        claimToken: "token-a",
        operationId: "other",
        deviceId: "device-a",
      },
      error: null,
    });
    await expect(claimRefundAuthority(input)).rejects.toThrow(
      "invalid authority",
    );
  });
});
