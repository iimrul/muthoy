# Portable POS — Remove ALL Hardcoded Seed & Demo Data
## Make the app fully user-controlled — every shop starts empty

A real pharmacy must start with a clean slate: no fake medicines, no fake customers,
no fake sales. Right now several sources inject hardcoded data. Remove every one so
the app contains only what the user enters. Below is the complete list found in the
code — fix all of them.

---

## SOURCE 1 — `initialMedicines` (6 fake medicines)

`medicineData.ts` defines `initialMedicines` (Napa 500mg, Ace 10mg, Filmet 400mg,
Sergel 20mg, Max-D 400, Atorvastatin 20mg) and `getMedicines()` falls back to it when
storage is empty. So every new shop starts with 6 medicines it never added.

### Fix
- In `getMedicines()`, change the empty-storage fallback from `initialMedicines` to an
  empty array:

```ts
const raw = storedMedicines
  ? JSON.parse(storedMedicines)
  : [];                       // was: initialMedicines.filter(...)
```

- Remove the `initialMedicines` constant entirely, and remove any remaining imports of
  it (e.g. in `Inventory.tsx` the `initialMedicines.find(...)` check for default-medicine
  deletion — replace that logic so deletion simply removes the record; there are no
  "default" medicines anymore).
- Keep `migrateLegacyMedicine` — it still applies to user data.

Note: the 21,000-product MASTER medicine database (the searchable catalogue the user
picks from) is a SEPARATE concern and is NOT seed data — do not remove that. This fix
only removes the 6 fake medicines that were auto-added to a shop's own inventory.

---

## SOURCE 2 — `initialCustomers` (3 fake credit customers)

`CreditSales.tsx` defines `initialCustomers` (Md. Karim ৳1500, Rahima Begum ৳2250
overdue, Abdullah ৳750) and seeds them into `creditData` on first load.

### Fix
- Remove the `initialCustomers` constant.
- `useState(initialCustomers)` → `useState([])`.
- In `loadCreditData`, when no stored credit exists, initialise with an EMPTY customer
  list, do not write fake customers:

```ts
} else {
  const creditData = { customers: [] };
  shopStorage.setItem("creditData", JSON.stringify(creditData));
  setCustomers([]);
}
```

---

## SOURCE 3 — Demo data generator (`demoData.ts` + `DemoDataTool` screen)

`utils/demoData.ts` has `seedDemoData()` which writes ~90 days of fake transactions,
inventory, expenses, credit customers, staff, audit logs, and a fake cash drawer.
`screens/DemoDataTool.tsx` is a UI for it, routed at `/app/demo-data`.

### Fix — remove the feature entirely for production
- Delete `src/app/utils/demoData.ts`.
- Delete `src/app/screens/DemoDataTool.tsx`.
- In `router.tsx`, remove the `/app/demo-data` route entry (both the loader map entry
  ~line 32 and the route definition ~line 276) and any import.
- Remove any nav link or Settings/More entry that points to `demo-data`.
- Grep for `seedDemoData`, `clearDemoData`, `DemoDataTool`, `demoData` and remove every
  remaining reference so the build has no dangling imports.

(If you want to KEEP a developer-only seeding tool, instead gate it behind a build flag
`import.meta.env.DEV` so it never ships in the production bundle — but the cleanest
path for a user-controlled app is full removal.)

---

## SOURCE 4 — Verify no other seeded defaults

After the above, confirm these are clean (grep each):
- `auditLogs`: AuditLogContext already does NOT seed on fresh install — confirm it
  stays empty until a real action occurs.
- Recent/Frequent/Favorite: already computed from real sales via `salesInsights.ts` —
  confirm no hardcoded arrays remain in `SaleEntry.tsx`.
- `cashDrawer`: must start unset (owner enters opening cash) — no hardcoded 5000.
- `expenses`, `supplierInvoices`, `staffMembers`, `transactions`: confirm no screen
  writes default rows on first load.
- `Registration.tsx`: "রহিম ফার্মেসি / Rahim Pharmacy" is a placeholder hint only
  (not stored) — that is fine, leave it.

Grep commands to run:
```
grep -rn "= \[{" src/app/screens         # inline object-array seeds
grep -rn "initial[A-Z]" src/app          # any initialX constants left
grep -rn "demo\|mock\|sample\|dummy\|seed" src/app --include=*.tsx --include=*.ts
```
Every hit that WRITES data (not just a placeholder string or a type) must be removed.

---

## FIRST-RUN EXPERIENCE AFTER REMOVAL

With all seed data gone, a new shop should show:
- Inventory: empty state — "কোনো ওষুধ যোগ করা হয়নি / No medicines added yet" with an
  Add button. (Ensure the empty state renders, not a blank/error screen.)
- Credit: empty — "কোনো বাকি গ্রাহক নেই / No credit customers".
- Dashboard/Reports/EndOfDay: zero states (already handled) — confirm they read 0
  cleanly with no fake numbers.
- Sale page: search works against the master catalogue; the shop's own
  recent/frequent lists are empty until real sales happen.

Confirm each screen has a friendly empty state so "no data" never looks like a bug.

---

## VERIFICATION

1. Clear app storage (fresh install simulation). Register a new shop.
2. Inventory is empty. Add one medicine — only that medicine appears.
3. Credit is empty. No Karim/Rahima/Abdullah anywhere.
4. Dashboard shows ৳0 / zero states, no 18,450 etc.
5. There is no `/app/demo-data` route and no demo button anywhere.
6. The build compiles with no references to initialMedicines, initialCustomers,
   demoData, or DemoDataTool.

## WHAT NOT TO CHANGE
- The 21,000-product master medicine catalogue (that's the product DB, not seed data).
- Registration placeholder hint text.
- Empty-state components (keep/improve them).
- Any real user-entered data path.
