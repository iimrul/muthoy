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
const getRegistrationStatus = vi.fn();
const markShopCloudLinked = vi.fn();

vi.mock('../sync/supabaseClient', () => ({
  supabase: { auth: { getSession: () => getSession(), signInAnonymously: () => signInAnonymously() } },
  requireSupabaseConfiguration: () => undefined,
}));
vi.mock('../sync/linkDevice', () => ({ linkDeviceToShop: (shopId: string) => linkDeviceToShop(shopId) }));
vi.mock('../db/auth', () => ({
  createShopAndOwner: (input: unknown) => createShopAndOwner(input),
  getRegistrationStatus: () => getRegistrationStatus(),
  markShopCloudLinked: (shopId: string) => markShopCloudLinked(shopId),
}));

const {
  DEV_SHOP_PHONE,
  DevAuthError,
  devSignInAnonymouslyAndRegister,
  getDevRegistrationState,
  isDevPlaceholderPhone,
} = await import('./devAnonAuth');

const ANON_SESSION = { session: { user: { id: 'anon-1', is_anonymous: true } } };
const REAL_SESSION = { session: { user: { id: 'real-1', is_anonymous: false, phone: '+8801812345678' } } };
const NEW_SHOP_ID = 'shop-new';
const EXISTING_SHOP_ID = 'shop-existing';

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  signInAnonymously.mockReset().mockResolvedValue({ data: ANON_SESSION, error: null });
  linkDeviceToShop.mockReset().mockResolvedValue(undefined);
  createShopAndOwner.mockReset().mockResolvedValue({ shopId: NEW_SHOP_ID, userId: 'user-new' });
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
    expect(linkDeviceToShop).toHaveBeenCalledWith(EXISTING_SHOP_ID);
    expect(result.shopId).toBe(EXISTING_SHOP_ID);
  });
});

describe('successful path to PIN setup', () => {
  it('creates the shop, links the device, and marks it cloud-linked', async () => {
    const result = await devSignInAnonymouslyAndRegister();

    expect(createShopAndOwner).toHaveBeenCalledWith(expect.objectContaining({ phone: DEV_SHOP_PHONE }));
    expect(linkDeviceToShop).toHaveBeenCalledWith(NEW_SHOP_ID);
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
