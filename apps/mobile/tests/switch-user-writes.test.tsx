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

import { createElement, Fragment, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const SHOP_ID = "7c2f1a30-0000-4000-8000-000000000001";
const OWNER_ID = "7c2f1a30-0000-4000-8000-000000000002";
const STAFF_ID = "7c2f1a30-0000-4000-8000-000000000003";
const CUSTOMER_ID = "7c2f1a30-0000-4000-8000-000000000004";
const SUPPLIER_ID = "7c2f1a30-0000-4000-8000-000000000005";
const MEDICINE_ID = "7c2f1a30-0000-4000-8000-000000000006";
const BUSINESS_DATE = "2026-08-17";

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

vi.mock("react-native-mmkv", () => ({ createMMKV: mmkv.createMMKV }));

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  placeholder?: string;
  value?: string | boolean;
  onChangeText?: (value: string) => void;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  visible?: boolean;
  // FlatList (B3 Group 4: credit-sales.tsx's paginated list).
  data?: readonly unknown[];
  renderItem?: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor?: (item: unknown, index: number) => string;
  ListHeaderComponent?: ReactNode | (() => ReactNode);
  ListEmptyComponent?: ReactNode | (() => ReactNode);
}

vi.mock("react-native", () => ({
  View: ({ children }: StubProps) => createElement("div", null, children),
  Text: ({ children }: StubProps) => createElement("span", null, children),
  ScrollView: ({ children }: StubProps) => createElement("div", null, children),
  Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
    createElement(
      "button",
      { onClick: onPress, "aria-label": accessibilityLabel, disabled },
      children,
    ),
  TextInput: ({
    value,
    onChangeText,
    accessibilityLabel,
    placeholder,
  }: StubProps) =>
    createElement("input", {
      value: value ?? "",
      "aria-label": accessibilityLabel,
      placeholder,
      onChange: (event: { target: { value: string } }) =>
        onChangeText?.(event.target.value),
    }),
  // B3 Group 2: OpeningCashModal/WithdrawSheet render RN's Modal, which RN
  // itself only mounts children while `visible` — mirrored here rather than
  // always rendering, so a closed sheet's fields are genuinely absent from
  // the DOM (matching how getByLabelText assertions distinguish open/closed).
  Modal: ({ children, visible }: StubProps) =>
    visible ? createElement("div", null, children) : null,
  // B3 Group 6: purchase-create.tsx's pending-line toggle.
  Switch: ({ value, onValueChange }: StubProps) =>
    createElement("input", {
      type: "checkbox",
      checked: Boolean(value),
      onChange: () => onValueChange?.(!value),
    }),
  // B3 Group 4: credit-sales.tsx's paginated list. Renders the header, then
  // either the empty component (no rows) or each row via renderItem — real
  // enough for these actor-stamping tests, which never scroll or paginate.
  FlatList: ({
    data,
    renderItem,
    keyExtractor,
    ListHeaderComponent,
    ListEmptyComponent,
  }: StubProps) => {
    const items = data ?? [];
    const header =
      typeof ListHeaderComponent === "function"
        ? createElement(ListHeaderComponent)
        : (ListHeaderComponent ?? null);
    const empty =
      items.length === 0
        ? typeof ListEmptyComponent === "function"
          ? createElement(ListEmptyComponent)
          : (ListEmptyComponent ?? null)
        : null;
    return createElement(
      "div",
      null,
      header,
      empty,
      ...items.map((item, index) =>
        createElement(
          Fragment,
          { key: keyExtractor ? keyExtractor(item, index) : index },
          renderItem?.({ item, index }),
        ),
      ),
    );
  },
  Animated: {
    Value: class {
      stopAnimation() {}
      setValue() {}
    },
    View: ({ children }: StubProps) => createElement("div", null, children),
    timing: () => ({
      start: (callback?: (result: { finished: boolean }) => void) =>
        callback?.({ finished: true }),
    }),
    delay: () => ({ start: () => undefined }),
    sequence: () => ({
      start: (callback?: (result: { finished: boolean }) => void) =>
        callback?.({ finished: true }),
    }),
  },
}));

const routerMock = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  params: { value: {} as Record<string, string> },
}));
const focusMock = vi.hoisted(() => ({
  callback: null as null | (() => void | (() => void)),
}));

