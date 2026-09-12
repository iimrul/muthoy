// @vitest-environment jsdom

/**
 * The physical B4 report: server already granted the 14-day Trial, but the
 * device kept showing "Plan could not be verified / sync online once" until
 * the owner pressed Sync by hand. This proves the fix end to end — real
 * SQLite, the real usePlan/useMultiShopAccess hooks, only the network edge
 * (sync/invoke's Supabase call) and connectivity mocked — so a passing suite
 * here means the Trial and Multi-Shop actually update themselves, not that a
 * mock was told to say so.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { sqlite } from './test/expo-sqlite';
import type { ServerCommercialSnapshot } from './commercial';

const appState = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  return {
    listeners,
    emit: (state: string) => { for (const listener of [...listeners]) listener(state); },
  };
});
vi.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (_event: string, callback: (state: string) => void) => {
      appState.listeners.add(callback);
      return { remove: () => appState.listeners.delete(callback) };
    },
  },
}));

const connectivity = vi.hoisted(() => {
  let online = true;
  const reconnectListeners = new Set<() => void>();
  return {
    setOnline: (value: boolean) => { online = value; },
    hasNetworkConnection: vi.fn(async () => online),
    subscribeToReconnect: vi.fn((listener: () => void) => {
      reconnectListeners.add(listener);
      return () => reconnectListeners.delete(listener);
    }),
    fireReconnect: () => { for (const listener of [...reconnectListeners]) listener(); },
    listenerCount: () => reconnectListeners.size,
  };
});
vi.mock('../sync/connectivity', () => ({
  hasNetworkConnection: connectivity.hasNetworkConnection,
  subscribeToReconnect: connectivity.subscribeToReconnect,
  readNetworkDiagnostics: async () => ({
    reachability: 'unknown', isConnected: null, isInternetReachable: null,
    type: 'unknown', probeHostConfigured: true,
  }),
}));

const invoke = vi.hoisted(() => ({ invokeSyncWithClaimRefresh: vi.fn() }));
const configuration = vi.hoisted(() => ({ requireSupabaseConfiguration: vi.fn() }));
vi.mock('../sync/supabaseClient', () => ({
  requireSupabaseConfiguration: configuration.requireSupabaseConfiguration,
  supabase: {},
}));
// Only the network call is faked. SyncHaltedError stays real, because
// requestFailure.ts classifies against it with instanceof — a stubbed class
// would silently make every halt look unrecognised.
vi.mock('../sync/invoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sync/invoke')>()),
  invokeSyncWithClaimRefresh: invoke.invokeSyncWithClaimRefresh,
}));

// usePlan also listens for the full sync engine's own completion event as a
// secondary refresh trigger — irrelevant to what THIS suite proves (the
// dedicated hydration path), and the real engine pulls in push/pull/realtime
// modules this test has no reason to load.
vi.mock('../sync', () => ({ subscribeToSyncCompletion: () => () => undefined }));

const { db } = await import('./client');
const { shops, roles, users, billingAccounts, entitlementCache, shopDirectory, shopMemberships } = await import('./schema');
const { useSessionStore } = await import('../state/sessionStore');
const { usePlan } = await import('../state/usePlan');
const { useMultiShopAccess } = await import('../state/useMultiShopAccess');
const { useBillingAccountId } = await import('../state/useBillingAccountId');
const { refreshBillingStatus, StaleBillingRefreshError } = await import('../sync/billing');
const {
  startBillingHydration,
  stopBillingHydration,
  readHydrationStatus,
  subscribeHydrationStatus,
} = await import('../sync/billingHydration');

const SHOP_ID = '9d111111-1111-4111-8111-111111111111';
const OWNER_ID = '9d222222-2222-4222-8222-222222222222';
const ROLE_ID = '9d444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '9d666666-6666-4666-8666-666666666666';
const MEMBERSHIP_ID = '9d777777-7777-4777-8777-777777777777';
const SHOP_TWO_ID = '9e111111-1111-4111-8111-111111111111';
const OWNER_TWO_ID = '9e222222-2222-4222-8222-222222222222';
const ROLE_TWO_ID = '9e444444-4444-4444-8444-444444444444';
const ACCOUNT_TWO_ID = '9e666666-6666-4666-8666-666666666666';
const MEMBERSHIP_TWO_ID = '9e777777-7777-4777-8777-777777777777';
const T0 = '2026-09-01T06:00:00.000Z';

const OWNER_SESSION = { shopId: SHOP_ID, userId: OWNER_ID, role: 'owner' as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function flushMicrotasks(rounds = 12): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function serverTrialSnapshot(input: {
  shopId?: string;
  ownerId?: string;
  accountId?: string;
  membershipId?: string;
} = {}): ServerCommercialSnapshot & { order: null } {
  const shopId = input.shopId ?? SHOP_ID;
  const ownerId = input.ownerId ?? OWNER_ID;
  const accountId = input.accountId ?? ACCOUNT_ID;
  const membershipId = input.membershipId ?? MEMBERSHIP_ID;
  return {
    directory_complete: true,
    account: {
      id: accountId, principal_owner_user_id: ownerId, primary_shop_id: shopId,
      launch_trial_granted_at: T0, created_at: T0, updated_at: T0,
    },
    entitlement: {
      billing_account_id: accountId, tier: 'free' as const, status: 'trialing' as const,
      trial_ends_at: '2999-01-01T00:00:00.000Z', paid_through: null, grace_ends_at: null,
      verified_at: T0, version: 1, updated_at: T0,
    },
    memberships: [{
      id: membershipId, billing_account_id: accountId, principal_user_id: ownerId,
      shop_id: shopId, actor_user_id: ownerId, role: 'owner' as const, is_active: true,
      created_at: T0, updated_at: T0,
    }],
    shops: [{
      id: shopId, name: 'Shop', name_en: 'Shop', commercial_status: 'active' as const,
      commercial_reason: null, archived_at: null, created_at: T0, updated_at: T0,
    }],
    order: null,
  };
}

beforeAll(() => {
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrationDir = resolve('apps/mobile/db/migrations');
  for (const file of readdirSync(migrationDir).filter((name) => /^00(?:0\d|1\d|2[0-9])_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(resolve(migrationDir, file), 'utf8'));
  }
  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Shop', phone: '01700000041', createdAt: T0, updatedAt: T0 }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: T0, updatedAt: T0 }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000041', pinHash: 'hash', pinSetAt: T0, roleId: ROLE_ID, isActive: true, createdAt: T0, updatedAt: T0 }).run();
  db.insert(shops).values({ id: SHOP_TWO_ID, ownerId: OWNER_TWO_ID, name: 'Shop Two', phone: '01700000042', createdAt: T0, updatedAt: T0 }).run();
  db.insert(roles).values({ id: ROLE_TWO_ID, shopId: SHOP_TWO_ID, name: 'owner', isSystem: true, createdAt: T0, updatedAt: T0 }).run();
  db.insert(users).values({ id: OWNER_TWO_ID, shopId: SHOP_TWO_ID, name: 'Owner Two', phone: '01700000042', pinHash: 'hash', pinSetAt: T0, roleId: ROLE_TWO_ID, isActive: true, createdAt: T0, updatedAt: T0 }).run();
});

beforeEach(() => {
  vi.clearAllMocks();
  configuration.requireSupabaseConfiguration.mockReset();
  connectivity.setOnline(true);
  db.delete(shopMemberships).run();
  db.delete(shopDirectory).run();
  db.delete(entitlementCache).run();
  db.delete(billingAccounts).run();
  useSessionStore.setState({ session: OWNER_SESSION, epoch: 0 });
});

afterEach(() => {
  stopBillingHydration();
  cleanup();
});

describe('billing entitlement auto-hydration', () => {
  it('fails clearly and without retries when Supabase configuration is missing', async () => {
    vi.useFakeTimers();
    configuration.requireSupabaseConfiguration.mockImplementation(() => {
      throw new Error('Supabase is not configured. Add the mobile app environment variables first.');
    });

    try {
      startBillingHydration(SHOP_ID);
      await flushMicrotasks();

      expect(readHydrationStatus()).toEqual({ phase: 'failed', failure: 'config', everAttempted: true });
      expect(invoke.invokeSyncWithClaimRefresh).not.toHaveBeenCalled();
      expect(db.select().from(billingAccounts).all()).toHaveLength(0);
      expect(db.select().from(entitlementCache).all()).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stopBillingHydration();
      vi.useRealTimers();
    }
  });

  it('shows the server Trial automatically after login — no manual sync', async () => {
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });
    const plan = renderHook(() => usePlan());

    startBillingHydration(SHOP_ID);

    await waitFor(() => expect(plan.result.current.plan).toBe('trial'));
    expect(plan.result.current.effectiveTier).toBe('ultra');
    // Exactly the automatic path — nothing that looks like a manual Sync button
    // press was ever invoked to get here.
    expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledWith(
      { action: 'billing-status' },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('unlocks Multi-Shop (Trial -> effective Ultra) immediately after hydration', async () => {
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });
    const access = renderHook(() => useMultiShopAccess());
    expect(access.result.current.allowed).toBe(false);

    startBillingHydration(SHOP_ID);

    await waitFor(() => expect(access.result.current.entitled).toBe(true));
    expect(access.result.current.allowed).toBe(true);
  });

  it('retries automatically on reconnect, with no manual Sync', async () => {
    connectivity.setOnline(false);
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({
      data: null, error: new TypeError('Network request failed'),
    });
    const plan = renderHook(() => usePlan());

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(readHydrationStatus().failure).toBe('offline'));
    expect(plan.result.current.reason).toBe('unverified');

    connectivity.setOnline(true);
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });
    act(() => connectivity.fireReconnect());

    await waitFor(() => expect(plan.result.current.plan).toBe('trial'));
  });

  it('a failed verification stays unverified/fail-closed, never silently becomes Free', async () => {
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: null, error: new Error('billing-status unreachable') });
    const plan = renderHook(() => usePlan());

    startBillingHydration(SHOP_ID);

    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalled());
    // Fail-closed: locked out of premium exactly like Free, but distinguishably
    // 'unverified' — the UI shows "could not verify", not a quiet downgrade.
    expect(plan.result.current.effectiveTier).toBe('free');
    expect(plan.result.current.reason).toBe('unverified');
  });

  it('a previously verified Trial still works fully offline, within its cached bounds', async () => {
    db.insert(billingAccounts).values({ id: ACCOUNT_ID, principalOwnerUserId: OWNER_ID, primaryShopId: SHOP_ID, launchTrialGrantedAt: T0, createdAt: T0, updatedAt: T0 }).run();
    db.insert(shopDirectory).values({ shopId: SHOP_ID, billingAccountId: ACCOUNT_ID, name: 'Shop', commercialStatus: 'active', createdAt: T0, updatedAt: T0 }).run();
    db.insert(entitlementCache).values({
      billingAccountId: ACCOUNT_ID, tier: 'free', status: 'trialing',
      trialEndsAt: '2999-01-01T00:00:00.000Z', verifiedAt: T0, lastObservedAt: T0, version: 1, updatedAt: T0,
    }).run();
    connectivity.setOnline(false);
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({
      data: null, error: new TypeError('Network request failed'),
    });

    const plan = renderHook(() => usePlan());
    // The cached Trial is readable with no network round trip at all.
    await waitFor(() => expect(plan.result.current.plan).toBe('trial'));
    expect(plan.result.current.effectiveTier).toBe('ultra');

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(readHydrationStatus().phase).toBe('failed'));

    // And a failed verification must not revoke a cached entitlement that is
    // still inside its own validity window. Offline downgrades nobody.
    expect(plan.result.current.plan).toBe('trial');
    expect(plan.result.current.effectiveTier).toBe('ultra');
  });

  it('an app-foreground resume retries after a failed attempt, same as reconnect', async () => {
    invoke.invokeSyncWithClaimRefresh.mockResolvedValueOnce({ data: null, error: new Error('timeout') });
    const plan = renderHook(() => usePlan());

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(1));
    expect(plan.result.current.reason).toBe('unverified');

    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });
    act(() => appState.emit('active'));

    await waitFor(() => expect(plan.result.current.plan).toBe('trial'));
  });
});

describe('the physical Android blocker: a device that wrongly believes it is offline', () => {
  it('still attempts the first verification when connectivity claims offline', async () => {
    // Exactly the reported device: working internet, but NetInfo's Google
    // probe failed so every connectivity check answers offline. The first
    // attempt of a session must go out regardless — otherwise one wrong
    // reading strands the owner as unverified forever, which is the bug.
    connectivity.setOnline(false);
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });
    const plan = renderHook(() => usePlan());

    startBillingHydration(SHOP_ID);

    await waitFor(() => expect(plan.result.current.plan).toBe('trial'));
    expect(plan.result.current.effectiveTier).toBe('ultra');
  });

  it('reports a server refusal as a server failure, never as offline', async () => {
    const httpish = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
    });
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: null, error: httpish });

    startBillingHydration(SHOP_ID);

    await waitFor(() => expect(readHydrationStatus().phase).toBe('failed'));
    // "unknown" is acceptable; "offline" is not — the owner must never be told
    // to go online because our own server misbehaved.
    expect(readHydrationStatus().failure).not.toBe('offline');
  });

  it('shows a verifying phase first, then settles verified', async () => {
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });

    startBillingHydration(SHOP_ID);
    expect(readHydrationStatus().phase).toBe('verifying');

    await waitFor(() => expect(readHydrationStatus().phase).toBe('verified'));
    expect(readHydrationStatus().failure).toBeNull();
  });
});

describe('the verified response actually lands in SQLite', () => {
  it('writes the billing account and a trialing entitlement row', async () => {
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(readHydrationStatus().phase).toBe('verified'));

    const account = db.select().from(billingAccounts).where(eq(billingAccounts.id, ACCOUNT_ID)).get();
    expect(account).toMatchObject({ id: ACCOUNT_ID, primaryShopId: SHOP_ID });

    const entitlement = db.select().from(entitlementCache)
      .where(eq(entitlementCache.billingAccountId, ACCOUNT_ID)).get();
    expect(entitlement).toMatchObject({ status: 'trialing', trialEndsAt: '2999-01-01T00:00:00.000Z' });
    expect(entitlement?.verifiedAt).toBeTruthy();

    // The directory row is what keys the shop to the account — without it the
    // entitlement exists but no screen can find it.
    const directory = db.select().from(shopDirectory).where(eq(shopDirectory.shopId, SHOP_ID)).get();
    expect(directory).toMatchObject({ shopId: SHOP_ID, billingAccountId: ACCOUNT_ID });
  });

  it('recovers a stale session that never carried a billingAccountId', async () => {
    // A session persisted before B4 has no billingAccountId claim at all. The
    // account must be recoverable from the verified SQLite projection instead,
    // or such an owner stays blocked forever through no fault of their own.
    useSessionStore.setState({
      session: { shopId: SHOP_ID, userId: OWNER_ID, role: 'owner' },
      epoch: 0,
    });
    expect(useSessionStore.getState().session).not.toHaveProperty('billingAccountId');
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });

    const account = renderHook(() => useBillingAccountId(SHOP_ID));
    const access = renderHook(() => useMultiShopAccess());

    startBillingHydration(SHOP_ID);

    await waitFor(() => expect(account.result.current.billingAccountId).toBe(ACCOUNT_ID));
    await waitFor(() => expect(access.result.current.allowed).toBe(true));
  });
});

describe('session-bound hydration lifecycle', () => {
  it('binds direct billing refreshes to the captured session epoch and shop by default', async () => {
    const request = deferred<{ data: ReturnType<typeof serverTrialSnapshot>; error: null }>();
    invoke.invokeSyncWithClaimRefresh.mockReturnValue(request.promise);

    const refresh = refreshBillingStatus(SHOP_ID);
    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(1));
    act(() => useSessionStore.getState().login({
      shopId: SHOP_TWO_ID,
      userId: OWNER_TWO_ID,
      role: 'owner',
    }));
    request.resolve({ data: serverTrialSnapshot(), error: null });

    await expect(refresh).rejects.toBeInstanceOf(StaleBillingRefreshError);
    expect(db.select().from(billingAccounts).all()).toHaveLength(0);
    expect(db.select().from(entitlementCache).all()).toHaveLength(0);
  });

  it('aborts an in-flight request when logout cleanup stops the controller', async () => {
    const request = deferred<{ data: ReturnType<typeof serverTrialSnapshot>; error: null }>();
    invoke.invokeSyncWithClaimRefresh.mockReturnValue(request.promise);

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(1));
    const signal = invoke.invokeSyncWithClaimRefresh.mock.calls[0]?.[1]?.signal as AbortSignal;

    act(() => useSessionStore.getState().clearActiveUser());
    stopBillingHydration();
    expect(signal.aborted).toBe(true);

    request.resolve({ data: serverTrialSnapshot(), error: null });
    await flushMicrotasks();
    expect(db.select().from(billingAccounts).all()).toHaveLength(0);
    expect(readHydrationStatus()).toEqual({ phase: 'idle', failure: null, everAttempted: false });
  });

  it('ignores a stale logout response before lifecycle cleanup can run', async () => {
    const request = deferred<{ data: ReturnType<typeof serverTrialSnapshot>; error: null }>();
    invoke.invokeSyncWithClaimRefresh.mockReturnValue(request.promise);
    const published: string[] = [];
    const unsubscribe = subscribeHydrationStatus((next) => published.push(next.phase));

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(1));
    const beforeLogout = [...published];

    // Resolve before the RootLayout effect cleanup can call stop. This proves
    // the session epoch itself rejects the response, not merely AbortSignal.
    act(() => useSessionStore.getState().clearActiveUser());
    request.resolve({ data: serverTrialSnapshot(), error: null });
    await flushMicrotasks();

    expect(db.select().from(billingAccounts).all()).toHaveLength(0);
    expect(db.select().from(entitlementCache).all()).toHaveLength(0);
    expect(published).toEqual(beforeLogout);
    expect(published).not.toContain('verified');
    expect(published).not.toContain('failed');

    stopBillingHydration();
    expect(readHydrationStatus()).toEqual({ phase: 'idle', failure: null, everAttempted: false });
    unsubscribe();
  });

  it('starts a mandatory request for a new session while the stale request is still in flight', async () => {
    const stale = deferred<{ data: ReturnType<typeof serverTrialSnapshot>; error: null }>();
    invoke.invokeSyncWithClaimRefresh
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ data: serverTrialSnapshot(), error: null });

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(1));

    act(() => useSessionStore.getState().login(OWNER_SESSION));
    startBillingHydration(SHOP_ID);

    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readHydrationStatus().phase).toBe('verified'));
    stale.resolve({
      data: {
        ...serverTrialSnapshot(),
        entitlement: {
          ...serverTrialSnapshot().entitlement,
          status: 'expired',
          trial_ends_at: null,
          version: 0,
        },
      },
      error: null,
    });
    await flushMicrotasks();

    const entitlement = db.select().from(entitlementCache)
      .where(eq(entitlementCache.billingAccountId, ACCOUNT_ID)).get();
    expect(entitlement).toMatchObject({ status: 'trialing', version: 1 });
    expect(readHydrationStatus().phase).toBe('verified');
  });

  it('keeps one trigger-listener set per generation and removes it on stop', async () => {
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({ data: serverTrialSnapshot(), error: null });

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(readHydrationStatus().phase).toBe('verified'));
    expect(appState.listeners.size).toBe(1);
    expect(connectivity.listenerCount()).toBe(1);

    act(() => useSessionStore.getState().login(OWNER_SESSION));
    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(2));
    expect(appState.listeners.size).toBe(1);
    expect(connectivity.listenerCount()).toBe(1);

    stopBillingHydration();
    expect(appState.listeners.size).toBe(0);
    expect(connectivity.listenerCount()).toBe(0);
  });

  it('invalidates an in-flight shop generation and hydrates the switched shop immediately', async () => {
    const stale = deferred<{ data: ReturnType<typeof serverTrialSnapshot>; error: null }>();
    const shopTwoSnapshot = serverTrialSnapshot({
      shopId: SHOP_TWO_ID,
      ownerId: OWNER_TWO_ID,
      accountId: ACCOUNT_TWO_ID,
      membershipId: MEMBERSHIP_TWO_ID,
    });
    invoke.invokeSyncWithClaimRefresh
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ data: shopTwoSnapshot, error: null });

    startBillingHydration(SHOP_ID);
    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(1));
    const staleSignal = invoke.invokeSyncWithClaimRefresh.mock.calls[0]?.[1]?.signal as AbortSignal;
    act(() => useSessionStore.getState().login({
      shopId: SHOP_TWO_ID,
      userId: OWNER_TWO_ID,
      role: 'owner',
    }));
    startBillingHydration(SHOP_TWO_ID);
    expect(staleSignal.aborted).toBe(true);

    await waitFor(() => expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(
      db.select().from(entitlementCache)
        .where(eq(entitlementCache.billingAccountId, ACCOUNT_TWO_ID)).get()?.status,
    ).toBe('trialing'));

    stale.resolve({ data: serverTrialSnapshot(), error: null });
    await flushMicrotasks();
    expect(db.select().from(billingAccounts).where(eq(billingAccounts.id, ACCOUNT_ID)).get()).toBeUndefined();
    expect(readHydrationStatus().phase).toBe('verified');
  });

  it('coalesces reconnect, foreground, and due-backoff triggers into one request', async () => {
    vi.useFakeTimers();
    const retry = deferred<{ data: ReturnType<typeof serverTrialSnapshot>; error: null }>();
    invoke.invokeSyncWithClaimRefresh
      .mockResolvedValueOnce({ data: null, error: new TypeError('Network request failed') })
      .mockReturnValueOnce(retry.promise);

    startBillingHydration(SHOP_ID);
    await flushMicrotasks();
    expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(1);
    expect(readHydrationStatus().phase).toBe('failed');

    connectivity.fireReconnect();
    appState.emit('active');
    await vi.advanceTimersByTimeAsync(5_000);
    await flushMicrotasks();
    expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(2);

    retry.resolve({ data: serverTrialSnapshot(), error: null });
    await flushMicrotasks();
    expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(2);
    stopBillingHydration();
    vi.useRealTimers();
  });

  it('stops cleanly after the bounded backoff budget is exhausted', async () => {
    vi.useFakeTimers();
    invoke.invokeSyncWithClaimRefresh.mockResolvedValue({
      data: null,
      error: new TypeError('Network request failed'),
    });

    startBillingHydration(SHOP_ID);
    await flushMicrotasks();
    for (const delay of [5_000, 10_000, 20_000, 40_000, 80_000, 160_000]) {
      await vi.advanceTimersByTimeAsync(delay);
      await flushMicrotasks();
    }

    expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(7);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(invoke.invokeSyncWithClaimRefresh).toHaveBeenCalledTimes(7);
    expect(readHydrationStatus()).toMatchObject({ phase: 'failed', failure: 'offline' });
    stopBillingHydration();
    vi.useRealTimers();
  });
});
