// Single interception point that namespaces localStorage by active shop.
// Screens call shopStorage.getItem("medicines") — it transparently reads
// `${activeShopId}__medicines`. Switching shops swaps the entire dataset
// without any screen changes.

import { getActiveShopId } from "./shopManager";

// Keys whose value is per-shop. Everything else (auth, owner account,
// app settings, printer config, shopRegistry itself) is global.
export const SCOPED_KEYS = new Set([
  "medicines",
  "transactions",
  "customers",
  "creditData",
  "expenses",
  "inventory",
  "suppliers",
  "supplierInvoices",
  "supplierPayments",
  "cashDrawer",
  "cashOpening",
  "cashWithdrawals",
  "cashActualCounts",
  "dailyHistory",
  "settledCreditHistory",
  "auditLogs",
  "archivedStaffIds",
  "staffMembers",
  "deletedMedicineIds",
  "lastCompletedDay",
  "scannedMedicineData",
  "lastPaymentAllocation",
  "reportSettings",
  "yesterdaySummaryShownDate",
  "openingCashShownDate",
]);

export function scopedKey(key: string): string {
  if (SCOPED_KEYS.has(key)) {
    return `${getActiveShopId()}__${key}`;
  }
  return key;
}

export const shopStorage = {
  getItem(key: string): string | null {
    return localStorage.getItem(scopedKey(key));
  },
  setItem(key: string, value: string): void {
    localStorage.setItem(scopedKey(key), value);
  },
  removeItem(key: string): void {
    localStorage.removeItem(scopedKey(key));
  },
  scopedKey,
};

// Helper for the cross-shop summary screen — read a scoped key for a
// specific shop id without changing the active shop.
export function readShopKey(shopId: string, key: string): string | null {
  return localStorage.getItem(`${shopId}__${key}`);
}
