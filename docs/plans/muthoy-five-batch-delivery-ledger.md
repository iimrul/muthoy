# Muthoy POS — delivery ledger (SIX batches)

**Purpose:** one place that says which task sits in which delivery batch, and
what each batch's status actually is.
**Last updated:** 2026-10-23 — **the founder extended the delivery grouping from
FIVE batches to SIX.** The filename still says `five-batch` deliberately: other
documents and several commit messages reference that path, and renaming would
break them for no gain. This file is the authoritative ledger and it now
describes **six** batches.

> The six batches are **delivery groups**, not replacement development phases.
> The project roadmap is still the original Waves 1–5
> (`docs/plans/pre-rc-master-plan.md`). A batch says *when work ships together*;
> a wave says *what it is*.

Status is tracked on **two independent axes**, because conflating them is how a
green test suite starts being read as a shipped feature:

- **CODE-COMPLETE** — implemented, and covered by automated tests that were run.
- **DEVICE/PRODUCTION-VERIFIED** — `DEVELOPMENT_RULES.md` Definition of Done
  clauses 2 and 3: tested on a real Android device, offline, with its Validation
  Checklist passing. Nothing reaches this axis without a physical run, and no
  amount of automated coverage substitutes for it.

| Batch | Tasks | CODE-COMPLETE | DEVICE/PRODUCTION-VERIFIED |
|---|---:|---|---|
| **1** | **9** | **YES** — all nine, suite green at exit 0 | **NO** — none. Device work was outside this batch's authorization. Acceptance gates listed below |
| **2** | **9** | **YES for six of the seven implemented tasks**; **W2-03 PARTIAL**; W4-09 not implemented (E8) and W5-16 excluded | **NO** — none. Pushed at `c25924e`, CI green |
| 3 | 21 | not started — owns H-9 hosted/recovery, **W4-04 + W4-05**, **W2-03's remaining shop-medicine search**, and the durable admin audit table | not started |
| 4 | 18 | not started — owns the **Batch 1 external acceptance gates** (H-6 two-device, H-8 provider/device) | not started |
| 5 | 6 | not started — RC gates. May PREPARE the pilot and release checklist, but **final launch sign-off is BLOCKED until Batch 6 is accepted** | not started |
| **6** | **2** | not started — **B6-01** the real licensed medicine dataset (E7) and **B6-02** the direct bKash merchant gateway (E8 / W4-09). **No third deliverable** | not started |

---

## Batch 1 — code-complete, pending device validation

Nine tasks. Every one carries its own tests; the full suite is green at exit 0.

| ID | Task | Before | After | Evidence |
|---|---|---|---|---|
| **W3-01** | H-6 conflict queue — durable detection + persistence | H-6 `NOT DONE`; `conflict_queue` existed since migration `0000` with **no writer at all** | **CODE-COMPLETE** | migration `0031`, `db/conflicts.ts`, `domain/serverOwnedFields.ts`, detector in `db/sync-helpers.ts`. 14 + 15 + 18 tests |
| **W3-02** | Conflict resolution UI — permission-aware | no surface; a conflict was invisible on both sides | **CODE-COMPLETE** | `app/sync-conflicts.tsx`, `domain/conflictTables.ts`, route rule. 15 + 12 tests |
| **W3-04** | H-8 monitoring core | nothing existed; `dev/runtimeDiagnostics.ts` said *"H-8 will add deliberate observability"* | **core CODE-COMPLETE; H-8 itself stays `NOT DONE`** | `domain/errorRedaction.ts`, `monitoring/*`, wired into `db/init.ts` + `sync/index.ts`. 13 + 11 tests |
| **W3-06** | Payment integration testing | provider contract covered; the **pipeline** was unreachable (`Deno.serve` at import time) | **CODE-COMPLETE** | `payment-webhook/handler.ts` extracted; 23 + 24 tests |
| **W3-08** | Localization (D8/D9 + verified siblings) | 6 screens rendered English under `locale=bn` | **CODE-COMPLETE — gap closed 2026-10-21** | 74 catalog keys ×2 locales; all 6 screens fully localized including enum slugs, table names and thrown errors; `tests/localization-and-ui-consistency.test.ts` (42) pins them — 17 planted shapes and 5 planted non-shapes prove the detector can still fail |
| **W3-09** | Inventory refresh on focus (D10) | load-once-on-mount; list stale after Add Medicine | **CODE-COMPLETE** | `useFocusEffect` + `latestRequestGuard` |
| **W3-10** | UI consistency (D11, Alert→Toast, tokens) | 3 hand-rolled headers had no top inset; taps at y ≤ 45px swallowed | **CODE-COMPLETE** | inset context in 3 headers; 1 success Alert → Toast; 4 raw hex → `auth-heroEnd` |
| **W3-11** | Core workflow regression | per-feature suites existed; nothing tested them **in sequence** | **CODE-COMPLETE** | `db/core-workflow-regression.sqlite.test.ts`, 18 tests, plus `db/push-replay.sqlite.test.ts` for at-least-once delivery |
| **W5-15** | DEV credential exposure assessment | reported, uninvestigated | **ASSESSED — NO EXPOSURE FOUND** | `muthoy-w5-15-dev-credential-assessment-2026-10-20.md`. No rotation |

