# Portable POS — Permission System Complete Redesign
## Prompt for Antigravity Agent

Read every section before writing any code.
This touches 6 files. The order matters — do them in sequence.

---

## THE CORE PROBLEM

There are two bugs running simultaneously that make permissions non-functional:

**Bug 1 — Key name mismatch (critical):**
`AddStaffModal` saves permissions with these keys: `sales, inventory, reports, staff, settings`
But screens check DIFFERENT keys:
- `MorningDashboard.tsx` checks `permissions.dashboard` → never set → always undefined → always blocks
- `CreditSales.tsx` checks `permissions.credit` → never set → staff can never access credit
- `EndOfDay.tsx` checks `permissions.report` (singular) → saved as `reports` (plural) → never matches
- `Report.tsx` checks `permissions.report` (singular) → same problem

Every permission toggle the owner clicks in StaffManagement is partially or fully broken.

**Bug 2 — Too coarse for real pharmacy use:**
5 binary toggles cannot represent how a real pharmacy actually assigns responsibilities.
A Cashier needs sale entry but not return processing or discount overrides.
A Manager needs credit oversight but not the ability to write off balances.

---

## STEP 1 — DEFINE THE NEW PERMISSION SCHEMA

Replace the current 5-key system with this 12-key system.
This maps directly to real pharmacy role responsibilities.

In `AuthContext.tsx`, update the `StaffMember` interface:

```typescript
permissions: {
  // --- SALES ---
  sale_entry: boolean;        // Can process new sales (POS screen)
  sale_discount: boolean;     // Can apply discounts during checkout
  sale_return: boolean;       // Can process returns/refunds
  sale_history: boolean;      // Can view sales history list

  // --- INVENTORY ---
  inventory_view: boolean;    // Can view stock levels
  inventory_edit: boolean;    // Can add stock, update batches
  expiry_manage: boolean;     // Can mark batches discounted/returned

  // --- CREDIT & CASH ---
  credit_view: boolean;       // Can view credit customer list
  credit_manage: boolean;     // Can record credit sales and payments
  cash_drawer: boolean;       // Can view cash drawer / end-of-day

  // --- MANAGEMENT ---
  reports: boolean;           // Can view reports, monthly P&L, store overview
  staff_manage: boolean;      // Can view/add/edit staff (Manager only)
}
```

---

## STEP 2 — UPDATE `hasPermission()` in `AuthContext.tsx`

The function signature stays the same but now accepts the new 12 keys:

```typescript
const hasPermission = (permission: keyof StaffMember['permissions']): boolean => {
  if (user?.role === 'owner') return true;  // owner always has everything
  if (!staff) return false;
  return staff.permissions[permission] === true;
};
```

No other changes to `AuthContext.tsx`.

---

## STEP 3 — FIX ALL SCREEN-LEVEL PERMISSION CHECKS

These 5 screens check wrong/old permission keys. Update each one:

**`MorningDashboard.tsx`** — line that checks `permissions.dashboard`:
```typescript
// BEFORE
if (user.permissions && !user.permissions.dashboard) { navigate... }
// AFTER
if (!isOwner && !hasPermission("reports")) { navigate("/app/staff-home", { replace: true }); }
```

**`CreditSales.tsx`** — line that checks `permissions.credit`:
```typescript
// BEFORE
if (user.permissions && !user.permissions.credit) { navigate... }
// AFTER
if (!isOwner && !hasPermission("credit_view")) { navigate("/app/staff-home", { replace: true }); }
```

**`EndOfDay.tsx`** — line that checks `permissions.report`:
```typescript
// BEFORE
if (user.permissions && !user.permissions.report) { navigate... }
// AFTER
if (!isOwner && !hasPermission("cash_drawer")) { navigate("/app/staff-home", { replace: true }); }
```

**`Report.tsx`** — line that checks `permissions.report`:
```typescript
// BEFORE
if (user.permissions && !user.permissions.report) { navigate... }
// AFTER
if (!isOwner && !hasPermission("reports")) { navigate("/app/staff-home", { replace: true }); }
```

**`StaffPINLogin.tsx`** — line that checks `permissions.dashboard`:
```typescript
// BEFORE
if (user.permissions && !user.permissions.dashboard) { navigate("/app/staff-home") }
// AFTER
if (!user.permissions?.reports) { navigate("/app/staff-home", { replace: true }) }
```

**`StaffHome.tsx`** — update all `hasPermission()` calls to new keys:
```typescript
// Nav tiles filter:
{ perm: "sale_history" }      // was "sales"
{ perm: "credit_view" }       // was "sales"
{ perm: "inventory_view" }    // was "inventory"
{ perm: "reports" }           // stays same

// New Sale button:
hasPermission("sale_entry")   // was "sales"

// Cash Drawer tile:
hasPermission("cash_drawer")  // was "reports"
```

