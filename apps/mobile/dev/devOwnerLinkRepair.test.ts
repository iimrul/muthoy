import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createShopAndOwner: vi.fn(),
  getOwnerOnboardingPayload: vi.fn(),
  clearUnverifiedOwnerPhone: vi.fn(),
  getRegistrationStatus: vi.fn(),
  markShopCloudLinked: vi.fn(),
  getSession: vi.fn(),
  signInAnonymously: vi.fn(),
  invoke: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('../db/auth', () => ({
  createShopAndOwner: mocks.createShopAndOwner,
  getOwnerOnboardingPayload: mocks.getOwnerOnboardingPayload,
  clearUnverifiedOwnerPhone: mocks.clearUnverifiedOwnerPhone,
  getRegistrationStatus: mocks.getRegistrationStatus,
  markShopCloudLinked: mocks.markShopCloudLinked,
}));

vi.mock('../sync/supabaseClient', () => ({
  requireSupabaseConfiguration: () => undefined,
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signInAnonymously: mocks.signInAnonymously,
      refreshSession: mocks.refreshSession,
    },
    functions: { invoke: mocks.invoke },
  },
}));

const { DEV_SHOP_PHONE, repairOwnerDeviceLink } = await import('./devAnonAuth');

const SHOP_ID = 'shop-existing';
const OWNER_ID = 'owner-existing';
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

function token(): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    app_metadata: {
      app_user_id: OWNER_ID,
      principal_user_id: OWNER_ID,
      shop_id: SHOP_ID,
      role: 'owner',
      permission_version: 0,
      billing_account_id: 'billing-existing',
    },
  })}.sig`;
}

describe('full DEV Owner link repair path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRegistrationStatus.mockResolvedValue({
      status: 'complete',
      shopId: SHOP_ID,
      userId: OWNER_ID,
      phone: DEV_SHOP_PHONE,
    });
    mocks.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            is_anonymous: true,
            app_metadata: { shop_id: SHOP_ID },
          },
        },
      },
      error: null,
    });
    mocks.getOwnerOnboardingPayload.mockResolvedValue(ONBOARDING);
    mocks.clearUnverifiedOwnerPhone.mockResolvedValue(undefined);
    mocks.invoke.mockResolvedValue({ data: { shopId: SHOP_ID }, error: null });
    mocks.refreshSession.mockResolvedValue({
      data: {
        session: {
          access_token: token(),
          user: { app_metadata: { shop_id: SHOP_ID } },
        },
      },
      error: null,
    });
  });

  it('repeats safely with the same Owner, anonymous session, and link target', async () => {
    await expect(repairOwnerDeviceLink()).resolves.toEqual({
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
    });
    await expect(repairOwnerDeviceLink()).resolves.toEqual({
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
    });

    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
    expect(mocks.createShopAndOwner).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'sync', {
      body: {
        action: 'link-device',
        shopId: SHOP_ID,
        ownerUserId: OWNER_ID,
        onboarding: ONBOARDING_SENT,
      },
    });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'sync', {
      body: {
        action: 'link-device',
        shopId: SHOP_ID,
        ownerUserId: OWNER_ID,
        onboarding: ONBOARDING_SENT,
      },
    });
    expect(mocks.refreshSession).toHaveBeenCalledTimes(2);
    // Registration was already genuinely linked. Repair validates identity but
    // does not rewrite its success timestamp on either idempotent pass.
    expect(mocks.markShopCloudLinked).not.toHaveBeenCalled();
  });
});
