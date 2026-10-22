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
                 2b39062  W2-02 catalogue UI wiring (2026-10-22)
                 9bc08a6  W2-01 scanner-owned capture cleanup (2026-10-22)
                 9e7d880  W2-01 sale-scan confirmation gate (2026-10-22)
                 ca7a7a4  W2-01 opt-in captureOnly recognition (2026-10-22)
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

**W2-02 is code-complete and dataset-blocked. W2-01 is two-thirds done and its
last piece needs a founder decision. W4-06, W4-07, W4-08 and W4-10 are unbuilt.**

| ID | Task | State | Remaining |
|---|---|---|---|
| **W2-02** | Offline medicine catalogue | **code DONE (data layer + UI); DATASET NOT DONE** | nothing in code. UI wiring landed in `2b39062`: `catalogMedicineSearchProvider` is passed from `app/inventory/add-medicine.tsx`, selection re-reads via `getCatalogEntry` before the form opens, `SearchMedicineTab.tsx` renders strength/dosage form/pack size and guards overlapping queries with `domain/latestRequestGuard.ts`, `ManualEntryForm.tsx` exposes Strength/Dosage form/Unit as editable prefills, and `addMedicineSchema` + `CreateMedicineWithPurchaseInput` carry the optional `type`. New pure mapper `domain/catalogPrefill.ts` (24 tests). **Gate E7 still blocks the feature: zero rows ship and the 21,000 count is not claimed.** Selection stays a READ; `createMedicineFromCatalog` was not built. |
| **W2-03** | English / Bangla / Banglish search | **DONE** (data layer); its UI surface rides on W2-02's wiring | — |
| **W2-01** | Medicine OCR completion | **2 of 3 gaps DONE; the third is BLOCKED on a founder decision** | DONE: the scanner-owned capture cleanup (`9bc08a6`), the sale-scan confirmation gate on BOTH scanners (`9e7d880`), and `captureOnly` recognition as an opt-in scanner capability (`ca7a7a4`). REMAINING: checkout's per-line prescription review — it adds cart lines on a money-path screen, so CLAUDE.md rule 10 puts it behind an explicit approval. See section 7.1 for the exact question and the proposal. `parseScannedInvoiceLines` and `onCaptureRecognition` are both in place and unused by `checkout.tsx` until then. |
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

**W2-02's UI wiring and two of W2-01's three gaps are COMPLETE.** Four local
checkpoints, nine mutation checks, every one failing the assertion it was aimed at.

| Checkpoint | What landed | Verification |
|---|---|---|
| `2b39062` | W2-02 catalogue UI wiring, + `domain/catalogPrefill.ts` (24 tests) | mobile+admin tsc 0; 54 files / 636 tests; 4 mutation checks |
| `9bc08a6` | W2-01 gap 6.2.2 — the scanner deletes its own capture on the OCR path only | mobile tsc 0; 45 files / 418 tests; 3 mutation checks |
| `9e7d880` | W2-01 gap 6.2.3 — the sale-scan confirmation sheet, on BOTH scanners | mobile tsc 0; 50 files / 614 tests; 3 mutation checks |
| `ca7a7a4` | W2-01 gap 6.2.4 (first half) — `captureOnly` recognition, opt-in by presence | mobile tsc 0; 5 files / 53 tests; 2 mutation checks |

H-9 seal re-verified: **34** Postgres migrations, same tail,
`h9_postmigration_checks.sql` SHA-256 still
`361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9`. No file was
added to `backend/supabase/migrations/`. The 41 pre-existing dirty paths are
untouched, and `origin/main` is still `51c5230` — nothing has been pushed.

### Deviations and judgement calls, all deliberate

1. **The confirmation gate went on BOTH scanners, not just `app/scan.tsx`**
   (CLAUDE.md rule 11). Plan section 6.2.3 names only `app/scan.tsx`, but
   `app/(tabs)/sale.tsx`'s in-screen scanner had the identical auto-add on an
   exact match — the same defect on the busier path. "It must never be
   skippable" cannot hold while one of two identical paths still commits on a
   misread. Barcode is untouched (Q1/EXCLUDED); tapping a search result or a
   barcode candidate is still a direct add, because those are explicit choices
   of a specific medicine rather than a misread.