vi.mock("expo-router", () => ({
  router: routerMock,
  useLocalSearchParams: () => routerMock.params.value,
  // useUnreadCount subscribes through this; the badge is not under test.
  useFocusEffect: (callback: () => void | (() => void)) => {
    focusMock.callback = callback;
  },
}));

vi.mock("../components/ui/StandardHeader", () => ({
  // B3 Group 4: credit-sales.tsx's "+" add-customer button lives in
  // rightAccessory — dropped silently before, so it could never be found.
  StandardHeader: ({
    title,
    rightAccessory,
  }: {
    title: string;
    rightAccessory?: ReactNode;
  }) => createElement("div", null, createElement("h1", null, title), rightAccessory ?? null),
}));
vi.mock("../components/ui/AccessDenied", () => ({
  AccessDenied: () => createElement("p", null, "Access denied"),
}));
// B3 Group 6: purchase-create.tsx now imports the OCR scan modal, which
// transitively loads expo-camera/ML Kit — no native module can load under
// this jsdom harness. Mocked wholesale, same as StandardHeader/AccessDenied
// above: this suite exercises the actor-stamped save path, not scanning.
vi.mock("../components/scanner/MedicineTextScanner", () => ({
  MedicineTextScanner: () => null,
}));

const deps = vi.hoisted(() => ({
  currentBusinessDate: vi.fn(),
  getCashSummary: vi.fn(),
  getCashBreakdown: vi.fn(),
  recordWithdrawal: vi.fn(),
  reconcileCashDrawer: vi.fn(),
  setOpeningCash: vi.fn(),
  listExpenses: vi.fn(),
  listExpensesForMonth: vi.fn(),
  findDuplicateExpense: vi.fn(),
  recordExpense: vi.fn(),
  deleteExpense: vi.fn(),
  getEndOfDaySummary: vi.fn(),
  getEndOfDayReportSnapshot: vi.fn(),
  getB2Settings: vi.fn(),
  closeDay: vi.fn(),
  listCustomersWithBalance: vi.fn(),
  createCustomer: vi.fn(),
  getCustomer: vi.fn(),
  getCustomerCreditLedger: vi.fn(),
  getCustomerCreditDetail: vi.fn(),
  getCustomerListTotals: vi.fn(),
  collectPayment: vi.fn(),
  listSuppliers: vi.fn(),
  searchMedicinesForPurchase: vi.fn(),
  findDuplicatePurchase: vi.fn(),
  createPurchase: vi.fn(),
  getUnreadCount: vi.fn(),
  triggerSyncNow: vi.fn(),
  subscribeToSyncCompletion: vi.fn(
    (_shopId: string, _listener: () => void | Promise<void>) => vi.fn(),
  ),
  stopSyncEngine: vi.fn(),
}));

vi.mock("../db/cash", () => ({
  currentBusinessDate: deps.currentBusinessDate,
  getCashSummary: deps.getCashSummary,
  getCashBreakdown: deps.getCashBreakdown,
  recordWithdrawal: deps.recordWithdrawal,
  reconcileCashDrawer: deps.reconcileCashDrawer,
  setOpeningCash: deps.setOpeningCash,
  listExpenses: deps.listExpenses,
  listExpensesForMonth: deps.listExpensesForMonth,
  findDuplicateExpense: deps.findDuplicateExpense,
  recordExpense: deps.recordExpense,
  deleteExpense: deps.deleteExpense,
  getEndOfDaySummary: deps.getEndOfDaySummary,
  closeDay: deps.closeDay,
}));
vi.mock("../db/customers", () => ({
  // B3 Group 4 (W-4): credit-sales.tsx paginates instead of the old LIMIT 50.
  CUSTOMER_LIST_PAGE_SIZE: 30,
  listCustomersWithBalance: deps.listCustomersWithBalance,
  getCustomerListTotals: deps.getCustomerListTotals,
  createCustomer: deps.createCustomer,
  getCustomer: deps.getCustomer,
  getCustomerCreditLedger: deps.getCustomerCreditLedger,
  getCustomerCreditDetail: deps.getCustomerCreditDetail,
  collectPayment: deps.collectPayment,
}));
vi.mock("../db/reports", () => ({
  getEndOfDayReportSnapshot: deps.getEndOfDayReportSnapshot,
}));
// Export/share authorization is exercised by reportExport.authorization.sqlite.test.ts.
vi.mock("../services/reportExport", () => ({ shareReportSummary: vi.fn() }));
vi.mock("../db/purchases", () => ({
  searchMedicinesForPurchase: deps.searchMedicinesForPurchase,
  findDuplicatePurchase: deps.findDuplicatePurchase,
  createPurchase: deps.createPurchase,
}));
vi.mock("../db/suppliers", () => ({ listSuppliers: deps.listSuppliers }));
vi.mock("../db/notifications", () => ({ getUnreadCount: deps.getUnreadCount }));
vi.mock("../db/settings", () => ({ getB2Settings: deps.getB2Settings }));
// state/switchUser.ts pulls stopSyncEngine from here, so the real handover
// below runs against the mock rather than the native engine.
vi.mock("../sync", () => ({
  triggerSyncNow: deps.triggerSyncNow,
  subscribeToSyncCompletion: deps.subscribeToSyncCompletion,
  stopSyncEngine: deps.stopSyncEngine,
}));