### Reassigned OUT of Batch 1 → Batch 3

| ID | Task | Status | Why |
|---|---|---|---|
| **W4-04** | Admin revenue correction (gross → refund-net) | **BLOCKED — DEFERRED TO BATCH 3.** Never DONE | needs a `service_role` SELECT grant on `sale_refunds`; **no Postgres migration can enter the chain** without overwriting hash-pinned H-9 evidence |
| **W4-05** | Shop sync permissions (Owner-controlled fields) | **BLOCKED — DEFERRED TO BATCH 3.** Never DONE | needs a `sync_apply_row` wrapper — same seal |

**The seal, precisely.** Adding any file to `backend/supabase/migrations/` breaks:

1. `scripts/h9-prod-preflight.mjs:232` — asserts exactly 34 migrations and that
   the H-9 files are the chain **tail**;
2. `backend/supabase/checks/h9_postmigration_checks.sql:369-382` — asserts
   `count(*) = 34`, all three H-9 versions present, and
   `not exists (… where version > '20261015000000')`. **Pinned `text eol=lf` in
   `.gitattributes` "for every file whose SHA-256 is recorded as H-9 evidence"**;
3. `backend/supabase/pgtest/h9-cron-cleanup.pgtest.ts:406` — records every
   migration and then expects those checks to pass.

(2) is founder-signed-off sealed evidence. Batch 3 owns extending the chain and
its checks in one reviewed step, which is where the migration would be applied
anyway.

**What is preserved for Batch 3, and what is deliberately NOT half-built:**

- The full W4-04 analysis — the full-refund-only model and its three enforcement
  points, `business_date` on **both** sides, the `unique(shop_id, sale_id)`
  guarantee, and the shared-`packages/utils` placement required by
  `DEVELOPMENT_RULES.md` — is recorded in `muthoy-batch-1-plan.md` §2.
- The full W4-05 design — the owner-role gate, field-level pinning as
  independent defence, and the **five required ACL statements** (including
  revoking `service_role` from the renamed `_pre_w405` implementation) — is
  recorded in the same section.
- **No partial admin wiring ships.** An admin panel that reads `sale_refunds`
  without the grant would fail `42501` in production, so the code lands with the
  migration, not before it.

### Interim safety boundaries while these two are blocked

1. **The admin dashboard still reports GROSS sales.** Its label is unchanged and
   is **not** to be described as net revenue anywhere.
2. **No shop-location or permission-dependent shop-profile feature may be
   released** before W4-05 acceptance.
3. **No production or pilot sign-off** with these blockers open.

### Future acceptance criteria for the deferred pair

| Task | Accepted when |
|---|---|
| W4-04 | the dashboard figure is refund-net on `business_date` for **both** sales and refunds; the subtraction has exactly one definition in `packages/utils`; full-refund, cancelled and duplicate-impossible cases proven; `adminGrants.test.ts` passes with `sale_refunds` granted SELECT to `service_role` and nothing else |
| W4-05 | a manager holding a `settings_manage` override can no longer write `shops`; identity fields are pinned for any non-owner reaching the dispatcher; the renamed `_pre_w405` implementation is unreachable by every role; and **no currently-working path is refused** (owner registration, `b4_mutate_owned_shop`, and a staff sale/stock/cash push all still pass) |

---

## What each later batch still owns

