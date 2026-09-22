// @vitest-environment jsdom
//
// The sync engine's LIFECYCLE seam for the device handover (Volume 0 Days
// 5/11). state/switchUser.ts stops the engine itself, but the restart at the
// next login belongs to this layout's effect — and until now nothing tested
// it, so "sync resumes for the incoming user" rested on a render-order
// coincidence rather than on anything asserted.
//
// Everything native (fonts, splash, migrations, notifications, Supabase auth
// refresh) is mocked at the module boundary; only the effect's start/stop
// contract with ../sync is under test.

import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const SHOP_ID = '3f1c8a90-0000-4000-8000-000000000001';

const mmkv = vi.hoisted(() => {
  const stores = new Map<string, Map<string, string>>();
  return {
    stores,
    createMMKV: ({ id }: { id: string }) => {
      const store = stores.get(id) ?? new Map<string, string>();
      stores.set(id, store);
      return {
        set: (key: string, value: string) => void store.set(key, value),
        getString: (key: string) => store.get(key),
        remove: (key: string) => void store.delete(key),
      };
    },
  };
});

vi.mock('react-native-mmkv', () => ({ createMMKV: mmkv.createMMKV }));

const config = vi.hoisted(() => ({ isSupabaseConfigured: true }));
const listeners = vi.hoisted(() => ({
  reconnect: null as null | (() => void),
  appState: null as null | ((state: string) => void),
}));
const databaseGate = vi.hoisted(() => ({
  isReady: true,
  error: undefined as Error | undefined,
  retry: vi.fn(),
}));

const native = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  startSyncEngine: vi.fn(),
  stopSyncEngine: vi.fn(),
  startBillingHydration: vi.fn(),
  stopBillingHydration: vi.fn(),
  handleAppStateChangeForAuthRefresh: vi.fn(),
  registerNotificationBackgroundTaskAsync: vi.fn(),
  requestNotificationPermissionsAsync: vi.fn(),
  runNotificationChecks: vi.fn(),
  syncClosingTimeScheduleAsync: vi.fn(),
  subscribeToReconnect: vi.fn((_listener: () => void) => vi.fn()),
  revalidateOfflineSelectedShop: vi.fn(),
  enforceSessionAuthority: vi.fn(async () => ({ status: 'confirmed', reason: 'claims_match' })),
  readSessionAuthorityDeadlineMs: vi.fn(() => Date.now() + 604_800_000),
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: native.addEventListener, currentState: 'active' },
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  // The root layout mounts dev/devAuthorityRecovery on the closed gate for an
  // owner session, so the mock has to cover what that component renders.
  Pressable: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
  ActivityIndicator: () => createElement('div'),
  Alert: { alert: vi.fn() },
}));

vi.mock('expo-router', () => ({ Stack: () => createElement('div') }));
vi.mock('../components/navigation/AppNavigationShell', () => ({ AppNavigationShell: ({ children }: { children?: ReactNode }) => createElement('div', null, children) }));
vi.mock('../components/navigation/AuthenticatedRuntimeErrorBoundary', () => ({ AuthenticatedRuntimeErrorBoundary: ({ children }: { children?: ReactNode }) => createElement('div', null, children) }));
vi.mock('../components/navigation/NavigationBoundary', () => ({ NavigationBoundary: ({ children }: { children?: ReactNode }) => createElement('div', null, children) }));
vi.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: vi.fn(),
  hideAsync: vi.fn(),
}));
vi.mock('expo-font', () => ({ useFonts: () => [true, null] }));
vi.mock('@expo-google-fonts/plus-jakarta-sans', () => ({
  PlusJakartaSans_300Light: 'a',
  PlusJakartaSans_400Regular: 'b',
  PlusJakartaSans_500Medium: 'c',
  PlusJakartaSans_600SemiBold: 'd',
  PlusJakartaSans_700Bold: 'e',
  PlusJakartaSans_800ExtraBold: 'f',
}));
vi.mock('@expo-google-fonts/hind-siliguri', () => ({
  HindSiliguri_300Light: 'g',
  HindSiliguri_400Regular: 'h',
  HindSiliguri_600SemiBold: 'i',
  HindSiliguri_700Bold: 'j',
}));
vi.mock('@expo-google-fonts/dm-mono', () => ({ DMMono_400Regular: 'k', DMMono_500Medium: 'l' }));
vi.mock('../global.css', () => ({}));
vi.mock('../sync/connectivity', () => ({ subscribeToReconnect: native.subscribeToReconnect }));
vi.mock('../state/switchShop', () => ({ revalidateOfflineSelectedShop: native.revalidateOfflineSelectedShop }));
// H-10 #6. The layout now holds an authority GATE: nothing authenticated
// renders until reconciliation has settled for the current session epoch.
// Mocked here so this file keeps testing the sync lifecycle, and so the gate
// itself can be driven deliberately in its own block below.
vi.mock('../state/signOutDevice', () => ({
  CredentialCleanupError: class CredentialCleanupError extends Error {},
  enforceSessionAuthority: native.enforceSessionAuthority,
  readSessionAuthorityDeadlineMs: native.readSessionAuthorityDeadlineMs,
}));

