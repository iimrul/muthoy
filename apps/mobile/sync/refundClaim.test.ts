import { beforeEach, describe, expect, it, vi } from "vitest";
import { claimRefundAuthority } from "./refundClaim";

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
        deviceId: "device-a",
      },
    });
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
