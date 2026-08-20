// @vitest-environment jsdom
//
// The SESSION half of the device handover (Volume 0 Days 5/11): what
// state/switchUser.ts clears, what it must leave standing, and how the route
// guard follows the active user.
//
// react-native-mmkv is a Nitro native module and cannot load in Node, so it is
// replaced below with an in-memory double that keeps ONE MAP PER STORE ID —
// the same isolation the real library gives. That isolation is the whole point
// of these tests: the local user session ('muthoy-session'), the Supabase JWT
// ('muthoy-supabase-auth') and the pull cursor ('muthoy-sync-cursor') are
// separate stores, and a handover may only empty the first.
//
// jsdom (not the default node environment) so usePermission can be exercised
// as a real React hook — the route guard's behaviour across a switch is one of
// the things under test, not something to re-implement in the assertions.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

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

// The real sync engine pulls in AppState/NetInfo/supabase-js — none of which
// belong in this file's concern (the SESSION half of a handover). Mocked at
// the module boundary so switchUser's contract with it — "stop, every time,
// exactly once" — can be asserted without dragging in the whole engine.
const sync = vi.hoisted(() => ({ stopSyncEngine: vi.fn() }));
vi.mock('../sync', () => ({ stopSyncEngine: sync.stopSyncEngine }));

const { readPersistedSessionSync, useSessionStore } = await import('./sessionStore');
type Session = import('./sessionStore').Session;
const { useCartStore } = await import('./cartStore');
const { usePermission } = await import('./usePermission');
const { switchUser } = await import('./switchUser');
const { asPaisa } = await import('@muthoy/types');

// The three MMKV stores this app opens, by the ids their owning modules use.
const SESSION_STORE = 'muthoy-session';
const SUPABASE_AUTH_STORE = 'muthoy-supabase-auth'; // sync/supabaseClient.ts
const SYNC_CURSOR_STORE = 'muthoy-sync-cursor'; // sync/cursorStore.ts

const SHOP_ID = '3f1c8a90-0000-4000-8000-000000000001';
const OWNER: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000002', role: 'owner' };
const STAFF: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000003', role: 'staff' };

// Stand-ins for what a LINKED device carries: the Supabase session minted at
// OTP verification, and the shop-keyed pull cursor. Opaque here on purpose —
// the assertions only ever check that they came through a handover unchanged.
const CLOUD_SESSION_KEY = `sb-${SHOP_ID}-auth-token`;
const CLOUD_SESSION_VALUE = JSON.stringify({
  access_token: 'jwt-for-the-linked-device',
  refresh_token: 'refresh-for-the-linked-device',
  user: { app_metadata: { shop_id: SHOP_ID } },
});
const CURSOR_KEY = `last-pulled:${SHOP_ID}`;
const CURSOR_VALUE = JSON.stringify({
  updatedAt: '2026-08-17T09:30:00.000Z',
  tableName: 'sales',
  rowId: '3f1c8a90-0000-4000-8000-000000000009',
});

function storeSnapshot(id: string): [string, string][] {
  return [...(mmkv.stores.get(id) ?? new Map<string, string>())].sort();
}

function seedLinkedDevice(): void {
  mmkv.createMMKV({ id: SUPABASE_AUTH_STORE }).set(CLOUD_SESSION_KEY, CLOUD_SESSION_VALUE);
  mmkv.createMMKV({ id: SYNC_CURSOR_STORE }).set(CURSOR_KEY, CURSOR_VALUE);
}

