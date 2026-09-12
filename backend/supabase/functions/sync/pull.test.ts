import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "./_shared/auth.ts";

const mocks = vi.hoisted(() => ({ assertCallerCurrent: vi.fn(), rpc: vi.fn() }));

vi.mock("./_shared/auth.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_shared/auth.ts")>();
  return { ...original, assertCallerCurrent: mocks.assertCallerCurrent };
});
vi.mock("./_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { pull } from "./pull.ts";

const caller = {
  authUserId: "auth-1", appUserId: "user-1", principalUserId: "user-1",
  shopId: "shop-1", role: "staff", permissionVersion: 7,
  verifiedPhone: null, raw: { app_metadata: {} },
} as unknown as Caller;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCallerCurrent.mockResolvedValue({
    appUserId: "user-1", shopId: "shop-1", roleName: "staff", isOwner: false,
    permissionVersion: 7, billingAccountId: "account-1", commercialStatus: "active",
  });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "sync_pull_changes_b2") return { data: [], error: null };
    if (name === "sync_readable_tables") return { data: ["shops", "sales"], error: null };
    if (name === "user_has_permission") return { data: false, error: null };
    return { data: null, error: { message: "unexpected rpc" } };
  });
});

describe("pull access snapshot", () => {
  it("returns a version on every page and a complete first-page access answer", async () => {
    await expect(pull(caller, { shopId: "shop-1", includeAccess: true })).resolves.toMatchObject({
      accessVersion: 7,
      readableTables: ["shops", "sales"],
      accessUserId: "user-1",
      saleHistoryScope: "own",
    });
    const later = await pull(caller, { shopId: "shop-1", since: null });
    expect(later).toMatchObject({ accessVersion: 7 });
    expect(later).not.toHaveProperty("readableTables");
  });

  it.each([
    [["shops", null]],
    [["shops", 9]],
    [["shops", "shops"]],
    [["shops", "unknown_table"]],
  ])("rejects malformed readable-table RPC data %j as a whole", async (data) => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "sync_pull_changes_b2") return { data: [], error: null };
      if (name === "sync_readable_tables") return { data, error: null };
      return { data: false, error: null };
    });
    await expect(pull(caller, { shopId: "shop-1", includeAccess: true }))
      .rejects.toMatchObject({ status: 500 });
  });
});
