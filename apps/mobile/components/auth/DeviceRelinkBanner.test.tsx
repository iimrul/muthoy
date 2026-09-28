// @vitest-environment jsdom
//
// The A2.3 relink banner end to end: the REAL handover (state/switchUser.ts,
// state/sessionStore.ts, state/cartStore.ts) against an MMKV double whose
// writes can be made to fail — so a persistence failure happens where it would
// on a device, inside the store's own write, not as a thrown stub standing in
// for the whole teardown. Only the sync engine (whose stop is observed) and the
// router (a real stack model) are stand-ins.

import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async () =>
  (await import('../../tests/support/reactNativeMock')).createReactNativeMock(),
);

const mmkv = vi.hoisted(() => {
  const stores = new Map<string, Map<string, string>>();
  // Once armed, the Nth write to the armed store (and every later one) throws
  // from `set` — a full or failing disk, at the real persistence boundary.
  const failure = { storeId: null as string | null, fromWrite: 1, writes: 0 };
  return {
    stores,
    failure,
    createMMKV: ({ id }: { id: string }) => {
      const store = stores.get(id) ?? new Map<string, string>();
      stores.set(id, store);
      return {
        set: (key: string, value: string) => {
          if (failure.storeId === id) {
            failure.writes += 1;
            if (failure.writes >= failure.fromWrite) throw new Error('MMKV write failed');
          }
          store.set(key, value);
        },
        getString: (key: string) => store.get(key),
        remove: (key: string) => void store.delete(key),
      };
    },
  };
});
vi.mock('react-native-mmkv', () => ({ createMMKV: mmkv.createMMKV }));

const sync = vi.hoisted(() => ({ stopSyncEngine: vi.fn() }));
vi.mock('../../sync', () => ({ stopSyncEngine: sync.stopSyncEngine }));

// A navigator that keeps a real stack, so "what does Android Back reveal" is
// answerable: back() pops one screen, exactly as the hardware button does.
const nav = vi.hoisted(() => {
  const state = { stack: [] as unknown[], log: [] as string[] };
  return {
    state,
    at: () => state.stack[state.stack.length - 1],
    router: {
      replace: vi.fn(),
      canDismiss: vi.fn(() => state.stack.length > 1),
      dismissAll: vi.fn(() => {
        state.log.push('dismissAll');
        state.stack.splice(1);
      }),
      back: vi.fn(() => {
        state.stack.pop();
      }),
    },
  };
});
vi.mock('expo-router', () => ({ router: nav.router }));

const { useLocaleStore } = await import('../../state/localeStore');
const { readPersistedSessionSync, useSessionStore } = await import('../../state/sessionStore');
type Session = import('../../state/sessionStore').Session;
const { useCartStore } = await import('../../state/cartStore');
const { clearDeviceRelinkRequired, markDeviceRelinkRequired, useDeviceRelinkStore } = await import(
  '../../state/deviceRelinkStore'
);
const { DeviceRelinkBanner } = await import('./DeviceRelinkBanner');
const { catalog } = await import('../../i18n/catalog');
const { asPaisa } = await import('@muthoy/types');

const SESSION_STORE = 'muthoy-session';
const SESSION: Session = { shopId: 'shop-1', userId: 'user-1', role: 'staff' };
const AUTHENTICATED = ['/staff-home', '/settings/settings'];
const DEVICE_LOGIN = { pathname: '/device-login', params: { role: 'staff', reason: 'relink' } };

/** What memory and disk said at the moment Device Login was entered. */
let atNavigation: { memory: Session | null; disk: Session | null; cartLines: number }[];

function pathOf(entry: unknown): string {
  return typeof entry === 'string' ? entry : (entry as { pathname: string }).pathname;
}

function failSessionWrites(fromWrite = 1): void {
  mmkv.failure.storeId = SESSION_STORE;
  mmkv.failure.fromWrite = fromWrite;
  mmkv.failure.writes = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.failure.storeId = null;
  mmkv.stores.forEach((store) => store.clear());
  nav.state.stack = [...AUTHENTICATED];
  nav.state.log = [];
  atNavigation = [];
  nav.router.replace.mockImplementation((href: unknown) => {
    atNavigation.push({
      memory: useSessionStore.getState().session,
      disk: readPersistedSessionSync(),
      cartLines: useCartStore.getState().items.length,
    });
    nav.state.log.push('replace');
    nav.state.stack[Math.max(0, nav.state.stack.length - 1)] = href;
  });
  useLocaleStore.setState({ locale: 'en' });
  // A real, persisted login with a half-built sale — what a till actually holds.
  useSessionStore.getState().login(SESSION);
  useCartStore.setState({ items: [] });
  useCartStore.getState().addItem({
    medicineId: 'med-1',
    medicineName: 'Napa',
    batchId: 'batch-1',
    quantity: 1,
    unitPrice: asPaisa(1000),
  });
  clearDeviceRelinkRequired();
});