const { asPaisa } = await import("@muthoy/types");
const { useLocaleStore } = await import("../state/localeStore");
const { useSessionStore } = await import("../state/sessionStore");
type Session = import("../state/sessionStore").Session;
const { switchUser } = await import("../state/switchUser");
const { captureSessionFor } = await import("../state/sessionGuard");

const CashSummaryScreen = (await import("../app/cash-summary")).default;
const ExpensesScreen = (await import("../app/expenses")).default;
const EndOfDayScreen = (await import("../app/end-of-day")).default;
const CreditSalesScreen = (await import("../app/credit/credit-sales")).default;
const CustomerDetailScreen = (await import("../app/credit/customer-detail"))
  .default;
const PurchaseCreateScreen = (await import("../app/suppliers/purchase-create"))
  .default;

const OWNER: Session = { shopId: SHOP_ID, userId: OWNER_ID, role: "owner" };
const STAFF: Session = { shopId: SHOP_ID, userId: STAFF_ID, role: "staff" };

const ZERO_FORMULA = {
  openingCash: asPaisa(0),
  cashSales: asPaisa(0),
  creditCollections: asPaisa(0),
  expenses: asPaisa(0),
  refunds: asPaisa(0),
  supplierPayments: asPaisa(0),
  withdrawals: asPaisa(0),
};

