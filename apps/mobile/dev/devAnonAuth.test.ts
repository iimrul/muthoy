// ⚠️ TEMPORARY — tests for the dev-only anonymous auth entry. Delete together
// with the rest of apps/mobile/dev/.
//
// Every native/DB boundary is mocked, so this exercises the dev flow's own
// decisions only: which session it will accept, what it does on link failure,
// and how it recovers from a partial registration after a restart.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const signInAnonymously = vi.fn();
const linkDeviceToShop = vi.fn();
const createShopAndOwner = vi.fn();
const getOwnerOnboardingPayload = vi.fn();
const clearUnverifiedOwnerPhone = vi.fn();
const getRegistrationStatus = vi.fn();
const markShopCloudLinked = vi.fn();

vi.mock('../sync/supabaseClient', () => ({
  supabase: { auth: { getSession: () => getSession(), signInAnonymously: () => signInAnonymously() } },
  requireSupabaseConfiguration: () => undefined,
}));
// Forwards BOTH arguments. The previous mock passed only shopId, so the
// ownerUserId this flow was failing to send was invisible to every test here —
// the binding was never written, and the device died on `hook_not_configured`
// with a green suite.
vi.mock('../sync/linkDevice', () => ({
  linkDeviceToShop: (shopId: string, ownerUserId?: string, options?: unknown) =>
    linkDeviceToShop(shopId, ownerUserId, options),
}));
vi.mock('../db/auth', () => ({
  createShopAndOwner: (input: unknown) => createShopAndOwner(input),
  clearUnverifiedOwnerPhone: (shopId: string, ownerUserId: string) =>
    clearUnverifiedOwnerPhone(shopId, ownerUserId),
  getOwnerOnboardingPayload: (shopId: string, ownerUserId: string) =>
    getOwnerOnboardingPayload(shopId, ownerUserId),
  getRegistrationStatus: () => getRegistrationStatus(),
  markShopCloudLinked: (shopId: string) => markShopCloudLinked(shopId),
}));

const {
  DEV_SHOP_PHONE,
  DevAuthError,
  devSignInAnonymouslyAndRegister,
  getDevRegistrationState,
  hasMatchingDevRepairSession,
  isDevPlaceholderPhone,
  repairOwnerDeviceLink,
} = await import('./devAnonAuth');

const NEW_SHOP_ID = 'shop-new';
const EXISTING_SHOP_ID = 'shop-existing';
const ANON_SESSION = {
  session: {
    user: {
      id: 'anon-1',
      is_anonymous: true,
      app_metadata: { shop_id: EXISTING_SHOP_ID },
    },
  },
};
const REAL_SESSION = { session: { user: { id: 'real-1', is_anonymous: false, phone: '+8801812345678' } } };
const ONBOARDING = {
  shop: { id: 'shop-1' },
  roles: [{ id: 'role-1', name: 'owner' }],
  owner: { id: 'user-1', phone: '+8801700000000', pinHash: 'hash' },
  settings: { id: 'settings-1' },
};
/**
 * What actually goes to the server: the same payload with the Owner's phone
 * removed. users_phone_unique is global, and this flow writes ONE placeholder
 * into every DEV registration, so a second DEV shop's Owner insert died with
 * 23505. Skip-OTP proved no number, so it must not send one as a credential.
 */
const ONBOARDING_SENT = { ...ONBOARDING, owner: { ...ONBOARDING.owner, phone: null } };

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  signInAnonymously.mockReset().mockResolvedValue({ data: ANON_SESSION, error: null });
  linkDeviceToShop.mockReset().mockResolvedValue(undefined);
  createShopAndOwner.mockReset().mockResolvedValue({ shopId: NEW_SHOP_ID, userId: 'user-new' });
  getOwnerOnboardingPayload.mockReset().mockResolvedValue(ONBOARDING);
  clearUnverifiedOwnerPhone.mockReset().mockResolvedValue(undefined);
  getRegistrationStatus.mockReset().mockResolvedValue({ status: 'none' });
  markShopCloudLinked.mockReset().mockResolvedValue(undefined);
});

