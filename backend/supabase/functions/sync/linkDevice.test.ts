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

// A production Owner: Supabase itself verified this phone by OTP. Every test
// that is not specifically about the onboarding gate uses this, because it is
// the only identity production accepts.
const caller = {
  authUserId: AUTH_ID,
  appUserId: null,
  principalUserId: null,
  billingAccountId: null,
  shopId: null,
  role: null,
  permissionVersion: null,
  verifiedPhone: "+8801712345678",
  isAnonymous: false,
  email: null,
  emailConfirmedAt: null,
  raw: { app_metadata: {}, is_anonymous: false },
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
  // Project secrets are per-test. Left set, one gate test would silently make
  // the next one's "production project" a DEV project.
  vi.unstubAllEnvs();
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

  it("rejects a stale session already linked to another shop", async () => {
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

  // The gate that decides WHO may onboard an Owner. Until this existed,
  // link-device accepted any authenticated JWT, so an email or anonymous
  // session was a second route to Owner onboarding on every project.
  describe("the onboarding identity gate", () => {
    const devHarnessCaller = {
      ...caller,
      verifiedPhone: null,
      email: "dev-0707070707070707@harness.muthoy.invalid",
      emailConfirmedAt: "2026-09-06T09:15:00.000Z",
    } as unknown as Caller;

    async function attempt(who: Caller) {
      return linkDevice(who, { shopId: SHOP_ID, ownerUserId: OWNER_ID, onboarding: ONBOARDING });
    }

    it("denies an unverified email JWT on a production project", async () => {
      await expect(attempt({
        ...caller,
        verifiedPhone: null,
        email: "someone@example.com",
        emailConfirmedAt: "2026-09-06T09:15:00.000Z",
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it("denies an anonymous JWT on a production project", async () => {
      await expect(attempt({
        ...caller,
        verifiedPhone: null,
        isAnonymous: true,
        raw: { app_metadata: {}, is_anonymous: true },
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
    });

    // The blocker this gate exists for: a DEV BUILD talking to production. The
    // client's __DEV__ flag is not part of the decision, so production refuses
    // the harness identity outright.
    it("denies the DEV harness identity on a production project", async () => {
      await expect(attempt(devHarnessCaller))
        .rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
    });

    it("denies an anonymous JWT even on the DEV project", async () => {
      vi.stubEnv("MUTHOY_ENVIRONMENT", "development");
      vi.stubEnv("MUTHOY_DEV_ONBOARDING", "1");
      await expect(attempt({
        ...devHarnessCaller,
        isAnonymous: true,
        raw: { app_metadata: {}, is_anonymous: true },
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
    });

    it("denies a generic email identity even on the DEV project", async () => {
      vi.stubEnv("MUTHOY_ENVIRONMENT", "development");
      vi.stubEnv("MUTHOY_DEV_ONBOARDING", "1");
      await expect(attempt({
        ...devHarnessCaller,
        email: "someone@example.com",
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
    });

    it("requires BOTH project secrets, not either one", async () => {
      vi.unstubAllEnvs();
      vi.stubEnv("MUTHOY_ENVIRONMENT", "development");
      await expect(attempt(devHarnessCaller)).rejects.toMatchObject({ code: "otp_required" });

      vi.unstubAllEnvs();
      vi.stubEnv("MUTHOY_DEV_ONBOARDING", "1");
      await expect(attempt(devHarnessCaller)).rejects.toMatchObject({ code: "otp_required" });
    });

    it("allows the DEV harness identity on the DEV project and stamps it durably", async () => {
      vi.stubEnv("MUTHOY_ENVIRONMENT", "development");
      vi.stubEnv("MUTHOY_DEV_ONBOARDING", "1");
      await expect(attempt(devHarnessCaller)).resolves.toEqual({ shopId: SHOP_ID });

      // ensureAuthBinding is about to rewrite this account's email, so the
      // marker has to move somewhere only the service role can write.
      expect(mocks.updateUserById).toHaveBeenCalledWith(
        AUTH_ID,
        { app_metadata: { shop_id: SHOP_ID, dev_harness: true } },
      );
      expect(mocks.onboardOwner).toHaveBeenCalledWith(SHOP_ID, OWNER_ID, ONBOARDING);
    });

    it("recognises a resumed harness caller by the stamp once the email is gone", async () => {
      vi.stubEnv("MUTHOY_ENVIRONMENT", "development");
      vi.stubEnv("MUTHOY_DEV_ONBOARDING", "1");
      // What the account looks like after link-device rewrote its address.
      await expect(attempt({
        ...devHarnessCaller,
        email: `u-${OWNER_ID}@users.muthoy.invalid`,
        raw: { app_metadata: { dev_harness: true }, is_anonymous: false },
      } as unknown as Caller)).resolves.toEqual({ shopId: SHOP_ID });
      expect(mocks.onboardOwner).toHaveBeenCalledOnce();
    });

    it("never stamps a production OTP owner", async () => {
      await expect(attempt(caller)).resolves.toEqual({ shopId: SHOP_ID });
      expect(mocks.updateUserById).toHaveBeenCalledWith(AUTH_ID, {
        app_metadata: { shop_id: SHOP_ID },
      });
    });
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
