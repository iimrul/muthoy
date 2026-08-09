# Portable POS — Multi-Shop Management
## Implementation Prompt

This is a PREMIUM feature (FR-177 to FR-182). Implement it WITHOUT changing any
screen's logic or design. The entire feature is achieved through one storage
interception layer plus two small UI additions.

---

## THE CORE INSIGHT — WHY THIS IS CLEAN

Right now every screen reads/writes flat localStorage keys: `medicines`,
`transactions`, `customers`, `expenses`, `staffMembers`, etc. The app implicitly
assumes one shop.

To support multiple shops, we do NOT touch any screen. Instead we namespace the
storage keys by the active shop ID at one central point. When the active shop is
shop "A", `medicines` transparently reads/writes `shop_A_medicines`. When the owner
switches to shop "B", the same screens now read `shop_B_medicines` — completely
isolated, zero screen changes.

This works because data is already accessed through localStorage calls. We
intercept those calls in one place.

---

## STEP 1 — Create the shop registry and active-shop state

Add `src/app/utils/shopManager.ts`:

```ts
// A shop is just an id + name + metadata. The owner account owns the registry.
export interface Shop {
  id: string;          // "shop_1", "shop_2", ...
  name: string;
  nameEn: string;
  createdAt: string;
  isActive: boolean;   // soft-archive flag (FR-182)
}

const SHOPS_KEY = "shopRegistry";        // list of all shops (NOT namespaced)
const ACTIVE_SHOP_KEY = "activeShopId";  // which shop is currently selected

export function getShops(): Shop[] {
  try { return JSON.parse(localStorage.getItem(SHOPS_KEY) || "[]"); }
  catch { return []; }
}

export function getActiveShopId(): string {
  // Default to the first shop, or "shop_1" for existing single-shop users.
  return localStorage.getItem(ACTIVE_SHOP_KEY) || "shop_1";
}

export function setActiveShopId(id: string): void {
  localStorage.setItem(ACTIVE_SHOP_KEY, id);
}

export function addShop(name: string, nameEn: string): Shop {
  const shops = getShops();
  const shop: Shop = {
    id: `shop_${Date.now()}`,
    name, nameEn,
    createdAt: new Date().toISOString(),
    isActive: true,
  };
  shops.push(shop);
  localStorage.setItem(SHOPS_KEY, JSON.stringify(shops));
  return shop;
}
```

---

## STEP 2 — Create the namespaced storage adapter

Add `src/app/utils/shopStorage.ts`. This is the ONE interception point.

```ts
import { getActiveShopId } from "./shopManager";

// Keys that are SHOP-SCOPED (each shop has its own copy).
const SCOPED_KEYS = new Set([
  "medicines", "transactions", "customers", "creditData", "expenses",
  "inventory", "supplierInvoices", "supplierPayments", "cashDrawer",
  "dailyHistory", "settledCreditHistory", "auditLogs", "staffMembers",
  "deletedMedicineIds", "lastCompletedDay", "scannedMedicineData",
  "lastPaymentAllocation", "reportSettings",
]);

// Keys that are GLOBAL (shared across all shops — owner account, app settings).
// These are NOT scoped: currentUser, authType, owner, appSettings, backupKey,
// pharmacyRegistration, setupCompleted, shopRegistry, activeShopId, printerInfo.

function scopedKey(key: string): string {
  if (SCOPED_KEYS.has(key)) {
    return `${getActiveShopId()}__${key}`;
  }
  return key; // global keys pass through untouched
}

export const shopStorage = {
  getItem: (key: string) => localStorage.getItem(scopedKey(key)),
  setItem: (key: string, value: string) => localStorage.setItem(scopedKey(key), value),
  removeItem: (key: string) => localStorage.removeItem(scopedKey(key)),
};
```

---

## STEP 3 — Wire screens to the adapter (mechanical, no logic change)

Do a project-wide find-and-replace in all SCREEN and UTILITY files (not contexts
that handle global auth):

- `localStorage.getItem("medicines")` → `shopStorage.getItem("medicines")`
- `localStorage.setItem("transactions", ...)` → `shopStorage.setItem("transactions", ...)`
- ...and so on for every SCOPED key.

Leave GLOBAL keys (currentUser, authType, owner, appSettings, etc.) as plain
`localStorage`. Import `shopStorage` at the top of each file that uses scoped keys.

This is a pure mechanical swap. No logic changes. The screens behave identically —
they just read/write the active shop's namespace now.

---

## STEP 4 — Migrate existing single-shop data

Add a one-time migration in `migrations.ts` so existing users don't lose data:

```ts
export function migrateToMultiShop() {
  if (localStorage.getItem("multiShopMigrated")) return;

  // Create the first shop from existing registration.
  const reg = JSON.parse(localStorage.getItem("pharmacyRegistration") || "{}");
  const firstShop = {
    id: "shop_1",
    name: reg.pharmacyName || "আমার দোকান",
    nameEn: reg.pharmacyNameEn || "My Shop",
    createdAt: new Date().toISOString(),
    isActive: true,
  };
  localStorage.setItem("shopRegistry", JSON.stringify([firstShop]));
  localStorage.setItem("activeShopId", "shop_1");

  // Move existing flat keys into shop_1's namespace.
  const SCOPED = ["medicines","transactions","customers","creditData","expenses",
    "inventory","supplierInvoices","supplierPayments","cashDrawer","dailyHistory",
    "settledCreditHistory","auditLogs","staffMembers","deletedMedicineIds",
    "lastCompletedDay","scannedMedicineData","lastPaymentAllocation","reportSettings"];

  SCOPED.forEach((key) => {
    const val = localStorage.getItem(key);
    if (val !== null) {
      localStorage.setItem(`shop_1__${key}`, val);
      localStorage.removeItem(key); // remove the un-namespaced original
    }
  });

  localStorage.setItem("multiShopMigrated", "true");
}
```

Call this once at app startup, BEFORE any screen renders.

---

## STEP 5 — Add the shop switcher UI (the only visible change)

### 5a. Shop switcher in the dashboard header

In `MorningDashboard.tsx` header, next to the greeting, add a small tappable shop
name pill that opens a shop-switcher bottom sheet. Show this ONLY if the owner has
more than one shop AND is premium.

```
Pill appearance:
  Background: white/15 (on the green header)
  Text: active shop name + a small chevron-down icon
  Tap → opens shop switcher bottom sheet

Bottom sheet:
  Title: "দোকান নির্বাচন করুন" / "Select Shop"
  List of all active shops — each row: shop name + checkmark if active
  Tapping a shop:
    - setActiveShopId(shop.id)
    - close sheet
    - reload dashboard data (the screens now read the new shop's namespace)
  At bottom: "+ নতুন দোকান যোগ করুন" / "Add New Shop" → only if premium
```

### 5b. Multi-shop section in Settings

In `Settings.tsx`, under the existing Shop Profile section, add a "একাধিক দোকান"
(Multi-Shop) row, gated with PremiumGate:

```
Row: "একাধিক দোকান পরিচালনা" / "Manage Multiple Shops"
Tap → opens a Multi-Shop management screen showing:
  - List of all shops with name, created date, active/archived status
  - "নতুন দোকান" button to add a shop (name + nameEn only — same minimal
    registration philosophy: never ask more than needed)
  - Per shop: rename, archive (soft-delete, data preserved — FR-182)
  - A "সব দোকানের সারসংক্ষেপ" / "All Shops Summary" view showing combined
    total sales, combined outstanding credit, and merged low-stock + expiry
    alerts across all shops (FR-180)
```

### 5c. Cross-shop summary (FR-180)

The all-shops summary reads each shop's namespace in a loop:

```ts
function getAllShopsSummary() {
  return getShops().filter(s => s.isActive).map(shop => {
    const txns = JSON.parse(localStorage.getItem(`${shop.id}__transactions`) || "[]");
    const todaySales = txns
      .filter(t => isToday(t.timestamp))
      .reduce((sum, t) => sum + (t.total || 0), 0);
    // ... outstanding credit, low stock count, expiry count per shop
    return { shop, todaySales, /* ... */ };
  });
}
```

This is the ONLY place that reads across shops. Every other screen stays
single-shop via the active namespace.

---

## STEP 6 — Staff scoping (FR-179)

Staff accounts live in the scoped `staffMembers` key, so they are AUTOMATICALLY
per-shop already — a staff member created in shop A only exists in shop A's
namespace. No extra work needed. If the owner wants a staff member in two shops,
they create the account in each. (Cross-shop staff access is a later enhancement,
not needed for V1 multi-shop.)

---

## WHERE THIS SITS — WHY THIS POSITION

- The shop SWITCHER goes in the dashboard header because that's where the owner
  starts their day and where switching context is most natural.
- The shop MANAGEMENT (add/rename/archive) goes in Settings because it's
  infrequent configuration, not daily use.
- The whole feature is PREMIUM-gated because multi-shop is a premium feature in
  your spec — a single-shop free user never sees any of this and their experience
  is completely unchanged.

---

## WHAT NOT TO CHANGE

- No screen's internal logic — they read/write the same key names, just through
  shopStorage instead of localStorage.
- No global auth keys (currentUser, authType, owner) — these stay shared because
  one owner account owns all shops.
- The single-shop experience — a free user with one shop sees zero difference.
- The brand, colors, fonts, layouts — only two small UI additions (header pill +
  settings row).

---

## SUMMARY OF FILES TOUCHED

| File | Change |
|---|---|
| `shopManager.ts` | NEW — shop registry + active shop state |
| `shopStorage.ts` | NEW — the one namespacing interception point |
| `migrations.ts` | Add `migrateToMultiShop()` one-time migration |
| All screens + utils using scoped keys | Mechanical swap: `localStorage` → `shopStorage` for scoped keys only |
| `MorningDashboard.tsx` | Add shop-switcher pill in header (premium + multi-shop only) |
| `Settings.tsx` | Add Multi-Shop management row (PremiumGate) |
| NEW `MultiShopManagement.tsx` | Shop list, add/rename/archive, all-shops summary |
```
