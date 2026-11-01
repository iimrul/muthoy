# Batch 3 restock correction — implementation evidence

Baseline: `08dea18`. No device or hosted deployment was changed.

## Established cause

At baseline, `ManualEntryForm.tsx:196` always called
`createMedicineWithPurchase`. `db/inventory.ts:367` unconditionally generated
a medicine ID and `:447` inserted the medicine. No existing-shop identity was
selected or checked. Identical manual restocking therefore produced a second
medicine and isolated its batches from the first medicine's FEFO allocation.

The regression `adds the earlier batch to the chosen medicine without
fragmenting FEFO` was executed with the baseline inventory module loaded from
`git show HEAD:apps/mobile/db/inventory.ts`, leaving working files untouched.
It failed: expected chosen ID `50000001-0000-4000-8000-000000000005`, received
new ID `00000000-0000-4000-8000-000000000001`. The corrected module passes it.
The UI regression is `regression: identical manual entry requires an explicit
medicine choice before any write`.

Corrections to the hardware narrative:

- Baseline `batches.tsx` already had Add Batch, but Edit Medicine did not expose
  it. That legacy form wrote stock without purchase/payment booking; it now
  routes through the same receipt form as other entry points.
- Current source already wires Search Medicine to the offline catalogue.
  An empty licensed catalogue produces the observed unavailable message;
  existing-shop selection now works independently of it.
- `sortByExpiry` only sorts its input. Its allocation callers filter by
  medicine ID; the reported fragmentation defect is real.

## Files and purpose

| File | Change |
| --- | --- |
| `apps/mobile/app/inventory/add-medicine.tsx` | Prominent local-shop restock selection; scope form state to session. |
| `apps/mobile/app/inventory/add-batch.tsx` | New route carries an explicitly selected shop medicine ID into receipt entry. |
| `apps/mobile/app/inventory/edit-medicine.tsx` | Add Batch action respects `inventory_add`. |
| `apps/mobile/app/inventory/batches.tsx` | Replace stock-only receipt form with ledger-backed route; reset displayed data on shop/user/medicine change. |
| `apps/mobile/components/inventory/ManualEntryForm.tsx` | Explicit same/distinct identity decision, immutable existing metadata, fresh confirmation validation, failed-selection and repeated-submit guards. |
| `apps/mobile/components/inventory/ExistingMedicinePicker.tsx` | SQLite shop search with strength/form/unit/barcode, batch context and ID; isolate async results. |
| `apps/mobile/db/inventory.ts` | Same-shop existing-ID verification, new-batch receipt, duplicate-name acknowledgement, duplicate-batch rejection and live permission/session checks. |
| `apps/mobile/db/purchases.ts` | Tag existing-medicine inventory receipts with the narrow `inventory_add_purchase` operation; share existing atomic financial/stock effects. |
| `apps/mobile/db/permissions.sqlite.test.ts` | Baseline regression, receipt reconciliation, permissions and identity rejection. |
| `apps/mobile/db/b2-restock.sqlite.test.ts` | Real SQLite receipt → FEFO sale → refund/return and cash/stock/supplier reconciliation. |
| `apps/mobile/domain/fefo.test.ts` | Sellable ordering, expiry, partial depletion, spillover and exhaustion. |
| `apps/mobile/tests/inventory/inventory-remediation.test.tsx` | Same/distinct UI, staff, async selection/validation, hidden fields, failed lookup, shop isolation and repeated taps. |
| `apps/mobile/i18n/catalog.ts` | English/Bangla restock copy. |
| `backend/supabase/held-migrations/20261101000000_b3_existing_medicine_restock.sql` | Unapplied hosted contract draft supports reference-only existing medicine receipts and preserves original new-medicine graphs. |
| `backend/supabase/held-migrations/README.md` | Held release prerequisite and forward-compatible rollback limits. |
| `backend/supabase/pgtest/inventory-add-purchase-sync.pgtest.ts` | Original contract plus held-draft validation, authority, identity, COD, supplier credit, replay and ACL checks. |
| `docs/plans/restock-history-reconciliation.md` | Separate reversible proposal for historical aliases; no cleanup authorized or executed. |
| `docs/plans/b3-restock-verification.md` | This evidence and review handoff. |
| `DECISIONS.md` | Record explicit identity, atomic receipts and held hosted release prerequisite. |

## Verification

Standard `npx vitest run` could not start esbuild: `spawn EPERM`.
Local verification runners use native config loading, worker threads and
in-process TypeScript transpilation. The primary `.tmp/restock/` config uses
`preserveSymlinks` and explicit React resolution to avoid blocked optional
Windows network-drive discovery. A concurrent runner uses a stub for that
optional `net use` discovery instead. Production dependencies,
application code, SQLite triggers and PostgreSQL functions are unchanged by
the runner. Commands used:

```powershell
node --experimental-strip-types node_modules/vitest/vitest.mjs run --config .tmp/restock/vitest.config.mjs --configLoader native <test paths>
# Baseline negative control (loads 08dea18 inventory source without replacing working files):
node --experimental-strip-types node_modules/vitest/vitest.mjs run --config .tmp/restock/baseline.config.mjs --configLoader native apps/mobile/db/permissions.sqlite.test.ts -t "adds the earlier batch to the chosen medicine"
npx turbo run lint
npx turbo run typecheck
git diff --check
```

Focused selection: inventory UI, permissions SQLite, restock SQLite, FEFO and
i18n catalog: **106/106 passed in 5 files**.

Final broader SQLite, hosted-draft, lint and typecheck results are recorded
below after their running checks finish.

Earlier failures were retained and fixed: draft SQL CASE parsing (17 failed
held cases; 12 original cases passed), two supplier-credit fixtures lacking
real premium entitlement, stale owner-only assertions after the staff contract
change (three failures), and two TypeScript errors in test label tuples.
The fixtures now have real verified Pro state; tuple types/assertions were fixed. No production premium check was bypassed.

## Release limits and manual checks

No SQLite migration is needed. The hosted draft stays OUTSIDE the active
migration directory; no migration manifest/hash/preflight was changed.
**Do not distribute this client until the held hosted contract extension has
been separately approved, promoted and applied.** The current deployed
contract rejects reference-only receipt graphs.

No historical medicine, sale, purchase, refund or movement was merged,
rewritten or deleted. No Batch 4 feature was added. Unrelated prototype
working-tree changes remain untouched. Concurrent related edits were
integrated after preserving a local snapshot.

Physical Samsung acceptance and live two-device sync remain required. Follow
the device checklist in `restock-history-reconciliation.md`, including the
200+50 batch case, expiry, spillover prices, COD outflow and original-batch
refund. PGlite and jsdom results do not establish device or hosted readiness.

Suggested commit: `fix(inventory): restock explicitly selected medicines atomically`.
