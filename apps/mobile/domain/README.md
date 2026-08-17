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
- `permissions.ts` — Staff (Day 11). The app's ONLY grant table: `hasPermission`
  (for an already-narrowed `Role`) and `hasPermissionForRoleName` (the
  fail-closed entry point for a raw/untrusted role string — a persisted
  session or a `roles.name` read back from SQLite). Both `state/usePermission.ts`
  (route guards) and `db/auth.ts`'s `requirePermission`/`requireOwner` (action
  guards) resolve through this file, so the two layers can never disagree.
  `toRole` denies the P1 `manager` role and anything unrecognized outright —
  the full Owner/Manager/Staff matrix stays P1.
- `purchases.ts` — Supplier/Purchase (P1, shipped early per DECISIONS.md).
