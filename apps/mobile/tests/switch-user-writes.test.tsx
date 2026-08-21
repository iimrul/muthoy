// @vitest-environment jsdom
//
// The SIBLING-WRITE half of the device handover (Volume 0 Days 5/11).
//
// db/user-switch.sqlite.test.ts already proves the SQLite half: when a write's
// isStillActive reports false, assertSessionLive aborts the transaction and
// zero rows land. What it cannot prove is the half that lives in the screens —
// that each handler pins the epoch at action start, hands that guard down, and
// then refuses to clear a form, repaint owner-only money, or navigate once the
// phone has changed hands. That is what this file drives, on the real screens.
//
// The handover under test is OWNER → STAFF → OWNER: the owner lends the phone
// and takes it straight back. The user id is identical either side, so nothing
// short of the session epoch can see that two real handovers happened.
//
// React Native's primitives are replaced with minimal DOM stubs, the same
// approach tests/sale/checkout.test.tsx uses — this repo has no jest-expo
// harness, and what is under test is handler wiring across a session change,
// not native rendering. Only the db/ and sync/ boundaries are mocked; the
// session store, switchUser, captureSessionFor, react-hook-form and every
// zod schema are the real implementations.

import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const SHOP_ID = '7c2f1a30-0000-4000-8000-000000000001';
const OWNER_ID = '7c2f1a30-0000-4000-8000-000000000002';
const STAFF_ID = '7c2f1a30-0000-4000-8000-000000000003';
const CUSTOMER_ID = '7c2f1a30-0000-4000-8000-000000000004';
const SUPPLIER_ID = '7c2f1a30-0000-4000-8000-000000000005';
const MEDICINE_ID = '7c2f1a30-0000-4000-8000-000000000006';
const BUSINESS_DATE = '2026-08-17';

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
  placeholder?: string;
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
  TextInput: ({ value, onChangeText, accessibilityLabel, placeholder }: StubProps) =>
    createElement('input', {
      value: value ?? '',
      'aria-label': accessibilityLabel,
      placeholder,
      onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
    }),
}));

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  params: { value: {} as Record<string, string> },
}));

vi.mock('expo-router', () => ({
  router: routerMock,
  useLocalSearchParams: () => routerMock.params.value,
  // useUnreadCount subscribes through this; the badge is not under test.
  useFocusEffect: () => undefined,
}));

vi.mock('../components/ui/StandardHeader', () => ({
  StandardHeader: ({ title }: { title: string }) => createElement('h1', null, title),
}));
vi.mock('../components/ui/AccessDenied', () => ({
  AccessDenied: () => createElement('p', null, 'Access denied'),
}));

const deps = vi.hoisted(() => ({
  currentBusinessDate: vi.fn(),
  getCashSummary: vi.fn(),
  setOpeningCash: vi.fn(),
  listExpenses: vi.fn(),
  recordExpense: vi.fn(),
  getEndOfDaySummary: vi.fn(),
  closeDay: vi.fn(),
  listCustomersWithBalance: vi.fn(),
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
  getCustomerCreditLedger: vi.fn(),
  collectPayment: vi.fn(),
  listSuppliers: vi.fn(),
  searchMedicinesForPurchase: vi.fn(),
  createPurchase: vi.fn(),
  getUnreadCount: vi.fn(),
  triggerSyncNow: vi.fn(),
  stopSyncEngine: vi.fn(),
}));

vi.mock('../db/cash', () => ({
  currentBusinessDate: deps.currentBusinessDate,
  getCashSummary: deps.getCashSummary,
  setOpeningCash: deps.setOpeningCash,
  listExpenses: deps.listExpenses,
  recordExpense: deps.recordExpense,
  getEndOfDaySummary: deps.getEndOfDaySummary,
  closeDay: deps.closeDay,
}));
vi.mock('../db/customers', () => ({
  listCustomersWithBalance: deps.listCustomersWithBalance,
  createCustomer: deps.createCustomer,
  getCustomer: deps.getCustomer,
  getCustomerCreditLedger: deps.getCustomerCreditLedger,
  collectPayment: deps.collectPayment,
}));
vi.mock('../db/purchases', () => ({
  searchMedicinesForPurchase: deps.searchMedicinesForPurchase,
  createPurchase: deps.createPurchase,
}));
vi.mock('../db/suppliers', () => ({ listSuppliers: deps.listSuppliers }));
vi.mock('../db/notifications', () => ({ getUnreadCount: deps.getUnreadCount }));
// state/switchUser.ts pulls stopSyncEngine from here, so the real handover
// below runs against the mock rather than the native engine.
vi.mock('../sync', () => ({
  triggerSyncNow: deps.triggerSyncNow,
  stopSyncEngine: deps.stopSyncEngine,
}));

