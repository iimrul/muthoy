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

const { useSessionStore } = await import('./sessionStore');
const { revalidateOfflineSelectedShop, switchActiveShop } = await import('./switchShop');
const { hasNetworkConnection } = await import('../sync/connectivity');
const { invokeSyncWithClaimRefresh } = await import('../sync/invoke');
const { getUserPermissionOverrides, markShopCloudLinked } = await import('../db/auth');
const { pullChanges } = await import('../sync/pull');
const { supabase } = await import('../sync/supabaseClient');
const { inspectCloudActorBinding } = await import('../sync/authActorBinding');

const OWNER_SESSION = {
  shopId: 'shop-1', userId: 'owner-1', principalUserId: 'owner-1',
  billingAccountId: 'account-1', role: 'owner' as const, cloudShopConfirmed: true,
};

describe('multi-shop switch entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ session: OWNER_SESSION, epoch: 0 });
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
  beforeEach(() => useSessionStore.setState({ session: null, epoch: 0 }));

  it('records the cloud link only after the server confirmed the switch and hydration finished', async () => {
    // The physical defect: a switched-to shop hydrated fine but kept
    // cloud_linked_at NULL, so the next cold start read it as an unfinished
    // registration and sent an already-linked owner back to OTP.
    useSessionStore.setState({ session: OWNER_SESSION, epoch: 0 });
    commercial.requireShopSwitchAccess.mockResolvedValue(undefined);
    commercial.membershipForSwitch.mockResolvedValue(undefined);
    vi.mocked(invokeSyncWithClaimRefresh).mockResolvedValue({
      data: { actor_user_id: 'owner-2', role: 'owner', billing_account_id: 'account-1' },
      error: null,
    } as never);
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
});