- **Batch 2 (9)** — **IMPLEMENTED 2026-10-21 to 2026-10-22; six tasks
  CODE-COMPLETE and W2-03 PARTIAL; not pushed and not device-verified.** Seven
  executable tasks were implemented:
  **W2-01** medicine OCR completion, **W2-02** the offline catalogue
  mechanism, **W2-03** Bangla / English / Banglish search (was **PARTIAL** — the fold reached the catalogue path only; **COMPLETED in Batch 3** by SQLite migration 0033 and the union query), **W4-06** admin
  auth / RBAC / audit / sessions (Basic Auth retired), **W4-07** the six admin
  management pages, **W4-08** three bounded admin write actions, and **W4-10**
  SSLCommerz retirement. Evidence:
  `docs/plans/muthoy-batch-2-implementation-2026-10-21.md`.

  **Two of the nine are NOT implemented, by decision:**
  - **W4-09 direct bKash — BLOCKED on E8.** Three undocumented contract
    surfaces (the callback request contract, the `Authorization` value format,
    the signature/IPN verification procedures). Its design and the verified
    contract are preserved in `docs/plans/bkash-integration-runbook.md`.
    **Implementation and live acceptance are assigned to Batch 6 as B6-02**
    (founder decision 2026-10-23; previously recorded as moving to Batch 4).
  - **W5-16 barcode scanning — EXCLUDED** (Q1, founder decision).
    **Barcode remains EXCLUDED and is not to be reintroduced into any batch
    without an explicit decision.** OCR works independently with manual
    confirmation; the barcode code that already shipped is neither deleted nor
    extended.

  **New gates opened by this batch:**
  - **E7 — the medicine dataset.** The catalogue MECHANISM is complete and
    **empty**. No licensed source exists: DGDA (authoritative) reports ~34,000
    products behind an expired TLS certificate and publishes no bulk licence,
    and the ~21,000 figure in the original scope line traces to an unlicensed
    Kaggle scrape of medex.com.bd. **Zero rows ship and the 21,000 count is
    not claimed.** See `docs/plans/medicine-catalog-provenance.md` for the
    four conditions a verified count requires. **Owned by Batch 6 as B6-01**
    (founder decision 2026-10-23).
  - **E8 — the bKash contract**, above. **Owned by Batch 6 as B6-02.**
  - **E9 — prescription capture cleanup on the `captureOnly` path**,
    descoped after five designs each proved unsafe. Existing durable captures
    are preserved and no destructive cleanup was introduced.

  **E5 (the payment gate Batch 1 left open) is CLOSED by founder decision:**
  SSLCommerz is no longer approved and direct bKash is the only approved
  subscription gateway. Since bKash is blocked, the shipped state is that the
  product has **no active subscription payment path at all** — the safe,
  fail-closed posture, which must not be described anywhere as a working
  payment integration.

  **Still blocked and untouched:** W4-04 and W4-05 (Batch 3), the H-9
  migration seal (E4 — no Postgres migration was added, and
  `backend/supabase/deploy/batch2-admin-audit.sql` stays outside the chain),
  and shop location/map, which needs an `update` grant on `shops` that does
  not exist. An effective-ACL pgtest now proves that absence rather than
  assuming it.
