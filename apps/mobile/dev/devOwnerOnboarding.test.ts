// The DEV registration harness's flow.
//
// Two things are under test and they pull in opposite directions: that the
// harness really does reach the canonical onboarding path (so DEV exercises
// what production exercises), and that it refuses everything the removed
// anonymous bootstrap used to allow — a second identity, a resume, a repair, or
// a placeholder phone dressed up as a verified credential.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The harness keeps its identity and the shop it created in MMKV, at module
// scope. Each test must start from a device that remembers nothing, or one
// test's stored registration becomes the next one's "resume".
import { __resetMMKVStores } from '../db/test/react-native-mmkv';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
/** The address ensureAuthBinding rewrites the harness account to. */
const BOUND_EMAIL = `u-${OWNER_ID}@users.muthoy.invalid`;

const mocks = vi.hoisted(() => ({
  getRegistrationStatus: vi.fn(),
  createShopAndOwner: vi.fn(),
  getOwnerOnboardingPayload: vi.fn(),
  markShopCloudLinked: vi.fn(),
  linkDeviceToShop: vi.fn(),
  requireSupabaseConfiguration: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('../db/auth', () => ({
  getRegistrationStatus: mocks.getRegistrationStatus,
  createShopAndOwner: mocks.createShopAndOwner,
  getOwnerOnboardingPayload: mocks.getOwnerOnboardingPayload,
  markShopCloudLinked: mocks.markShopCloudLinked,
}));
vi.mock('../sync/linkDevice', () => ({ linkDeviceToShop: mocks.linkDeviceToShop }));
vi.mock('../sync/supabaseClient', () => ({
  requireSupabaseConfiguration: mocks.requireSupabaseConfiguration,
  supabase: {
    auth: {
      getSession: mocks.getSession,
      getUser: mocks.getUser,
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
    },
  },
}));

const { DEV_HARNESS_SHOP_CONTACT, DevHarnessError, assertDevBuild, registerDevOwner } =
  await import('./devOwnerOnboarding');

const ONBOARDING = {
  shop: { id: SHOP_ID, phone: DEV_HARNESS_SHOP_CONTACT },
  roles: [],
  // The whole point of ownerPhone: null — the payload that reaches
  // b4_onboard_owner carries no phone, so MU043's global uniqueness check is
  // skipped and no unproved number is stored as a credential.
  owner: { id: OWNER_ID, shopId: SHOP_ID, phone: null },
  settings: null,
};

function session(email: string) {
  return { data: { session: { user: { email, is_anonymous: false } } }, error: null };
}

beforeEach(() => {
  __resetMMKVStores();
  vi.stubGlobal('__DEV__', true);
  mocks.getRegistrationStatus.mockReset().mockResolvedValue({ status: 'none' });
  mocks.createShopAndOwner.mockReset().mockResolvedValue({ shopId: SHOP_ID, userId: OWNER_ID });
  mocks.getOwnerOnboardingPayload.mockReset().mockResolvedValue(ONBOARDING);
  mocks.markShopCloudLinked.mockReset().mockResolvedValue(undefined);
  mocks.linkDeviceToShop.mockReset().mockResolvedValue({ shopId: SHOP_ID });
  mocks.requireSupabaseConfiguration.mockReset();
  mocks.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mocks.signInWithPassword.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  mocks.signUp
    .mockReset()
    .mockImplementation(async ({ email }: { email: string }) => session(email));
  // What link-device leaves behind: ensureAuthBinding has rewritten the
  // account's address to the canonical one every account gets.
  mocks.getUser
    .mockReset()
    .mockResolvedValue({ data: { user: { email: BOUND_EMAIL } }, error: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the harness refuses to run outside a dev build', () => {
  it.each([false, undefined])('throws when __DEV__ is %p', async (value) => {
    vi.stubGlobal('__DEV__', value);
    await expect(registerDevOwner()).rejects.toBeInstanceOf(DevHarnessError);
    expect(mocks.createShopAndOwner).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('checks the build BEFORE anything else, config included', async () => {
    vi.stubGlobal('__DEV__', false);
    await expect(registerDevOwner()).rejects.toThrow(/cannot run in a production build/);
    expect(mocks.requireSupabaseConfiguration).not.toHaveBeenCalled();
    expect(mocks.getRegistrationStatus).not.toHaveBeenCalled();
  });

  it('exposes the same guard for a caller that wants to fail early', () => {
    vi.stubGlobal('__DEV__', false);
    expect(() => assertDevBuild()).toThrow(DevHarnessError);
    vi.stubGlobal('__DEV__', true);
    expect(() => assertDevBuild()).not.toThrow();
  });
});

describe('the canonical onboarding path is what actually runs', () => {
  it('creates the shop, sends the onboarding payload with link-device, then marks it linked', async () => {
    await expect(registerDevOwner()).resolves.toEqual({ shopId: SHOP_ID, ownerUserId: OWNER_ID });

    expect(mocks.createShopAndOwner).toHaveBeenCalledWith(
      expect.objectContaining({ phone: DEV_HARNESS_SHOP_CONTACT, ownerPhone: null }),
    );
    expect(mocks.getOwnerOnboardingPayload).toHaveBeenCalledWith(SHOP_ID, OWNER_ID);
    expect(mocks.linkDeviceToShop).toHaveBeenCalledWith(SHOP_ID, OWNER_ID, {
      onboarding: ONBOARDING,
    });
    // markShopCloudLinked only after link-device returned, because that call is
    // what verifies the refreshed token's full Owner claim set.
    expect(mocks.linkDeviceToShop).toHaveBeenCalledBefore(mocks.markShopCloudLinked);
    expect(mocks.markShopCloudLinked).toHaveBeenCalledWith(SHOP_ID);
  });

  it('requires Supabase configuration, exactly as the OTP path does', async () => {
    mocks.requireSupabaseConfiguration.mockImplementation(() => {
      throw new Error('Supabase is not configured.');
    });
    await expect(registerDevOwner()).rejects.toThrow('Supabase is not configured.');
    expect(mocks.createShopAndOwner).not.toHaveBeenCalled();
  });

  it('never writes an unproved number into the Owner credential column', async () => {
    await registerDevOwner();
    const [input] = mocks.createShopAndOwner.mock.calls[0] as [Record<string, unknown>];
    expect(input.ownerPhone).toBeNull();
    // The contact number belongs to the SHOP row, which is a business field.
    expect(input.phone).toBe(DEV_HARNESS_SHOP_CONTACT);
  });
});

describe('the removed anonymous architecture stays removed', () => {
  // The mocked auth surface deliberately offers only getSession,
  // signInWithPassword and signUp. Reaching for an anonymous entry would throw
  // "not a function" here rather than quietly working, which is the point.
  it('never signs in anonymously', async () => {
    await registerDevOwner();
    const { supabase } = await import('../sync/supabaseClient');
    const auth = supabase.auth as unknown as Record<string, unknown>;
    expect(auth.signInAnonymously).toBeUndefined();
    expect(Object.keys(auth).sort()).toEqual([
      'getSession',
      'getUser',
      'signInWithPassword',
      'signUp',
    ]);
  });

  // The blocker: link-device REWRITES this account's email, so signing in
  // again with the address the harness first chose would fail, fall through to
  // sign-up, and mint a second account that shop_claims then refuses.
  it('signs in after binding with the address the account actually has now', async () => {
    await registerDevOwner();
    const [created] = mocks.signUp.mock.calls[0] as [{ email: string; password: string }];
    expect(created.email).toMatch(/^dev-[0-9a-f]+@harness\.muthoy\.invalid$/);
    expect(created.password.length).toBeGreaterThanOrEqual(32);

    // A second device-registration attempt after a restart: the stored address
    // is the POST-BINDING one, and the password is unchanged.
    mocks.signUp.mockClear();
    mocks.signInWithPassword.mockResolvedValue(session(BOUND_EMAIL));
    mocks.getRegistrationStatus.mockResolvedValue({ status: 'none' });

    await registerDevOwner();

    expect(mocks.signInWithPassword).toHaveBeenLastCalledWith({
      email: BOUND_EMAIL,
      password: created.password,
    });
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it('refuses to mint a second account when the stored identity cannot sign in', async () => {
    await registerDevOwner();
    mocks.signUp.mockClear();
    mocks.getRegistrationStatus.mockResolvedValue({ status: 'none' });
    mocks.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });

    await expect(registerDevOwner()).rejects.toThrow(/purged from the project/);
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(mocks.createShopAndOwner).toHaveBeenCalledTimes(1);
  });

  it("refuses to attach a DEV shop to somebody else's signed-in account", async () => {
    mocks.getSession.mockResolvedValue(session('real-owner@example.com'));
    await expect(registerDevOwner()).rejects.toThrow(/different Supabase session/);
    expect(mocks.createShopAndOwner).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  // Recovery is identity-bound. A registration the harness did not create is
  // refused whatever state it is in, so a real OTP shop can never be adopted
  // and the generic repair architecture cannot return through here.
  it.each(['link_pending', 'incomplete', 'complete'] as const)(
    'refuses a %s registration it did not create',
    async (status) => {
      mocks.getRegistrationStatus.mockResolvedValue({
        status,
        shopId: SHOP_ID,
        userId: OWNER_ID,
        phone: DEV_HARNESS_SHOP_CONTACT,
      });
      await expect(registerDevOwner()).rejects.toThrow(/did not create/);
      expect(mocks.createShopAndOwner).not.toHaveBeenCalled();
      expect(mocks.linkDeviceToShop).not.toHaveBeenCalled();
      expect(mocks.markShopCloudLinked).not.toHaveBeenCalled();
    },
  );

  it('refuses its OWN shop once that shop is past link_pending', async () => {
    mocks.linkDeviceToShop.mockRejectedValueOnce(new Error('claims failed'));
    await expect(registerDevOwner()).rejects.toThrow();

    mocks.getRegistrationStatus.mockResolvedValue({
      status: 'complete',
      shopId: SHOP_ID,
      userId: OWNER_ID,
      phone: DEV_HARNESS_SHOP_CONTACT,
    });
    await expect(registerDevOwner()).rejects.toThrow(/already complete/);
  });

  it('leaves a failed link failed — no retry, no repair, no cloud-linked marker', async () => {
    mocks.linkDeviceToShop.mockRejectedValue(
      new Error('Device linked, but Owner token verification failed'),
    );
    await expect(registerDevOwner()).rejects.toThrow(/Owner token verification failed/);
    expect(mocks.linkDeviceToShop).toHaveBeenCalledTimes(1);
    expect(mocks.markShopCloudLinked).not.toHaveBeenCalled();
  });
});

// The exact state the review flagged: hosted onboarding, binding and trial all
// succeeded, then the refreshed-token claim check failed. The local shop is
// link_pending while the server's rows are complete. Refusing that stranded the
// hosted data with no way forward but wiping the device.
describe('resuming an interrupted link', () => {
  async function interruptFirstAttempt() {
    mocks.linkDeviceToShop.mockRejectedValueOnce(
      new Error('Device linked, but Owner token verification failed'),
    );
    await expect(registerDevOwner()).rejects.toThrow(/Owner token verification failed/);
    mocks.getRegistrationStatus.mockResolvedValue({
      status: 'link_pending',
      shopId: SHOP_ID,
      userId: OWNER_ID,
      phone: DEV_HARNESS_SHOP_CONTACT,
    });
    mocks.signInWithPassword.mockResolvedValue(session(BOUND_EMAIL));
  }

  it('finishes the link without creating a second shop, owner or trial', async () => {
    await interruptFirstAttempt();
    mocks.createShopAndOwner.mockClear();

    await expect(registerDevOwner()).resolves.toEqual({
      shopId: SHOP_ID,
      ownerUserId: OWNER_ID,
    });

    expect(mocks.createShopAndOwner).not.toHaveBeenCalled();
    expect(mocks.linkDeviceToShop).toHaveBeenLastCalledWith(SHOP_ID, OWNER_ID, {
      onboarding: ONBOARDING,
    });
    expect(mocks.markShopCloudLinked).toHaveBeenCalledWith(SHOP_ID);
  });

  it('refuses when the local registration is not the one it recorded', async () => {
    await interruptFirstAttempt();
    mocks.getRegistrationStatus.mockResolvedValue({
      status: 'link_pending',
      shopId: '33333333-3333-4333-8333-333333333333',
      userId: OWNER_ID,
      phone: DEV_HARNESS_SHOP_CONTACT,
    });

    await expect(registerDevOwner()).rejects.toThrow(/did not create/);
    expect(mocks.linkDeviceToShop).toHaveBeenCalledTimes(1);
  });

  it('refuses when a foreign session is signed in', async () => {
    await interruptFirstAttempt();
    mocks.getSession.mockResolvedValue(session('real-owner@example.com'));

    await expect(registerDevOwner()).rejects.toThrow(/different Supabase session/);
    expect(mocks.linkDeviceToShop).toHaveBeenCalledTimes(1);
    expect(mocks.markShopCloudLinked).not.toHaveBeenCalled();
  });
});

describe('misconfiguration names itself', () => {
  it('explains the confirm-email setting when sign-up returns no session', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(registerDevOwner()).rejects.toThrow(/Confirm email/);
    expect(mocks.createShopAndOwner).not.toHaveBeenCalled();
  });

  it('surfaces a sign-up error rather than continuing without a session', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null }, error: new Error('signup disabled') });
    await expect(registerDevOwner()).rejects.toThrow('signup disabled');
    expect(mocks.createShopAndOwner).not.toHaveBeenCalled();
  });
});
