import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

// No `from()` at all. Onboarding writes exclusively through the SECURITY
// DEFINER function: a PostgREST write runs as service_role, which holds no
// INSERT on shops, roles or users, and that is what died with 42501 on every
// physical attempt. Without a `from` here, reintroducing one is a TypeError.
vi.mock("./_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { onboardOwner, parseOnboarding } from "./onboarding.ts";

const SHOP = "10000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000002";
const ROLE = "10000000-0000-4000-8000-000000000003";
const SETTINGS = "10000000-0000-4000-8000-000000000004";
const T0 = "2026-09-05T00:00:00.000Z";
const PIN_HASH = `$2a$10$${".".repeat(53)}`;

function payload(overrides: Record<string, unknown> = {}) {
  return {
    shop: {
      id: SHOP, ownerId: OWNER, name: "Test Pharmacy", nameEn: null,
      phone: "+8801711111111", createdAt: T0, updatedAt: T0,
    },
    roles: [
      { id: ROLE, shopId: SHOP, name: "owner", createdAt: T0, updatedAt: T0 },
      { id: SETTINGS, shopId: SHOP, name: "staff", createdAt: T0, updatedAt: T0 },
    ],
    owner: {
      id: OWNER, shopId: SHOP, name: "Test Pharmacy", phone: "+8801711111111",
      pinHash: PIN_HASH, pinSetAt: null, roleId: ROLE, createdAt: T0, updatedAt: T0,
    },
    settings: { id: SETTINGS },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

describe("onboarding payload validation", () => {
  it("accepts a complete registration and passes it to the definer function", async () => {
    await onboardOwner(SHOP, OWNER, payload());

    expect(mocks.rpc).toHaveBeenCalledWith("b4_onboard_owner", {
      p_payload: expect.objectContaining({
        shop: expect.objectContaining({ id: SHOP, ownerId: OWNER }),
        owner: expect.objectContaining({ id: OWNER, roleId: ROLE }),
      }),
    });
  });

  it("carries every system role, not only the Owner's", () => {
    const parsed = parseOnboarding(payload(), SHOP, OWNER) as unknown as {
      roles: { name: string }[];
    };
    expect(parsed.roles.map((role) => role.name)).toEqual(["owner", "staff"]);
  });

  it("accepts an Owner with no phone, which is what an unverified DEV sign-in has", () => {
    // users_phone_unique is global, so the DEV flow's shared placeholder could
    // only ever belong to one shop. Skip-OTP proved no number, so it sends none.
    const parsed = parseOnboarding(
      payload({ owner: { ...payload().owner, phone: null } }), SHOP, OWNER,
    ) as unknown as { owner: { phone: string | null } };
    expect(parsed.owner.phone).toBeNull();
  });

  it("refuses a payload for a different shop than the request names", () => {
    expect(() => parseOnboarding(payload(), "20000000-0000-4000-8000-000000000001", OWNER))
      .toThrowError(/cannot be linked to that shop/);
  });

  it("refuses a payload for a different owner than the request names", () => {
    expect(() => parseOnboarding(payload(), SHOP, "20000000-0000-4000-8000-000000000002"))
      .toThrowError(/cannot be linked to that shop/);
  });

  it.each([
    ["a missing shop", { shop: undefined }],
    ["no roles at all", { roles: [] }],
    ["roles that are not an array", { roles: {} }],
  ])("refuses %s", (_label, override) => {
    expect(() => parseOnboarding(payload(override), SHOP, OWNER))
      .toThrowError(/Invalid onboarding/);
  });

  it("refuses an invented role name", () => {
    expect(() => parseOnboarding(
      payload({ roles: [{ id: ROLE, shopId: SHOP, name: "superuser", createdAt: T0, updatedAt: T0 }] }),
      SHOP, OWNER,
    )).toThrowError(/Invalid onboarding role name/);
  });

  it("refuses a pin hash that is not bcrypt", () => {
    // The device is the only source of this value and it lands in a NOT NULL
    // credential column, so a plain 4-digit PIN must never be storable here.
    expect(() => parseOnboarding(
      payload({ owner: { ...payload().owner, pinHash: "1234" } }), SHOP, OWNER,
    )).toThrowError(/Invalid onboarding owner\.pinHash/);
  });

  it("refuses a non-uuid identifier", () => {
    expect(() => parseOnboarding(
      payload({ owner: { ...payload().owner, roleId: "not-a-uuid" } }), SHOP, OWNER,
    )).toThrowError(/Invalid onboarding owner\.roleId/);
  });
});

describe("the diagnostic that was missing", () => {
  it.each([
    ["MU042", 403, "onboarding_conflict"],
    ["MU043", 409, "phone_already_registered"],
    ["MU041", 400, "onboarding_invalid"],
  ])("turns %s into an answer the device can act on", async (code, status, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "boom" } });

    await expect(onboardOwner(SHOP, OWNER, payload()))
      .rejects.toMatchObject({ status, code: expected });
  });

  it("keeps the SQLSTATE and the step for anything unmapped", async () => {
    // The whole reason this took several physical rounds: the device was told
    // only a generic code, and the real SQLSTATE never left the server.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key ... (phone)=(+8801700000000)" },
    });

    await expect(onboardOwner(SHOP, OWNER, payload())).rejects.toMatchObject({
      status: 500,
      code: "onboarding_failed",
      message: "Could not complete onboarding (db=23505 op=onboard_owner)",
    });
  });

  it("never forwards database text, which can quote the offending row", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key ... (phone)=(+8801700000000)" },
    });

    await expect(onboardOwner(SHOP, OWNER, payload())).rejects.toMatchObject({
      message: expect.not.stringContaining("8801700000000") as unknown as string,
    });
  });
});