const { asPaisa } = await import('@muthoy/types');
const { useSessionStore } = await import('../state/sessionStore');
type Session = import('../state/sessionStore').Session;
const { switchUser } = await import('../state/switchUser');
const { captureSessionFor } = await import('../state/sessionGuard');

const CashSummaryScreen = (await import('../app/cash-summary')).default;
const ExpensesScreen = (await import('../app/expenses')).default;
const EndOfDayScreen = (await import('../app/end-of-day')).default;
const CreditSalesScreen = (await import('../app/credit/credit-sales')).default;
const CustomerDetailScreen = (await import('../app/credit/customer-detail')).default;
const PurchaseCreateScreen = (await import('../app/suppliers/purchase-create')).default;

const OWNER: Session = { shopId: SHOP_ID, userId: OWNER_ID, role: 'owner' };
const STAFF: Session = { shopId: SHOP_ID, userId: STAFF_ID, role: 'staff' };

const ZERO_FORMULA = {
  openingCash: asPaisa(0),
  cashSales: asPaisa(0),
  creditCollections: asPaisa(0),
  expenses: asPaisa(0),
  refunds: asPaisa(0),
  supplierPayments: asPaisa(0),
  withdrawals: asPaisa(0),
};

const OPEN_DAY_SUMMARY = {
  businessDate: BUSINESS_DATE,
  isClosed: false,
  cashFormula: ZERO_FORMULA,
  expectedCash: asPaisa(0),
  totalSales: asPaisa(0),
  cashSales: asPaisa(0),
  creditSales: asPaisa(0),
  cogs: asPaisa(0),
  grossProfit: asPaisa(0),
  expenses: asPaisa(0),
  newCreditGiven: asPaisa(0),
  creditCollected: asPaisa(0),
  countedCash: null,
  variance: null,
  openedByName: 'Owner',
  closedByName: null,
  openedAt: null,
  closedAt: null,
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * The handover itself: the owner lends the phone to staff and takes it back.
 * Four real epoch transitions, and the same userId on both ends — the case an
 * identity comparison is structurally blind to.
 */
function ownerLendsPhoneAndTakesItBack(): void {
  act(() => switchUser());
  act(() => useSessionStore.getState().login(STAFF));
  act(() => switchUser());
  act(() => useSessionStore.getState().login(OWNER));
}

/** The liveness callback the screen handed to the db layer on its last call. */
function livenessOf(write: { mock: { calls: unknown[][] } }): () => boolean {
  const input = write.mock.calls.at(-1)?.[0] as { isStillActive?: () => boolean };
  return input.isStillActive!;
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** Presses a Pressable by its visible text. */
function clickText(text: string): void {
  fireEvent.click(screen.getByText(text));
}

/**
 * What the field holds now. Clearing it is each screen's success signal, so a
 * retained value is the observable proof that the stale path stopped before it.
 * Counting reload() calls cannot serve here: logging back in legitimately
 * re-fires the mount effect for the INCOMING user, which is correct behaviour.
 */
function valueOf(label: string): string {
  return (screen.getByLabelText(label) as HTMLInputElement).value;
}

beforeEach(() => {
  vi.clearAllMocks();
  mmkv.stores.forEach((store) => store.clear());
  useSessionStore.setState({ session: null, epoch: 0 });
  routerMock.params.value = {};

  deps.currentBusinessDate.mockReturnValue(BUSINESS_DATE);
  deps.getCashSummary.mockResolvedValue(ZERO_FORMULA);
  deps.listExpenses.mockResolvedValue([]);
  deps.getEndOfDaySummary.mockResolvedValue(OPEN_DAY_SUMMARY);
  deps.listCustomersWithBalance.mockResolvedValue([]);
  deps.getCustomer.mockResolvedValue({ id: CUSTOMER_ID, name: 'Rahim', phone: null, address: null, notes: null });
  deps.getCustomerCreditLedger.mockResolvedValue([]);
  deps.listSuppliers.mockResolvedValue([{ id: SUPPLIER_ID, name: 'Square Pharmaceuticals' }]);
  deps.searchMedicinesForPurchase.mockResolvedValue([
    { medicineId: MEDICINE_ID, name: 'Napa', generic: 'Paracetamol' },
  ]);
  deps.getUnreadCount.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
});

describe('captureSessionFor pins a write to the login that rendered it', () => {
  it('refuses when the store has already moved past that session', () => {
    useSessionStore.getState().login(OWNER);
    useSessionStore.getState().clearActiveUser();
    useSessionStore.getState().login(STAFF);

    // A handler still holding the owner's session, pressed after the store
    // moved on. Zustand writes synchronously but React re-renders afterwards,
    // so this window is real.
    expect(captureSessionFor(OWNER)).toBeNull();
  });

  it('refuses when nobody is logged in at all', () => {
    useSessionStore.getState().login(OWNER);
    useSessionStore.getState().clearActiveUser();

    expect(captureSessionFor(OWNER)).toBeNull();
  });

  it('goes stale across a handover that returns to the same user', () => {
    useSessionStore.getState().login(OWNER);
    const guard = captureSessionFor(OWNER)!;
    expect(guard.isStale()).toBe(false);
    expect(guard.isStillActive()).toBe(true);

    ownerLendsPhoneAndTakesItBack();

    expect(useSessionStore.getState().session?.userId).toBe(OWNER_ID);
    expect(guard.isStale()).toBe(true);
    expect(guard.isStillActive()).toBe(false);
  });
});

describe('cash-summary: opening cash', () => {
  async function openScreen(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(CashSummaryScreen));
    await waitFor(() => expect(screen.getByLabelText('Opening cash amount')).toBeTruthy());
  }

  it('cannot commit or clear the form when the phone changes hands mid-write', async () => {
    const pending = deferred<void>();
    deps.setOpeningCash.mockReturnValueOnce(pending.promise);
    await openScreen();

    type('Opening cash amount', '500');
    clickText('Set opening cash');
    await waitFor(() => expect(deps.setOpeningCash).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    // db/cash.ts calls this as the transaction's first statement.
    expect(livenessOf(deps.setOpeningCash)()).toBe(false);
    expect(valueOf('Opening cash amount')).toBe('500');
  });

  it('still saves and clears on the owner normal path', async () => {
    deps.setOpeningCash.mockResolvedValue(undefined);
    await openScreen();

    type('Opening cash amount', '500');
    await act(async () => {
      clickText('Set opening cash');
    });

    expect(deps.setOpeningCash).toHaveBeenCalledTimes(1);
    expect(deps.setOpeningCash.mock.calls[0]?.[0]).toMatchObject({ shopId: SHOP_ID, staffId: OWNER_ID });
    expect(livenessOf(deps.setOpeningCash)()).toBe(true);
    expect(valueOf('Opening cash amount')).toBe('');
  });
});

describe('expenses: record expense', () => {
  async function openScreen(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(ExpensesScreen));
    await waitFor(() => expect(screen.getByLabelText('Expense amount')).toBeTruthy());
  }

  it('cannot commit or clear the form when the phone changes hands mid-write', async () => {
    const pending = deferred<void>();
    deps.recordExpense.mockReturnValueOnce(pending.promise);
    await openScreen();

    type('Expense amount', '250');
    clickText('Save expense');
    await waitFor(() => expect(deps.recordExpense).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.recordExpense)()).toBe(false);
    expect(valueOf('Expense amount')).toBe('250');
  });

  it('still saves and clears on the owner normal path', async () => {
    deps.recordExpense.mockResolvedValue(undefined);
    await openScreen();

    type('Expense amount', '250');
    await act(async () => {
      clickText('Save expense');
    });

    expect(deps.recordExpense.mock.calls[0]?.[0]).toMatchObject({ shopId: SHOP_ID, staffId: OWNER_ID });
    expect(livenessOf(deps.recordExpense)()).toBe(true);
    expect(valueOf('Expense amount')).toBe('');
  });
});

