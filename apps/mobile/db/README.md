# db/

The ONLY code in this app that imports Drizzle or touches SQLite directly.
Drizzle schema instance, migrations, DB init — empty until Day 2.

Every query file below currently holds signature-only stubs — every
function throws `TODO: ...` since there's no Drizzle schema to query yet:
`auth.ts` (Day 4-5), `sales.ts` (Day 6-7), `inventory.ts` (Day 8),
`customers.ts` (Day 9), `cash.ts` (Day 10), `staff.ts` (Day 11),
`suppliers.ts` + `purchases.ts` (P1), `reports.ts` (P1),
`notifications.ts` (P1), `settings.ts` (P0 slice: change-own-PIN; P1 slice:
backup restore).