const ZERO_CASH_BREAKDOWN = {
  businessDate: BUSINESS_DATE,
  openingCash: asPaisa(0),
  cashSales: {
    total: asPaisa(0),
    owner: asPaisa(0),
    staff: asPaisa(0),
    staffBreakdown: [],
  },
  creditCollections: { total: asPaisa(0), details: [] },
  expenses: { total: asPaisa(0), details: [] },
  withdrawals: { total: asPaisa(0) },
  supplierPayments: { total: asPaisa(0) },
  expectedCash: asPaisa(0),
  reconciled: {
    countedAmount: null,
    at: null,
    by: null,
    status: "unknown" as const,
    diff: null,
  },
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
  openedByName: "Owner",
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
  const input = write.mock.calls.at(-1)?.[0] as {
    isStillActive?: () => boolean;
  };
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
  focusMock.callback = null;
  mmkv.stores.forEach((store) => store.clear());
  useSessionStore.setState({ session: null, epoch: 0 });
  // B3 Group 2: CashSummaryScreen now renders through useI18n (OpeningCashModal
  // and WithdrawSheet always did) — the app's default locale is Bangla
  // (state/localeStore.ts), so every English-string selector in this file
  // needs the store pinned to 'en' rather than asserting on Bangla text.
  useLocaleStore.getState().setLocale("en");
  routerMock.params.value = {};

  deps.currentBusinessDate.mockReturnValue(BUSINESS_DATE);
  deps.getCashSummary.mockResolvedValue(ZERO_FORMULA);
  deps.getCashBreakdown.mockResolvedValue(ZERO_CASH_BREAKDOWN);
  deps.listExpenses.mockResolvedValue([]);
  deps.listExpensesForMonth.mockResolvedValue([]);
  deps.findDuplicateExpense.mockResolvedValue(null);
  deps.getEndOfDaySummary.mockResolvedValue(OPEN_DAY_SUMMARY);
  deps.getEndOfDayReportSnapshot.mockResolvedValue({
    range: { startDate: BUSINESS_DATE, endDate: BUSINESS_DATE },
    previousNetSales: asPaisa(0), changeBp: null, trend: [], topMedicines: [], expensesByCategory: [],
    totals: {
      grossSales: asPaisa(0), discounts: asPaisa(0), refunds: asPaisa(0), netSales: asPaisa(0),
      taxCollected: asPaisa(0), netRevenue: asPaisa(0), cogs: asPaisa(0), grossProfit: asPaisa(0),
      expenses: asPaisa(0), netProfit: asPaisa(0), cashSales: asPaisa(0), creditSales: asPaisa(0),
      transactions: 0, refundsCount: 0, averageSale: asPaisa(0), isCogsPartial: false, missingCogsMedicines: [],
    },
  });
  deps.getB2Settings.mockResolvedValue({ closingHour: 20 });
  deps.listCustomersWithBalance.mockResolvedValue([]);
  deps.getCustomerListTotals.mockResolvedValue({ customerCount: 0, totalOutstanding: 0 });
  deps.getCustomer.mockResolvedValue({
    id: CUSTOMER_ID,
    name: "Rahim",
    phone: null,
    address: null,
    notes: null,
  });
  deps.getCustomerCreditLedger.mockResolvedValue([]);
  // B3 Group 4: customer-detail.tsx now reads this composite instead of
  // getCustomer/getCustomerCreditLedger. totalDue > 0 so the "Make Payment"
  // button (and the sheet it opens) render, matching what the collect-
  // payment tests below need.
  deps.getCustomerCreditDetail.mockResolvedValue({
    customer: { id: CUSTOMER_ID, name: "Rahim", phone: null, address: null, notes: null },
    totalDue: 30000,
    totalPurchases: 1,
    settledCount: 0,
    credits: [],
  });
  deps.listSuppliers.mockResolvedValue([
    { id: SUPPLIER_ID, name: "Square Pharmaceuticals" },
  ]);
  deps.searchMedicinesForPurchase.mockResolvedValue([
    { medicineId: MEDICINE_ID, name: "Napa", generic: "Paracetamol" },
  ]);
  // B3 Group 6: purchase-create.tsx checks this before saving; null means no
  // advisory duplicate match, so the normal save path proceeds unblocked.
  deps.findDuplicatePurchase.mockResolvedValue(null);
  deps.getUnreadCount.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
});

