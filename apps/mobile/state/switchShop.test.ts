import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/auth', () => ({
  getUserPermissionOverrides: vi.fn(),
  markShopCloudLinked: vi.fn(),
}));
const commercial = vi.hoisted(() => ({
  membershipForSwitch: vi.fn(),
  requireShopSwitchAccess: vi.fn(),
}));
vi.mock('../db/commercial', () => ({
  membershipForSwitch: commercial.membershipForSwitch,
  requireShopSwitchAccess: commercial.requireShopSwitchAccess,
}));
vi.mock('../sync', () => ({ startSyncEngine: vi.fn(), stopSyncEngine: vi.fn() }));
vi.mock('../sync/billing', () => ({ refreshBillingStatus: vi.fn() }));
vi.mock('../sync/connectivity', () => ({ hasNetworkConnection: vi.fn() }));
vi.mock('../sync/invoke', () => ({ invokeSyncWithClaimRefresh: vi.fn() }));
vi.mock('../sync/pull', () => ({ pullChanges: vi.fn() }));
vi.mock('../sync/authActorBinding', () => ({
  inspectCloudActorBinding: vi.fn(),
  assertCloudActorBinding: (binding: { status: string }) => {
    if (binding.status !== 'matched') throw new Error('Cloud actor mismatch');
  },
}));
vi.mock('../sync/supabaseClient', () => ({ isSupabaseConfigured: true, supabase: {} }));
const deviceRegistry = vi.hoisted(() => ({
  installationClaim: vi.fn(() => ({ deviceRegistryVersion: 1, devicePublicId: 'install-1', label: 'Counter' })),
  isDeviceEnrolled: vi.fn(async () => true),
  recordBoundInstallation: vi.fn(async () => true),
}));
vi.mock('../sync/deviceRegistry', () => deviceRegistry);

const { useSessionStore } = await import('./sessionStore');
const {
  OFFLINE_SHOP_RELINK_RETRY_MS,
  ShopRelinkPausedError,
  revalidateOfflineSelectedShop,
  switchActiveShop,
} = await import('./switchShop');
const { hasNetworkConnection } = await import('../sync/connectivity');
const { invokeSyncWithClaimRefresh } = await import('../sync/invoke');
const { getUserPermissionOverrides, markShopCloudLinked } = await import('../db/auth');
const { pullChanges } = await import('../sync/pull');
const { supabase } = await import('../sync/supabaseClient');
const { inspectCloudActorBinding } = await import('../sync/authActorBinding');
const { startSyncEngine } = await import('../sync');

const OWNER_SESSION = {
  shopId: 'shop-1', userId: 'owner-1', principalUserId: 'owner-1',
  billingAccountId: 'account-1', role: 'owner' as const, cloudShopConfirmed: true,
};

describe('multi-shop switch entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ session: OWNER_SESSION, epoch: 0, authorityTransitioning: false });
    vi.mocked(inspectCloudActorBinding).mockResolvedValue({
      status: 'matched', actorUserId: 'owner-1', shopId: 'shop-1',
    });
  });

  it.each([
    ['a Free owner', 'free'],
    ['an owner whose trial expired', 'expired'],
  ])('refuses %s before any membership lookup or network call', async (_label, _state) => {
    commercial.requireShopSwitchAccess.mockRejectedValue(
      Object.assign(new Error('Upgrade to Pro or Ultra to use this feature.'), { name: 'PlanAccessError' }),
    );

    await expect(switchActiveShop('shop-2', true)).rejects.toThrow(/Upgrade to Pro or Ultra/);

    // The entitlement gate sits above membership and above the wire: nothing
    // downstream of it may run for a non-premium owner.
    expect(commercial.requireShopSwitchAccess).toHaveBeenCalledWith('shop-1', 'shop-2');
    expect(commercial.membershipForSwitch).not.toHaveBeenCalled();
    expect(vi.mocked(invokeSyncWithClaimRefresh)).not.toHaveBeenCalled();
    expect(vi.mocked(hasNetworkConnection)).not.toHaveBeenCalled();
  });

  it('lets an entitled trial owner through to the offline membership path', async () => {
    commercial.requireShopSwitchAccess.mockResolvedValue(undefined);
    commercial.membershipForSwitch.mockResolvedValue(null);

    // Offline branch: the next failure is the membership one, which proves the
    // entitlement gate itself let the trial owner past.
    await expect(switchActiveShop('shop-2', false)).rejects.toThrow(/Open this shop online once/);
    expect(commercial.membershipForSwitch).toHaveBeenCalledWith('owner-1', 'shop-2');
  });
});

