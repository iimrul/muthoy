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
  prepareInstallationEnrollment: vi.fn(),
  tryBindSession: vi.fn(),
}));

vi.mock("./_shared/auth.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_shared/auth.ts")>();
  return { ...original, callerShopId: mocks.callerShopId };
});
vi.mock("./_shared/identity.ts", () => ({
  assertBindingTarget: mocks.assertBindingTarget,
  ensureAuthBinding: mocks.ensureAuthBinding,
}));
// The real H-5 phone binder, the mocked RPC: what reaches onboardOwner is the
// payload link-device actually decided to send.
vi.mock("./onboarding.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./onboarding.ts")>()),
  onboardOwner: mocks.onboardOwner,
}));
vi.mock("./deviceBinding.ts", () => ({
  prepareInstallationEnrollment: mocks.prepareInstallationEnrollment,
  tryBindSession: mocks.tryBindSession,
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
// The Owner carries the number the caller below proved by OTP — the only
// shape an honest registration can send (H-5).
const ONBOARDING = { safe: "payload", owner: { id: OWNER_ID, phone: "+8801712345678" } };

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
  authSessionId: "10000000-0000-4000-8000-000000000004",
  freshPhoneOtp: { phone: "+8801712345678", authenticatedAt: 1_800_000_000 },
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
  // Environment stubs are per-test; see the removed-switch guard below.
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mocks.callerShopId.mockReturnValue(null);
  mocks.assertBindingTarget.mockResolvedValue(undefined);
  mocks.ensureAuthBinding.mockResolvedValue(undefined);
  mocks.onboardOwner.mockResolvedValue(undefined);
  mocks.updateUserById.mockResolvedValue({ error: null });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "a23_session_gate") {
      return {
        data: {
          bound: false,
          enforced: false,
          deviceStatus: null,
          bindingStatus: null,
          authority: null,
        },
        error: null,
      };
    }
    return { data: "billing-1", error: null };
  });
  mocks.tryBindSession.mockResolvedValue(null);
  mocks.prepareInstallationEnrollment.mockResolvedValue(null);
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
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "a23_session_gate")).toHaveLength(2);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "b4_ensure_owner_billing_account"))
      .toHaveLength(2);
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

  it("does not bind or return registration success when a persistent hold rejects OTP enrolment", async () => {
    mocks.prepareInstallationEnrollment.mockRejectedValueOnce(
      new HttpError(
        403,
        "Another active Owner or Manager must approve this installation.",
        "device_enrollment_held",
      ),
    );

    await expect(linkDevice(caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
      deviceRegistryVersion: 1,
      devicePublicId: "replacement-held",
    })).rejects.toMatchObject({ status: 403, code: "device_enrollment_held" });

    expect(mocks.prepareInstallationEnrollment).toHaveBeenCalledWith(
      SHOP_ID,
      OWNER_ID,
      expect.objectContaining({ devicePublicId: "replacement-held" }),
    );
    expect(mocks.ensureAuthBinding).not.toHaveBeenCalled();
    expect(mocks.tryBindSession).not.toHaveBeenCalled();
  });

  // The gate that decides WHO may onboard an Owner. Until this existed,
  // link-device accepted any authenticated JWT, so an email or anonymous
  // session was a second route to Owner onboarding on every project.
  describe("the onboarding identity gate", () => {
    // The identity the removed DEV registration harness (H-2 → H-5) signed in
    // with: a confirmed email account and no phone proof.
    const harnessShapedCaller = {
      ...caller,
      freshPhoneOtp: null,
      email: "dev-0707070707070707@harness.muthoy.invalid",
      emailConfirmedAt: "2026-09-06T09:15:00.000Z",
    } as unknown as Caller;

    async function attempt(who: Caller) {
      return linkDevice(who, { shopId: SHOP_ID, ownerUserId: OWNER_ID, onboarding: ONBOARDING });
    }

    it("rejects a historically phone-confirmed JWT with no fresh OTP event", async () => {
      await expect(attempt({
        ...caller,
        freshPhoneOtp: null,
        raw: {
          app_metadata: {},
          is_anonymous: false,
          phone: "+8801712345678",
          phone_confirmed_at: "2025-01-01T00:00:00.000Z",
        },
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
      expect(mocks.tryBindSession).not.toHaveBeenCalled();
    });

    it("refuses an already-revoked session before onboarding or binding", async () => {
      mocks.callerShopId.mockReturnValue(SHOP_ID);
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === "a23_session_gate") {
          return {
            data: {
              bound: true,
              enforced: false,
              deviceStatus: "revoked",
              bindingStatus: "active",
              authority: {
                known: true,
                status: "revoked",
                registryVersion: 4,
                enforced: false,
                bindings: [{
                  actorUserId: OWNER_ID,
                  status: "active",
                  bindingVersion: 1,
                }],
              },
            },
            error: null,
          };
        }
        return { data: "billing-1", error: null };
      });
      await expect(attempt({
        ...caller,
        appUserId: OWNER_ID,
        shopId: SHOP_ID,
      } as Caller)).rejects.toMatchObject({ status: 403, code: "device_revoked" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
      expect(mocks.ensureAuthBinding).not.toHaveBeenCalled();
      expect(mocks.tryBindSession).not.toHaveBeenCalled();
    });

    it("denies an unverified email JWT on a production project", async () => {
      await expect(attempt({
        ...caller,
        freshPhoneOtp: null,
        email: "someone@example.com",
        emailConfirmedAt: null,
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
    });

    it("denies an anonymous JWT on a production project", async () => {
      await expect(attempt({
        ...caller,
        freshPhoneOtp: null,
        isAnonymous: true,
        raw: { app_metadata: {}, is_anonymous: true },
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
    });

    // A DEV build is no longer special anywhere: the harness identity is just an
    // email account, refused like any other — before AND after link-device used
    // to stamp it, so an account created by the old harness cannot onboard again.
    it.each([
      ["first-run harness address", {}],
      ["stamped by the old link-device", { app_metadata: { dev_harness: true }, is_anonymous: false }],
    ])("denies the removed DEV harness identity (%s)", async (_label, rawOverride) => {
      await expect(attempt({
        ...harnessShapedCaller,
        ...(Object.keys(rawOverride).length > 0 ? { raw: rawOverride } : {}),
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.updateUserById).not.toHaveBeenCalled();
    });

    // Guard for the removal itself: the DEV-project switch that admitted the
    // harness is gone from the code, so setting it again grants nothing.
    it("grants nothing even with the removed DEV onboarding switch set", async () => {
      vi.stubEnv("MUTHOY_ENVIRONMENT", "development");
      vi.stubEnv("MUTHOY_DEV_ONBOARDING", "1");
      await expect(attempt(harnessShapedCaller))
        .rejects.toMatchObject({ status: 403, code: "otp_required" });
      await expect(attempt({
        ...harnessShapedCaller,
        isAnonymous: true,
        raw: { app_metadata: {}, is_anonymous: true },
      } as unknown as Caller)).rejects.toMatchObject({ status: 403, code: "otp_required" });
      expect(mocks.onboardOwner).not.toHaveBeenCalled();
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

// H-5. The number Supabase verified by OTP is the number the onboarded Owner
// gets. Before this, a tampered client could prove its own number and register
// an Owner under somebody else's — locking the real holder out of registering
// with phone_already_registered while keeping a phone + PIN sign-in under it.
describe("the verified OTP phone binds the onboarded Owner", () => {
  function payloadWithOwnerPhone(phone: unknown) {
    return { ...ONBOARDING, owner: { id: OWNER_ID, phone } };
  }

  function expectNothingClaimedOrBound() {
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.onboardOwner).not.toHaveBeenCalled();
    expect(mocks.assertBindingTarget).not.toHaveBeenCalled();
    expect(mocks.prepareInstallationEnrollment).not.toHaveBeenCalled();
    expect(mocks.ensureAuthBinding).not.toHaveBeenCalled();
    expect(mocks.tryBindSession).not.toHaveBeenCalled();
  }

  it.each([
    ["somebody else's number", "+8801812345678"],
    ["a number one digit off", "+8801712345679"],
    ["the same last ten digits under a foreign code", "+911712345678"],
    ["no number at all", null],
    ["an empty number", ""],
    ["a non-string number", 8801712345678],
  ])("refuses an Owner with %s before anything is claimed", async (_label, phone) => {
    await expect(linkDevice(caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: payloadWithOwnerPhone(phone),
    })).rejects.toMatchObject({ status: 403, code: "onboarding_phone_mismatch" });
    expectNothingClaimedOrBound();
  });

  it("refuses an Owner with no phone field at all", async () => {
    await expect(linkDevice(caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: { ...ONBOARDING, owner: { id: OWNER_ID } },
    })).rejects.toMatchObject({ status: 403, code: "onboarding_phone_mismatch" });
    expectNothingClaimedOrBound();
  });

  it("refuses an onboarding payload with no Owner object", async () => {
    await expect(linkDevice(caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: { safe: "payload" },
    })).rejects.toMatchObject({ status: 400, code: "onboarding_invalid" });
    expectNothingClaimedOrBound();
  });

  it("refuses when the session proved a foreign number, even one sharing the last ten digits", async () => {
    await expect(linkDevice({
      ...caller,
      freshPhoneOtp: { phone: "+911712345678", authenticatedAt: 1_800_000_000 },
    } as Caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: ONBOARDING,
    })).rejects.toMatchObject({ status: 403, code: "onboarding_phone_mismatch" });
    expectNothingClaimedOrBound();
  });

  it.each([
    ["Supabase's stored form against a local spelling", "8801712345678", "01712345678"],
    ["E.164 against the stored form", "+8801712345678", "8801712345678"],
    ["the canonical form on both sides", "+8801712345678", "+8801712345678"],
  ])("accepts %s and stores the canonical verified number", async (_label, verified, ownerPhone) => {
    await expect(linkDevice({
      ...caller,
      freshPhoneOtp: { phone: verified, authenticatedAt: 1_800_000_000 },
    } as Caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: payloadWithOwnerPhone(ownerPhone),
    })).resolves.toEqual({ shopId: SHOP_ID });

    expect(mocks.onboardOwner).toHaveBeenCalledWith(SHOP_ID, OWNER_ID, {
      safe: "payload",
      owner: { id: OWNER_ID, phone: "+8801712345678" },
    });
  });

  it("never modifies the request's own payload", async () => {
    const onboarding = payloadWithOwnerPhone("01712345678");
    await linkDevice(caller, { shopId: SHOP_ID, ownerUserId: OWNER_ID, onboarding });
    expect(onboarding.owner.phone).toBe("01712345678");
  });

  it("leaves a resume that sends no onboarding payload exactly as it was", async () => {
    mocks.callerShopId.mockReturnValue(SHOP_ID);
    await expect(linkDevice({ ...caller, shopId: SHOP_ID }, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
    })).resolves.toEqual({ shopId: SHOP_ID });
    expect(mocks.onboardOwner).not.toHaveBeenCalled();
    expect(mocks.ensureAuthBinding).toHaveBeenCalledWith(OWNER_ID, AUTH_ID);
  });

  it("refuses a phoneless Owner from a session that proved no number", async () => {
    await expect(linkDevice({
      ...caller,
      freshPhoneOtp: null,
      email: "dev-0707070707070707@harness.muthoy.invalid",
      emailConfirmedAt: "2026-09-06T09:15:00.000Z",
    } as unknown as Caller, {
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
      onboarding: payloadWithOwnerPhone(null),
    })).rejects.toMatchObject({ status: 403, code: "otp_required" });
    expectNothingClaimedOrBound();
  });
});
