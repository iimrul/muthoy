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
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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
  retryCloudCredentialCleanup: vi.fn(async () => true),
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: native.addEventListener, currentState: 'active' },
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  // Auth parity: the gate's status screens render real buttons (Try again,
  // Switch user) inside the shared auth shell, so presses are wired through.
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: {
    children?: ReactNode; onPress?: () => void; accessibilityLabel?: string; disabled?: boolean;
  }) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  KeyboardAvoidingView: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  ActivityIndicator: () => createElement('div'),
  Alert: { alert: vi.fn() },
}));

// The marker is what 'the navigator is mounted' means below: every closed-gate
// assertion checks it is ABSENT, not merely that some copy is present.
vi.mock('expo-router', () => ({ Stack: () => createElement('div', null, 'navigator-mounted') }));
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
  retryCloudCredentialCleanup: native.retryCloudCredentialCleanup,
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
const { useLocaleStore } = await import('../state/localeStore');
const { clearSignOutNotice } = await import('../state/signOutNotice');
const { CredentialCleanupError } = await import('../state/signOutDevice');
const { catalog } = await import('../i18n/catalog');
const { DatabaseKeyUnrecoverableError, DatabaseKeyUnavailableError } = await import('../db/errors');
type Session = import('../state/sessionStore').Session;
const RootLayout = (await import('../app/_layout')).default;

const OWNER: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000002', role: 'owner' };
const STAFF: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000003', role: 'staff' };

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  // The copy asserted below is English; the app's own default is Bangla.
  useLocaleStore.setState({ locale: 'en' });
  clearSignOutNotice();
  native.retryCloudCredentialCleanup.mockResolvedValue(true);
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
  it('shows localized configuration refusal and starts nothing', () => {
    config.isSupabaseConfigured = false;

    const view = render(createElement(RootLayout));

    // Without these the entitlement can never be verified, so every owner would
    // silently read as Free. Say so loudly rather than downgrading them.
    expect(view.container.textContent).toContain('App is not configured');
    expect(view.container.textContent).toContain(catalog.en.environmentConfigurationBlockedBody);
    expect(view.container.textContent).not.toContain('EXPO_PUBLIC');
    expect(view.container.textContent).not.toContain('apps/mobile/.env');
    expect(view.queryByRole('button', { name: /reset|restore|sign out/i })).toBeNull();

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

    // A check that did not complete is not a check that passed — and it now
    // says so instead of 'Checking your access…' forever.
    expect(view.container.textContent).toContain(catalog.en.gateUnknownTitle);
    expect(view.container.textContent).not.toContain('navigator-mounted');
    expect(native.startSyncEngine).not.toHaveBeenCalled();
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
    // Still closed; now with the reason and what fixes it.
    expect(view.container.textContent).toContain(catalog.en.gateAbsentTitle);
    expect(view.container.textContent).toContain(catalog.en.gateAutoRecheck);
    expect(view.container.textContent).not.toContain('navigator-mounted');
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
    // A temporary outage retries by itself and says so; it is not a block.
    expect(view.container.textContent).toContain(catalog.en.gateRetryingBody);
    expect(view.container.textContent).not.toContain('navigator-mounted');
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
    expect(view.container.textContent).toContain(catalog.en.gateExpiredTitle);
    expect(view.container.textContent).not.toContain('navigator-mounted');
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
    expect(view.container.textContent).toContain('navigator-mounted');
  });
});

