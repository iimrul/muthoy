import { FunctionsHttpError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeSyncWithClaimRefresh } from "./invoke";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), refreshSession: vi.fn() }));
vi.mock("./supabaseClient", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: { refreshSession: mocks.refreshSession },
  },
}));

function functionError(code: string): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify({
    code,
    error: code,
    actorUserId: 'actor-1',
    shopId: 'shop-1',
  }), {
    status: code === "permissions_changed" ? 401 : 403,
    headers: { "content-type": "application/json" },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.refreshSession.mockResolvedValue({ error: null });
});

describe("authoritative sync control errors", () => {
  it.each([
    "account_inactive",
    "account_deleted",
    "account_plan_suspended",
    "access_invalidated",
    "shop_inactive",
  ] as const)("surfaces %s without retrying", async (code) => {
    mocks.invoke.mockResolvedValue({ data: null, error: functionError(code) });
    await expect(invokeSyncWithClaimRefresh({ action: "pull" }))
      .rejects.toMatchObject({
        name: "SyncHaltedError", code, actorUserId: 'actor-1', shopId: 'shop-1',
      });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("does not halt when a stale permission token refreshes successfully", async () => {
    mocks.invoke
      .mockResolvedValueOnce({ data: null, error: functionError("permissions_changed") })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    await expect(invokeSyncWithClaimRefresh({ action: "pull" })).resolves.toEqual({
      data: { ok: true }, error: null,
    });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('retains the server-verified actor when refresh fails', async () => {
    mocks.invoke.mockResolvedValue({
      data: null, error: functionError('permissions_changed'),
    });
    mocks.refreshSession.mockResolvedValue({ error: new Error('refresh denied') });

    await expect(invokeSyncWithClaimRefresh({ action: 'pull' })).rejects.toMatchObject({
      code: 'permissions_changed',
      actorUserId: 'actor-1',
      shopId: 'shop-1',
    });
  });
});