describe('end-of-day: close the day', () => {
  async function openScreen(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(EndOfDayScreen));
    await waitFor(() => expect(screen.getByLabelText('Counted cash amount')).toBeTruthy());
  }

  it('cannot lock the day or clear the form when the phone changes hands mid-write', async () => {
    const pending = deferred<void>();
    deps.closeDay.mockReturnValueOnce(pending.promise);
    await openScreen();

    type('Counted cash amount', '1200');
    clickText('Close the day');
    await waitFor(() => expect(deps.closeDay).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.closeDay)()).toBe(false);
    expect(valueOf('Counted cash amount')).toBe('1200');
  });

  it('still closes and clears on the owner normal path', async () => {
    deps.closeDay.mockResolvedValue(undefined);
    await openScreen();

    type('Counted cash amount', '1200');
    await act(async () => {
      clickText('Close the day');
    });

    expect(deps.closeDay.mock.calls[0]?.[0]).toMatchObject({ shopId: SHOP_ID, closedBy: OWNER_ID });
    expect(livenessOf(deps.closeDay)()).toBe(true);
    expect(valueOf('Counted cash amount')).toBe('');
  });
});

describe('credit-sales: create customer', () => {
  async function openForm(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(CreditSalesScreen));
    await waitFor(() => expect(deps.listCustomersWithBalance).toHaveBeenCalledTimes(1));
    await act(async () => {
      clickText('Add customer');
    });
    type('Customer name', 'Rahim Uddin');
  }

  // react-hook-form awaits its zod resolver BEFORE handleCreate runs, so a
  // handover can land in that gap. This is the one screen where the write is
  // provably never reached at all.
  it('never reaches the database when the handover lands in the resolver gap', async () => {
    deps.createCustomer.mockResolvedValue(undefined);
    await openForm();

    clickText('Save customer');
    act(() => switchUser());
    act(() => useSessionStore.getState().login(STAFF));
    await act(async () => {
      await Promise.resolve();
    });

    expect(deps.createCustomer).not.toHaveBeenCalled();
  });

  it('cannot commit or close the form when the phone changes hands mid-write', async () => {
    const pending = deferred<void>();
    deps.createCustomer.mockReturnValueOnce(pending.promise);
    await openForm();

    await act(async () => {
      clickText('Save customer');
    });
    expect(deps.createCustomer).toHaveBeenCalledTimes(1);

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.createCustomer)()).toBe(false);
    // reset() + setIsAdding(false) is this screen's success signal. The form
    // is still open, still holding what the outgoing owner typed.
    expect(valueOf('Customer name')).toBe('Rahim Uddin');
  });

  it('still saves and closes the form on the owner normal path', async () => {
    deps.createCustomer.mockResolvedValue(undefined);
    await openForm();

    await act(async () => {
      clickText('Save customer');
    });

    expect(deps.createCustomer.mock.calls[0]?.[0]).toMatchObject({ shopId: SHOP_ID, actorUserId: OWNER_ID });
    expect(livenessOf(deps.createCustomer)()).toBe(true);
    await waitFor(() => expect(screen.queryByLabelText('Customer name')).toBeNull());
  });
});

