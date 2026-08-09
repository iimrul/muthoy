// Daily cash reconciliation - pure calculation helpers.
// Local-first: all inputs read from localStorage on-demand.

import { getOpeningCash } from "./dailyOpeningCash";
import { shopStorage } from "../../utils/shopStorage";

export interface CashBreakdown {
  openingCash: number;
  cashSales: number;
  creditCollections: number;
  expenses: number;
  withdrawals: number;
  supplierPayments: number;
  expected: number;
}

export interface CashWithdrawal {
  id: string;
  amount: number;
  timestamp: string;
  note?: string;
  loggedBy?: string;
}

const STORAGE_KEYS = {
  withdrawals: "cashWithdrawals",
  actualCounts: "cashActualCounts",
} as const;

export function getDateKey(d: Date = new Date()): string {
  // YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameLocalDay(iso: string, target: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

export function getTodayCashSales(target: Date = new Date()): number {
  const txns = JSON.parse(shopStorage.getItem("transactions") || "[]");
  return txns
    .filter((t: any) => !t.isDeleted && sameLocalDay(t.timestamp, target))
    .reduce((sum: number, t: any) => {
      if (t.paymentMethod === "cash") return sum + (t.total || 0);
      if (t.paymentMethod === "split") return sum + (t.partialPaidAmount || 0);
      return sum;
    }, 0);
}

export function getTodayCreditCollections(target: Date = new Date()): number {
  const settled = JSON.parse(shopStorage.getItem("settledCreditHistory") || "[]");
  return settled
    .filter((s: any) => sameLocalDay(s.settlementTimestamp || s.settlementDate, target))
    .reduce((sum: number, s: any) => sum + (s.amount || 0), 0);
}

export function getTodayExpenses(target: Date = new Date()): number {
  const expenses = JSON.parse(shopStorage.getItem("expenses") || "[]");
  return expenses
    .filter((e: any) => sameLocalDay(e.timestamp, target))
    .reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
}

export function getAllWithdrawals(): CashWithdrawal[] {
  return JSON.parse(shopStorage.getItem(STORAGE_KEYS.withdrawals) || "[]");
}

export function getTodayWithdrawals(target: Date = new Date()): number {
  return getAllWithdrawals()
    .filter((w) => sameLocalDay(w.timestamp, target))
    .reduce((sum, w) => sum + (w.amount || 0), 0);
}

export function addWithdrawal(amount: number, note?: string, loggedBy?: string): CashWithdrawal {
  const list = getAllWithdrawals();
  const entry: CashWithdrawal = {
    id: Date.now().toString(),
    amount,
    timestamp: new Date().toISOString(),
    note,
    loggedBy,
  };
  list.push(entry);
  shopStorage.setItem(STORAGE_KEYS.withdrawals, JSON.stringify(list));
  return entry;
}

export function getTodaySupplierPayments(target: Date = new Date()): number {
  const invoices = JSON.parse(shopStorage.getItem("supplierInvoices") || "[]");
  let total = 0;

  for (const invoice of invoices) {
    const payments = invoice.payments || [];
    for (const payment of payments) {
      // payment.date is YYYY-MM-DD format, compare directly
      if (payment.date === getDateKey(target)) {
        total += payment.amount || 0;
      }
    }
  }

  return total;
}

export function getCashBreakdown(target: Date = new Date()): CashBreakdown {
  const openingCash = getOpeningCash(target) ?? 0;
  const cashSales = getTodayCashSales(target);
  const creditCollections = getTodayCreditCollections(target);
  const expenses = getTodayExpenses(target);
  const withdrawals = getTodayWithdrawals(target);
  const supplierPayments = getTodaySupplierPayments(target);

  // Expected = Opening + Cash Sales + Credit Collections - Expenses - Withdrawals - Supplier Payments
  // (Cash *coming in* adds, cash *going out* subtracts.)
  const expected =
    openingCash + cashSales + creditCollections - expenses - withdrawals - supplierPayments;

  return {
    openingCash,
    cashSales,
    creditCollections,
    expenses,
    withdrawals,
    supplierPayments,
    expected,
  };
}

// Actual counted cash (for end-of-day reconciliation)
export function getActualCash(target: Date = new Date()): number | null {
  const all = JSON.parse(shopStorage.getItem(STORAGE_KEYS.actualCounts) || "{}");
  const v = all[getDateKey(target)];
  return typeof v === "number" ? v : null;
}

export function setActualCash(value: number, target: Date = new Date()): void {
  const all = JSON.parse(shopStorage.getItem(STORAGE_KEYS.actualCounts) || "{}");
  all[getDateKey(target)] = value;
  shopStorage.setItem(STORAGE_KEYS.actualCounts, JSON.stringify(all));
}

export function getDifference(target: Date = new Date()): {
  diff: number;
  status: "match" | "surplus" | "shortage" | "unknown";
} {
  const actual = getActualCash(target);
  if (actual === null) return { diff: 0, status: "unknown" };
  const { expected } = getCashBreakdown(target);
  const diff = actual - expected;
  if (Math.abs(diff) < 0.5) return { diff: 0, status: "match" };
  return { diff, status: diff > 0 ? "surplus" : "shortage" };
}

// Event bus so cards/screens can reactively refresh without a router refresh.
export const CASH_UPDATED_EVENT = "cash:updated";
export function notifyCashUpdated() {
  window.dispatchEvent(new CustomEvent(CASH_UPDATED_EVENT));
}
