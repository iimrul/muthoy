# Portable POS — Manager Dashboard Redesign
## Prompt for Antigravity Agent

Read everything before writing any code.
This change affects ONLY the Manager role. Cashier role and Owner flow are untouched.

---

## THE SINGLE CHANGE THAT UNLOCKS EVERYTHING

In `StaffHome.tsx`, the screen currently renders identically for both Manager and Cashier.
Add one role check at the very top of the component:

```typescript
const isManager = staff?.role === "Manager";
```

If `isManager === true` → render `<ManagerDashboard />` (new component, described below)
If `isManager === false` → render the existing JSX exactly as it is today (Cashier view unchanged)

Do this inside `StaffHome.tsx` itself so no routing changes are needed.
Manager and Cashier still both land on `/app/staff-home` — the screen just branches internally.

---

## NEW FILE: `src/app/components/manager/ManagerDashboard.tsx`

This is the entire new manager view. It receives `staff` and `{ t, formatNumber }` as props
from `StaffHome`. All data reads from `localStorage` keys already used in the app
(`transactions`, `medicines`, `customers`, `cashSessions`, `staffMembers`).

---

### SECTION 1 — HEADER (same green gradient as existing StaffHome header)

```
Background: linear-gradient(135deg, #059669 0%, #047857 100%)
Padding: 24px 20px 80px (deep bottom for card overlap)

Top row:
  Left:  Greeting + manager name (same logic as existing StaffHome)
         Role badge: "ম্যানেজার" pill — white/20 bg, white text, uppercase
         Shift started time below
  Right: Bell icon button → /app/notifications
         Language toggle

Below greeting (inside hero, before overlap):
  Small store status pill:
    If any expiry alerts: "⚠ X মেয়াদ সতর্কতা" — amber pill, white text
    If any low stock: "📦 X কম স্টক" — yellow pill, white text
    If all clear: "✓ সব ঠিক আছে" — white/20 pill
    These pills are tappable — navigate to /app/expiry or /app/inventory
```

---

### SECTION 2 — STORE OVERVIEW CARDS (overlapping hero, -mt-16)