describe('anonymous session creation and reuse', () => {
  it('creates an anonymous session when none exists', async () => {
    await devSignInAnonymouslyAndRegister();
    expect(signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing anonymous session instead of minting a second one', async () => {
    getSession.mockResolvedValue({ data: ANON_SESSION, error: null });
    await devSignInAnonymouslyAndRegister();
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(linkDeviceToShop).toHaveBeenCalledTimes(1);
  });

  it('rejects a session Supabase reports as non-anonymous even from signInAnonymously', async () => {
    signInAnonymously.mockResolvedValue({ data: REAL_SESSION, error: null });
    await expect(devSignInAnonymouslyAndRegister()).rejects.toBeInstanceOf(DevAuthError);
  });

  it('fails clearly when anonymous sign-ins are disabled on the project', async () => {
    signInAnonymously.mockResolvedValue({ data: { session: null }, error: null });
    await expect(devSignInAnonymouslyAndRegister()).rejects.toThrow(/Enable Anonymous sign-ins/);
  });
});

describe('non-anonymous session rejection', () => {
  it('refuses to reuse a real phone-verified session', async () => {
    getSession.mockResolvedValue({ data: REAL_SESSION, error: null });
    await expect(devSignInAnonymouslyAndRegister()).rejects.toBeInstanceOf(DevAuthError);
  });

  it('does not create a shop or link a device when a real session is present', async () => {
    getSession.mockResolvedValue({ data: REAL_SESSION, error: null });
    await expect(devSignInAnonymouslyAndRegister()).rejects.toThrow();
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(createShopAndOwner).not.toHaveBeenCalled();
    expect(linkDeviceToShop).not.toHaveBeenCalled();
  });

  it('treats a session with is_anonymous absent as real, never as anonymous', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } }, error: null });
    await expect(devSignInAnonymouslyAndRegister()).rejects.toBeInstanceOf(DevAuthError);
  });
});

describe('link failure', () => {
  it('propagates the link failure and never marks the shop cloud-linked', async () => {
    linkDeviceToShop.mockRejectedValue(new Error('Edge Function unreachable'));
    await expect(devSignInAnonymouslyAndRegister()).rejects.toThrow('Edge Function unreachable');
    expect(markShopCloudLinked).not.toHaveBeenCalled();
  });
});

describe('restart / partial-registration recovery', () => {
  it('reports a dev link_pending registration as resumable', async () => {
    getRegistrationStatus.mockResolvedValue({
      status: 'link_pending',
      shopId: EXISTING_SHOP_ID,
      userId: 'user-1',
      phone: DEV_SHOP_PHONE,
    });
    await expect(getDevRegistrationState()).resolves.toEqual({
      status: 'link_incomplete',
      shopId: EXISTING_SHOP_ID,
      ownerUserId: 'user-1',
    });
  });

  it('never claims a real phone registration as a dev one', async () => {
    getRegistrationStatus.mockResolvedValue({
      status: 'link_pending',
      shopId: 'real-shop',
      userId: 'user-1',
      phone: '+8801812345678',
    });
    await expect(getDevRegistrationState()).resolves.toEqual({ status: 'none' });
    expect(isDevPlaceholderPhone('+8801812345678')).toBe(false);
  });

  it('retries the link against the existing shop rather than creating a duplicate', async () => {
    getRegistrationStatus.mockResolvedValue({
      status: 'link_pending',
      shopId: EXISTING_SHOP_ID,
      userId: 'user-1',
      phone: DEV_SHOP_PHONE,
    });
    const result = await devSignInAnonymouslyAndRegister();

    expect(createShopAndOwner).not.toHaveBeenCalled();
    expect(linkDeviceToShop).toHaveBeenCalledWith(
      EXISTING_SHOP_ID,
      'user-1',
      { onboarding: ONBOARDING_SENT },
    );
    expect(result.shopId).toBe(EXISTING_SHOP_ID);
  });
});

