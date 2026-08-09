Portable POS — Fix Multi-Shop Data Isolation
The storage layer is correct. The bug is the cache and missing reload.
After review: every file correctly uses shopStorage for scoped keys. There are
ZERO raw-localStorage leaks. The cross-shop mess comes from TWO specific bugs.
Fix both. Do not change the storage layer or any screen's logic.

ROOT CAUSE 1 — storageCache ignores the active shop (THE MAIN BUG)
medicineData.ts (and any other file using storageCache from performance.ts)
caches data under the bare key name, e.g. storageCache.get("medicines"). This
cache is NOT shop-aware. When the owner switches from shop_1 to shop_2, the cache
still holds shop_1's medicines under the key "medicines" and returns them —
showing the wrong shop's inventory. The cache is the leak, not storage.
Fix: make storageCache shop-aware
In performance.ts, the storageCache get/set/invalidate must namespace the cache
key by the active shop id — exactly like shopStorage does.
tsimport { getActiveShopId } from "./shopManager";

function cacheKey(key: string): string {
  // Scoped keys get shop-prefixed cache entries so shop_1 and shop_2
  // never share a cached value.
  const SCOPED = new Set([
    "medicines","transactions","customers","creditData","expenses",
    "inventory","suppliers","supplierInvoices","supplierPayments","cashDrawer",
    "dailyHistory","settledCreditHistory","auditLogs","staffMembers",
    "deletedMedicineIds","reportSettings",
  ]);
  return SCOPED.has(key) ? `${getActiveShopId()}__${key}` : key;
}

// Apply cacheKey(key) inside get(), set(), and invalidate().
This guarantees shop_1's cached medicines live under shop_1__medicines in the
cache, and shop_2's under shop_2__medicines — they can never cross.

ROOT CAUSE 2 — only the dashboard reloads on shop switch
setActiveShopId() dispatches an activeShopChanged event, but only
MorningDashboard.tsx listens for it. Every other screen — Inventory, Expense
Tracking, Suppliers, Supplier Invoices, Staff Management, Credit Sales, Reports —
keeps showing the previous shop's data until you leave and return.
Fix: clear the cache and reload on shop switch, app-wide
Step A — In setActiveShopId() in shopManager.ts, clear the entire
storageCache before dispatching the event, so no stale shop data survives the switch:
tsexport function setActiveShopId(id: string): void {
  localStorage.setItem(ACTIVE_SHOP_KEY, id);
  storageCache.clear();                 // drop ALL cached data
  window.dispatchEvent(new Event("activeShopChanged"));
}
(Import storageCache; if it has no clear(), add one that empties the whole cache map.)
Step B — Add a tiny reusable hook useActiveShop() that any data screen calls to
re-run its loader when the shop changes:
ts// src/app/hooks/useActiveShopReload.ts
import { useEffect } from "react";

// Calls `reload` whenever the active shop changes.
export function useActiveShopReload(reload: () => void) {
  useEffect(() => {
    window.addEventListener("activeShopChanged", reload);
    return () => window.removeEventListener("activeShopChanged", reload);
  }, [reload]);
}
Step C — In every data screen, call it with that screen's existing load function.
For example in Inventory.tsx:
tsuseActiveShopReload(loadMedicines);   // loadMedicines already exists
Apply the same one-liner to: Inventory, ExpenseTracking, Suppliers,
SupplierInvoices, SupplierDetail, StaffManagement, CreditSales,
Report, MonthlyReport, EndOfDay, SaleEntry. Use whatever each screen's
existing data-loading function is named — do not write new load logic, just
re-trigger the existing one on shop change.

ROOT CAUSE 3 — migration order (minor, fix while here)
In runMigrations(), migrateToMultiShop() runs LAST, after the supplier/staff
migrations have already read and rewritten the flat keys. Move multishop FIRST so
the flat data is namespaced into shop_1__ before the other migrations run. Then
the supplier/staff migrations operate on the correct shop-scoped data.
tsexport function runMigrations() {
  try { migrateToMultiShop(); } catch (e) { console.error(e); }      // FIRST now
  try { migrateSupplierGraphV1(); } catch (e) { console.error(e); }
  try { migratePaymentTermsV1(); } catch (e) { console.error(e); }
  try { migrateStaffPermissionsV2(); } catch (e) { console.error(e); }
}
But those three migrations use raw localStorage on flat keys. Since multishop now
moves data to shop_1__ first, update those three to read/write through
shopStorage instead of raw localStorage, so they migrate the active shop's data.

VERIFICATION AFTER FIX

Create shop_2. Switch to it. Inventory must be EMPTY (not shop_1's medicines).
Add a medicine in shop_2. Switch back to shop_1 — that medicine must NOT appear.
Record a sale in shop_2. Check shop_1's dashboard total is unaffected.
Add staff in shop_1. Switch to shop_2 — staff list must be empty.
Expenses, suppliers, invoices, credit — repeat the same isolation check.

Every one of these must show complete isolation. The data was always stored
correctly per-shop; these fixes make the CACHE and the SCREENS respect the switch.

WHAT NOT TO CHANGE

shopStorage.ts — it is correct
The per-shop storage namespacing — it is correct
Any screen's internal logic — only add the one useActiveShopReload(...) line
The shop registry, switcher UI, or settings — they work