describe('the closed gate says why, and its actions never open it (auth parity)', () => {
  async function loginBlocked(reason: string, session: Session = OWNER) {
    native.enforceSessionAuthority.mockResolvedValue({ status: 'unverified', reason });
    const view = render(createElement(RootLayout));
    await act(async () => {
      useSessionStore.getState().login(session);
      await promiseTick();
    });
    return view;
  }

  it.each([
    ['authority_absent', 'gateAbsentTitle'],
    ['offline_window_expired', 'gateExpiredTitle'],
    ['clock_rolled_back', 'gateClockTitle'],
    ['authority_read_failed', 'gateUnreadableTitle'],
    ['authority_corrupt', 'gateUnreadableTitle'],
    ['device_authority_read_failed', 'gateUnreadableTitle'],
  ] as const)('explains %s and keeps the navigator unmounted', async (reason, titleKey) => {
    const view = await loginBlocked(reason);
    expect(view.container.textContent).toContain(catalog.en[titleKey]);
    expect(view.container.textContent).not.toContain('Checking your access');
    expect(view.container.textContent).not.toContain('navigator-mounted');
    expect(native.startSyncEngine).not.toHaveBeenCalled();
    expect(native.startBillingHydration).not.toHaveBeenCalled();
  });

  it('Try again re-runs the same check and cannot open the gate by itself', async () => {
    const view = await loginBlocked('authority_absent');
    expect(native.enforceSessionAuthority).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await promiseTick();
    });
    // Refused again: still closed, still explained.
    expect(native.enforceSessionAuthority).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain(catalog.en.gateAbsentTitle);
    expect(view.container.textContent).not.toContain('navigator-mounted');

    // Only an authoritative verdict opens it.
    native.enforceSessionAuthority.mockResolvedValue({ status: 'confirmed', reason: 'claims_match' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await promiseTick();
    });
    expect(view.container.textContent).toContain('navigator-mounted');
    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
  });

  it('Switch user clears only the active actor; the navigator opens with NO session', async () => {
    const view = await loginBlocked('offline_window_expired');
    const { epoch } = useSessionStore.getState();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Switch user' }));
      await promiseTick();
    });

    expect(useSessionStore.getState().session).toBeNull();
    expect(useSessionStore.getState().epoch).toBe(epoch + 1);
    // Nothing authenticated to admit: only the sign-in routes mount, sync
    // never starts, and no authority check runs for nobody.
    expect(view.container.textContent).toContain('navigator-mounted');
    expect(native.startSyncEngine).not.toHaveBeenCalled();
    expect(native.startBillingHydration).not.toHaveBeenCalled();
    expect(native.enforceSessionAuthority).toHaveBeenCalledTimes(1);
  });

  it('renders the blocked state in Bangla', async () => {
    useLocaleStore.setState({ locale: 'bn' });
    const view = await loginBlocked('clock_rolled_back');
    expect(view.container.textContent).toContain(catalog.bn.gateClockTitle);
    expect(view.container.textContent).not.toContain(catalog.en.gateClockTitle);
  });

});

describe('a cloud credential that would not clear is recoverable (was a dead end)', () => {
  async function failCleanup() {
    native.enforceSessionAuthority.mockImplementation(async () => {
      // signOutDevice clears the local session FIRST, then throws.
      useSessionStore.getState().clearActiveUser();
      throw new CredentialCleanupError('cloud session could not be cleared', { localSessionCleared: true, cloudSessionCleared: false });
    });
    const view = render(createElement(RootLayout));
    await act(async () => {
      useSessionStore.getState().login(OWNER);
      await promiseTick();
    });
    return view;
  }

  it('explains it without mounting anything', async () => {
    const view = await failCleanup();
    expect(view.container.textContent).toContain(catalog.en.gateCleanupTitle);
    expect(view.container.textContent).not.toContain('navigator-mounted');
  });

  it('Continue reaches the sign-in routes with no session and no sync', async () => {
    const view = await failCleanup();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.gateCleanupContinue }));
    });
    expect(useSessionStore.getState().session).toBeNull();
    expect(view.container.textContent).toContain('navigator-mounted');
    expect(native.startSyncEngine).not.toHaveBeenCalled();
  });

  it('Retry clears the credential when it can, and says so when it cannot', async () => {
    native.retryCloudCredentialCleanup.mockResolvedValueOnce(false);
    const view = await failCleanup();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.gateCleanupRetry }));
      await promiseTick();
    });
    expect(native.retryCloudCredentialCleanup).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain(catalog.en.gateCleanupRetryFailed);
    expect(view.container.textContent).not.toContain('navigator-mounted');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: catalog.en.gateCleanupRetry }));
      await promiseTick();
    });
    expect(native.retryCloudCredentialCleanup).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain('navigator-mounted');
  });
});

function promiseTick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}
