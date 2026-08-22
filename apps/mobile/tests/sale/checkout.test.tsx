// @vitest-environment jsdom
//
// The ATTRIBUTION half of the device handover (Volume 0 Days 5/11). The
// session layer is covered by state/switchUser.test.tsx and the SQLite writes
// by db/user-switch.sqlite.test.ts; neither can prove the thing that actually
// decides a sale's staff_id, which is WHICH id this screen hands to
// createSaleTransaction after the phone changes hands.
//
// React Native's primitives are replaced with minimal DOM stubs, the same
// approach components/scanner/MedicineTextScanner.test.tsx uses — this repo
// has no jest-expo/@testing-library/react-native harness, and what is under
// test here is handler wiring across a session change, not native rendering.

import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const BATCH_ID = '3f1c8a90-0000-4000-8000-000000000005';
const MEDICINE_ID = '3f1c8a90-0000-4000-8000-000000000004';
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

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  value?: string;
  onChangeText?: (value: string) => void;
  disabled?: boolean;
}

vi.mock('react-native', () => ({
  View: ({ children }: StubProps) => createElement('div', null, children),
  Text: ({ children }: StubProps) => createElement('span', null, children),
  ScrollView: ({ children }: StubProps) => createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children),
  TextInput: ({ value, onChangeText, accessibilityLabel }: StubProps) =>
    createElement('input', {
      value: value ?? '',
      'aria-label': accessibilityLabel,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
}));

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), back: vi.fn() }));
vi.mock('expo-router', () => ({ router: routerMock }));

vi.mock('../../components/ui/StandardHeader', () => ({
  StandardHeader: ({ title }: { title: string }) => createElement('h1', null, title),
}));
vi.mock('../../components/scanner/MedicineTextScanner', () => ({
  MedicineTextScanner: () => null,
}));

const deps = vi.hoisted(() => ({
  listCustomers: vi.fn(),
  listBatchesForMedicine: vi.fn(),
  createSaleTransaction: vi.fn(),
  runNotificationChecks: vi.fn(),
  triggerSyncNow: vi.fn(),
  stopSyncEngine: vi.fn(),
}));

vi.mock('../../db/customers', () => ({ listCustomers: deps.listCustomers }));
vi.mock('../../db/inventory', () => ({ listBatchesForMedicine: deps.listBatchesForMedicine }));
vi.mock('../../db/sales', () => ({
  createSaleTransaction: deps.createSaleTransaction,
  SaleQuoteChangedError: class SaleQuoteChangedError extends Error {
    constructor(readonly refreshedTotal: number) { super('Quote changed'); }
  },
}));
vi.mock('../../native/notifications', () => ({ runNotificationChecks: deps.runNotificationChecks }));
// state/switchUser.ts imports stopSyncEngine from this same module, so the
// real switch below runs against the mock rather than the native engine.
vi.mock('../../sync', () => ({
  triggerSyncNow: deps.triggerSyncNow,
  stopSyncEngine: deps.stopSyncEngine,
}));

// Only FEFO's allocation is stubbed — InsufficientStockError stays the
// genuine class the screen catches.
vi.mock('../../domain/fefo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../domain/fefo')>()),
  deduct: () => [{ batchId: BATCH_ID, quantityDeducted: 1 }],
}));

const { StaleSessionError } = await import('../../db/errors');
const { useSessionStore } = await import('../../state/sessionStore');
type Session = import('../../state/sessionStore').Session;
const { useCartStore } = await import('../../state/cartStore');
const { switchUser } = await import('../../state/switchUser');
const { asPaisa } = await import('@muthoy/types');
const CheckoutScreen = (await import('../../app/sale/checkout')).default;

const OWNER: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000002', role: 'owner' };
const STAFF: Session = { shopId: SHOP_ID, userId: '3f1c8a90-0000-4000-8000-000000000003', role: 'staff' };

function fillCart(): void {
  useCartStore.getState().addItem({
    medicineId: MEDICINE_ID,
    medicineName: 'Napa',
    batchId: BATCH_ID,
    quantity: 1,
    unitPrice: asPaisa(1000),
  });
}

/** Enters enough cash and presses Confirm sale. */
async function confirmCashSale(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Amount tendered'), { target: { value: '100' } });
  await act(async () => {
    fireEvent.click(screen.getByLabelText('Confirm sale'));
  });
}

function staffIdOfLastSale(): string {
  return deps.createSaleTransaction.mock.calls.at(-1)?.[0]?.staffId as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  useSessionStore.setState({ session: null });
  useCartStore.setState({ items: [] });
  deps.listCustomers.mockResolvedValue([]);
  deps.listBatchesForMedicine.mockResolvedValue([]);
  deps.runNotificationChecks.mockResolvedValue(undefined);
  deps.createSaleTransaction.mockResolvedValue({
    saleId: '3f1c8a90-0000-4000-8000-00000000000a',
    invoiceNo: 'INV-1',
    total: asPaisa(1000),
    change: asPaisa(9000),
  });
});

afterEach(() => {
  cleanup();
});

