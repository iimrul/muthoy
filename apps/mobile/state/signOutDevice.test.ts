import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../sync', () => ({ stopSyncEngine: vi.fn(), startSyncEngine: vi.fn() }));
const cloud = vi.hoisted(() => ({
  // Typed as the real signOut is — error is nullable — so the failure
  // cases below are assignable rather than needing a cast each time.
  signOut: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
}));
vi.mock('../sync/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { signOut: cloud.signOut } },
}));
const authority = vi.hoisted(() => ({ inspectSessionAuthority: vi.fn() }));
vi.mock('../sync/sessionAuthority', () => ({
  inspectSessionAuthority: authority.inspectSessionAuthority,
}));

const { createMMKV, __resetMMKVStores } = await import('../db/test/react-native-mmkv');
const { useSessionStore } = await import('./sessionStore');
const { useCartStore } = await import('./cartStore');
const { stopSyncEngine } = await import('../sync');
const { readSessionAuthorityLease } = await import('../sync/sessionAuthorityStore');
const {
  CredentialCleanupError, enforceSessionAuthority, signOutDevice,
} = await import('./signOutDevice');

// H-10 A2.4 and the sign-out race. Two things are being pinned here:
//
//   1. The ENUMERATION. Sign-out has to be exact about which of the device's
//      nine MMKV stores it touches, because the interesting mistakes are
//      opposite ones — leaving a credential behind, and wiping the H-4
//      attempt budget or the shop-keyed pull cursor, either of which turns a
//      security action into a usability or re-hydration incident.
//   2. The RACE. The only await is the cloud sign-out, and a device handover
//      can complete while it is in flight.

const PRESERVED_STORES = [
  'muthoy-sync-cursor',
  'muthoy-sync-status',
  'muthoy-pin-attempts',
  'muthoy-session-authority',
  'muthoy-device-identity',
  'muthoy-printer',
  'muthoy-locale',
  'muthoy-business-day',
  'muthoy-notification-preferences',
];

const SESSION = {
  shopId: 'shop-1',
  userId: 'actor-1',
  role: 'staff' as const,
  startedAt: '2026-09-17T09:00:00.000Z',
};

function seedPreservedStores(): void {
  for (const id of PRESERVED_STORES) createMMKV({ id }).set('canary', 'kept');
}

beforeEach(() => {
  vi.clearAllMocks();
  cloud.signOut.mockImplementation(async () => ({ error: null }));
  __resetMMKVStores();
  useSessionStore.setState({ session: SESSION, epoch: 4, lastShopId: 'shop-1' });
  useCartStore.getState().clear();
});

describe('signOutDevice', () => {
  it('ends the local shift and drops the cloud token', async () => {
    await signOutDevice();
    expect(useSessionStore.getState().session).toBeNull();
    // 'local' and not 'global': a stale token on this handset is no reason to
    // sign the same owner out of their other phone.
    expect(cloud.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(stopSyncEngine).toHaveBeenCalled();
  });

  it('leaves every store that is not a credential alone', async () => {
    seedPreservedStores();
    await signOutDevice();
    for (const id of PRESERVED_STORES) {
      expect(createMMKV({ id }).getString('canary')).toBe('kept');
    }
  });

  it('keeps the H-4 attempt budget, specifically', async () => {
    // Wiping it would make sign-out the reset button an attacker needs.
    const budget = createMMKV({ id: 'muthoy-pin-attempts' });
    budget.set('attempts:shop-1', '{"v":1,"failures":5}');
    await signOutDevice();
    expect(budget.getString('attempts:shop-1')).toBe('{"v":1,"failures":5}');
  });

  it('keeps the device linked so the next person reaches PIN Login', async () => {
    await signOutDevice();
    expect(useSessionStore.getState().lastShopId).toBe('shop-1');
  });

  it('bumps the epoch so in-flight screen work cannot land afterwards', async () => {
    const before = useSessionStore.getState().epoch;
    await signOutDevice();
    expect(useSessionStore.getState().epoch).toBeGreaterThan(before);
  });
});

describe('credential cleanup is never silently swallowed', () => {
  it('reports a cloud sign-out that returned an error, and still fails closed', async () => {
    cloud.signOut.mockResolvedValueOnce({ error: new Error('network down') });

    const failure = await signOutDevice().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CredentialCleanupError);
    expect((failure as InstanceType<typeof CredentialCleanupError>).cloudSessionCleared).toBe(false);
    expect((failure as InstanceType<typeof CredentialCleanupError>).localSessionCleared).toBe(true);
    // Fail CLOSED: access is denied even though the token may still be on
    // disk. The previous version swallowed this with .catch(() => undefined),
    // so a refresh token surviving a revocation looked exactly like success.
    expect(useSessionStore.getState().session).toBeNull();
    expect(readSessionAuthorityLease('shop-1', 'actor-1')).toMatchObject({
      status: 'valid', record: { quarantineReason: 'credential_cleanup_failed' },
    });
  });

  it('reports a cloud sign-out that threw, and still fails closed', async () => {
    cloud.signOut.mockRejectedValueOnce(new Error('offline'));
    await expect(signOutDevice()).rejects.toBeInstanceOf(CredentialCleanupError);
    expect(useSessionStore.getState().session).toBeNull();
  });
});

