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
                 fd9b21b  W2-01 prescription OCR review at checkout (2026-10-22)
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

**W2-01, W2-02 and W2-03 are code-complete (W2-02 still dataset-blocked by E7).
W4-10, W4-06, W4-07 and W4-08 are unbuilt.**

| ID | Task | State | Remaining |
|---|---|---|---|
| **W2-02** | Offline medicine catalogue | **code DONE (data layer + UI); DATASET NOT DONE** | nothing in code. UI wiring landed in `2b39062`: `catalogMedicineSearchProvider` is passed from `app/inventory/add-medicine.tsx`, selection re-reads via `getCatalogEntry` before the form opens, `SearchMedicineTab.tsx` renders strength/dosage form/pack size and guards overlapping queries with `domain/latestRequestGuard.ts`, `ManualEntryForm.tsx` exposes Strength/Dosage form/Unit as editable prefills, and `addMedicineSchema` + `CreateMedicineWithPurchaseInput` carry the optional `type`. New pure mapper `domain/catalogPrefill.ts` (24 tests). **Gate E7 still blocks the feature: zero rows ship and the 21,000 count is not claimed.** Selection stays a READ; `createMedicineFromCatalog` was not built. |
| **W2-03** | English / Bangla / Banglish search | **DONE** (data layer); its UI surface rides on W2-02's wiring | — |
| **W2-01** | Medicine OCR completion | **DONE** (all three gaps) | nothing. `9bc08a6` scanner-owned capture cleanup; `9e7d880` the confirmation gate on BOTH scanners; `ca7a7a4` opt-in `captureOnly` recognition; `fd9b21b` the per-line prescription review at checkout, with the founder-approved behaviour that a confirmed line calls the existing `addItem` then `resetQuote()`. Barcode untouched (Q1 EXCLUDED); capture cleanup on the `captureOnly` path still descoped (E9). |
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

**W2-01, W2-02 and W2-03 are code-complete.** Five code checkpoints, eleven
mutation checks, every one failing the assertion it was aimed at.

| Checkpoint | What landed | Verification |
|---|---|---|
| `2b39062` | W2-02 catalogue UI wiring + `domain/catalogPrefill.ts` (24 tests) | mobile+admin tsc 0; 54 files / 636 tests; 4 mutations |
| `9bc08a6` | W2-01 §6.2.2 — the scanner deletes its own capture, OCR path only | mobile tsc 0; 45 files / 418 tests; 3 mutations |
| `9e7d880` | W2-01 §6.2.3 — the confirmation sheet, on BOTH scanners | mobile tsc 0; 50 files / 614 tests; 3 mutations |
| `ca7a7a4` | W2-01 §6.2.4a — `captureOnly` recognition, opt-in by presence | mobile tsc 0; 5 files / 53 tests; 2 mutations |
| `fd9b21b` | W2-01 §6.2.4b — the per-line prescription review at checkout | mobile+admin tsc 0; 70 files / 804 tests; 2 mutations |

H-9 seal re-verified at every checkpoint: **34** Postgres migrations, same tail,
`h9_postmigration_checks.sql` SHA-256 still
`361a400a29025f2d859b4cd3e4f826afcdcd2c134a332b3412b9a2e0af1e2bd9`; the SQLite
chain is still 33 files. No migration was added by any of this. The 41
pre-existing dirty paths are untouched and `origin/main` is still `51c5230` —
**nothing has been pushed.**

### Deviations and judgement calls, all deliberate

1. **The confirmation gate went on BOTH scanners** (CLAUDE.md rule 11). §6.2.3
   names only `app/scan.tsx`, but `app/(tabs)/sale.tsx`'s in-screen scanner had
   the identical auto-add on an exact match. "Never skippable" cannot hold with
   one of two identical paths still committing on a misread. Barcode untouched;
   tapping a search result or a barcode candidate is still a direct add, because
   those are explicit choices rather than a misread.
2. **Manual Entry gained Strength, Dosage form and Unit** — the catalogue
   prefills exactly those, and a prefilled value the user can neither see nor
   correct must not reach the database.
3. **`packSize` -> `unitOfMeasure` is an allowlist of bare unit words**; anything
   with a digit is dropped, because `sale_items.unit_snapshot` copies that column
   and "1 x 10" would land on a receipt line. Re-check it against a real dataset.
4. **`onCaptureRecognition` is opt-in by presence**, so no future `captureOnly`
   caller acquires OCR silently; recognition failure there is folded to `null`
   and never reuses the retryable scan-error branches.
5. **A confirmed prescription line calls `addItem` then `resetQuote()`** — the
   founder approved this on 2026-10-22 after §6.2.4 was found to leave it open.
6. **`domain/prescriptionLines.ts` holds the matching**, not `checkout.tsx`:
   that screen was already 866 lines, over the 800 limit, and is 950 now.
   **Checkout is over the limit and worth a dedicated extraction pass** — not
   done here because it is unrelated refactoring of money-path code.

### 7.1 Next: W4-10, the SSLCommerz retirement

Founder constraints, given 2026-10-22 and binding:

- Disable **new** SSLCommerz payment initiation.
- Do **not** break historical payments, pending callbacks, or refund processing.
- bKash is blocked on E8, so new subscription payments **fail closed**.
- **Do not represent the product as payment-ready.**

The files, from §4: `functions/sync/_shared/paymentProvider.ts` (refuses
`sslcommerz`, no bKash branch); `functions/sync/billing.ts` uses it;
`apps/mobile/sync/billing.ts` must fail **locally, before** `createPaymentAttempt`
writes a row (`:77` -> `:85`); `app/settings/plan-payment.tsx` gets a
payment-unavailable state. Note `db/commercial.ts:467` writes the literal
`provider: 'sslcommerz'` and `db/schema.ts:325` constrains that column to it, so
the local attempt row cannot simply switch provider — which is why the refusal
has to happen before the row is written.

Then W4-06 -> W4-07 -> W4-08 (largest, do last).

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
