# Fix Prompt — Staff Add Bug + Inventory/Sale Sync
**File:** `Portable_POS_v5` · 3 targeted fixes

---

## Bug 1 — Add Staff: Fields Work But Staff Never Appears in List

### Root Cause
`handleAddStaff` in `StaffManagement.tsx` calls `loadStaff()` after writing to localStorage, but **`loadStaff` reads directly from localStorage without invalidating `storageCache`**. The modal itself uses `sanitizeMobile()` in `goNext()` but **re-sanitizes again in `handleFinish()`** — if sanitization produces a different result the second time, the duplicate-phone check in `goNext()` passes with the original string, but `handleFinish()` saves a different phone string. This means it silently saves with a mismatched phone and the component re-renders with stale state.

There is also **no `loadStaff` call after the modal closes** — if the modal's `onAdd` callback fires correctly but React state hasn't flushed, the list looks unchanged until the user navigates away and back.

### Fix — 3 changes

**1. `src/app/components/AddStaffModal.tsx` — `handleFinish()`**

Remove the second `sanitizeMobile` call. Use the already-sanitized `phone` state that was validated in Step 1:

```tsx
// BEFORE
const handleFinish = () => {
  setError("");
  const sanitized = sanitizeMobile(phone);   // ← REMOVE this line
  const newStaff = {
    ...
    phone: sanitized,                         // ← causes mismatch
```

```tsx
// AFTER
const handleFinish = () => {
  setError("");
  const newStaff = {
    id: Date.now(),
    name: name.trim(),
    phone,          // already sanitized during Step 1 validation
    role,
    roleBn: role === "Manager" ? "ম্যানেজার" : "ক্যাশিয়ার",
    pin,
    active: true,
    permissions,
    createdAt: new Date().toISOString(),
  };
  onAdd(newStaff);
  handleClose();
};
```

**2. `src/app/screens/StaffManagement.tsx` — `handleAddStaff()`**

After writing to localStorage, dispatch a storage event so React state refreshes reliably, and call `loadStaff()`:

```tsx
// BEFORE
const handleAddStaff = (newStaff: any) => {
  const list = JSON.parse(localStorage.getItem("staffMembers") || "[]");
  list.push(newStaff);
  localStorage.setItem("staffMembers", JSON.stringify(list));
  loadStaff();
};
```

```tsx
// AFTER
const handleAddStaff = (newStaff: any) => {
  const list = JSON.parse(localStorage.getItem("staffMembers") || "[]");
  list.push(newStaff);
  localStorage.setItem("staffMembers", JSON.stringify(list));
  // Force same-tab React state refresh
  window.dispatchEvent(new StorageEvent("storage", { key: "staffMembers" }));
  loadStaff();
};
```

**3. `src/app/screens/StaffManagement.tsx` — add storage listener in `useEffect`**

```tsx
useEffect(() => {
  loadStaff();
  const handleStorage = (e: StorageEvent) => {
    if (e.key === "staffMembers" || e.key === null) loadStaff();
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}, []);
```

---

## Bug 2 — Inventory Changes Not Syncing to Sale Page (Same Session)

### Root Cause
`storageCache` in `src/app/utils/performance.ts` is a **module-level singleton with a 5-second TTL**. When any screen calls `saveMedicines()`, it updates the cache correctly. But `SaleEntry.tsx` only reloads medicines on:
- Initial mount (`[]` dependency)
- `visibilitychange` event (tab focus)

It **never listens for a `storage` event**. So when Inventory adds/edits a medicine and the user switches to the Sale screen *without* hiding/showing the tab (e.g., navigating via the bottom nav in the same SPA), `SaleEntry` keeps serving the old in-memory React state — the cache was updated but `rawMedicines` state was not.

Same issue in `Inventory.tsx`: it only reloads on `location.pathname` change — it won't catch an update made by another screen if the pathname didn't change.

### Fix — 2 changes

**1. `src/app/utils/medicineData.ts` — `saveMedicines()` must dispatch a storage event**