describe('the sign-out race', () => {
  it('abandons before it starts if the device already changed hands', async () => {
    const staleEpoch = useSessionStore.getState().epoch - 1;
    const failure = await signOutDevice(staleEpoch).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(CredentialCleanupError);
    expect(useSessionStore.getState().session).toEqual(SESSION);
    expect(cloud.signOut).not.toHaveBeenCalled();
  });

  it('does not clear the INCOMING session when the handover lands mid-await', async () => {
    const epoch = useSessionStore.getState().epoch;
    cloud.signOut.mockImplementation(async () => {
      // The handover completes while the cloud call is in flight — the exact
      // window the epoch re-check after the await exists to close.
      useSessionStore.getState().login({ ...SESSION, userId: 'actor-2' });
      return { error: null };
    });

    await expect(signOutDevice(epoch)).resolves.toBeUndefined();
    expect(useSessionStore.getState().session?.userId).toBe('actor-2');
  });

  it('reports the cloud outcome even when it abandons mid-flight', async () => {
    const epoch = useSessionStore.getState().epoch;
    cloud.signOut.mockImplementation(async () => {
      useSessionStore.getState().login({ ...SESSION, userId: 'actor-2' });
      return { error: new Error('network down') };
    });

    const failure = await signOutDevice(epoch).catch((error: unknown) => error) as
      InstanceType<typeof CredentialCleanupError>;
    // The outgoing session was cleared before the await; the incoming one is
    // untouched, while the cloud token remains unaccounted for.
    expect(failure.localSessionCleared).toBe(true);
    expect(failure.cloudSessionCleared).toBe(false);
  });
});

describe('enforceSessionAuthority', () => {
  it('signs out on a revoked verdict', async () => {
    authority.inspectSessionAuthority.mockResolvedValue({
      status: 'revoked', reason: 'actor_mismatch',
    });
    await expect(enforceSessionAuthority()).resolves.toEqual({
      status: 'revoked', reason: 'actor_mismatch',
    });
    expect(useSessionStore.getState().session).toBeNull();
  });

  it('leaves an unverified offline session running', async () => {
    authority.inspectSessionAuthority.mockResolvedValue({
      status: 'unverified', reason: 'offline_window_open',
    });
    await enforceSessionAuthority();
    // Offline is a supported state, not a refusal. Signing people out for it
    // would break the app in exactly the shops that need it offline most.
    expect(useSessionStore.getState().session).toEqual(SESSION);
    expect(cloud.signOut).not.toHaveBeenCalled();
  });

  it('lets fresh authority clear stale cloud preflight flags without changing epoch', async () => {
    useSessionStore.setState({
      session: {
        ...SESSION,
        cloudActorConfirmed: false,
        cloudShopConfirmed: false,
      },
    });
    const epoch = useSessionStore.getState().epoch;
    authority.inspectSessionAuthority.mockResolvedValue({
      status: 'confirmed', reason: 'claims_match',
    });

    await enforceSessionAuthority();

    expect(useSessionStore.getState()).toMatchObject({
      epoch,
      session: {
        ...SESSION,
        cloudActorConfirmed: true,
        cloudShopConfirmed: true,
      },
    });
    expect(cloud.signOut).not.toHaveBeenCalled();
  });

  it('does nothing when there is no session at all', async () => {
    useSessionStore.setState({ session: null });
    await expect(enforceSessionAuthority()).resolves.toBeNull();
    expect(authority.inspectSessionAuthority).not.toHaveBeenCalled();
  });

  it('does not sign out the incoming user when the handover lands during INSPECTION', async () => {
    authority.inspectSessionAuthority.mockImplementation(async () => {
      useSessionStore.getState().login({ ...SESSION, userId: 'actor-2' });
      return { status: 'revoked', reason: 'actor_mismatch' };
    });
    await enforceSessionAuthority();
    expect(useSessionStore.getState().session?.userId).toBe('actor-2');
    expect(cloud.signOut).not.toHaveBeenCalled();
  });

  it('does not sign out the incoming user when the handover lands during SIGN-OUT', async () => {
    // The second awaited boundary. Passing the inspected epoch through is
    // what makes signOutDevice able to see this.
    authority.inspectSessionAuthority.mockResolvedValue({
      status: 'revoked', reason: 'offline_window_expired',
    });
    cloud.signOut.mockImplementation(async () => {
      useSessionStore.getState().login({ ...SESSION, userId: 'actor-3' });
      return { error: null };
    });
    await expect(enforceSessionAuthority()).resolves.toEqual({
      status: 'revoked', reason: 'offline_window_expired',
    });
    expect(useSessionStore.getState().session?.userId).toBe('actor-3');
  });

  it('propagates a credential cleanup failure rather than eating it', async () => {
    authority.inspectSessionAuthority.mockResolvedValue({
      status: 'revoked', reason: 'actor_inactive',
    });
    cloud.signOut.mockResolvedValueOnce({ error: new Error('network down') });
    await expect(enforceSessionAuthority()).rejects.toBeInstanceOf(CredentialCleanupError);
  });
});