- **Batch 3 (21)** — **IMPLEMENTED 2026-10-26. CODE-COMPLETE on both local
  axes; NOTHING device-verified and NOTHING hosted.** See
  `docs/plans/muthoy-batch-3-implementation-2026-10-26.md` for the evidence
  record and `docs/plans/admin-architecture-rbac.md` for the per-page
  acceptance checklist.

  **Closed locally in Batch 3:**

  | Task | State | Evidence |
  |---|---|---|
  | **E4** the migration-chain successor | **CLOSED LOCALLY.** Migration 35 written, four gates re-pointed to an exact-set successor check, a new hash-verified evidence manifest | `e4-admin-platform`, `e4-chain-succession`, `e4-evidence-manifest`; `docs/plans/e4-migration-and-rollback.md`. **Hosted application is gate E4-H and was NOT performed** |
  | **W4-04** refund-net pharmacy sales | **CODE-COMPLETE.** One shared `netSalesPaisa`, consumed by the mobile reports and the admin panel, both sides windowed on `business_date` | `packages/utils/src/netSales.test.ts`, `platformStats.test.ts`, the mobile report regressions |
  | **W4-05** owner-controlled shop sync | **CODE-COMPLETE.** The permission gate plus the independent field-level identity pin; no working path refused | `w405-shop-identity.pgtest.ts` |
  | **W4-06** admin audit, awaited | **CODE-COMPLETE.** Awaited on every sensitive path including denials, with `actor_verified` and the committed-but-unaudited outcome | `docs/plans/admin-audit-security.md` |
  | **W2-03** multilingual shop-medicine search | **COMPLETE — no longer PARTIAL.** SQLite migration 0033, a chunked transactional backfill, and a permanent raw-OR-folded union query | `w203-shop-medicine-search.sqlite.test.ts` (35 tests); `docs/plans/w203-shop-medicine-search.md` |
  | **E11** the unsafe entitlement refresh | **WITHDRAWN from the panel.** It extended paid access with no payment behind it. The RPC itself is unmodified — rewriting it is money-path SQL and needs its own approved plan | `adminGrants.test.ts` forbids the RPC by name |
  | **The eleven Admin Panel pages** | **ALL CODE-COMPLETE** | `adminRoutes.contract.test.tsx` (81 tests); per-page record in `admin-architecture-rbac.md` |

  **Still open and NOT closed by Batch 3:** H-9 hosted/recovery execution
  (ON HOLD, with the uncommitted working-tree paths and the H1/F12/N0/PG17
  evidence preserved **byte-identical**), H-11's C5 restore rehearsal (needs a
  real backup provider), and the external gates E1, E4-H, E5, E10, E12, E13,
  E14 and E15 — enumerated with their owners in
  `docs/plans/release-readiness-checklist.md`.

  **Inherited from Batch 2, unresolved (added 2026-10-23):**
  - **W2-03's remaining half — multilingual search over EXISTING SHOP
    MEDICINES.** Batch 2 shipped the Bangla/English/Banglish fold and applied it
    to the catalogue path only; `db/sales.ts` and `db/purchases.ts` still pass
    raw input to `medicines_fts`, so shop-inventory search is single-script.
    Closing it requires **a SQLite migration adding a folded search-key column
    to `medicines` plus an FTS index rebuild**, over a search index every
    existing shop depends on — so it is subject to Batch 3's approved migration
    and device-safety gates, not to be slipped in as a patch.
    **CLOSED IN BATCH 3** by migration `0033_medicine_search_key.sql`, a
    chunked transactional backfill and a permanent raw-OR-folded union query.
    One limit is recorded rather than hidden: the fold has no `c`/`k` rule, so
    the English spelling "seclo" does not reach a row stored as "সেক্লো". That
    is a gap in W2-02's shipped fold, asserted by a test, and widening it would
    change the national catalogue's index semantics.
    **Real Android-device acceptance is still NOT claimed.**
  - **The durable admin audit table.** SQL staged out-of-chain at
    `backend/supabase/deploy/batch2-admin-audit.sql`, never executed, **BLOCKED
    on E4**. Batch 2 ships the stderr and ring-buffer sinks behind the same
    interface, so landing it changes no call site; until it lands, the in-app
    `/audit` view is per-instance and non-durable and **stderr is the record of
    account**.
  - **Phase 3 of any payment-function rollout** (revoke and drop the superseded
    5-argument `b4_apply_verified_payment` signature), which stays a separate
    later change by design.
- **Batch 4 (18)** — remaining pre-RC hardening, **plus the two external
  acceptance gates Batch 1 could not close**:
  - **H-6 two-device convergence.** A forced conflict between two physical
    devices on one shop, resolved from each side. Batch 1's coverage is
    synthetic, with both devices' clocks simulated in one process.
  - **H-8 provider + device acceptance.** A real monitoring provider with a DSN,
    and a forced failure in each of the five classes observed arriving. Batch 1
    shipped the redaction core and a no-op sink only.
- **Batch 5 (6)** — RC gates. Batch 5 **may prepare** the pilot, the release
  checklist and its other assigned launch activities, but **final public launch
  and full-feature production sign-off stay BLOCKED until the Batch 6
  deliverables and every other applicable release gate are accepted.** Six
  delivery groups is not permission to launch an incomplete product.
