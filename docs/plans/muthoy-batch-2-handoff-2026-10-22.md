# Muthoy POS — Batch 2 Gate 3 handoff (local checkpoint)

**Date:** 2026-10-22
**Status:** **Gate 3 IN PROGRESS.** Gates 1–2 are CLOSED and must not be repeated.
**Batch 2 is NOT closed.** No GitHub push, no Codex final review, no CI run yet.

---

## 1. The accepted plan

`docs/plans/muthoy-batch-2-plan.md` — **revision 7**, the founder-accepted plan.

Six independent Codex review rounds (`gpt-5.6-sol`), every one `PLAN REVISE`, every
finding verified against the code and applied. §14 is the full review log; §15 records
the Gate 2 disposition. The founder authorized Gate 3 on revision 7 on 2026-10-22 with
"No seventh broad plan review, no new sub-batches, no planning restart."

**Do not re-plan. Do not re-review the plan. Continue implementing it.**

---

## 2. Local checkpoint commit

```
SHA              63b88dfce8684091d5fd9635ec08bea5ab1193eb
                 (+ this doc-only SHA backfill commit on top)
Branch           main
Pushed           NO — deliberately. Push happens only after all seven tasks are done.
Parent           51c5230e622b2ff5e1ca0c859fdf541a3131cc4c
```

### 2.1 Verification recorded at checkpoint

| Check | Command | Exit code |
|---|---|---|
| Mobile typecheck | `npx tsc --noEmit -p apps/mobile/tsconfig.json` | **0** |
| Admin typecheck | `npx tsc --noEmit -p apps/admin/tsconfig.json` | **0** |
| Whitespace / conflict markers | `git diff --check` | **0** |
| Focused regression (11 files) | `npx vitest run packages/utils/src apps/mobile/db/medicine-catalog.sqlite.test.ts apps/mobile/db/b2-sales.sqlite.test.ts apps/mobile/db/b2-inventory.sqlite.test.ts apps/mobile/db/purchase-invoice.sqlite.test.ts apps/mobile/db/h7-access-lock.sqlite.test.ts apps/mobile/tests/inventory` | **0** — 11 files / **95 tests** passed |

H-9 seal re-verified at checkpoint: **34** Postgres migrations, tail
`20261015000000_h9_api_role_table_privileges.sql`, and
`backend/supabase/checks/h9_postmigration_checks.sql` SHA-256 =
`361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9` — unchanged.
**No file was added to `backend/supabase/migrations/`.** No path in `.gitattributes`'
`eol=lf` pinned list was touched (verified with `git check-attr`).

---

## 3. What is COMPLETE and tested

All of W2-03, and W2-02's **data layer** — not its UI, and not its dataset.

| File | State | Tests |
|---|---|---|
| `packages/utils/src/bengali.ts` | NEW | `bengali.test.ts`, **21 tests**. Mutation check: removing the transliteration fold fails 4 |
| `packages/utils/src/bengali.test.ts` | NEW | — |
| `packages/utils/src/index.ts` | MODIFIED (one additive export) | — |
| `apps/mobile/domain/ftsQuery.ts` | NEW | covered by the existing sale/purchase suites, 14/14 |
| `apps/mobile/domain/medicineSearchProvider.ts` | MODIFIED — three **optional** fields | existing `inventory-remediation.test.tsx` passes unchanged |
| `apps/mobile/db/sales.ts` | MODIFIED — private FTS duplicate removed, shared import added | `b2-sales.sqlite.test.ts` |
| `apps/mobile/db/purchases.ts` | MODIFIED — same | `purchase-invoice.sqlite.test.ts` |
| `apps/mobile/db/schema.ts` | MODIFIED — `medicineCatalog`, `medicineCatalogImports` | — |
| `apps/mobile/db/medicineCatalog.ts` | NEW — search / get / count / provider | `medicine-catalog.sqlite.test.ts` |
| `apps/mobile/db/medicineCatalogImport.ts` | NEW — chunked, idempotent, resumable, owner-only | same, incl. a 25,000-row chunking test |
| `apps/mobile/db/medicine-catalog.sqlite.test.ts` | NEW | **15 tests** |
| `apps/mobile/db/migrations/0032_medicine_catalog.sql` | NEW | applied by every suite that migrates |
| `apps/mobile/db/migrations/meta/_journal.json` | MODIFIED — `idx: 32` | guarded by `h7-access-lock.sqlite.test.ts:200-216` |
| `apps/mobile/db/migrations/migrations.js` | MODIFIED — `m0032` import + key | same guard; mutation check: removing the key fails it |
| `vitest.config.ts` | MODIFIED — one include entry | — |

### 3.1 Three deliberate deviations from revision 7 — keep them