```ts
// BEFORE
export const saveMedicines = (medicines: Medicine[]) => {
  localStorage.setItem("medicines", JSON.stringify(medicines));
  storageCache.set("medicines", medicines);
};
```

```ts
// AFTER
export const saveMedicines = (medicines: Medicine[]) => {
  localStorage.setItem("medicines", JSON.stringify(medicines));
  storageCache.set("medicines", medicines);
  // Notify all screens in the same tab that medicines changed
  window.dispatchEvent(new StorageEvent("storage", { key: "medicines" }));
};
```

**2. `src/app/screens/SaleEntry.tsx` — add storage event listener**

```tsx
// BEFORE — only listens to visibilitychange
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      setRawMedicines(getMedicines());
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, []);
```

```tsx
// AFTER — also listens for storage events (fired by saveMedicines)
useEffect(() => {
  const reload = () => {
    storageCache.invalidate("medicines");
    setRawMedicines(getMedicines());
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') reload();
  };
  const handleStorage = (e: StorageEvent) => {
    if (e.key === "medicines" || e.key === null) reload();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('storage', handleStorage);
  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('storage', handleStorage);
  };
}, []);
```

---

## Bug 3 — Staff Inventory and Sale Pages Show Stale Data

### Root Cause
This is the same `storageCache` TTL problem, but from the **staff session's perspective**. When a staff member is on `SaleEntry` and the owner (in the same browser, same tab) adds a medicine via `AddMedicine`, `saveMedicines()` updates the cache and localStorage — but the staff's `SaleEntry` component's React state (`rawMedicines`) is never told to re-render.

Additionally, `Inventory.tsx` only reloads medicines on `location.pathname` change — if a staff member is already on `/app/inventory` and the owner adds a medicine, the inventory list never refreshes because the pathname didn't change.

### Fix — 1 change (covers both owner and staff for Inventory)

**`src/app/screens/Inventory.tsx` — add storage event listener alongside the existing pathname reload**

```tsx
// BEFORE
useEffect(() => {
  setMedicines(getMedicines());
}, [location.pathname]);
```

```tsx
// AFTER
useEffect(() => {
  setMedicines(getMedicines());
}, [location.pathname]);

useEffect(() => {
  const handleStorage = (e: StorageEvent) => {
    if (e.key === "medicines" || e.key === null) {
      storageCache.invalidate("medicines");
      setMedicines(getMedicines());
    }
  };
  window.addEventListener("storage", handleStorage);
  return () => window.removeEventListener("storage", handleStorage);
}, []);
```

> **Note:** You need to import `storageCache` in `Inventory.tsx` if not already imported:
> ```tsx
> import { getMedicines, saveMedicines, ... } from "../utils/medicineData";
> import { storageCache } from "../utils/performance";  // add this
> ```

---

## Summary of All Changes

| File | Change | Fixes |
|---|---|---|
| `components/AddStaffModal.tsx` | Remove duplicate `sanitizeMobile()` in `handleFinish` | Bug 1 — staff save phone mismatch |
| `screens/StaffManagement.tsx` | Dispatch `storage` event after add; add storage listener | Bug 1 — list not refreshing |
| `utils/medicineData.ts` | Dispatch `storage` event inside `saveMedicines()` | Bugs 2 & 3 — single source of truth broadcast |
| `screens/SaleEntry.tsx` | Add `storage` event listener to reload medicines | Bug 2 — sale page stays stale |
| `screens/Inventory.tsx` | Add `storage` event listener to reload medicines | Bug 3 — staff/owner inventory stays stale |

**Total files changed: 5. No new dependencies. No data model changes.**

---

## Why `window.dispatchEvent(new StorageEvent(...))` Works Here

The native `storage` event only fires on *other* tabs, not the originating tab. Since this is a single-page app where owner and staff both run in the **same tab**, manually dispatching the event on `window` is the correct pattern to notify all mounted components in the same session. `MorningDashboard.tsx` already uses this pattern for `supplierInvoices` — this fix applies it consistently to `medicines` and `staffMembers`.