describe("captureSessionFor pins a write to the login that rendered it", () => {
  it("refuses when the store has already moved past that session", () => {
    useSessionStore.getState().login(OWNER);
    useSessionStore.getState().clearActiveUser();
    useSessionStore.getState().login(STAFF);

    // A handler still holding the owner's session, pressed after the store
    // moved on. Zustand writes synchronously but React re-renders afterwards,
    // so this window is real.
    expect(captureSessionFor(OWNER)).toBeNull();
  });

  it("refuses when nobody is logged in at all", () => {
    useSessionStore.getState().login(OWNER);
    useSessionStore.getState().clearActiveUser();

    expect(captureSessionFor(OWNER)).toBeNull();
  });

  it("goes stale across a handover that returns to the same user", () => {
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

describe("cash-summary: opening cash (via OpeningCashModal, B3 Group 2)", () => {
  async function openScreenAndModal(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(CashSummaryScreen));
    await waitFor(() => expect(screen.getByText("Edit Opening")).toBeTruthy());
    await act(async () => {
      clickText("Edit Opening");
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Or enter an amount")).toBeTruthy(),
    );
  }

  it("localizes the header and every visible formula term in Bangla", async () => {
    useLocaleStore.getState().setLocale("bn");
    deps.getCashBreakdown.mockResolvedValueOnce({
      ...ZERO_CASH_BREAKDOWN,
      openingCash: asPaisa(100),
      cashSales: { ...ZERO_CASH_BREAKDOWN.cashSales, total: asPaisa(200) },
      creditCollections: { total: asPaisa(300), details: [] },
      expenses: { total: asPaisa(400), details: [] },
      withdrawals: { total: asPaisa(500) },
    });
    useSessionStore.getState().login(OWNER);
    render(createElement(CashSummaryScreen));

    await waitFor(() =>
      expect(screen.getByText("নগদ সারসংক্ষেপ")).toBeTruthy(),
    );
    expect(
      screen.getByText(/শুরু .*বিক্রি .*আদায় .*খরচ .*উত্তোলন/),
    ).toBeTruthy();
  });

  it("reloads after a successful sync completion only through the focused subscription", async () => {
    useSessionStore.getState().login(OWNER);
    render(createElement(CashSummaryScreen));
    await waitFor(() => expect(deps.getCashBreakdown).toHaveBeenCalledTimes(1));

    await act(async () => {
      focusMock.callback?.();
    });
    await waitFor(() => expect(deps.getCashBreakdown).toHaveBeenCalledTimes(2));
    expect(deps.subscribeToSyncCompletion).toHaveBeenCalledWith(
      SHOP_ID,
      expect.any(Function),
    );

    const listener = deps.subscribeToSyncCompletion.mock
      .calls[0]?.[1] as () => Promise<void>;
    await act(async () => {
      await listener();
    });
    expect(deps.getCashBreakdown).toHaveBeenCalledTimes(3);
    const unsubscribe = deps.subscribeToSyncCompletion.mock.results[0]?.value;
    unsubscribe?.();
  });

  // The write itself can never commit under a stale actor — db/cash.ts's
  // assertSessionLive re-checks this INSIDE the transaction, proven
  // independently by db/user-switch.sqlite.test.ts. What differs from the
  // pre-B3 inline-input screen: OpeningCashModal is a shared, presentational
  // component that closes/clears its own local field on any non-throwing
  // resolution of onSubmit, since it has no notion of session staleness.
  // handleSaveOpeningCash intentionally returns (not throws) on a stale
  // write, so the modal closes rather than surfacing a raw error to
  // whichever actor happens to be looking at the screen next — a deliberate
  // trade documented in this session's DEVIATIONS.
  it("cannot commit under the outgoing owner when the phone changes hands mid-write", async () => {
    const pending = deferred<void>();
    deps.setOpeningCash.mockReturnValueOnce(pending.promise);
    await openScreenAndModal();

    type("Or enter an amount", "500");
    clickText("Save Opening Cash");
    await waitFor(() => expect(deps.setOpeningCash).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    // db/cash.ts calls this as the transaction's first statement — the
    // write itself never commits under the stale actor.
    expect(livenessOf(deps.setOpeningCash)()).toBe(false);
    // getCashBreakdown is called twice: once on mount, and once more when
    // reload's useCallback identity changes on the OWNER's re-login (its
    // deps include `session`) and the mount effect re-fires — correctly
    // refetching under the RETURNING owner's now-valid session. What must
    // NOT happen is a THIRD call caused by the stale write's own guarded
    // reload(), which the guard.isStale() check above skips entirely.
    expect(deps.getCashBreakdown).toHaveBeenCalledTimes(2);
  });

  it("still saves and closes the modal on the owner normal path", async () => {
    deps.setOpeningCash.mockResolvedValue(undefined);
    await openScreenAndModal();

    type("Or enter an amount", "500");
    await act(async () => {
      clickText("Save Opening Cash");
    });

    expect(deps.setOpeningCash).toHaveBeenCalledTimes(1);
    expect(deps.setOpeningCash.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      staffId: OWNER_ID,
    });
    expect(livenessOf(deps.setOpeningCash)()).toBe(true);
    await waitFor(() =>
      expect(screen.queryByLabelText("Or enter an amount")).toBeNull(),
    );
  });

  it("keeps Save disabled for an explicit zero on the Cash Summary edit flow", async () => {
    await openScreenAndModal();
    type("Or enter an amount", "0");
    expect(
      screen.getByText("Save Opening Cash").closest("button")?.disabled,
    ).toBe(true);
    expect(deps.setOpeningCash).not.toHaveBeenCalled();
  });
});

describe("cash-summary: withdraw (via WithdrawSheet, B3 Group 2)", () => {
  async function openSheet(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(CashSummaryScreen));
    await waitFor(() => expect(screen.getByText("Withdraw")).toBeTruthy());
    await act(async () => {
      clickText("Withdraw");
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Note (optional)")).toBeTruthy(),
    );
  }

  it("cannot commit under the outgoing owner when the phone changes hands mid-write", async () => {
    const pending = deferred<void>();
    deps.recordWithdrawal.mockReturnValueOnce(pending.promise);
    await openSheet();

    type("Withdraw", "750");
    clickText("Save");
    await waitFor(() => expect(deps.recordWithdrawal).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.recordWithdrawal)()).toBe(false);
    // See the equivalent opening-cash test above: 2 is mount + the OWNER's
    // re-login refresh, not a leak from the stale write's guarded reload.
    expect(deps.getCashBreakdown).toHaveBeenCalledTimes(2);
  });

  it("still withdraws and closes the sheet on the owner normal path", async () => {
    deps.recordWithdrawal.mockResolvedValue({ paymentId: "p1" });
    await openSheet();

    type("Withdraw", "750");
    await act(async () => {
      clickText("Save");
    });

    expect(deps.recordWithdrawal.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      staffId: OWNER_ID,
    });
    expect(livenessOf(deps.recordWithdrawal)()).toBe(true);
    await waitFor(() =>
      expect(screen.queryByLabelText("Note (optional)")).toBeNull(),
    );
  });
});

describe("cash-summary: mid-day reconcile (D-2, B3 Group 2)", () => {
  async function openScreen(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(CashSummaryScreen));
    await waitFor(() =>
      expect(
        screen.getByLabelText("How much cash is actually in the drawer?"),
      ).toBeTruthy(),
    );
  }

  it("cannot commit under the outgoing owner when the phone changes hands mid-write", async () => {
    const pending = deferred<void>();
    deps.reconcileCashDrawer.mockReturnValueOnce(pending.promise);
    await openScreen();

    type("How much cash is actually in the drawer?", "900");
    clickText("Reconcile");
    await waitFor(() =>
      expect(deps.reconcileCashDrawer).toHaveBeenCalledTimes(1),
    );

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.reconcileCashDrawer)()).toBe(false);
    // See the equivalent opening-cash test above: 2 is mount + the OWNER's
    // re-login refresh, not a leak from the stale write's guarded reload.
    expect(deps.getCashBreakdown).toHaveBeenCalledTimes(2);
  });

  it("still reconciles on the owner normal path", async () => {
    deps.reconcileCashDrawer.mockResolvedValue({
      status: "match",
      countedCash: asPaisa(900),
      expectedCash: asPaisa(900),
      diff: asPaisa(0),
    });
    await openScreen();

    type("How much cash is actually in the drawer?", "900");
    await act(async () => {
      clickText("Reconcile");
    });

    expect(deps.reconcileCashDrawer.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      staffId: OWNER_ID,
    });
    expect(livenessOf(deps.reconcileCashDrawer)()).toBe(true);
  });
});

