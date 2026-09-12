import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "./_shared/auth.ts";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("./_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
  supabaseAnon: { auth: {} },
}));

import { assertCallerCurrent } from "./_shared/auth.ts";

const caller = {
  authUserId: "auth-1", appUserId: "user-1", principalUserId: "principal-1",
  shopId: "shop-1", role: "staff", permissionVersion: 4,
  billingAccountId: null, verifiedPhone: null, isAnonymous: false,
  email: null, emailConfirmedAt: null, raw: {},
} as unknown as Caller;

const liveUser = {
  id: "user-1", shop_id: "shop-1", permission_version: 4,
  is_active: true, is_deleted: false, plan_suspended_at: null,
  roles: { name: "staff" },
  shops: {
    billing_account_id: "account-1", commercial_status: "active",
    archived_at: null, is_deleted: false,
  },
};

function builder(result: { data: unknown; error: unknown }) {
  const value: Record<string, unknown> = {};
  value.select = () => value;
  value.eq = () => value;
  value.maybeSingle = async () => result;
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.from.mockImplementation((table: string) => builder(
    table === "users"
      ? { data: liveUser, error: null }
      : { data: { auth_user_id: "auth-1" }, error: null },
  ));
});

describe("assertCallerCurrent stable revocation codes", () => {
  it.each([
    ["account_deleted", { is_deleted: true }],
    ["account_inactive", { is_active: false }],
    ["account_plan_suspended", { plan_suspended_at: "2026-09-07T00:00:00Z" }],
  ])("returns %s", async (code, override) => {
    mocks.from.mockImplementation((table: string) => builder(
      table === "users"
        ? { data: { ...liveUser, ...override }, error: null }
        : { data: { auth_user_id: "auth-1" }, error: null },
    ));
    await expect(assertCallerCurrent(caller)).rejects.toMatchObject({ status: 403, code });
  });

  it("returns account_plan_suspended when the plan limit excludes the user", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    await expect(assertCallerCurrent(caller)).rejects.toMatchObject({
      status: 403, code: "account_plan_suspended",
    });
  });

  it("returns access_invalidated for a broken principal binding", async () => {
    mocks.from.mockImplementation((table: string) => builder(
      table === "users"
        ? { data: liveUser, error: null }
        : { data: null, error: null },
    ));
    await expect(assertCallerCurrent(caller)).rejects.toMatchObject({
      status: 403, code: "access_invalidated",
    });
  });

  it("returns shop_inactive for an archived shop", async () => {
    mocks.from.mockImplementation((table: string) => builder(
      table === "users"
        ? { data: { ...liveUser, shops: { ...liveUser.shops, archived_at: "2026-09-07" } }, error: null }
        : { data: { auth_user_id: "auth-1" }, error: null },
    ));
    await expect(assertCallerCurrent(caller)).rejects.toMatchObject({
      status: 403, code: "shop_inactive",
    });
  });
});