beforeEach(() => {
  mmkv.stores.forEach((store) => store.clear());
  seedLinkedDevice();
  useSessionStore.setState({ session: null });
  useCartStore.setState({ items: [] });
  sync.stopSyncEngine.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('switchUser — what a handover clears', () => {
  it('ends the active user session so the next screen is PIN Login', () => {
    useSessionStore.getState().login(OWNER);

    switchUser();

    expect(useSessionStore.getState().session).toBeNull();
    // The headless notification path (native/notifications.ts) reads MMKV
    // directly, outside React — it must see no user either, or a background
    // check would keep running as the person who walked away.
    expect(readPersistedSessionSync()).toBeNull();
  });

  it("drops the outgoing user's cart so no line is saved under the next user", () => {
    useSessionStore.getState().login(OWNER);
    useCartStore.getState().addItem({
      medicineId: '3f1c8a90-0000-4000-8000-000000000004',
      medicineName: 'Napa',
      batchId: '3f1c8a90-0000-4000-8000-000000000005',
      quantity: 2,
      unitPrice: asPaisa(1000),
    });
    expect(useCartStore.getState().items).toHaveLength(1);

    switchUser();

    expect(useCartStore.getState().items).toEqual([]);
  });

  it("the outgoing owner's cart cannot resurface once staff logs in — no stale actor state leaks across the login boundary", () => {
    useSessionStore.getState().login(OWNER);
    useCartStore.getState().addItem({
      medicineId: '3f1c8a90-0000-4000-8000-000000000004',
      medicineName: 'Napa',
      batchId: '3f1c8a90-0000-4000-8000-000000000005',
      quantity: 2,
      unitPrice: asPaisa(1000),
    });

    switchUser();
    useSessionStore.getState().login(STAFF);

    expect(useCartStore.getState().items).toEqual([]);
    expect(useSessionStore.getState().session).toEqual(STAFF);
  });

  it('stops the sync engine as part of the handover itself, every time — not left to another screen noticing', () => {
    useSessionStore.getState().login(OWNER);

    switchUser();
    expect(sync.stopSyncEngine).toHaveBeenCalledTimes(1);

    useSessionStore.getState().login(STAFF);
    switchUser();
    expect(sync.stopSyncEngine).toHaveBeenCalledTimes(2);
  });

  it('never writes a PIN or a hash into the persisted session', () => {
    useSessionStore.getState().login(OWNER);

    const persisted = mmkv.stores.get(SESSION_STORE)?.get('session') ?? '';

    // CLAUDE.md rule 8. The session carries identity only; users.pin_hash in
    // SQLite stays the single home of the hash, and the raw PIN no home at all.
    expect(persisted).not.toMatch(/pin/i);
    expect(JSON.parse(persisted).state.session).toEqual(OWNER);
  });
});

describe('switchUser — what a handover must leave standing', () => {
  it('leaves the linked-device Supabase session byte-identical', () => {
    const before = storeSnapshot(SUPABASE_AUTH_STORE);
    useSessionStore.getState().login(OWNER);

    switchUser();

    // Not merely "still present": unchanged. A handover that refreshed or
    // re-minted the JWT would be a cloud sign-in, which is sync/otp.ts's job
    // for a NEW owner, never part of passing the phone to a colleague.
    expect(storeSnapshot(SUPABASE_AUTH_STORE)).toEqual(before);
    expect(before).toEqual([[CLOUD_SESSION_KEY, CLOUD_SESSION_VALUE]]);
  });

  it('leaves the shop-keyed pull cursor untouched — no sync identity reset', () => {
    const before = storeSnapshot(SYNC_CURSOR_STORE);
    useSessionStore.getState().login(OWNER);

    switchUser();
    useSessionStore.getState().login(STAFF);

    // The cursor is keyed by SHOP, not user, so the incoming staff member
    // resumes the same pull position rather than re-hydrating the shop.
    expect(storeSnapshot(SYNC_CURSOR_STORE)).toEqual(before);
    expect(before).toEqual([[CURSOR_KEY, CURSOR_VALUE]]);
  });

  it('opens no new MMKV store and keeps the shop id across a round trip', () => {
    const storeIds = [...mmkv.stores.keys()].sort();
    useSessionStore.getState().login(OWNER);

    switchUser();
    useSessionStore.getState().login(STAFF);
    switchUser();
    useSessionStore.getState().login(OWNER);

    // CLAUDE.md rule 7 at the session layer: the shop is never re-created or
    // re-derived by a handover — both users land on the same shopId.
    expect(useSessionStore.getState().session?.shopId).toBe(SHOP_ID);
    expect([...mmkv.stores.keys()].sort()).toEqual(storeIds);
  });
});

// Owner → switch → Staff, and back. The route guard is the UI half of Volume 0
// Day 11's check; db/user-switch.sqlite.test.ts covers the enforcement half.
describe('usePermission — the guard follows the active user', () => {
  function renderGuards() {
    return renderHook(() => ({
      cash: usePermission('cash_management'),
      staffManagement: usePermission('staff_management'),
      sales: usePermission('sales'),
      inventoryView: usePermission('inventory_view'),
    }));
  }

  it('grants the owner everything, then only sales and inventory-view to the staff who takes over', () => {
    const { result } = renderGuards();

    act(() => useSessionStore.getState().login(OWNER));
    expect(result.current.cash.isAllowed).toBe(true);
    expect(result.current.staffManagement.isAllowed).toBe(true);
    expect(result.current.sales.isAllowed).toBe(true);

    act(() => switchUser());
    // Nobody is logged in between the two PINs: every permission is denied,
    // not merely hidden.
    expect(result.current.cash.session).toBeNull();
    expect(result.current.cash.isAllowed).toBe(false);
    expect(result.current.sales.isAllowed).toBe(false);

    act(() => useSessionStore.getState().login(STAFF));
    expect(result.current.sales.isAllowed).toBe(true);
    expect(result.current.inventoryView.isAllowed).toBe(true);
    expect(result.current.cash.isAllowed).toBe(false);
    expect(result.current.staffManagement.isAllowed).toBe(false);
  });

  it('restores owner access when the owner switches back', () => {
    const { result } = renderGuards();

    act(() => useSessionStore.getState().login(STAFF));
    expect(result.current.cash.isAllowed).toBe(false);

    act(() => switchUser());
    act(() => useSessionStore.getState().login(OWNER));

    expect(result.current.cash.isAllowed).toBe(true);
    expect(result.current.staffManagement.isAllowed).toBe(true);
  });

  // Fail-closed, unchanged by the handover work: the P1 'manager' rows every
  // shop already carries (db/auth.ts's createShopAndOwner) must not inherit a
  // grant if one is ever forced into the persisted session.
  it('denies a manager or unknown role forced into the session', () => {
    const { result } = renderGuards();

    act(() =>
      useSessionStore.setState({
        session: { ...STAFF, role: 'manager' as unknown as Session['role'] },
      }),
    );

    expect(result.current.sales.isAllowed).toBe(false);
    expect(result.current.inventoryView.isAllowed).toBe(false);
    expect(result.current.cash.isAllowed).toBe(false);

    act(() =>
      useSessionStore.setState({
        session: { ...STAFF, role: 'superuser' as unknown as Session['role'] },
      }),
    );

    expect(result.current.sales.isAllowed).toBe(false);
    expect(result.current.cash.isAllowed).toBe(false);
  });
});