describe("expenses: record expense", () => {
  // B3 Group 3: Quick Log's amount field is a keypad-driven display (EX-5/
  // EX-7), not a text input — "typing" 250 means pressing the 2/5/0 keys,
  // and the field's value is read off the rendered "৳ 250" text rather than
  // an <input>'s .value (mirrors valueOf's old TextInput-based check). Keyed
  // by accessibilityLabel, not visible text: a bare "0" is ambiguous with
  // the summary strip's zero-entries count, which carries no label at all.
  function pressDigits(digits: string): void {
    for (const digit of digits) {
      fireEvent.click(screen.getByLabelText(digit));
    }
  }

  async function openScreen(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(ExpensesScreen));
    await waitFor(() => expect(screen.getByText("Log Expense")).toBeTruthy());
  }

  it("cannot commit or clear the form when the phone changes hands mid-write", async () => {
    const pending = deferred<void>();
    deps.recordExpense.mockReturnValueOnce(pending.promise);
    await openScreen();

    pressDigits("250");
    clickText("Log Expense");
    await waitFor(() => expect(deps.recordExpense).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.recordExpense)()).toBe(false);
    expect(screen.getByText("৳ 250")).toBeTruthy();
  });

  it("still saves and clears on the owner normal path", async () => {
    deps.recordExpense.mockResolvedValue(undefined);
    await openScreen();

    pressDigits("250");
    await act(async () => {
      clickText("Log Expense");
    });

    expect(deps.recordExpense.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      staffId: OWNER_ID,
    });
    expect(livenessOf(deps.recordExpense)()).toBe(true);
    expect(screen.getByText("৳ 0")).toBeTruthy();
  });
});