**`ManagerDashboard.tsx`** (from previous prompt) — update permission checks:
```typescript
hasPermission("sale_entry")    // new sale button
hasPermission("inventory_view") // inventory tile
hasPermission("credit_view")    // credit tile
hasPermission("sale_history")   // sales history tile
hasPermission("cash_drawer")    // day summary tile
hasPermission("reports")        // store overview access
```

---

## STEP 4 — REBUILD THE PERMISSION MATRIX UI

Replace `PERM_LIST` in 3 files: `StaffManagement.tsx`, `StaffDetailSheet.tsx`,
and `AddStaffModal.tsx`.

All three must use this identical grouped structure:

```typescript
const PERM_GROUPS = [
  {
    groupKey: "sales",
    groupBn: "বিক্রয়",
    groupEn: "Sales",
    icon: "ShoppingBag",
    color: "#059669",
    perms: [
      { key: "sale_entry",    bn: "বিক্রয় করা",         en: "Process Sales" },
      { key: "sale_discount", bn: "ছাড় প্রয়োগ",         en: "Apply Discounts" },
      { key: "sale_return",   bn: "ফেরত / রিফান্ড",     en: "Process Returns" },
      { key: "sale_history",  bn: "বিক্রয় ইতিহাস দেখা", en: "View Sales History" },
    ],
  },
  {
    groupKey: "inventory",
    groupBn: "ইনভেন্টরি",
    groupEn: "Inventory",
    icon: "Package",
    color: "#B45309",
    perms: [
      { key: "inventory_view", bn: "স্টক দেখা",      en: "View Stock" },
      { key: "inventory_edit", bn: "স্টক আপডেট",     en: "Update Stock" },
      { key: "expiry_manage",  bn: "মেয়াদ ব্যবস্থাপনা", en: "Manage Expiry" },
    ],
  },
  {
    groupKey: "credit_cash",
    groupBn: "ক্রেডিট ও নগদ",
    groupEn: "Credit & Cash",
    icon: "CreditCard",
    color: "#2563EB",
    perms: [
      { key: "credit_view",   bn: "ক্রেডিট দেখা",   en: "View Credit" },
      { key: "credit_manage", bn: "ক্রেডিট রেকর্ড", en: "Manage Credit" },
      { key: "cash_drawer",   bn: "ক্যাশ ড্রয়ার",  en: "Cash Drawer" },
    ],
  },
  {
    groupKey: "management",
    groupBn: "ম্যানেজমেন্ট",
    groupEn: "Management",
    icon: "BarChart2",
    color: "#7C3AED",
    perms: [
      { key: "reports",      bn: "রিপোর্ট দেখা",   en: "View Reports" },
      { key: "staff_manage", bn: "স্টাফ ব্যবস্থাপনা", en: "Manage Staff" },
    ],
  },
];
```

**UI layout for the permission matrix** (in `StaffManagement.tsx` Permissions tab and `StaffDetailSheet.tsx`):

Replace the current flat table with a grouped card layout:

```
Each group = one white card, rounded-xl, border, padding 12px 0

Card header row:
  Left: Icon (colored) + group name (bold, 13px)
  Right: "সব চালু" / "Enable All" small link — tapping toggles all perms in group ON
         If all already on: shows "সব বন্ধ" / "Disable All"

Each permission row inside card:
  Height: 48px (touch target)
  Left: Permission label in Bangla (14px) + English subtitle (11px, gray)
  Right: Toggle switch — green when on, gray when off
  Divider between rows (no divider on last row)

Between cards: 12px gap
```

---

## STEP 5 — REBUILD `AddStaffModal.tsx` WITH ROLE PRESETS

Replace the current flat checkbox list with the new grouped structure AND role presets.

**Role preset buttons** (shown above the permission groups):

```
3 preset buttons in a row:

"ক্যাশিয়ার" / Cashier:
  sale_entry: true
  sale_discount: false
  sale_return: false
  sale_history: false
  inventory_view: true
  inventory_edit: false
  expiry_manage: false
  credit_view: false
  credit_manage: false
  cash_drawer: false
  reports: false
  staff_manage: false

"ম্যানেজার" / Manager:
  sale_entry: true
  sale_discount: true
  sale_return: true
  sale_history: true
  inventory_view: true
  inventory_edit: true
  expiry_manage: true
  credit_view: true
  credit_manage: true
  cash_drawer: true
  reports: true
  staff_manage: false   ← owner decides this manually

"কাস্টম" / Custom:
  All false — owner configures manually

Preset button style:
  Selected: bg-[#059669] text-white, rounded-lg, height 40px
  Unselected: bg-[#F3F4F6] text-[#6B7280], same shape
  When owner clicks a preset → permissions state updates instantly
  When owner manually toggles any permission → "কাস্টম" preset auto-selects
```