describe('checkout attributes a sale to whoever is logged in at commit time', () => {
  it('stamps the Owner id before the handover and the Staff id after it', async () => {
    useSessionStore.getState().login(OWNER);
    fillCart();
    render(createElement(CheckoutScreen));

    await confirmCashSale();
    expect(staffIdOfLastSale()).toBe(OWNER.userId);

    // The real handover: cart cleared, session ended, sync stopped.
    act(() => switchUser());
    act(() => useSessionStore.getState().login(STAFF));
    act(() => fillCart());

    await confirmCashSale();
    expect(staffIdOfLastSale()).toBe(STAFF.userId);
    expect(deps.createSaleTransaction).toHaveBeenCalledTimes(2);
  });

  it('stamps the Owner id when the owner takes the phone back from staff', async () => {
    useSessionStore.getState().login(STAFF);
    fillCart();
    render(createElement(CheckoutScreen));

    await confirmCashSale();
    expect(staffIdOfLastSale()).toBe(STAFF.userId);

    act(() => switchUser());
    act(() => useSessionStore.getState().login(OWNER));
    act(() => fillCart());

    await confirmCashSale();
    expect(staffIdOfLastSale()).toBe(OWNER.userId);
  });

  // The screen's handler captured `session` AND `items` at its render. Both
  // survive a switch that lands mid-await, so without the live re-read the
  // outgoing user's already-cleared cart would still commit under their id.
  it('commits nothing and shows no confirmation when the device changes hands mid-await', async () => {
    let releaseCommit: () => void = () => undefined;
    deps.createSaleTransaction.mockImplementationOnce(
      (input: { isStillActive?: () => boolean }) => new Promise((resolve, reject) => {
        releaseCommit = () => input.isStillActive?.()
          ? resolve({ saleId: 's1', invoiceNo: 'INV-1', total: asPaisa(1000), change: asPaisa(9000) })
          : reject(new StaleSessionError());
      }),
    );

    useSessionStore.getState().login(OWNER);
    fillCart();
    render(createElement(CheckoutScreen));

    fireEvent.change(screen.getByLabelText('Amount tendered'), { target: { value: '100' } });
    fireEvent.click(screen.getByLabelText('Confirm sale'));
    await waitFor(() => expect(deps.createSaleTransaction).toHaveBeenCalled());

    act(() => switchUser());
    act(() => useSessionStore.getState().login(STAFF));
    await act(async () => {
      releaseCommit();
    });

    expect(deps.createSaleTransaction).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(deps.triggerSyncNow).not.toHaveBeenCalled();
  });

  // The case a userId comparison structurally cannot catch: the id is the
  // same on both sides of two real handovers, and the cart it would commit
  // was cleared in between. Only the session epoch sees this.
  it('refuses a stale checkout when the OWNER hands the phone over and takes it straight back', async () => {
    let releaseCommit: () => void = () => undefined;
    deps.createSaleTransaction.mockImplementationOnce(
      (input: { isStillActive?: () => boolean }) => new Promise((resolve, reject) => {
        releaseCommit = () => input.isStillActive?.()
          ? resolve({ saleId: 's1', invoiceNo: 'INV-1', total: asPaisa(1000), change: asPaisa(9000) })
          : reject(new StaleSessionError());
      }),
    );

    useSessionStore.getState().login(OWNER);
    fillCart();
    render(createElement(CheckoutScreen));

    fireEvent.change(screen.getByLabelText('Amount tendered'), { target: { value: '100' } });
    fireEvent.click(screen.getByLabelText('Confirm sale'));
    await waitFor(() => expect(deps.createSaleTransaction).toHaveBeenCalled());

    act(() => switchUser());
    act(() => useSessionStore.getState().login(STAFF));
    act(() => switchUser());
    act(() => useSessionStore.getState().login(OWNER));
    expect(useSessionStore.getState().session?.userId).toBe(OWNER.userId);
    expect(useCartStore.getState().items).toEqual([]);

    await act(async () => {
      releaseCommit();
    });

    expect(deps.createSaleTransaction).toHaveBeenCalledTimes(1);
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(deps.triggerSyncNow).not.toHaveBeenCalled();
  });

  // db/sales.ts awaits requirePermission before opening its transaction. The
  // screen's pre-commit check cannot cover that gap, so the guard is handed
  // down and re-evaluated inside the (synchronous) transaction itself.
  it('rejects a switch that lands inside createSaleTransaction, and does not navigate', async () => {
    let releaseCommit: () => void = () => undefined;
    deps.createSaleTransaction.mockImplementationOnce(
      (input: { isStillActive?: () => boolean }) =>
        new Promise((resolve, reject) => {
          releaseCommit = () => {
            // What assertSessionLive does as the transaction's first statement.
            if (input.isStillActive && !input.isStillActive()) {
              reject(new StaleSessionError());
              return;
            }
            resolve({ saleId: 's1', invoiceNo: 'INV-1', total: asPaisa(1000), change: asPaisa(9000) });
          };
        }),
    );

    useSessionStore.getState().login(OWNER);
    fillCart();
    render(createElement(CheckoutScreen));

    await confirmCashSale();
    expect(deps.createSaleTransaction).toHaveBeenCalledTimes(1);

    act(() => switchUser());
    act(() => useSessionStore.getState().login(STAFF));

    await act(async () => {
      releaseCommit();
    });

    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(screen.getByText('The active user changed. This action was not saved.')).toBeTruthy();
  });

  it('passes a liveness callback that reports true while the session holds', async () => {
    useSessionStore.getState().login(OWNER);
    fillCart();
    render(createElement(CheckoutScreen));

    await confirmCashSale();

    const isStillActive = deps.createSaleTransaction.mock.calls[0]?.[0]?.isStillActive as () => boolean;
    expect(isStillActive()).toBe(true);
    act(() => switchUser());
    expect(isStillActive()).toBe(false);
  });

  it('leaves no cart line behind for the incoming user to sell', async () => {
    useSessionStore.getState().login(OWNER);
    fillCart();
    render(createElement(CheckoutScreen));

    act(() => switchUser());
    act(() => useSessionStore.getState().login(STAFF));

    expect(useCartStore.getState().items).toEqual([]);
    await confirmCashSale();

    // An empty cart is refused outright: nothing of the owner's survives.
    expect(deps.createSaleTransaction).not.toHaveBeenCalled();
  });
});