describe("end-of-day: close the day", () => {
  async function openScreen(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(EndOfDayScreen));
    await waitFor(() =>
      expect(screen.getByLabelText("Counted cash amount")).toBeTruthy(),
    );
  }

  it("cannot lock the day or clear the form when the phone changes hands mid-write", async () => {
    const pending = deferred<void>();
    deps.closeDay.mockReturnValueOnce(pending.promise);
    await openScreen();

    type("Counted cash amount", "1200");
    clickText("Close the day");
    await waitFor(() => expect(deps.closeDay).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.closeDay)()).toBe(false);
    expect(valueOf("Counted cash amount")).toBe("1200");
  });

  it("still closes and clears on the owner normal path", async () => {
    deps.closeDay.mockResolvedValue(undefined);
    await openScreen();

    type("Counted cash amount", "1200");
    await act(async () => {
      clickText("Close the day");
    });

    expect(deps.closeDay.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      closedBy: OWNER_ID,
    });
    expect(livenessOf(deps.closeDay)()).toBe(true);
    expect(valueOf("Counted cash amount")).toBe("");
  });
});

describe("credit-sales: create customer", () => {
  async function openForm(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(CreditSalesScreen));
    await waitFor(() =>
      expect(deps.listCustomersWithBalance).toHaveBeenCalledTimes(1),
    );
    // B3 Group 4: the "Add customer" text button was replaced by a "+" icon
    // button in the header, labeled for accessibility rather than by text.
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add customer"));
    });
    type("Customer name", "Rahim Uddin");
  }

  // react-hook-form awaits its zod resolver BEFORE handleCreate runs, so a
  // handover can land in that gap. This is the one screen where the write is
  // provably never reached at all.
  it("never reaches the database when the handover lands in the resolver gap", async () => {
    deps.createCustomer.mockResolvedValue(undefined);
    await openForm();

    clickText("Save customer");
    act(() => switchUser());
    act(() => useSessionStore.getState().login(STAFF));
    await act(async () => {
      await Promise.resolve();
    });

    expect(deps.createCustomer).not.toHaveBeenCalled();
  });

  it("cannot commit or close the form when the phone changes hands mid-write", async () => {
    const pending = deferred<void>();
    deps.createCustomer.mockReturnValueOnce(pending.promise);
    await openForm();

    await act(async () => {
      clickText("Save customer");
    });
    expect(deps.createCustomer).toHaveBeenCalledTimes(1);

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.createCustomer)()).toBe(false);
    // reset() + setIsAdding(false) is this screen's success signal. The form
    // is still open, still holding what the outgoing owner typed.
    expect(valueOf("Customer name")).toBe("Rahim Uddin");
  });

  it("still saves and closes the form on the owner normal path", async () => {
    deps.createCustomer.mockResolvedValue(undefined);
    await openForm();

    await act(async () => {
      clickText("Save customer");
    });

    expect(deps.createCustomer.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      actorUserId: OWNER_ID,
    });
    expect(livenessOf(deps.createCustomer)()).toBe(true);
    await waitFor(() =>
      expect(screen.queryByLabelText("Customer name")).toBeNull(),
    );
  });
});

