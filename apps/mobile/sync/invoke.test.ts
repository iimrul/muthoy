import { FunctionsHttpError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeSyncWithClaimRefresh } from "./invoke";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refreshSession: vi.fn(),
  handleDeviceRevocation: vi.fn(),
}));
vi.mock("./supabaseClient", () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    auth: { refreshSession: mocks.refreshSession },
  },
}));
vi.mock("./deviceRevocation", () => ({
  handleDeviceRevocation: mocks.handleDeviceRevocation,
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
  mocks.handleDeviceRevocation.mockResolvedValue(undefined);
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

// -- Blocker 7: revocation is persisted by the INVOKER, not the sync engine --

function deviceError(
  code: string,
  body: Record<string, unknown> = {},
): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify({
    code,
    error: code,
    actorUserId: 'actor-1',
    shopId: 'shop-1',
    ...body,
  }), { status: 403, headers: { 'content-type': 'application/json' } }));
}

const AUTHORITY = {
  known: true,
  status: 'revoked',
  registryVersion: 9,
  enforced: true,
  bindings: [{ actorUserId: 'actor-1', status: 'revoked', bindingVersion: 4 }],
};

describe('a device refusal on ANY guarded call closes the session', () => {
  it.each(['device_revoked', 'binding_revoked'] as const)(
    'persists and quarantines on %s, before surfacing the error',
    async (code) => {
      // This used to live in the sync engine's catch block, so it ran only for
      // work the engine drove. A revocation arriving on a device-list, a
      // billing check or a refund claim was surfaced as a generic failure and
      // the mirror left untouched — the device stayed signed in until the next
      // sync cycle, if one came at all.
      mocks.invoke.mockResolvedValue({
        data: null,
        error: deviceError(code, { authority: AUTHORITY }),
      });

      await expect(invokeSyncWithClaimRefresh({ action: 'device-list', shopId: 'shop-1' }))
        .rejects.toMatchObject({ name: 'SyncHaltedError', code });

      expect(mocks.handleDeviceRevocation)
        .toHaveBeenCalledWith('shop-1', 'actor-1', code, AUTHORITY);
      // No retry and no token refresh: refreshing cannot fix an installation
      // the server has disowned.
      expect(mocks.invoke).toHaveBeenCalledTimes(1);
      expect(mocks.refreshSession).not.toHaveBeenCalled();
    },
  );

  it('persists BEFORE the error escapes, so a caller that swallows it is safe', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: deviceError('device_revoked', { authority: AUTHORITY }),
    });
    let handledDuringThrow = false;
    try {
      await invokeSyncWithClaimRefresh({ action: 'billing-status', shopId: 'shop-1' });
    } catch {
      // By the time anybody can see the error, the quarantine is already done.
      handledDuringThrow = mocks.handleDeviceRevocation.mock.calls.length === 1;
    }
    expect(handledDuringThrow).toBe(true);
  });

  it('falls back to the request shop when the body names none', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(
        JSON.stringify({ code: 'device_revoked', error: 'gone' }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )),
    });
    await expect(invokeSyncWithClaimRefresh({ action: 'pull', shopId: 'shop-7' }))
      .rejects.toMatchObject({ code: 'device_revoked' });
    expect(mocks.handleDeviceRevocation)
      .toHaveBeenCalledWith('shop-7', null, 'device_revoked', undefined);
  });

  it('does NOT quarantine a merely unbound session', async () => {
    // "Sign in again on this device" is not "you were cut off". Persisting a
    // quarantine here would make revocation self-inflicted: every ordinary
    // expired session would look like one.
    mocks.invoke.mockResolvedValue({
      data: null,
      error: deviceError('device_session_unbound'),
    });
    await expect(invokeSyncWithClaimRefresh({ action: 'pull', shopId: 'shop-1' }))
      .rejects.toMatchObject({ code: 'device_session_unbound' });
    expect(mocks.handleDeviceRevocation).not.toHaveBeenCalled();
  });

  it('sends no device identity of its own', async () => {
    // The server derives the installation from the session id inside the
    // token. Sending one would be the caller nominating its own authority,
    // which is the design this replaced.
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await invokeSyncWithClaimRefresh({ action: 'pull', shopId: 'shop-1' });
    const body = mocks.invoke.mock.calls[0]?.[1]?.body as Record<string, unknown>;
    expect(body).toEqual({ action: 'pull', shopId: 'shop-1' });
    expect(body.devicePublicId).toBeUndefined();
    expect(body.deviceSecret).toBeUndefined();
  });
});