White card, rounded-2xl, shadow-xl, border border-[#E5E7EB], padding 16px.
This shows STORE-WIDE numbers, not personal numbers.

```
Label above card: "আজকের দোকানের অবস্থা" / "Store Overview Today"
                  10px, uppercase, #6B7280

4-cell grid (2×2), each cell divided by thin lines:

Cell 1 — মোট বিক্রয় / Total Sales
  Value: Sum of ALL today's transactions (all sellers combined)
  Font: DM Mono, 20px bold, #059669
  Sub: "X টি লেনদেন" — 11px, #6B7280

Cell 2 — নগদ ড্রয়ার / Cash Drawer
  Value: Expected cash from cashCalculation.getCashBreakdown()
  Font: DM Mono, 20px bold, #111827
  Sub: "শুরু থেকে" — 11px, #6B7280

Cell 3 — ক্রেডিট বাকি / Credit Due
  Value: Sum of all customers current_outstanding
  Font: DM Mono, 18px bold, #DC2626 (if > 0), #059669 (if 0)
  Sub: "X জন গ্রাহক" — 11px, #6B7280

Cell 4 — স্টাফ সক্রিয় / Staff Active
  Value: Count of staffMembers where active: true (excluding self)
  Font: DM Mono, 18px bold, #2563EB
  Sub: "আজ লগইন করেছে" — 11px, #6B7280

Data source for Cell 1 and 2:
  const allTodayTxns = JSON.parse(localStorage.getItem("transactions") || "[]")
    .filter(tx => isToday(tx.timestamp) && !tx.isDeleted && tx.status !== "cancelled")

  totalSales = allTodayTxns.reduce((sum, tx) => sum + (tx.total || 0), 0)
  txnCount = allTodayTxns.length
```

---

### SECTION 3 — PRIMARY ACTION BUTTON (full width, always visible)

```
"নতুন বিক্রয়" / New Sale
Background: linear-gradient(135deg, #059669, #047857)
Height: 56px, rounded-2xl, shadow-lg
Left: ShoppingBag icon in white/15 circle + text
Right: ArrowRight icon
Navigate to: /app/sale
Only shown if hasPermission("sales") === true
```

---

### SECTION 4 — ALERT CARDS (conditional, shown only if data exists)

Each alert is a compact horizontal card. Show only if count > 0.

**Expiry Alert Card:**
```
Background: #FEF2F2, border: 1px solid #FECACA, rounded-xl, padding 12px 16px
Left: Clock icon circle (40×40, #DC2626 bg, white icon)
Content: "X টি ওষুধের মেয়াদ শেষ হচ্ছে" — Inter 600, 13px, #DC2626
         "৩০ দিনের মধ্যে" — 11px, #EF4444
Right: "দেখুন →" — 12px bold, #DC2626 → /app/expiry
Entire card tappable
```

**Low Stock Alert Card:**
```
Background: #FEF3C7, border: 1px solid #FCD34D, rounded-xl, padding 12px 16px
Left: Package icon circle (40×40, #D97706 bg, white icon)
Content: "X টি ওষুধের স্টক কম" — Inter 600, 13px, #D97706
         Default threshold: < 10 units
Right: "অর্ডার করুন →" — 12px bold, #D97706 → /app/inventory
Entire card tappable
```

Data for alerts:
```typescript
const medicines = JSON.parse(localStorage.getItem("medicines") || "[]");
const today = new Date();

const expiryAlerts = medicines.filter(med => {
  if (!med.batches) return false;
  return med.batches.some(b => {
    if (!b.expiryDate || b.quantity <= 0) return false;
    const days = Math.ceil((new Date(b.expiryDate) - today) / 86400000);
    return days >= 0 && days <= 30;
  });
});

const lowStockMeds = medicines.filter(med => {
  const total = (med.batches || []).reduce((s, b) => s + (b.quantity || 0), 0);
  return total > 0 && total < (med.minStock || 10);
});
```

---

### SECTION 5 — STAFF PERFORMANCE STRIP (horizontal scroll)

Label: "আজকের স্টাফ বিক্রয়" / "Staff Sales Today"  — 11px uppercase #6B7280
Right link: "সব দেখুন →" — 11px, #059669 → /app/staff (manager has staff permission)

Horizontal scroll row, gap 10px, no visible scrollbar.
Each staff card (min-width 130px, white bg, rounded-xl, border, padding 12px):

```
Top: Initials avatar (32×32, color-coded) + name truncated
Middle: Sales amount — DM Mono, 16px bold, #059669
Bottom: "X টি বিল" — 11px, #6B7280

Data per staff member:
  const staffTxns = allTodayTxns.filter(tx =>
    String(tx?.soldBy?.id ?? tx?.staffId) === String(member.id)
  )
  memberSales = staffTxns.reduce((s, tx) => s + (tx.total || 0), 0)
  memberTxnCount = staffTxns.length

Empty state (no staff sales yet):
  Single card: "আজ কোনো স্টাফ বিক্রয় করেনি" — #6B7280, 12px, centered
```

---

### SECTION 6 — QUICK ACCESS TILES (2-column grid)

Show only tiles for permitted features. Manager default permissions include:
sales, inventory, reports. Does NOT include: staff (by default), settings (never).

```
Tile 1: ইনভেন্টরি / Inventory
  Icon: Package, tint #FEF3C7, color #B45309 → /app/inventory
  Shown if hasPermission("inventory")

Tile 2: ক্রেডিট বিক্রয় / Credit Sales
  Icon: CreditCard, tint #EFF6FF, color #2563EB → /app/credit
  Shown if hasPermission("sales")

Tile 3: বিক্রয় ইতিহাস / Sales History
  Icon: ClipboardList, tint #ECFDF5, color #047857 → /app/sales-history
  Shown if hasPermission("reports")

Tile 4: দিনের সারসংক্ষেপ / Day Summary
  Icon: FileText, tint #F3E8FF, color #7C3AED → /app/end-of-day
  Shown if hasPermission("reports")

Each tile: white bg, border border-[#E5E7EB], rounded-2xl, height 80px,
           flex column, icon + label, active:scale-[0.98]
```

---

### SECTION 7 — RECENT STORE TRANSACTIONS (last 8, all sellers)

Label: "সাম্প্রতিক লেনদেন" / "Recent Transactions" — 11px uppercase #6B7280

```
White card, rounded-2xl, divide-y divide-[#F3F4F6]

Each row:
  Left:  Medicine names (first 2, comma separated) — 13px bold #111827
         Time + seller name — 11px, #9CA3AF
         Format: "10:42 · রহিম" (seller's first name only)
  Right: ৳ amount — DM Mono, 13px bold #047857
         Payment type badge: "নগদ"/"ক্রেডিট" — 9px pill

Show 8 most recent. "সব দেখুন →" link at bottom → /app/sales-history

Empty state:
  Receipt icon + "আজকের প্রথম বিক্রয় শুরু করুন" — same as current StaffHome
```

---

### SECTION 8 — END SHIFT BUTTON (bottom, same as existing)

Identical to current StaffHome end-shift button and modal. No changes.
The shift summary sheet for manager shows store-wide totals (Section 2 data),
not just personal totals.

---

## DATA REFRESH STRATEGY

Manager dashboard must stay live throughout the day.

```typescript
useEffect(() => {
  loadData(); // initial load

  // Refresh on window focus (when returning from another screen)
  window.addEventListener("focus", loadData);

  // Poll every 15 seconds
  const interval = setInterval(loadData, 15000);

  // Listen for storage changes (when cashier makes a sale on same device)
  window.addEventListener("storage", loadData);

  return () => {
    window.removeEventListener("focus", loadData);
    window.removeEventListener("storage", loadData);
    clearInterval(interval);
  };
}, []);
```

---

## PERMISSION DEFAULTS FOR MANAGER ROLE

In `AddStaffModal.tsx`, when role dropdown changes to "Manager",
auto-set these default permissions (owner can still override them):

```typescript
if (role === "Manager") {
  setPermissions({
    sales: true,
    inventory: true,
    reports: true,   // needs this for store overview + day summary
    staff: false,    // owner decides if manager can add/edit staff
    settings: false, // never for manager
  });
} else {
  // Cashier defaults (unchanged from today)
  setPermissions({
    sales: true,
    inventory: false,
    reports: false,
    staff: false,
    settings: false,
  });
}
```

This auto-fill is only a default — owner can still toggle any permission on/off after.

---

## FILES TO CHANGE — COMPLETE LIST

| File | Change |
|---|---|
| `StaffHome.tsx` | Add `const isManager = staff?.role === "Manager"`. If true, render `<ManagerDashboard staff={staff} />`. Existing JSX is the else branch. No other changes. |
| `src/app/components/manager/ManagerDashboard.tsx` | New file. Full implementation as described above. |
| `AddStaffModal.tsx` | Auto-set permission defaults when role dropdown changes. Manager gets sales+inventory+reports by default. Cashier keeps current defaults. |

---

## DO NOT CHANGE

- `StaffHome.tsx` Cashier view JSX — zero changes
- Owner `MorningDashboard.tsx` — zero changes
- `AuthContext.tsx` — zero changes
- Any routing in `router.tsx` — zero changes
- Any other screen, service, or utility file
- The existing `StaffManagement.tsx` — zero changes
- The existing permissions toggle matrix — zero changes