1. **No `db/migration-registration.test.ts` was created.**
   `apps/mobile/db/h7-access-lock.sqlite.test.ts:200-216` **already** asserts
   journal ≡ static registry ≡ `.sql` files for the whole directory. A second would be
   the duplicate-module mistake `DECISIONS.md` records at "D10 — one error-to-text map,
   not two". The existing guard was used instead, and a mutation check confirmed it
   catches a missing registry key.
2. **The importer is JSONL, not CSV.** `@muthoy/utils`' `parseCsv` enforces
   `MAX_INVENTORY_CSV_ROWS = 1000` and `MAX_INVENTORY_CSV_BYTES = 2 MiB`
   (`packages/utils/src/csv.ts:1-5`). A ~21,000-row catalogue is **21× the row cap**, and
   raising it would weaken a guard protecting the **shop inventory** import path. JSONL
   also needs no quote-aware buffering, so retained memory is bounded by the 500-row
   chunk rather than by the file.
3. **The duplicated FTS query builder was consolidated, not triplicated.**
   `toFtsPrefixQuery` existed privately and identically in `db/sales.ts` and
   `db/purchases.ts`. W2-02 needed a third caller, so it moved to `domain/ftsQuery.ts`
   and all three import it. `DEVELOPMENT_RULES.md` forbids duplicating shared logic.

---

## 4. The seven executable tasks and what remains

**W2-02's catalogue UI and all of W2-01, W4-06, W4-07, W4-08 and W4-10 are unbuilt.**

| ID | Task | State | Remaining |
|---|---|---|---|
| **W2-02** | Offline medicine catalogue | **data layer DONE; UI + dataset NOT DONE** | wire `catalogMedicineSearchProvider` into `app/inventory/add-medicine.tsx`; render `strength`/`dosageForm`/`packSize` in `components/inventory/SearchMedicineTab.tsx` and add stale-query protection via the existing `domain/latestRequestGuard.ts`; prefill `components/inventory/ManualEntryForm.tsx`; extend `db/inventory.ts`'s `createMedicineWithPurchase` input and `packages/validation/src/inventory.ts`; update `apps/mobile/tests/inventory/inventory-remediation.test.tsx`. **Selection READS only — Save stays the one commit path; do NOT build `createMedicineFromCatalog`.** |
| **W2-03** | English / Bangla / Banglish search | **DONE** (data layer); its UI surface rides on W2-02's wiring | — |
| **W2-01** | Medicine OCR completion | **NOT STARTED** | `native/prescriptionAttachment.ts` + `removeTemporaryCapture`; `MedicineTextScanner` deletes on the **OCR path only** and never when `captureOnly` is set; `components/scanner/ScanConfirmSheet.tsx`; confirmation gate before `addItem` in `app/scan.tsx`; run recognition on the prescription capture in `app/sale/checkout.tsx`; `tests/sale/resumed-draft-capture.test.tsx` |
| **W4-06** | Admin auth / RBAC / audit / sessions | **NOT STARTED** | `apps/admin/lib/{adminIdentity,adminSession,adminRoles,adminAuthz,adminAudit}.ts` + tests; `middleware.ts` exact-pathname exemption; `app/api/admin/session/route.ts`; `app/login/page.tsx`; `scripts/admin-hash-password.mjs` |
| **W4-07** | Admin management pages | **NOT STARTED** | `lib/adminQueries.ts`; `app/shops/[id]`, `app/accounts`, `app/accounts/[id]`, `app/subscriptions`, `app/payments`, `app/audit` |
| **W4-08** | Admin write actions | **NOT STARTED** | `lib/adminActions.ts` (three RPC-backed actions only); `lib/adminGrants.test.ts` restructure; source-level write-restriction test; `pgtest/batch2-admin-acl.pgtest.ts` |
| **W4-10** | SSLCommerz retirement | **NOT STARTED** | `functions/sync/_shared/paymentProvider.ts` (refuses `sslcommerz`, no bKash branch); `functions/sync/billing.ts` uses it; **`apps/mobile/sync/billing.ts` must fail locally BEFORE `createPaymentAttempt` writes a row** (`:77`→`:85`); `app/settings/plan-payment.tsx` payment-unavailable state |

**Not in scope, by founder decision:**

- **W4-09 bKash — BLOCKED on E8.** Not implemented. Its remaining implementation and
  live acceptance are tracked in **Batch 4**. Do not declare DONE. Plan §7.5 holds the
  verified contract, the five-point blocker analysis, the three-identifier design and
  the phased-rollout SQL spec.
- **W5-16 barcode — Q1 RESOLVED: EXCLUDED.** Do not implement barcode scanning or a
  barcode fallback. OCR must work independently, with manual confirmation. The existing
  shipped barcode code is **not deleted** and **not extended**.

---

## 5. Open gates

