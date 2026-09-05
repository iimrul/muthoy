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
  subscribeToReconnect: vi.fn(() => vi.fn()),
  revalidateOfflineSelectedShop: vi.fn(),
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: native.addEventListener, currentState: 'active' },
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
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

vi.mock('../db', () => ({
  useDatabaseMigrations: () => ({ isReady: true, error: null }),
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
type Session = import('../state/sessionStore').Session;
const RootLayout = (await import('../app/_layout')).default;

const OWNER: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000002', role: 'owner' };
const STAFF: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000003', role: 'staff' };

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  useSessionStore.setState({ session: null });
  config.isSupabaseConfigured = true;
  native.addEventListener.mockReturnValue({ remove: vi.fn() });
  native.registerNotificationBackgroundTaskAsync.mockResolvedValue(undefined);
  native.requestNotificationPermissionsAsync.mockResolvedValue(undefined);
  native.revalidateOfflineSelectedShop.mockResolvedValue(undefined);
  native.runNotificationChecks.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
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

  it('boots normally once the configuration is present', () => {
    const view = render(createElement(RootLayout));

    expect(view.container.textContent).not.toContain('App is not configured');
    act(() => useSessionStore.getState().login(OWNER));
    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
  });
});

describe('root layout drives the sync engine from the active session', () => {
  it('starts nothing while nobody is logged in', () => {
    render(createElement(RootLayout));

    expect(native.startSyncEngine).not.toHaveBeenCalled();
  });

  it('starts the engine on the session shop at login', () => {
    render(createElement(RootLayout));

    act(() => useSessionStore.getState().login(OWNER));

    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
  });

  it('stops the engine when the session ends, and restarts it on the SAME shop for the next user', () => {
    render(createElement(RootLayout));
    act(() => useSessionStore.getState().login(OWNER));
    native.startSyncEngine.mockClear();

    // What state/switchUser.ts does to the store during a handover.
    act(() => useSessionStore.getState().clearActiveUser());

    expect(native.stopSyncEngine).toHaveBeenCalled();
    expect(native.startSyncEngine).not.toHaveBeenCalled();

    act(() => useSessionStore.getState().login(STAFF));

    // Same shop id, never a re-derived or re-created one (CLAUDE.md rule 7).
    expect(native.startSyncEngine).toHaveBeenCalledTimes(1);
    expect(native.startSyncEngine).toHaveBeenCalledWith(SHOP_ID);
  });
});

describe('root layout drives automatic entitlement hydration — no manual Sync required', () => {
  it('starts hydration on login, with no press of Sync anywhere in the path', () => {
    render(createElement(RootLayout));

    act(() => useSessionStore.getState().login(OWNER));

    expect(native.startBillingHydration).toHaveBeenCalledWith(SHOP_ID);
  });

  it('still verifies a session whose shop is not yet cloud-confirmed', () => {
    render(createElement(RootLayout));

    act(() => useSessionStore.getState().login({ ...OWNER, cloudShopConfirmed: false }));

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