describe("credit/customer-detail: collect payment", () => {
  // B3 Group 4: the always-visible "Collection amount" input was replaced by
  // a "Make Payment" button that opens PaymentSheet — open the screen, then
  // open the sheet, before the field exists in the DOM.
  async function openScreen(): Promise<void> {
    routerMock.params.value = { customerId: CUSTOMER_ID };
    useSessionStore.getState().login(OWNER);
    render(createElement(CustomerDetailScreen));
    await waitFor(() => expect(screen.getByText("Make Payment")).toBeTruthy());
    clickText("Make Payment");
    await waitFor(() =>
      expect(screen.getByLabelText("Payment amount")).toBeTruthy(),
    );
  }

  it("cannot commit or navigate when the phone changes hands mid-write", async () => {
    const pending = deferred<void>();
    deps.collectPayment.mockReturnValueOnce(pending.promise);
    await openScreen();

    type("Payment amount", "300");
    clickText("Confirm Payment");
    await waitFor(() => expect(deps.collectPayment).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    // The closure passed to collectPayment must report the OUTGOING owner's
    // session as stale — the core money-safety property this suite exists
    // to protect, regardless of how the sheet's own optimistic-close UI
    // behaves once the (mocked) write appears to succeed.
    expect(livenessOf(deps.collectPayment)()).toBe(false);
  });

  it("still collects on the owner normal path and closes the sheet", async () => {
    deps.collectPayment.mockResolvedValue(undefined);
    await openScreen();

    type("Payment amount", "300");
    await act(async () => {
      clickText("Confirm Payment");
    });

    expect(deps.collectPayment.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      staffId: OWNER_ID,
      customerId: CUSTOMER_ID,
    });
    expect(livenessOf(deps.collectPayment)()).toBe(true);
    await waitFor(() =>
      expect(screen.queryByLabelText("Payment amount")).toBeNull(),
    );
  });
});

describe("suppliers/purchase-create: save purchase", () => {
  async function openScreenWithOneLine(): Promise<void> {
    useSessionStore.getState().login(OWNER);
    render(createElement(PurchaseCreateScreen));
    // 3-step stepper: Method -> Review -> Confirm. "Manual Entry" reaches
    // Review directly (no scanner involved).
    clickText("Manual Entry");
    await waitFor(() => expect(deps.listSuppliers).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText(/search medicine/i), {
      target: { value: "Napa" },
    });
    await waitFor(() => expect(screen.getByText("Napa")).toBeTruthy());
    clickText("Napa");

    type("Batch number", "B-100");
    type("Expiry date", "2099-01-01");
    type("Quantity", "10");
    type("Purchase price (৳)", "5");
    type("Sale price (৳)", "8");
    await act(async () => {
      clickText("Add line");
    });
    await act(async () => {
      clickText("Continue");
    });
  }

  it("cannot commit or navigate when the phone changes hands mid-write", async () => {
    const pending = deferred<void>();
    deps.createPurchase.mockReturnValueOnce(pending.promise);
    await openScreenWithOneLine();

    clickText("✓ Confirm Invoice");
    await waitFor(() => expect(deps.createPurchase).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      pending.resolve();
    });

    expect(livenessOf(deps.createPurchase)()).toBe(false);
    // The outgoing owner's supplier page must not land on the incoming user.
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("shows no stale error to the incoming user when a failed write lands late", async () => {
    let rejectCommit: (reason: unknown) => void = () => undefined;
    deps.createPurchase.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectCommit = reject;
      }),
    );
    await openScreenWithOneLine();

    clickText("✓ Confirm Invoice");
    await waitFor(() => expect(deps.createPurchase).toHaveBeenCalledTimes(1));

    ownerLendsPhoneAndTakesItBack();
    await act(async () => {
      rejectCommit(new Error("Supplier is no longer available."));
    });

    expect(screen.queryByText("Supplier is no longer available.")).toBeNull();
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("still saves and navigates to Invoice Detail on the owner normal path", async () => {
    deps.createPurchase.mockResolvedValue({ purchaseId: "new-purchase-id", invoiceNo: "PUR-2026-000001-ABCDEF", total: 5000 });
    await openScreenWithOneLine();

    await act(async () => {
      clickText("✓ Confirm Invoice");
    });

    expect(deps.createPurchase.mock.calls[0]?.[0]).toMatchObject({
      shopId: SHOP_ID,
      staffId: OWNER_ID,
      supplierId: SUPPLIER_ID,
    });
    expect(livenessOf(deps.createPurchase)()).toBe(true);
    expect(routerMock.replace).toHaveBeenCalledWith({
      pathname: "/suppliers/invoice-detail",
      params: { purchaseId: "new-purchase-id" },
    });
  });
});