| Gate | Requirement |
|---|---|
| **E7 — catalogue dataset** | **The 21K catalogue is NOT complete and must not be claimed.** No licensed dataset is identified. DGDA (the authoritative registry) reports ~34,000 allopathic products and its TLS certificate is expired; the ~21,000 figure matches a Kaggle dataset scraped from medex.com.bd with **no stated licence**. The repo itself records this at `domain/medicineSearchProvider.ts` ("MedEx vs. another source is still pending"). **Zero catalogue rows ship.** Real data, licensing, verified count and offline availability must all be confirmed before any completion claim |
| **E8 — bKash contract** | Three undocumented surfaces: the callback request contract, the `Authorization` value format, and the signature/IPN verification procedures. Plus E4 (migration seal), merchant credentials, the unpublished live base URL, and the three-phase function rollout |
| **E9 — capture cleanup** | Cleaning up the prescription capture on the `captureOnly` path is **descoped** after five designs each proved unsafe. Plan §6.2.2 holds all five and why. **Preserve existing durable captures; introduce no destructive cleanup.** The scanner-owned OCR-path cleanup DOES ship in W2-01 |
| E4 | H-9 migration-chain seal — Batch 3 |

---

## 6. Working-tree preservation rules

**41 pre-existing dirty paths must be preserved and never staged.** Enumerate with
`git status --porcelain=v1 --untracked-files=all` — **never** the default
`--porcelain`, which collapses `apps/prototype-web/Muthoy (prototype)/.expo/` into one
entry although it holds two files. That collapse is why the count was wrongly recorded
as 40 and as 42 in earlier revisions.

- Modified (3): `DECISIONS.md` (H-9's +137-line hunk at line 3654 — Batch 2 appends at
  the **end** and must not touch it), `scripts/h9/install-local-runtime.ps1`,
  `apps/prototype-web/Muthoy (prototype)/pnpm-workspace.yaml`
- Untracked (38): 8 `docs/plans/h9-*`, 26 `scripts/h9/**`, and 4 prototype paths
  (`.expo/README.md`, `.expo/devices.json`, `pnpm-lock.yaml`, `tsconfig.json`)

**`git add .` and `git add -A` are forbidden.** Stage every path by name. Do not modify
sealed H-9/F12/H1 evidence or anything in `.gitattributes`' `eol=lf` list.

---

## 7. The exact next implementation step

**Finish W2-02's UI wiring**, in this order — the smallest coherent unit, and its test
file already exists:

1. `apps/mobile/components/inventory/SearchMedicineTab.tsx` — render the
   `strength` / `dosageForm` / `packSize` secondary line, and replace
   `void provider.search(text).then(setResults)` with the existing
   `domain/latestRequestGuard.ts` so a slow early query cannot overwrite a fast later
   one against a 21k catalogue.
2. `apps/mobile/app/inventory/add-medicine.tsx` — pass `catalogMedicineSearchProvider`
   from `db/medicineCatalog.ts` to `SearchMedicineTab`, replacing the default
   `unavailableMedicineSearchProvider`. On selection call `getCatalogEntry(id)` — a
   **read** — and hand the full row to the form.
3. `apps/mobile/components/inventory/ManualEntryForm.tsx` — accept the mapped fields as
   editable prefills: `brandName → name`, `genericName → generic`,
   `manufacturer → manufacturer`, `strength → strength`, `dosageForm → type`,
   `packSize → unitOfMeasure` only when it names a unit. **Never concatenate anything
   into `name`** — `medicines_fts` indexes it and `findExactNameMatch` compares against it.
4. `apps/mobile/db/inventory.ts` + `packages/validation/src/inventory.ts` — extend
   `createMedicineWithPurchase`'s input and schema with those fields. **Save remains the
   only commit path.**
5. `apps/mobile/tests/inventory/inventory-remediation.test.tsx` — assert the provider
   passed is not `unavailableMedicineSearchProvider`, that nothing is written before
   Save, and that a fully-populated catalogue row reaches the form field-by-field.

Then W2-01, then W4-10, then W4-06 → W4-07 → W4-08 (largest, do last).

**Operational constraint:** never run the full `vitest` suite concurrently with a Codex
review. Under CPU contention `db/h7-pin-reservation.sqlite.test.ts` (5 s timeout, three
bcrypt cost-10 fixtures) and `db/inventory-ledger.sqlite.test.ts` (250 ms budget) fail
falsely; both pass in isolation (34/34). Baseline is 243 files / 5062 tests.

---

## 8. Closing sequence (only after all seven tasks are implemented)

focused tests → documentation (Gate 4's document set, plan §8) → **Codex FINAL ACCEPT**
→ selective GitHub push by explicit path → **CI PASS** → Batch 2 delivery report
distinguishing **CODE-COMPLETE**, **BLOCKED** and **DEVICE/PRODUCTION-VERIFIED**.

No Batch 2 task reaches DEVICE/PRODUCTION-VERIFIED in this batch: no physical-device run
is authorized and the founder's Galaxy A04s installation is off-limits.
**Do not start Batch 3.**