describe('owner binding: the claim-less session repair', () => {
  const READY = {
    status: 'complete',
    shopId: EXISTING_SHOP_ID,
    userId: 'user-1',
    phone: DEV_SHOP_PHONE,
  };

  beforeEach(() => {
    getSession.mockResolvedValue({ data: ANON_SESSION, error: null });
  });

  it('exposes repair only for the real DEV placeholder registration', async () => {
    getRegistrationStatus.mockResolvedValue(READY);
    await expect(getDevRegistrationState()).resolves.toEqual({
      status: 'ready',
      shopId: EXISTING_SHOP_ID,
      ownerUserId: 'user-1',
    });
    await expect(hasMatchingDevRepairSession(EXISTING_SHOP_ID)).resolves.toBe(true);
  });

  it('does not expose repair to another anonymous DEV session', async () => {
    getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'other-anon',
            is_anonymous: true,
            app_metadata: { shop_id: 'other-shop' },
          },
        },
      },
      error: null,
    });

    await expect(hasMatchingDevRepairSession(EXISTING_SHOP_ID)).resolves.toBe(false);
    getRegistrationStatus.mockResolvedValue(READY);
    await expect(repairOwnerDeviceLink()).rejects.toThrow('already linked to this DEV shop');
    expect(linkDeviceToShop).not.toHaveBeenCalled();
  });

  it('does not expose a completed real OTP registration as repairable', async () => {
    getRegistrationStatus.mockResolvedValue({
      ...READY,
      phone: '+8801812345678',
    });
    await expect(getDevRegistrationState()).resolves.toEqual({ status: 'none' });
    await expect(repairOwnerDeviceLink()).rejects.toBeInstanceOf(DevAuthError);
    expect(linkDeviceToShop).not.toHaveBeenCalled();
  });

  it('always sends the owner id, so the server writes the binding', async () => {
    // Without ownerUserId the edge function takes its shop_id-only branch and
    // skips ensureAuthBinding AND b4_ensure_owner_billing_account. The account
    // then holds shop_id with no binding, the access-token hook has nothing to
    // resolve, and every sync request fails as `hook_not_configured`.
    await devSignInAnonymouslyAndRegister();

    expect(linkDeviceToShop).toHaveBeenCalledWith(
      NEW_SHOP_ID,
      'user-new',
      { onboarding: ONBOARDING_SENT },
    );
    expect(linkDeviceToShop).not.toHaveBeenCalledWith(NEW_SHOP_ID, undefined, expect.anything());
  });

  it('repairs an already-registered device against its existing owner row', async () => {
    getRegistrationStatus.mockResolvedValue(READY);

    const result = await repairOwnerDeviceLink();

    expect(result).toEqual({ shopId: EXISTING_SHOP_ID, ownerUserId: 'user-1' });
    expect(linkDeviceToShop).toHaveBeenCalledWith(
      EXISTING_SHOP_ID,
      'user-1',
      { onboarding: ONBOARDING_SENT },
    );
    // The whole point of a repair: reuse what exists. A second owner row, a
    // second billing account, or a second trial would all be data corruption.
    expect(createShopAndOwner).not.toHaveBeenCalled();
  });

  it('reuses the existing anonymous session rather than minting a second identity', async () => {
    getRegistrationStatus.mockResolvedValue(READY);

    await repairOwnerDeviceLink();

    // shop_claims binds a shop to one auth user permanently; a fresh anonymous
    // user would be correctly refused with 403.
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it('refuses repair without the existing anonymous session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    getRegistrationStatus.mockResolvedValue(READY);

    await expect(repairOwnerDeviceLink()).rejects.toThrow('existing anonymous DEV session');
    expect(signInAnonymously).not.toHaveBeenCalled();
    expect(linkDeviceToShop).not.toHaveBeenCalled();
  });

  it('is safe to run twice — the server side is idempotent', async () => {
    getRegistrationStatus.mockResolvedValue(READY);

    await repairOwnerDeviceLink();
    await repairOwnerDeviceLink();

    expect(linkDeviceToShop).toHaveBeenNthCalledWith(
      1,
      EXISTING_SHOP_ID,
      'user-1',
      { onboarding: ONBOARDING_SENT },
    );
    expect(linkDeviceToShop).toHaveBeenNthCalledWith(
      2,
      EXISTING_SHOP_ID,
      'user-1',
      { onboarding: ONBOARDING_SENT },
    );
    expect(createShopAndOwner).not.toHaveBeenCalled();
    expect(markShopCloudLinked).not.toHaveBeenCalled();
  });

  it('refuses to invent a registration when there is none to repair', async () => {
    getRegistrationStatus.mockResolvedValue({ status: 'none' });

    await expect(repairOwnerDeviceLink()).rejects.toBeInstanceOf(DevAuthError);
    expect(linkDeviceToShop).not.toHaveBeenCalled();
    expect(createShopAndOwner).not.toHaveBeenCalled();
  });

  it('never marks the shop cloud-linked when the repair fails', async () => {
    getRegistrationStatus.mockResolvedValue(READY);
    linkDeviceToShop.mockRejectedValue(new Error('token carries no owner identity'));

    await expect(repairOwnerDeviceLink()).rejects.toThrow('token carries no owner identity');
    expect(markShopCloudLinked).not.toHaveBeenCalled();
  });
});

describe('successful path to PIN setup', () => {
  it('creates the shop, links the device, and marks it cloud-linked', async () => {
    const result = await devSignInAnonymouslyAndRegister();

    expect(createShopAndOwner).toHaveBeenCalledWith(expect.objectContaining({ phone: DEV_SHOP_PHONE }));
    expect(linkDeviceToShop).toHaveBeenCalledWith(
      NEW_SHOP_ID,
      'user-new',
      { onboarding: ONBOARDING_SENT },
    );
    expect(markShopCloudLinked).toHaveBeenCalledWith(NEW_SHOP_ID);
    expect(result).toEqual({ shopId: NEW_SHOP_ID });
  });

  it('leaves the PIN unset so the normal PIN Setup screen still runs', async () => {
    await devSignInAnonymouslyAndRegister();
    // createShopAndOwner writes only a placeholder hash; nothing in this flow
    // calls setOwnerPin, so app/index.tsx resolves 'incomplete' → pin-setup.
    const [input] = createShopAndOwner.mock.calls[0] as [Record<string, unknown>];
    expect(input).not.toHaveProperty('pin');
  });
});
