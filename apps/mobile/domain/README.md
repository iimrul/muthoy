# domain/

Pure, framework-free business logic — zero React/DB imports, 100%
unit-testable.

All files below are live, each with a passing unit test suite:
- `fefo.ts`, `cashFormula.ts`, `discounts.ts` — Sales (Day 6-7). `fefo.ts`'s
  `sortByExpiry` is also the sort Expiry Management (Day 9) and Purchase's
  medicine lookup reuse — never a second hand-rolled sort.
- `credit.ts` — Customer/Credit (Day 9). `remainingBalance` derives the
  outstanding balance from the ledger; never a mutable cached total.
- `notificationRules.ts` — Notifications/Expiry (P1, shipped early). Owns
  `EXPIRY_WINDOW_DAYS_DEFAULT` (30 days), the shared default both the Expiry
  Management screen and the Notifications expiry job alert against.
- `permissions.ts` — B1's canonical Owner/Manager/Staff defaults, presets, and
  per-user override resolution. Unknown roles fail closed. Production exposes
  the prototype's 12 keys plus `inventory_add`, which defaults OFF for Manager
  and Staff and is deliberately independent from `inventory_edit`.
- `pricing.ts`, `salePayment.ts`, `checkoutSnapshot.ts`, `refunds.ts`, and
  `deterministicId.ts` — B2 integer-paisa checkout/refund contracts.
- `supplierPosition.ts` and `purchases.ts` — B3 canonical supplier-credit/
  effective-payable and purchase arithmetic.
- `reporting.ts`, `tax.ts`, `export.ts`, and `escpos.ts` — B3 report ranges,
  MRP-inclusive tax extraction, safe export cells, and receipt bytes.
