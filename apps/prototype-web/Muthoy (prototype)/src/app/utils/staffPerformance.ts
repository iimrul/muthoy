/**
 * Staff Performance Tracker Utility
 *
 * Calculates per-seller sales metrics from the canonical `transactions`
 * store. Each transaction is attributed via its `soldBy` field; legacy
 * rows without one are treated as owner sales (see resolveSoldBy).
 */

import { resolveSoldBy, type SoldBy } from "./soldBy";
import { shopStorage } from "./shopStorage";

export interface StaffSalesData {
  staffId: string | number;
  staffName: string;
  staffPhone: string;
  totalSales: number;
  transactionCount: number;
  averageSaleValue: number;
  lastSaleDate: string | null;
}

export interface OwnerSalesData {
  totalSales: number;
  transactionCount: number;
  averageSaleValue: number;
  lastSaleDate: string | null;
}

function readTransactions(): any[] {
  try {
    return JSON.parse(shopStorage.getItem("transactions") || "[]");
  } catch {
    return [];
  }
}

function isCountableSale(txn: any): boolean {
  // Held/cancelled rows live in the same store but shouldn't count as sales.
  if (txn?.isDeleted) return false;
  if (txn?.status === "hold" || txn?.status === "cancelled") return false;
  return true;
}

function isSameLocalDay(iso: string, target: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === target.getFullYear() &&
    d.getMonth() === target.getMonth() &&
    d.getDate() === target.getDate()
  );
}

function aggregateByStaff(rows: any[]): StaffSalesData[] {
  const map = new Map<string | number, StaffSalesData>();

  for (const txn of rows) {
    if (!isCountableSale(txn)) continue;
    const seller: SoldBy = resolveSoldBy(txn);
    if (seller.type !== "staff") continue;

    const existing = map.get(seller.id) ?? {
      staffId: seller.id,
      staffName: seller.name,
      staffPhone: seller.phone,
      totalSales: 0,
      transactionCount: 0,
      averageSaleValue: 0,
      lastSaleDate: null as string | null,
    };

    existing.totalSales += txn.total || 0;
    existing.transactionCount += 1;
    if (!existing.lastSaleDate || new Date(txn.timestamp) > new Date(existing.lastSaleDate)) {
      existing.lastSaleDate = txn.timestamp;
    }
    map.set(seller.id, existing);
  }

  const result = Array.from(map.values()).map((r) => ({
    ...r,
    averageSaleValue: r.transactionCount > 0 ? r.totalSales / r.transactionCount : 0,
  }));
  result.sort((a, b) => b.totalSales - a.totalSales);
  return result;
}

export function getStaffPerformance(): StaffSalesData[] {
  return aggregateByStaff(readTransactions());
}

export function getOwnerPerformance(): OwnerSalesData {
  let totalSales = 0;
  let transactionCount = 0;
  let lastSaleDate: string | null = null;

  for (const txn of readTransactions()) {
    if (!isCountableSale(txn)) continue;
    if (resolveSoldBy(txn).type !== "owner") continue;
    totalSales += txn.total || 0;
    transactionCount += 1;
    if (!lastSaleDate || new Date(txn.timestamp) > new Date(lastSaleDate)) {
      lastSaleDate = txn.timestamp;
    }
  }

  return {
    totalSales,
    transactionCount,
    averageSaleValue: transactionCount > 0 ? totalSales / transactionCount : 0,
    lastSaleDate,
  };
}

export function getStaffPerformanceById(staffId: string | number): StaffSalesData | null {
  return getStaffPerformance().find((s) => s.staffId === staffId) ?? null;
}

export function getTotalStaffSales(): number {
  return getStaffPerformance().reduce((sum, s) => sum + s.totalSales, 0);
}

export function getTopStaff(): StaffSalesData | null {
  const perf = getStaffPerformance();
  return perf.length > 0 ? perf[0] : null;
}

export function getStaffPerformanceByDateRange(
  startDate: string,
  endDate: string
): StaffSalesData[] {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return aggregateByStaff(
    readTransactions().filter((t) => {
      const ts = new Date(t.timestamp).getTime();
      return ts >= start && ts <= end;
    })
  );
}

// ── Today-scoped helpers (used by Owner Dashboard active-staff strip
//    and the Staff Home shift summary) ───────────────────────────────

export function getStaffPerformanceToday(target: Date = new Date()): StaffSalesData[] {
  return aggregateByStaff(readTransactions().filter((t) => isSameLocalDay(t.timestamp, target)));
}

export function getStaffPerformanceForStaff(
  staffId: string | number,
  target: Date = new Date()
): StaffSalesData | null {
  return (
    getStaffPerformanceToday(target).find((s) => String(s.staffId) === String(staffId)) ?? null
  );
}

// Today's totals split by seller type — used by the cash drawer breakdown.
export function getTodaySalesSplit(target: Date = new Date()): {
  ownerSales: number;
  staffSales: number;
  ownerCash: number;
  staffCash: number;
} {
  let ownerSales = 0,
    staffSales = 0,
    ownerCash = 0,
    staffCash = 0;

  for (const txn of readTransactions()) {
    if (!isCountableSale(txn)) continue;
    if (!isSameLocalDay(txn.timestamp, target)) continue;

    const seller = resolveSoldBy(txn);
    const total = txn.total || 0;
    const cashPart =
      txn.paymentMethod === "cash"
        ? total
        : txn.paymentMethod === "split"
        ? txn.partialPaidAmount || 0
        : 0;

    if (seller.type === "owner") {
      ownerSales += total;
      ownerCash += cashPart;
    } else {
      staffSales += total;
      staffCash += cashPart;
    }
  }

  return { ownerSales, staffSales, ownerCash, staffCash };
}
