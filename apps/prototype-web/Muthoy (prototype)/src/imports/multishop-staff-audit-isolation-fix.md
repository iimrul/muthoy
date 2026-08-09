# Muthoy (মুঠোয়) — Fix Multi-Shop Staff Sales / Audit Isolation

## The contradiction (root cause found)
StaffSalesView and the per-staff activity come from `useAuditLog()` (AuditLogContext).
That context reads/writes the audit log with RAW `localStorage`, NOT `shopStorage`:

  const STORAGE_KEY = "auditLogs";        // line 36
  const ARCHIVED_KEY = "archivedStaffIds";
  localStorage.getItem(STORAGE_KEY)       // line 46 — NOT shop-scoped
  localStorage.setItem(STORAGE_KEY, ...)  // line 67

So even though `auditLogs` IS in shopStorage's SCOPED_KEYS, the context bypasses
shopStorage entirely — meaning every shop shares ONE global audit log. When the owner
switches to a particular shop, StaffSalesView still shows staff sales/activity from
ALL shops mixed together. That's the contradiction.

(staffPerformance.ts and StaffManagement.tsx already use shopStorage correctly — only
the audit log context is leaking.)

## FIX 1 — Route AuditLogContext through shopStorage
In `contexts/AuditLogContext.tsx`, replace every raw `localStorage` call for the
audit log and archived staff with `shopStorage`:

  import { shopStorage } from "../utils/shopStorage";

  // reads
  const raw = shopStorage.getItem(STORAGE_KEY);
  const archived = JSON.parse(shopStorage.getItem(ARCHIVED_KEY) || "[]");
  // writes
  shopStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  shopStorage.setItem(ARCHIVED_KEY, JSON.stringify(archived));

Add `archivedStaffIds` to SCOPED_KEYS in shopStorage.ts (auditLogs is already there)
so it namespaces per shop too.

## FIX 2 — Reload the audit log when the active shop changes
The context loads once on mount. After switching shops it must reload from the new
shop's namespace. In AuditLogContext, add a listener:

  useEffect(() => {
    const reload = () => setLogs(JSON.parse(shopStorage.getItem(STORAGE_KEY) || "[]"));
    window.addEventListener("activeShopChanged", reload);
    return () => window.removeEventListener("activeShopChanged", reload);
  }, []);

So when the owner switches shops, the staff sales / audit list re-reads that shop's
data and the StaffSalesView updates.

## FIX 3 — Verify every staff/stats surface is shop-scoped
After Fix 1-2, audit these read from the ACTIVE shop only:
- StaffSalesView (via useAuditLog) — now scoped.
- StaffManagement performance (staffPerformance.ts) — already scoped (transactions).
- Staff list (staffMembers) — already scoped.
- Per-staff totals, transaction counts, discounts, refunds — all derive from the
  now-scoped audit log + transactions.

## VERIFY (the exact contradiction)
1. Shop A: staff Arif records 3 sales. Shop B: staff Karim records 2 sales.
2. Switch to Shop A -> StaffSalesView shows ONLY Arif's 3 sales. Karim does not appear.
3. Switch to Shop B -> shows ONLY Karim's 2 sales. Arif does not appear.
4. Per-staff stats, audit log entries, and staff lists each reflect ONLY the active
   shop. No cross-shop bleed anywhere.
5. Switching shops live updates the view without needing a reload.

## What not to change
- shopStorage namespacing scheme, the scoped-key list (just add archivedStaffIds).
- staffPerformance.ts / StaffManagement.tsx (already correct).
- The audit log data shape or any logging call sites.