describe('credit/customer-detail: collect payment', () => {
  async function openScreen(): Promise<void> {
    routerMock.params.value = { customerId: CUSTOMER_ID };
    useSessionStore.getState().login(OWNER);
    render(createElement(CustomerDetailScreen));
    await waitFor(() => expect(screen.getByLabelText('Collection amount')).toBeTruthy());
  }

  it('cannot commit or clear the form when the phone changes hands mid-write', async () => {
    const pending = deferred<void>();
    deps.collectPayment.mockReturnValueOnce(pending.promise);
    await openScreen();

    type('Collection amount', '300');
    clickText('Collect cash');
    await waitFor(() => expect(deps.collectPayment).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.collectPayment)()).toBe(false);
    expect(valueOf('Collection amount')).toBe('300');
  });

  it('still collects and clears on the owner normal path', async () => {
    deps.collectPayment.mockResolvedValue(undefined);
    await openScreen();

    type('Collection amount', '300');
    await act(async () => {
      clickText('Collect cash');
    });

    expect(deps.collectPayment.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      staffId: OWNER_ID,
      customerId: CUSTOMER_ID,
    });
    expect(livenessOf(deps.collectPayment)()).toBe(true);
    expect(valueOf('Collection amount')).toBe('');
  });
});

describe('suppliers/purchase-create: save purchase', () => {
  async function openScreenWithOneLine(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(PurchaseCreateScreen));
    await waitFor(() => expect(deps.listSuppliers).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('Search medicine'), { target: { value: 'Napa' } });
    await waitFor(() => expect(screen.getByText('Napa')).toBeTruthy());
    clickText('Napa');

    type('Batch number', 'B-100');
    type('Expiry date', '2099-01-01');
    type('Quantity', '10');
    type('Purchase price (৳)', '5');
    type('Sale price (৳)', '8');
    await act(async () => {
      clickText('Add line');
    });
  }

  it('cannot commit or navigate when the phone changes hands mid-write', async () => {
    const pending = deferred<void>();
    deps.createPurchase.mockReturnValueOnce(pending.promise);
    await openScreenWithOneLine();

    clickText('Save purchase');
    await waitFor(() => expect(deps.createPurchase).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.createPurchase)()).toBe(false);
    // The outgoing owner's supplier page must not land on the incoming user.
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('shows no stale error to the incoming user when a failed write lands late', async () => {
    let rejectCommit: (reason: unknown) => void = () => undefined;
    deps.createPurchase.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectCommit = reject;
      }),
    );
    await openScreenWithOneLine();

    clickText('Save purchase');
    await waitFor(() => expect(deps.createPurchase).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      rejectCommit(new Error('Supplier is no longer available.'));
    });

    expect(screen.queryByText('Supplier is no longer available.')).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it('still saves and navigates on the owner normal path', async () => {
    deps.createPurchase.mockResolvedValue(undefined);
    await openScreenWithOneLine();

    await act(async () => {
      clickText('Save purchase');
    });

    expect(deps.createPurchase.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      staffId: OWNER_ID,
      supplierId: SUPPLIER_ID,
    });
    expect(livenessOf(deps.createPurchase)()).toBe(true);
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: '/suppliers/detail',
      params: { supplierId: SUPPLIER_ID },
    });
  });
});