describe('offline multi-shop reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ session: null, epoch: 0, authorityTransitioning: false });
  });

  it('cancels target hydration when the phone changes hands during a switch', async () => {
    useSessionStore.setState({ session: OWNER_SESSION, epoch: 0 });
    commercial.requireShopSwitchAccess.mockResolvedValue(undefined);
    commercial.membershipForSwitch.mockResolvedValue(undefined);
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({
      data: { actor_user_id: 'owner-2', role: 'owner', billing_account_id: 'account-1' },
      error: null,
    });
    vi.mocked(inspectCloudActorBinding).mockResolvedValue({
      status: 'matched', actorUserId: 'owner-2', shopId: 'shop-2',
    });
    Object.assign(supabase, {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'old-token' } }, error: null }),
        refreshSession: vi.fn().mockResolvedValue({ error: null }),
      },
      functions: { invoke: vi.fn().mockResolvedValue({ error: null }) },
    });
    vi.mocked(pullChanges).mockImplementationOnce(async (_shopId, _cursor, isCancelled) => {
      expect(isCancelled?.()).toBe(false);
      useSessionStore.getState().login({ ...OWNER_SESSION, userId: 'incoming-owner' });
      expect(isCancelled?.()).toBe(true);
    });
    await expect(switchActiveShop('shop-2', true)).rejects.toThrow(/active user changed/);
    expect(markShopCloudLinked).not.toHaveBeenCalled();
    expect(useSessionStore.getState().session?.userId).toBe('incoming-owner');
  });

  it('records the cloud link only after the server confirmed the switch and hydration finished', async () => {
    // The physical defect: a switched-to shop hydrated fine but kept
    // cloud_linked_at NULL, so the next cold start read it as an unfinished
    // registration and sent an already-linked owner back to OTP.
    useSessionStore.setState({ session: OWNER_SESSION, epoch: 0 });
    commercial.requireShopSwitchAccess.mockResolvedValue(undefined);
    commercial.membershipForSwitch.mockResolvedValue(undefined);
    vi.mocked(invokeSyncWithClaimRefresh).mockImplementation(async () => {
      // The old session is gone and the root gate remains explicitly closed
      // for the entire first network await.
      expect(useSessionStore.getState()).toMatchObject({
        session: null,
        authorityTransitioning: true,
      });
      return {
        data: { actor_user_id: 'owner-2', role: 'owner', billing_account_id: 'account-1' },
        error: null,
      } as never;
    });
    vi.mocked(getUserPermissionOverrides).mockResolvedValue({} as never);
    Object.assign(supabase, {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }),
        refreshSession: vi.fn().mockResolvedValue({ error: null }),
      },
      functions: { invoke: vi.fn() },
    });
    vi.mocked(inspectCloudActorBinding)
      .mockResolvedValueOnce({ status: 'matched', actorUserId: 'owner-1', shopId: 'shop-1' })
      .mockResolvedValueOnce({ status: 'matched', actorUserId: 'owner-2', shopId: 'shop-2' });

    await switchActiveShop('shop-2', true);

    expect(vi.mocked(markShopCloudLinked)).toHaveBeenCalledWith('shop-2');
    // Order is the guarantee, not just the call: the link is a consequence of a
    // completed hydration, never something claimed ahead of one.
    expect(vi.mocked(pullChanges)).toHaveBeenCalledBefore(vi.mocked(markShopCloudLinked));
    expect(useSessionStore.getState().session).toMatchObject({
      shopId: 'shop-2', userId: 'owner-2', cloudShopConfirmed: true,
      cloudActorConfirmed: true,
    });
    expect(useSessionStore.getState().authorityTransitioning).toBe(false);
    expect(vi.mocked(startSyncEngine)).not.toHaveBeenCalled();
  });

  it('re-links an offline-selected shop before comparing the refreshed target binding', async () => {
    useSessionStore.setState({
      session: { ...OWNER_SESSION, shopId: 'shop-2', userId: 'owner-2', cloudShopConfirmed: false },
      epoch: 0,
      authorityTransitioning: false,
    });
    commercial.requireShopSwitchAccess.mockResolvedValue(undefined);
    commercial.membershipForSwitch.mockResolvedValue({
      actorUserId: 'owner-2', role: 'owner', billingAccountId: 'account-1',
    });
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({
      data: { actor_user_id: 'owner-2', role: 'owner', billing_account_id: 'account-1' },
      error: null,
    } as never);
    vi.mocked(getUserPermissionOverrides).mockResolvedValue({} as never);
    Object.assign(supabase, {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'old-shop-token' } }, error: null }),
        refreshSession: vi.fn().mockResolvedValue({ error: null }),
      },
      functions: { invoke: vi.fn() },
    });
    vi.mocked(inspectCloudActorBinding).mockResolvedValueOnce({
      status: 'matched', actorUserId: 'owner-2', shopId: 'shop-2',
    });

    await switchActiveShop('shop-2', true);

    // Only the post-switch binding is inspected. The pre-switch JWT is known
    // to name the previous cloud shop and is not misclassified as revocation.
    expect(vi.mocked(inspectCloudActorBinding)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(inspectCloudActorBinding)).toHaveBeenCalledWith({
      userId: 'owner-2', shopId: 'shop-2',
    });
    expect(useSessionStore.getState().session).toMatchObject({
      shopId: 'shop-2', userId: 'owner-2', cloudShopConfirmed: true,
    });
  });

  it('revalidates the offline-selected shop when connectivity returns', async () => {
    useSessionStore.setState({
      session: {
        shopId: 'shop-2', userId: 'owner-2', principalUserId: 'owner-1',
        billingAccountId: 'account-1', role: 'owner', cloudShopConfirmed: false,
      },
    });
    const switchShop = vi.fn().mockResolvedValue(undefined);
    await expect(revalidateOfflineSelectedShop({ isOnline: async () => true, switchShop })).resolves.toBe(true);
    expect(switchShop).toHaveBeenCalledWith('shop-2', true);
  });

  it('does nothing while offline or after cloud confirmation', async () => {
    useSessionStore.setState({
      session: { shopId: 'shop-2', userId: 'owner-2', role: 'owner', cloudShopConfirmed: false },
    });
    const switchShop = vi.fn();
    await expect(revalidateOfflineSelectedShop({ isOnline: async () => false, switchShop })).resolves.toBe(false);
    expect(switchShop).not.toHaveBeenCalled();
    useSessionStore.setState({ session: { shopId: 'shop-2', userId: 'owner-2', role: 'owner', cloudShopConfirmed: true } });
    await expect(revalidateOfflineSelectedShop({ isOnline: async () => true, switchShop })).resolves.toBe(false);
  });

  it('pauses automatic re-link attempts after a failure instead of looping', async () => {
    // 2026-11-22: a failed switch re-logged-in the old session, which re-ran
    // the root gate, which switched again — ~2 refused requests a second.
    useSessionStore.setState({
      session: {
        shopId: 'shop-3', userId: 'owner-3', principalUserId: 'owner-1',
        billingAccountId: 'account-1', role: 'owner', cloudShopConfirmed: false,
      },
    });
    const switchShop = vi.fn().mockRejectedValue(new Error('refused'));
    let clock = 1_000_000;
    const now = () => clock;
    const online = async () => true;

    await expect(revalidateOfflineSelectedShop({ isOnline: online, switchShop, now })).rejects.toThrow('refused');
    clock += 1_000;
    await expect(revalidateOfflineSelectedShop({ isOnline: online, switchShop, now }))
      .rejects.toBeInstanceOf(ShopRelinkPausedError);
    expect(switchShop).toHaveBeenCalledTimes(1);

    clock += OFFLINE_SHOP_RELINK_RETRY_MS;
    switchShop.mockResolvedValueOnce(undefined);
    await expect(revalidateOfflineSelectedShop({ isOnline: online, switchShop, now })).resolves.toBe(true);
    expect(switchShop).toHaveBeenCalledTimes(2);
  });
});