- **Batch 6 (2)** — **added by founder decision 2026-10-23. EXACTLY TWO
  DELIVERABLES, and no third.** Supporting tests, documentation, security review
  and the required deployment/device acceptance belong **inside** these two; they
  are not separate Batch 6 tasks.

  - **B6-01 — the real ~21,000-medicine dataset (owns E7).** Obtain and verify a
    legally usable, appropriately licensed dataset; verify source provenance,
    actual record count, duplicates, quality and update rights; integrate the
    verified records through the **existing Batch 2 architecture** (catalogue
    schema, JSONL importer, search provider, offline lookup) rather than
    rebuilding it; verify offline availability, integrity, updates and device
    performance.
    **Never scrape an unlicensed database and never fabricate entries to reach
    21,000.** ~21,000 is a product TARGET, not permission to invent records: the
    verified count is reported truthfully whatever it turns out to be. Existing
    shop-specific medicine, inventory, purchase and sales records are preserved.
    Conditions a verified count must meet:
    `docs/plans/medicine-catalog-provenance.md`.
  - **B6-02 — the direct bKash merchant payment gateway (owns E8, implements
    W4-09).** bKash is the **ONLY** approved subscription gateway, and
    **SSLCommerz is never reactivated for new subscription payments** — W4-10's
    retirement stands. Use the verified official bKash merchant API and security
    contracts; implement secure initiation, callback verification, idempotency,
    reconciliation and failure recovery; obtain the required sandbox and live
    acceptance. Historical payment data and the legacy reconciliation behaviour
    that still settles pre-retirement orders are preserved.
    **Never invent an API contract, a credential or live payment evidence.** The
    verified contract, the three undocumented surfaces that block it, and the
    two-identifier problem are in `docs/plans/bkash-integration-runbook.md`.

  **Neither deliverable may be marked DONE before actual evidence exists** —
  a licensed dataset with a measured count for B6-01, and a real sandbox/live
  payment run for B6-02.

  **No duplication:** E7 and E8 are owned here and **nowhere else**. Batches 3,
  4 and 5 do not carry them, and Batch 2's records keep their historical
  statements with dated ownership addenda rather than being rewritten.

---

## Carried forward from Batch 1, explicitly not closed

| Item | Why it stays open |
|---|---|
| **H-8** | stays `NOT DONE`. W3-04 shipped the core only: no provider, no payment/auth/crash coverage, no device proof. The repository gate wants all five failure classes visible in a real provider |
| **H-6 physical two-device test** | Batch 1 proves conflict detection and resolution synthetically on real SQLite with both devices' timestamps simulated. The physical two-device run is **not** claimed — the same gap H-7's convergence row already carries |
| **Push-side detection blind spot** | only the provable case is queued (exact timestamp equality + a differing client-owned field). If a dropped row's server timestamp never advances past this device's pull cursor, the row is never re-sent and no client-side mechanism can see it. Closes only with a server-side `'stale'` return from `sync_apply_row` — a migration **and** a function redeploy |
| **Legacy `sales_returns` with NULL `refund_id`** | `db/reports.ts` INNER JOINs them away, so the canonical report already ignores them. Pre-existing; Batch 1 neither introduces nor fixes it |
| **Pre-existing unguarded map lookups in the printer helpers** | `app/end-of-day.tsx:25`, `app/reports/monthly-report.tsx:26` and `app/settings/printer-settings.tsx:19` index a label map with a printer error code (`map[code]`). An inherited name such as `constructor` resolves a function off `Object.prototype`, which is truthy and so defeats the `?? map.unknown` fallback, rendering `undefined`. **Pre-existing** (commits `9f48fac`, `04e373b`); not Batch 1 work and deliberately not changed here. Low reachability — the code comes from the native printer layer, not from user input — and degraded text rather than a crash. The equivalent lookups in Batch 1's own code are guarded by `ownKey()` and asserted by a test |
| **No stack capture in monitoring** | deliberate. A safe stack needs a validated module-id allowlist that does not exist yet, and a stack's first line is the error message |

---

## Why Batch 1 says CODE-COMPLETE and not DONE

`DEVELOPMENT_RULES.md` clause 2 of the Definition of Done requires a real
offline Android-device test, and clause 3 a passing Validation Checklist. This
batch was authorized for local code, tests, documentation and a conditional
selective push only — physical-device operations need separate approval, and the
founder's Galaxy A04s installation is explicitly off-limits.

So every Batch 1 row above is **implemented and automatically tested**, and
**none** of them has met clauses 2–3. The remaining gap per task is listed in
`muthoy-batch-1-implementation-2026-10-20.md` under *Remaining external
verification*. Calling these DONE would be the exact failure clause 2 exists to
prevent — *"AI said it works is NOT done."*

**W3-08's partial gap is CLOSED** (2026-10-21). `inventory/batches.tsx`,
`inventory/expiry.tsx` and `sale/held.tsx` are now fully localized — field
labels, section titles, placeholders, the expiry-band names, the in-stock and
days-left suffixes, and the batch-form field errors. All six screens now sit in
one tier in the ratchet; the two-tier list that let three of them be held to a
weaker standard is gone.

---

## Exact remaining external verification gates

Nothing in Batch 1 can pass these from a workstation. Each needs a physical
device, a hosted environment, or a founder decision.

