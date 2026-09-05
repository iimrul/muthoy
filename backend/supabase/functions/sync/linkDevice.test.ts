import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Caller } from "./_shared/auth.ts";

const mocks = vi.hoisted(() => ({
  callerShopId: vi.fn(),
  assertBindingTarget: vi.fn(),
  ensureAuthBinding: vi.fn(),
  onboardOwner: vi.fn(),
  from: vi.fn(),
  updateUserById: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./_shared/auth.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_shared/auth.ts")>();
  return { ...original, callerShopId: mocks.callerShopId };
});
vi.mock("./_shared/identity.ts", () => ({
  assertBindingTarget: mocks.assertBindingTarget,
  ensureAuthBinding: mocks.ensureAuthBinding,
}));
vi.mock("./onboarding.ts", () => ({
  onboardOwner: mocks.onboardOwner,
}));
vi.mock("./_shared/supabaseAdmin.ts", () => ({
  supabaseAdmin: {
    from: mocks.from,
    auth: { admin: { updateUserById: mocks.updateUserById } },
    rpc: mocks.rpc,
  },
}));

import { HttpError } from "./_shared/auth.ts";
import { linkDevice } from "./linkDevice.ts";

const SHOP_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "10000000-0000-4000-8000-000000000002";
const AUTH_ID = "10000000-0000-4000-8000-000000000003";
const ONBOARDING = { safe: "payload" };

const caller = {
  authUserId: AUTH_ID,
  appUserId: null,
  principalUserId: null,
  billingAccountId: null,
  shopId: null,
  role: null,
  permissionVersion: null,
  verifiedPhone: null,
  raw: { app_metadata: {}, is_anonymous: true },
} as unknown as Caller;

function claimBuilder(
  upsertResult: { data: unknown; error: unknown },
  lookupResult: { data: unknown; error: unknown },
) {
  let didUpsert = false;
  const builder: Record<string, unknown> = {};
  builder.upsert = () => {
    didUpsert = true;
    return builder;
  };
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = async () => didUpsert ? upsertResult : lookupResult;
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callerShopId.mockReturnValue(null);
  mocks.assertBindingTarget.mockResolvedValue(undefined);
  mocks.ensureAuthBinding.mockResolvedValue(undefined);
  mocks.onboardOwner.mockResolvedValue(undefined);
  mocks.updateUserById.mockResolvedValue({ error: null });
  mocks.rpc.mockResolvedValue({ data: "billing-1", error: null });
  mocks.from.mockImplementation(() => claimBuilder(
    { data: { claimed_by_user_id: AUTH_ID }, error: null },
    { data: { claimed_by_user_id: AUTH_ID }, error: null },
  ));
});

describe("link-device registration order", () => {
  it("onboards a fresh registration before validating its cloud Owner", async () => {
    // Order is the whole point: assertBindingTarget reads the Owner's users row
    // from the SERVER, and nothing else can put it there — push needs the
    // binding this call has not written yet. Onboarding must land first.
    await expect(linkDevice(caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
    })).resolves.toEqual({ shopId: SHOP_ID });

    // No caller argument: onboarding is identical for every flow, so it has no
    // way to behave differently for an anonymous DEV session.
    expect(mocks.onboardOwner).toHaveBeenCalledWith(
      SHOP_ID,
      OWNER_ID,
      ONBOARDING,
    );
    expect(mocks.onboardOwner.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.assertBindingTarget.mock.invocationCallOrder[0]!);
    expect(mocks.ensureAuthBinding).toHaveBeenCalledWith(OWNER_ID, AUTH_ID);
  });

  it("resumes the same unfinished claimed shop without creating a new claim", async () => {
    mocks.callerShopId.mockReturnValue(SHOP_ID);
    await expect(linkDevice({ ...caller, shopId: SHOP_ID }, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
    })).resolves.toEqual({ shopId: SHOP_ID });

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.onboardOwner).toHaveBeenCalledOnce();
  });

  it("keeps an already-linked healthy retry idempotent", async () => {
    mocks.callerShopId.mockReturnValue(SHOP_ID);
    const linkedCaller = { ...caller, shopId: SHOP_ID };
    await linkDevice(linkedCaller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
    });
    await linkDevice(linkedCaller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
    });

    expect(mocks.onboardOwner).toHaveBeenCalledTimes(2);
    expect(mocks.ensureAuthBinding).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale anonymous session already linked to another shop", async () => {
    mocks.callerShopId.mockReturnValue("20000000-0000-4000-8000-000000000001");
    await expect(linkDevice(caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
    })).rejects.toMatchObject({ status: 403 });
    expect(mocks.onboardOwner).not.toHaveBeenCalled();
  });

  it("rejects a shop_claim owned by another auth account", async () => {
    mocks.from.mockImplementation(() => claimBuilder(
      { data: null, error: null },
      { data: { claimed_by_user_id: "other-auth" }, error: null },
    ));
    await expect(linkDevice(caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
    })).rejects.toMatchObject({
      status: 403,
      message: "Shop already linked to a different account",
    });
    expect(mocks.onboardOwner).not.toHaveBeenCalled();
  });

  it("propagates an Owner identity mismatch before writing a binding", async () => {
    mocks.onboardOwner.mockRejectedValue(
      new HttpError(403, "This account cannot be linked to that shop"),
    );
    await expect(linkDevice(caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
    })).rejects.toMatchObject({
      status: 403,
      message: "This account cannot be linked to that shop",
    });
    expect(mocks.ensureAuthBinding).not.toHaveBeenCalled();
  });
});