vi.mock('../db', () => ({
  useDatabaseMigrations: () => databaseGate,
}));
vi.mock('../components/database/DatabaseRecoveryScreen', () => ({
  DatabaseRecoveryScreen: ({ canRestore }: { canRestore: boolean }) =>
    createElement('div', null, canRestore ? 'server-restore-ready' : 'secure-storage-retry'),
}));
vi.mock('../native/notifications', () => ({
  registerNotificationBackgroundTaskAsync: native.registerNotificationBackgroundTaskAsync,
  requestNotificationPermissionsAsync: native.requestNotificationPermissionsAsync,
  runNotificationChecks: native.runNotificationChecks,
  syncClosingTimeScheduleAsync: native.syncClosingTimeScheduleAsync,
}));
vi.mock('../sync/supabaseClient', () => ({
  handleAppStateChangeForAuthRefresh: native.handleAppStateChangeForAuthRefresh,
  get isSupabaseConfigured() {
    return config.isSupabaseConfigured;
  },
  get missingSupabaseConfigKeys() {
    return config.isSupabaseConfigured
      ? []
      : ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];
  },
}));
vi.mock('../sync', () => ({
  startSyncEngine: native.startSyncEngine,
  stopSyncEngine: native.stopSyncEngine,
}));
vi.mock('../sync/billingHydration', () => ({
  startBillingHydration: native.startBillingHydration,
  stopBillingHydration: native.stopBillingHydration,
}));

const { useSessionStore } = await import('../state/sessionStore');
const { DatabaseKeyUnrecoverableError, DatabaseKeyUnavailableError } = await import('../db/errors');
type Session = import('../state/sessionStore').Session;
const RootLayout = (await import('../app/_layout')).default;

const OWNER: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000002', role: 'owner' };
const STAFF: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000003', role: 'staff' };

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  useSessionStore.setState({
    session: null,
    authorityTransitioning: false,
    epoch: 0,
    lastShopId: null,
  });
  config.isSupabaseConfigured = true;
  native.enforceSessionAuthority.mockImplementation(
    async () => ({ status: 'confirmed', reason: 'claims_match' }),
  );
  native.readSessionAuthorityDeadlineMs.mockImplementation(() => Date.now() + 604_800_000);
  databaseGate.isReady = true;
  databaseGate.error = undefined;
  listeners.reconnect = null;
  listeners.appState = null;
  native.subscribeToReconnect.mockImplementation((listener: () => void) => {
    listeners.reconnect = listener;
    return vi.fn();
  });
  native.addEventListener.mockImplementation((_event: string, listener: (state: string) => void) => {
    listeners.appState = listener;
    return { remove: vi.fn() };
  });
  native.registerNotificationBackgroundTaskAsync.mockResolvedValue(undefined);
  native.requestNotificationPermissionsAsync.mockResolvedValue(undefined);
  native.revalidateOfflineSelectedShop.mockResolvedValue(undefined);
  native.runNotificationChecks.mockResolvedValue(undefined);
});