| # | Gate | Owner batch | What specifically must happen |
|---|---|---|---|
| E1 | **Batch 1 device validation** | pre-pilot | Run each Batch 1 feature on a real Android device, offline, against its Validation Checklist. Until this happens no Batch 1 task is DONE, however green the suite is |
| E2 | **H-6 two-device convergence** | 4 | Force a real conflict between two physical devices on one shop and resolve it from each side. Batch 1's coverage simulates both clocks in one process |
| E3 | **H-8 provider + device acceptance** | 4 | A real provider with a DSN, and a forced failure in each of the five classes observed arriving. Batch 1 shipped redaction and a no-op sink |
| E4 | **Migration-chain extension** | 3 | The H-9 seal pins the chain at 34. W4-04 and W4-05 cannot ship until it is deliberately extended with its hash-recorded evidence re-established |
| E5 | **Payment provider decision** | **CLOSED by the founder** | Decided: SSLCommerz is no longer approved, direct bKash is the only approved subscription gateway. W4-10 retired SSLCommerz initiation; delivery of bKash is **Batch 6, B6-02**. The analysis below is kept as the record of what was true when the question was open |
| E6 | **Live payment acceptance** | **6 — B6-02** (was 5) | Real bKash merchant credentials plus sandbox and live validation. Currently fails closed: no provider is active at all after W4-10 |
| E7 | **Real licensed medicine dataset** | **6 — B6-01** | A legally usable, licensed dataset with verified provenance, a MEASURED record count, duplicate and quality checks, update rights, and offline availability proven on a device. Zero catalogue rows ship today and the ~21,000 figure is not claimed |
| E8 | **bKash merchant contract** | **6 — B6-02** | The official callback request contract, the `Authorization` value format, and the signature/IPN verification procedures, from bKash onboarding material — plus merchant credentials and the unpublished live base URL. Until then no callback or signature path may be written |
| E9 | **Prescription capture cleanup (`captureOnly`)** | **documented, descoped** | Not a pending gate: five designs each proved unsafe, so the rule is that existing durable captures are preserved and no destructive cleanup is introduced. Recorded in `docs/plans/ocr-and-multilingual-search.md` |

### E5 — the payment provider question, stated plainly

A bKash-only requirement was raised during closure. I could not verify it, and
what the repository actually records contradicts it:

- **The locked decision says SSLCommerz.** `DECISIONS.md` (2026-08-31, "B4
  commercial platform locked") records *"SSLCommerz is first provider."* No
  bKash-only requirement appears anywhere in the repo, in any document.
- **The shipped W3-06 tests exercise SSLCommerz, not bKash** — 23 webhook tests
  and 24 integration tests, plus the pre-existing provider and billing suites.
- **There is no bKash subscription gateway implementation to test.** The bKash
  references are: `payments.method` (how a shopkeeper records that a *customer*
  paid by bKash — unrelated to subscriptions) and the legacy
  `subscriptions.payment_provider` enum at `db/schema.ts:92`, which lists
  `bkash` alongside `sslcommerz`, `stripe` and `manual`. The path that actually
  creates a payment is narrower still: `db/schema.ts:325` types the order
  `provider` as `["sslcommerz"]` **only**, and the backend payment orders match.
  No bKash initiation, validation, callback or webhook code exists anywhere.
- **SSLCommerz is currently the only active option.** `db/commercial.ts` hard-codes
  `provider: 'sslcommerz'` when creating an order, and the plan-payment screen
  shows it as the single pre-selected choice.
- **It cannot take a real payment today.** With no credentials configured the
  provider throws `payment_not_configured` (503) and fails closed, so no money
  can move either way while this is decided.

**Why I did not act on "ensure SSLCommerz is not an active supported payment
option":** doing so would change money-handling code, contradict a signed-off
decision, and leave the product with **no** subscription payment path at all,
because the bKash replacement does not exist. CLAUDE.md rule 10 puts money code
behind an approved plan and rule 11 requires saying so rather than quietly doing
something different. The safe posture is already in place (fails closed), so
nothing is at risk while the founder decides between:

  **(a)** keep SSLCommerz as the recorded first provider, and treat bKash as a
  later addition to the existing provider abstraction; or
  **(b)** make bKash the only provider — which means a new gateway
  implementation, retiring the SSLCommerz path, superseding the 2026-08-31
  decision in `DECISIONS.md`, and re-doing W3-06 against bKash.

Either way it is a planned piece of work, not a closure item.
