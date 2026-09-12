import { describe, expect, it } from "vitest";
import {
  deviceLoginAppMetadata,
  mintedSessionMatchesActor,
  resolveDeviceLoginActor,
  type DeviceLoginCandidate,
  type DeviceLoginRole,
} from "./deviceLoginPolicy.ts";

const SHOP_A = "00000000-0000-4000-8000-00000000000a";
const SHOP_B = "00000000-0000-4000-8000-00000000000b";

function candidate(
  role: DeviceLoginRole = "owner",
  overrides: Partial<DeviceLoginCandidate> = {},
): DeviceLoginCandidate {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    shop_id: SHOP_A,
    pin_hash: "$2a$10$serverhash",
    pin_set_at: "2026-09-10T00:00:00.000Z",
    is_active: true,
    is_deleted: false,
    plan_suspended_at: null,
    roles: { name: role, is_deleted: false },
    shops: { archived_at: null, is_deleted: false },
    ...overrides,
  };
}

describe("device-login actor authority", () => {
  it.each<DeviceLoginRole>(["owner", "manager", "staff"])(
    "accepts a live %s actor",
    (role) => {
      expect(resolveDeviceLoginActor(candidate(role))).toMatchObject({
        shopId: SHOP_A,
        roleName: role,
      });
    },
  );

  it.each([
    ["inactive actor", { is_active: false }],
    ["deleted actor", { is_deleted: true }],
    ["plan-suspended actor", { plan_suspended_at: "2026-09-10T00:00:00.000Z" }],
    ["deleted role", { roles: { name: "staff", is_deleted: true } }],
    [
      "archived shop",
      { shops: { archived_at: "2026-09-10T00:00:00.000Z", is_deleted: false } },
    ],
    ["deleted shop", { shops: { archived_at: null, is_deleted: true } }],
    ["unsupported role", { roles: { name: "owner-like", is_deleted: false } }],
  ] satisfies Array<[string, Partial<DeviceLoginCandidate>]>)(
    "rejects a %s",
    (_label, override) => {
      expect(resolveDeviceLoginActor(candidate("staff", override))).toBeNull();
    },
  );

  it("overwrites stale Shop-B metadata when the resolved actor belongs to Shop A", () => {
    const stale = {
      shop_id: SHOP_B,
      active_shop_id: SHOP_B,
      unrelated: "kept-by-auth",
    };
    expect({ ...stale, ...deviceLoginAppMetadata(SHOP_A) }).toEqual({
      shop_id: SHOP_A,
      active_shop_id: SHOP_A,
      unrelated: "kept-by-auth",
    });
  });

  it("gives a forged request shop no authority over the server-selected actor", () => {
    const forgedBody = { shopId: SHOP_B };
    const actor = resolveDeviceLoginActor(candidate("owner"));
    expect(forgedBody.shopId).toBe(SHOP_B);
    expect(actor).not.toBeNull();
    expect(deviceLoginAppMetadata(actor!.shopId)).toEqual({
      shop_id: SHOP_A,
      active_shop_id: SHOP_A,
    });
  });

  it("overwrites stale Shop-A metadata when the resolved actor belongs to Shop B", () => {
    const stale = { shop_id: SHOP_A, active_shop_id: SHOP_A };
    expect({ ...stale, ...deviceLoginAppMetadata(SHOP_B) }).toEqual({
      shop_id: SHOP_B,
      active_shop_id: SHOP_B,
    });
  });

  it("is idempotent for repeated login to the same resolved shop", () => {
    const first = deviceLoginAppMetadata(SHOP_A);
    expect({ ...first, ...deviceLoginAppMetadata(SHOP_A) }).toEqual(first);
  });

  it("requires the minted auth user, actor and shop to equal the response identity", () => {
    const expected = {
      authUserId: "00000000-0000-4000-8000-000000000010",
      appUserId: "00000000-0000-4000-8000-000000000011",
      shopId: SHOP_A,
    };
    expect(mintedSessionMatchesActor(expected, expected)).toBe(true);
    expect(
      mintedSessionMatchesActor(
        { ...expected, appUserId: "foreign-actor" },
        expected,
      ),
    ).toBe(false);
    expect(
      mintedSessionMatchesActor({ ...expected, shopId: SHOP_B }, expected),
    ).toBe(false);
    expect(
      mintedSessionMatchesActor(
        { ...expected, authUserId: "foreign-auth" },
        expected,
      ),
    ).toBe(false);
  });
});