describe('the device binding travels with the shop switch', () => {
  const SWITCHED = { actor_user_id: 'owner-2', role: 'owner', billing_account_id: 'account-1' };
  let refreshSession: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ session: OWNER_SESSION, epoch: 0, authorityTransitioning: false });
    commercial.requireShopSwitchAccess.mockResolvedValue(undefined);
    commercial.membershipForSwitch.mockResolvedValue(undefined);
    deviceRegistry.isDeviceEnrolled.mockResolvedValue(true);
    vi.mocked(getUserPermissionOverrides).mockResolvedValue({} as never);
    vi.mocked(pullChanges).mockResolvedValue(undefined as never);
    vi.mocked(inspectCloudActorBinding)
      .mockResolvedValueOnce({ status: 'matched', actorUserId: 'owner-1', shopId: 'shop-1' })
      .mockResolvedValueOnce({ status: 'matched', actorUserId: 'owner-2', shopId: 'shop-2' });
    refreshSession = vi.fn().mockResolvedValue({ error: null });
    Object.assign(supabase, {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null }),
        refreshSession,
      },
      functions: { invoke: vi.fn() },
    });
  });

  it('sends the installation labels and asks for a re-key only when no secret is held', async () => {
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({ data: SWITCHED, error: null } as never);
    await switchActiveShop('shop-2', true);
    expect(vi.mocked(invokeSyncWithClaimRefresh)).toHaveBeenCalledWith(expect.objectContaining({
      action: 'shop-switch', shopId: 'shop-2', label: 'Counter', deviceSecretMissing: false,
    }));
    expect(deviceRegistry.isDeviceEnrolled).toHaveBeenCalledWith('shop-2');
  });

  it('asks the server to re-key when this phone holds no secret for the target shop', async () => {
    deviceRegistry.isDeviceEnrolled.mockResolvedValue(false);
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({ data: SWITCHED, error: null } as never);
    await switchActiveShop('shop-2', true);
    expect(vi.mocked(invokeSyncWithClaimRefresh)).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: 'shop-2', deviceSecretMissing: true }),
    );
  });

  it('saves the target-shop secret the server hands back, before hydrating that shop', async () => {
    const device = { deviceSecret: 'a'.repeat(64), deviceAuthority: { shopId: 'shop-2' } };
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({ data: { ...SWITCHED, device }, error: null } as never);
    await switchActiveShop('shop-2', true);
    expect(deviceRegistry.recordBoundInstallation).toHaveBeenCalledWith(
      'shop-2', device, { required: true, expectedActorUserId: 'owner-2' },
    );
    expect(deviceRegistry.recordBoundInstallation).toHaveBeenCalledBefore(vi.mocked(pullChanges));
  });

  it('pulls with the shop\'s own stored cursor, so a hydrated shop fetches only its changes', async () => {
    // `undefined` lets pull.ts use getLastPulledCursor(shopId): full hydration
    // when the shop has never been pulled here, incremental otherwise. `null`
    // forced a full re-download on every switch (~15 requests).
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({ data: SWITCHED, error: null } as never);
    await switchActiveShop('shop-2', true);
    expect(vi.mocked(pullChanges)).toHaveBeenCalledWith('shop-2', undefined, expect.any(Function));
  });

  it('does not write a secret when the server re-pointed an existing registration', async () => {
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({
      data: { ...SWITCHED, device: { deviceAuthority: { shopId: 'shop-2' } } }, error: null,
    } as never);
    await switchActiveShop('shop-2', true);
    expect(deviceRegistry.recordBoundInstallation).not.toHaveBeenCalled();
  });

  it('refreshes the token BEFORE the rollback switch, so the device gate accepts it', async () => {
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({ data: SWITCHED, error: null } as never);
    vi.mocked(pullChanges).mockRejectedValueOnce(new Error('pull failed'));

    await expect(switchActiveShop('shop-2', true)).rejects.toThrow('pull failed');

    const invokes = vi.mocked(invokeSyncWithClaimRefresh).mock;
    expect(invokes.calls[1]?.[0]).toMatchObject({ action: 'shop-switch', shopId: 'shop-1' });
    // refresh #1 follows the switch; #2 precedes the rollback; #3 follows it.
    expect(refreshSession).toHaveBeenCalledTimes(3);
    const [, beforeRollback = 0, afterRollback = 0] = refreshSession.mock.invocationCallOrder;
    const rollback = invokes.invocationCallOrder[1] ?? 0;
    expect(beforeRollback).toBeLessThan(rollback);
    expect(afterRollback).toBeGreaterThan(rollback);
    expect(useSessionStore.getState().session).toMatchObject({ shopId: 'shop-1', cloudShopConfirmed: true });
  });

  it('keeps the shop unconfirmed when the server refuses the rollback', async () => {
    vi.mocked(invokeSyncWithClaimRefresh)
      .mockResolvedValueOnce({ data: SWITCHED, error: null } as never)
      .mockResolvedValueOnce({ data: null, error: new Error('refused') } as never);
    vi.mocked(pullChanges).mockRejectedValueOnce(new Error('pull failed'));

    await expect(switchActiveShop('shop-2', true)).rejects.toThrow('pull failed');
    // A refused rollback used to be read as success and re-confirm a shop the
    // server had already moved away from.
    expect(useSessionStore.getState().session).toMatchObject({
      shopId: 'shop-1', cloudShopConfirmed: false,
    });
  });
});