afterEach(() => cleanup());

async function pressRelink() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: catalog.en.deviceLoginContinue }));
  });
}

describe('DeviceRelinkBanner (A2.3 device_session_unbound)', () => {
  it('stays hidden until sync reports the installation unbound', () => {
    render(createElement(DeviceRelinkBanner));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is only shown to the actor sync refused', () => {
    markDeviceRelinkRequired('shop-1', 'someone-else');
    render(createElement(DeviceRelinkBanner));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tears the old actor down completely, in memory and on disk, before any navigation', async () => {
    markDeviceRelinkRequired('shop-1', 'user-1');
    render(createElement(DeviceRelinkBanner));
    expect(screen.getByRole('alert').textContent).toContain(catalog.en.authErrorRelink);

    await pressRelink();

    // At the moment Device Login was entered the old session was gone from
    // memory AND from disk, and the half-built sale with it.
    expect(atNavigation).toEqual([{ memory: null, disk: null, cartLines: 0 }]);
    expect(sync.stopSyncEngine.mock.invocationCallOrder[0]).toBeLessThan(
      nav.router.dismissAll.mock.invocationCallOrder[0]!,
    );
    expect(nav.state.log).toEqual(['dismissAll', 'replace']);
    expect(useDeviceRelinkStore.getState().required).toBeNull();
    expect(nav.at()).toEqual(DEVICE_LOGIN);
  });

  it('leaves no authenticated screen for Android Back to reveal', async () => {
    markDeviceRelinkRequired('shop-1', 'user-1');
    render(createElement(DeviceRelinkBanner));
    await pressRelink();

    expect(nav.state.stack.map(pathOf)).toEqual(['/device-login']);
    // Hardware Back from Device Login: nothing underneath, never a till screen.
    nav.router.back();
    expect(nav.state.stack.map(pathOf).filter((path) => AUTHENTICATED.includes(path))).toEqual([]);
  });

  it('does not dismiss when Device Login would already be the only screen', async () => {
    nav.state.stack = ['/staff-home'];
    markDeviceRelinkRequired('shop-1', 'user-1');
    render(createElement(DeviceRelinkBanner));
    await pressRelink();

    expect(nav.router.dismissAll).not.toHaveBeenCalled();
    expect(nav.state.stack.map(pathOf)).toEqual(['/device-login']);
  });

  it('changes nothing and goes nowhere when the signed-out session cannot be persisted', async () => {
    markDeviceRelinkRequired('shop-1', 'user-1');
    render(createElement(DeviceRelinkBanner));
    const epoch = useSessionStore.getState().epoch;
    failSessionWrites();

    await pressRelink();

    // No navigation of any kind: the person stays on the screen they were on.
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(nav.router.dismissAll).not.toHaveBeenCalled();
    expect(nav.state.stack).toEqual(AUTHENTICATED);
    // Internally consistent: memory and disk agree on the SAME signed-in
    // session, the login instance never moved, and nothing else was torn down.
    expect(useSessionStore.getState().session).toMatchObject(SESSION);
    expect(readPersistedSessionSync()).toEqual(useSessionStore.getState().session);
    expect(useSessionStore.getState().epoch).toBe(epoch);
    expect(useCartStore.getState().items).toHaveLength(1);
    expect(sync.stopSyncEngine).not.toHaveBeenCalled();
    // The requirement and the banner stay, to try again.
    expect(useDeviceRelinkStore.getState().required).toEqual({ shopId: 'shop-1', userId: 'user-1' });
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('works on the next press once storage recovers', async () => {
    markDeviceRelinkRequired('shop-1', 'user-1');
    render(createElement(DeviceRelinkBanner));
    failSessionWrites();
    await pressRelink();
    expect(nav.router.replace).not.toHaveBeenCalled();

    mmkv.failure.storeId = null;
    await pressRelink();

    expect(atNavigation).toEqual([{ memory: null, disk: null, cartLines: 0 }]);
    expect(nav.state.stack.map(pathOf)).toEqual(['/device-login']);
  });

  it('still reaches Device Login when only the repeat write fails: disk and memory already agree', async () => {
    markDeviceRelinkRequired('shop-1', 'user-1');
    render(createElement(DeviceRelinkBanner));
    // The durable write lands; the persist middleware's repeat of it throws.
    failSessionWrites(2);

    await pressRelink();

    expect(atNavigation).toEqual([{ memory: null, disk: null, cartLines: 0 }]);
    expect(nav.state.stack.map(pathOf)).toEqual(['/device-login']);
  });
});