Below the presets: the same grouped permission cards from Step 4.

**`DEFAULT_PERMS` for new staff object saved to localStorage:**
```typescript
const DEFAULT_PERMS = {
  sale_entry: false,
  sale_discount: false,
  sale_return: false,
  sale_history: false,
  inventory_view: false,
  inventory_edit: false,
  expiry_manage: false,
  credit_view: false,
  credit_manage: false,
  cash_drawer: false,
  reports: false,
  staff_manage: false,
};
```

---

## STEP 6 — ADD DATA MIGRATION FOR EXISTING STAFF

Existing staff in localStorage have the old 5-key permission structure.
Add this migration to run once on app load (in `migrations.ts` or App startup):

```typescript
function migrateStaffPermissionsV2() {
  const flag = localStorage.getItem("staffPermsV2Migrated");
  if (flag) return;

  const members = JSON.parse(localStorage.getItem("staffMembers") || "[]");
  const updated = members.map((m: any) => {
    const old = m.permissions || {};

    // Map old broad keys to new granular keys
    const newPerms = {
      sale_entry:    old.sales      ?? true,
      sale_discount: old.sales      ?? false,
      sale_return:   old.sales      ?? false,
      sale_history:  old.sales      ?? false,
      inventory_view: old.inventory ?? true,
      inventory_edit: old.inventory ?? false,
      expiry_manage:  old.inventory ?? false,
      credit_view:   old.sales      ?? false,
      credit_manage: old.sales      ?? false,
      cash_drawer:   old.reports    ?? false,
      reports:       old.reports    ?? false,
      staff_manage:  old.staff      ?? false,
    };

    return { ...m, permissions: newPerms };
  });

  localStorage.setItem("staffMembers", JSON.stringify(updated));
  localStorage.setItem("staffPermsV2Migrated", "true");
}
```

Call this at the top of `App.tsx` or inside `AuthContext` initialization,
before any screen renders.

---

## REAL-WORLD PERMISSION LOGIC TABLE

This is what each role should look like in a real pharmacy.
Use this as the reference when building preset defaults:

| Permission | Cashier | Manager | Notes |
|---|---|---|---|
| sale_entry | ✅ | ✅ | Core function of both |
| sale_discount | ❌ | ✅ | Only manager approves discounts |
| sale_return | ❌ | ✅ | Returns need supervisor approval |
| sale_history | ❌ | ✅ | Cashier sees their own via StaffHome |
| inventory_view | ✅ | ✅ | Both need to check stock |
| inventory_edit | ❌ | ✅ | Only manager receives stock |
| expiry_manage | ❌ | ✅ | Manager marks near-expiry action |
| credit_view | ❌ | ✅ | Manager oversees credit customers |
| credit_manage | ❌ | ✅ | Manager records credit sales/payments |
| cash_drawer | ❌ | ✅ | Manager reconciles end of day |
| reports | ❌ | ✅ | Manager reads store performance |
| staff_manage | ❌ | ❌ (default) | Owner manually grants if needed |

---

## FILES CHANGED — COMPLETE LIST

| File | Change |
|---|---|
| `AuthContext.tsx` | Update `StaffMember.permissions` interface to 12 new keys. Update `hasPermission` type. |
| `AddStaffModal.tsx` | New grouped UI with role presets. New `DEFAULT_PERMS` with 12 keys. |
| `StaffManagement.tsx` | Replace flat `PERM_LIST` with `PERM_GROUPS`. Grouped card layout with group-level toggles. |
| `StaffDetailSheet.tsx` | Same `PERM_GROUPS` structure. Same grouped card layout. |
| `MorningDashboard.tsx` | Fix permission check: `permissions.dashboard` → `hasPermission("reports")` |
| `CreditSales.tsx` | Fix permission check: `permissions.credit` → `hasPermission("credit_view")` |
| `EndOfDay.tsx` | Fix permission check: `permissions.report` → `hasPermission("cash_drawer")` |
| `Report.tsx` | Fix permission check: `permissions.report` → `hasPermission("reports")` |
| `StaffPINLogin.tsx` | Fix permission check: `permissions.dashboard` → `permissions.reports` |
| `StaffHome.tsx` | Update all `hasPermission()` calls to new key names |
| `ManagerDashboard.tsx` | Update all `hasPermission()` calls to new key names |
| `migrations.ts` / `App.tsx` | Add `migrateStaffPermissionsV2()` migration |

---

## DO NOT CHANGE

- Owner authentication flow — untouched
- `MorningDashboard.tsx` content/layout — only the permission check line changes
- All sale, inventory, checkout, credit screen logic — only permission check lines change
- `StaffHome.tsx` Cashier layout — only the `hasPermission()` key names update
- Router, `MainLayout`, bottom nav — untouched