2. **Manual Entry gained three visible fields** — Strength, Dosage form, Unit.
   The catalogue prefills exactly those, and a prefilled value the user can
   neither see nor correct must not reach the database.
3. **"`packSize` -> `unitOfMeasure` only when it names a unit"** is an allowlist
   of bare unit words in `domain/catalogPrefill.ts`; anything with a digit is
   dropped. `sale_items.unit_snapshot` copies that column at sale time, so a
   pack size like "1 x 10" must never become a unit or it lands on a receipt.
4. **`onCaptureRecognition` is opt-in by presence**, the idiom
   `onBarcodeRecognized` already uses, so no future `captureOnly` caller
   acquires OCR silently. Recognition failure on that path is folded to `null`
   and never reuses the retryable `cameraNoText` / `cameraReadFailed` branches.

### 7.1 BLOCKED — W2-01's last piece needs a founder decision

Everything for checkout's prescription OCR is now in place: the scanner hands
back the recognised text (`ca7a7a4`), and `domain/ocrText.ts`'s
`parseScannedInvoiceLines` already splits a multi-item list the way
`app/suppliers/purchase-create.tsx` proves. What is missing is the review UI,
and plan section 6.2.4 does not say what confirming a line DOES:

> "Lines are matched against the catalog and the shop's stock; each line is
> confirmed individually; unmatched or ambiguous lines stay in the list with a
> manual-search affordance and are **never** auto-added."

"Never auto-added" implies confirming adds the line **to the cart** — but this
is `app/sale/checkout.tsx`, after the cart, on the money path. Adding a line
there changes the sale total and must invalidate the confirmed quote.
**CLAUDE.md rule 10 therefore puts it behind its own approval.**

**The proposal, for approval:**

- Confirming a prescription line calls the cart store's existing `addItem` — the
  same path the Sale screen uses, with the same stock ceiling — and then
  `resetQuote()`, so the total is recomputed and the sale needs reconfirmation
  before it commits. No new write path, no second pricing implementation.
- Lines are matched with the existing `searchMedicinesForSale` plus
  `findExactNameMatch`. An exact single match offers Add; anything else stays in
  the list as unmatched with a search affordance. Nothing is ever auto-added.
- The recognised text lives only in component state and is never persisted.
- Recognition failure shows a non-blocking notice; the captured image is kept and
  the sale stays completable.
- The temporary prescription capture is still NOT deleted — gate E9 stands.

**If instead a confirmed line should only annotate the prescription and never
touch the cart, say so** — that is a materially different screen, and it is not
what "never auto-added" reads like.

**After that decision**, the order is: finish W2-01, then W4-10, then
W4-06 -> W4-07 -> W4-08 (largest, do last).

**Operational constraint:** never run the full `vitest` suite concurrently with a Codex
review. Under CPU contention `db/h7-pin-reservation.sqlite.test.ts` (5 s timeout, three
bcrypt cost-10 fixtures) and `db/inventory-ledger.sqlite.test.ts` (250 ms budget) fail
falsely; both pass in isolation (34/34). Baseline is 243 files / 5062 tests.

## 8. Closing sequence (only after all seven tasks are implemented)

focused tests → documentation (Gate 4's document set, plan §8) → **Codex FINAL ACCEPT**
→ selective GitHub push by explicit path → **CI PASS** → Batch 2 delivery report
distinguishing **CODE-COMPLETE**, **BLOCKED** and **DEVICE/PRODUCTION-VERIFIED**.

No Batch 2 task reaches DEVICE/PRODUCTION-VERIFIED in this batch: no physical-device run
is authorized and the founder's Galaxy A04s installation is off-limits.
**Do not start Batch 3.**