describe('database boot recovery gate', () => {
  it('offers authenticated server restore for a missing/wrong key', () => {
    databaseGate.isReady = false;
    databaseGate.error = new DatabaseKeyUnrecoverableError('missing-key');

    const view = render(createElement(RootLayout));

    expect(view.container.textContent).toContain('server-restore-ready');
    expect(native.startSyncEngine).not.toHaveBeenCalled();
  });

  it('offers retry, not key rotation, for a transient Keystore failure', () => {
    databaseGate.isReady = false;
    databaseGate.error = new DatabaseKeyUnavailableError('temporarily unavailable');

    const view = render(createElement(RootLayout));

    expect(view.container.textContent).toContain('secure-storage-retry');
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a build with no Supabase configuration fails visibly', () => {
  it('names the missing variables and starts nothing', () => {
    config.isSupabaseConfigured = false;

    const view = render(createElement(RootLayout));

    // Without these the entitlement can never be verified, so every owner would
    // silently read as Free. Say so loudly rather than downgrading them.
    expect(view.container.textContent).toContain('App is not configured');
    expect(view.container.textContent).toContain('EXPO_PUBLIC_SUPABASE_URL');
    expect(view.container.textContent).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY');
    // Naming the variables is not enough on its own — the screen has to say
    // where they are read from, or the founder is left guessing which of Metro,
    // .env, or EAS is at fault.
    expect(view.container.textContent).toContain('apps/mobile/.env');
    expect(view.container.textContent).toContain('EAS');

    act(() => useSessionStore.getState().login(OWNER));
    expect(native.startSyncEngine).not.toHaveBeenCalled();
  });

  it('boots normally once the configuration is present', async () => {
    const view = render(createElement(RootLayout));

    expect(view.container.textContent).not.toContain('App is not configured');
    await act(async () => { useSessionStore.getState().login(OWNER); await promiseTick(); });
    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
  });
});

describe('root layout drives the sync engine from the active session', () => {
  it('starts nothing while nobody is logged in', () => {
    render(createElement(RootLayout));

    expect(native.startSyncEngine).not.toHaveBeenCalled();
  });

  it('starts the engine on the session shop at login', async () => {
    render(createElement(RootLayout));

    await act(async () => { useSessionStore.getState().login(OWNER); await promiseTick(); });

    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
  });

  it('stops the engine when the session ends, and restarts it on the SAME shop for the next user', async () => {
    render(createElement(RootLayout));
    await act(async () => { useSessionStore.getState().login(OWNER); await promiseTick(); });
    native.startSyncEngine.mockClear();

    // What state/switchUser.ts does to the store during a handover.
    act(() => useSessionStore.getState().clearActiveUser());

    expect(native.stopSyncEngine).toHaveBeenCalled();
    expect(native.startSyncEngine).not.toHaveBeenCalled();

    await act(async () => { useSessionStore.getState().login(STAFF); await promiseTick(); });

    // Same shop id, never a re-derived or re-created one (CLAUDE.md rule 7).
    expect(native.startSyncEngine).toHaveBeenCalledTimes(1);
    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
  });
});

describe('root layout drives automatic entitlement hydration — no manual Sync required', () => {
  it('starts hydration on login, with no press of Sync anywhere in the path', async () => {
    render(createElement(RootLayout));

    await act(async () => { useSessionStore.getState().login(OWNER); await promiseTick(); });

    expect(native.startBillingHydration).toHaveBeenCalledWith(SHOP_ID);
  });

  it('starts both sync and billing after a Staff session is authoritatively confirmed', async () => {
    render(createElement(RootLayout));

    await act(async () => {
      useSessionStore.getState().login(STAFF);
      await promiseTick();
    });

    expect(native.enforceSessionAuthority).toHaveBeenCalled();
    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
    expect(native.startBillingHydration).toHaveBeenCalledWith(SHOP_ID);
  });

  it('still verifies a session whose shop is not yet cloud-confirmed', async () => {
    render(createElement(RootLayout));

    await act(async () => {
      useSessionStore.getState().login({ ...OWNER, cloudShopConfirmed: false });
      await promiseTick();
    });

    // This flag gets set by a shop switch that believed itself offline, and the
    // only path that clears it is itself behind a connectivity check. Gating
    // verification on it meant one wrong "offline" reading could strand an
    // owner as unverified forever — so the unconfirmed session, which needs
    // verifying most, is exactly the one that must still be allowed to ask.
    expect(native.startBillingHydration).toHaveBeenCalledWith(SHOP_ID);
  });

  it('stops hydration when the session ends, alongside the sync engine', () => {
    render(createElement(RootLayout));
    act(() => useSessionStore.getState().login(OWNER));
    native.stopBillingHydration.mockClear();

    act(() => useSessionStore.getState().clearActiveUser());

    expect(native.stopBillingHydration).toHaveBeenCalled();
  });
});

describe('the pre-navigation authority gate (H-10 #6)', () => {
  /** A promise this test resolves by hand, so the gate can be observed open. */
  function deferredAuthority() {
    let release!: (outcome: { status: string; reason: string }) => void;
    const promise = new Promise<{ status: string; reason: string }>((resolve) => {
      release = resolve;
    });
    native.enforceSessionAuthority.mockImplementation(() => promise);
    return { release };
  }

  it('renders nothing authenticated while reconciliation is still running', async () => {
    const { release } = deferredAuthority();
    const view = render(createElement(RootLayout));

    await act(async () => {
      useSessionStore.getState().login(OWNER);
    });

    // The whole navigator, not an overlay on top of it: an overlay leaves the
    // authenticated tree mounted underneath, running effects and reads.
    expect(view.container.textContent).toContain('Checking your access');
    expect(native.startSyncEngine).not.toHaveBeenCalled();
    expect(native.startBillingHydration).not.toHaveBeenCalled();

    await act(async () => {
      release({ status: 'confirmed', reason: 'claims_match' });
      await promiseTick();
    });
    expect(view.container.textContent).not.toContain('Checking your access');
  });

  it('opens once the session has been reconciled', async () => {
    const view = render(createElement(RootLayout));
    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await promiseTick();
    });
    expect(view.container.textContent).not.toContain('Checking your access');
  });

  it('re-closes when the device changes hands, so the next actor is checked too', async () => {
    const view = render(createElement(RootLayout));
    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await promiseTick();
    });

    const { release } = deferredAuthority();
    await act(async () => {
      // A new epoch is a new session, and a settled verdict for the previous
      // one says nothing about it.
      useSessionStore.getState().login(STAFF);
    });
    expect(view.container.textContent).toContain('Checking your access');

    await act(async () => {
      release({ status: 'confirmed', reason: 'claims_match' });
      await promiseTick();
    });
    expect(view.container.textContent).not.toContain('Checking your access');
  });

  it('stays closed when reconciliation fails, rather than falling open', async () => {
    native.enforceSessionAuthority.mockRejectedValue(new Error('unreadable'));
    const view = render(createElement(RootLayout));

    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await promiseTick();
    });

    // A check that did not complete is not a check that passed.
    expect(view.container.textContent).toContain('Checking your access');
  });

  it('keeps no-anchor offline authority closed and starts no runtime service', async () => {
    native.enforceSessionAuthority.mockResolvedValue({
      status: 'unverified', reason: 'authority_absent',
    });
    const view = render(createElement(RootLayout));
    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await promiseTick();
    });
    expect(view.container.textContent).toContain('Checking your access');
    expect(native.startSyncEngine).not.toHaveBeenCalled();
    expect(native.startBillingHydration).not.toHaveBeenCalled();
  });

  it('retries a temporary refresh failure with the gate closed and services stopped', async () => {
    vi.useFakeTimers();
    native.enforceSessionAuthority
      .mockResolvedValueOnce({
        status: 'unverified', reason: 'authority_refresh_unavailable',
      })
      .mockResolvedValueOnce({ status: 'confirmed', reason: 'claims_match' });
    const view = render(createElement(RootLayout));

    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.container.textContent).toContain('Checking your access');
    expect(native.startSyncEngine).not.toHaveBeenCalled();
    expect(native.startBillingHydration).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(4_999);
      await Promise.resolve();
    });
    expect(native.enforceSessionAuthority).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(native.enforceSessionAuthority).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).not.toContain('Checking your access');
    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
    expect(native.startBillingHydration).toHaveBeenCalledWith(SHOP_ID);
  });

  it('keeps the gate closed while an offline-selected shop performs authoritative re-link', async () => {
    let finishRelink!: () => void;
    native.revalidateOfflineSelectedShop.mockReturnValueOnce(new Promise<void>((resolve) => {
      finishRelink = resolve;
    }));
    const view = render(createElement(RootLayout));
    await act(async () => {
      useSessionStore.getState().login({ ...OWNER, cloudShopConfirmed: false });
    });

    expect(view.container.textContent).toContain('Checking your access');
    expect(native.revalidateOfflineSelectedShop).toHaveBeenCalledOnce();
    expect(native.enforceSessionAuthority).not.toHaveBeenCalled();
    expect(native.startSyncEngine).not.toHaveBeenCalled();
    expect(native.startBillingHydration).not.toHaveBeenCalled();

    await act(async () => {
      finishRelink();
      await promiseTick();
    });
    expect(native.enforceSessionAuthority).toHaveBeenCalledOnce();
  });

  it('re-closes the same epoch on reconnect and blocks runtime until fresh validation', async () => {
    const view = render(createElement(RootLayout));
    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await promiseTick();
    });
    expect(view.container.textContent).not.toContain('Checking your access');
    native.startSyncEngine.mockClear();
    native.startBillingHydration.mockClear();

    const { release } = deferredAuthority();
    await act(async () => { listeners.reconnect?.(); });
    expect(view.container.textContent).toContain('Checking your access');
    expect(native.stopSyncEngine).toHaveBeenCalled();
    expect(native.stopBillingHydration).toHaveBeenCalled();
    expect(native.startSyncEngine).not.toHaveBeenCalled();
    expect(native.startBillingHydration).not.toHaveBeenCalled();

    await act(async () => {
      release({ status: 'confirmed', reason: 'claims_match' });
      await promiseTick();
    });
    expect(view.container.textContent).not.toContain('Checking your access');
    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
    expect(native.startBillingHydration).toHaveBeenCalledWith(SHOP_ID);
  });

  it('queues a reconnect that arrives during an authority check', async () => {
    let release!: (value: { status: string; reason: string }) => void;
    const first = new Promise<{ status: string; reason: string }>((resolve) => { release = resolve; });
    native.enforceSessionAuthority
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ status: 'confirmed', reason: 'claims_match' });
    const view = render(createElement(RootLayout));
    await act(async () => { useSessionStore.getState().login(OWNER); });
    expect(view.container.textContent).toContain('Checking your access');

    await act(async () => { listeners.reconnect?.(); });
    await act(async () => {
      release({ status: 'confirmed', reason: 'claims_match' });
      await promiseTick();
      await promiseTick();
    });
    expect(native.enforceSessionAuthority).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).not.toContain('Checking your access');
    expect(native.startSyncEngine).toHaveBeenCalledTimes(1);
  });

  it('re-closes at the exact lease deadline without a reconnect or AppState event', async () => {
    vi.useFakeTimers();
    const now = 1_800_000_000_000;
    vi.setSystemTime(now);
    native.readSessionAuthorityDeadlineMs.mockReturnValue(now + 1_000);
    native.enforceSessionAuthority
      .mockResolvedValueOnce({ status: 'confirmed', reason: 'claims_match' })
      .mockResolvedValueOnce({ status: 'unverified', reason: 'offline_window_expired' });
    const view = render(createElement(RootLayout));

    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.container.textContent).not.toContain('Checking your access');

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(native.enforceSessionAuthority).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain('Checking your access');
    expect(native.stopSyncEngine).toHaveBeenCalled();
    expect(native.stopBillingHydration).toHaveBeenCalled();
  });

  it('mounts neither authenticated nor auth navigation during a shop transition', async () => {
    const view = render(createElement(RootLayout));
    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await promiseTick();
    });
    const epoch = useSessionStore.getState().epoch;

    act(() => {
      useSessionStore.getState().beginAuthorityTransitionIfEpoch(epoch);
    });

    expect(useSessionStore.getState().session).toBeNull();
    expect(view.container.textContent).toContain('Checking your access');
    expect(native.stopSyncEngine).toHaveBeenCalled();
    expect(native.stopBillingHydration).toHaveBeenCalled();
  });

  it('never gates an unauthenticated device', () => {
    const view = render(createElement(RootLayout));
    // No session, nothing to reconcile, and the auth routes must render.
    expect(view.container.textContent).not.toContain('Checking your access');
  });
});

function promiseTick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}
