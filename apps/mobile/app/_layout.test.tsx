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

const native = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  startSyncEngine: vi.fn(),
  stopSyncEngine: vi.fn(),
  handleAppStateChangeForAuthRefresh: vi.fn(),
  registerNotificationBackgroundTaskAsync: vi.fn(),
  requestNotificationPermissionsAsync: vi.fn(),
  runNotificationChecks: vi.fn(),
}));

vi.mock('react-native', () => ({
  AppState: { addEventListener: native.addEventListener, currentState: 'active' },
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  View: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}));

vi.mock('expo-router', () => ({ Stack: () => createElement('div') }));
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

vi.mock('../db', () => ({
  useDatabaseMigrations: () => ({ isReady: true, error: null }),
}));
vi.mock('../native/notifications', () => ({
  registerNotificationBackgroundTaskAsync: native.registerNotificationBackgroundTaskAsync,
  requestNotificationPermissionsAsync: native.requestNotificationPermissionsAsync,
  runNotificationChecks: native.runNotificationChecks,
}));
vi.mock('../sync/supabaseClient', () => ({
  handleAppStateChangeForAuthRefresh: native.handleAppStateChangeForAuthRefresh,
}));
vi.mock('../sync', () => ({
  startSyncEngine: native.startSyncEngine,
  stopSyncEngine: native.stopSyncEngine,
}));

const { useSessionStore } = await import('../state/sessionStore');
type Session = import('../state/sessionStore').Session;
const RootLayout = (await import('./_layout')).default;

const OWNER: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000002', role: 'owner' };
const STAFF: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000003', role: 'staff' };

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  useSessionStore.setState({ session: null });
  native.addEventListener.mockReturnValue({ remove: vi.fn() });
  native.registerNotificationBackgroundTaskAsync.mockResolvedValue(undefined);
  native.requestNotificationPermissionsAsync.mockResolvedValue(undefined);
  native.runNotificationChecks.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
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
