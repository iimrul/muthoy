# Muthoy POS — five-batch delivery ledger

**Purpose:** one place that says which task sits in which delivery batch, and
what each batch's status actually is.
**Last updated:** 2026-10-21 (Batch 1 final closure reconciliation)

> The five batches are **delivery groups**, not replacement development phases.
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
| 2 | 9 | not started | not started |
| 3 | 21 | not started — owns H-9 hosted/recovery **and W4-04 + W4-05** | not started |
| 4 | 18 | not started — owns the **Batch 1 external acceptance gates** (H-6 two-device, H-8 provider/device) | not started |
| 5 | 6 | not started | not started |

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
  mechanism, **W2-03** Bangla / English / Banglish search (**PARTIAL**: the fold reaches the catalogue path only — shop-inventory search stays single-script until a Batch 3 SQLite migration), **W4-06** admin
  auth / RBAC / audit / sessions (Basic Auth retired), **W4-07** the six admin
  management pages, **W4-08** three bounded admin write actions, and **W4-10**
  SSLCommerz retirement. Evidence:
  `docs/plans/muthoy-batch-2-implementation-2026-10-21.md`.

  **Two of the nine are NOT implemented, by decision:**
  - **W4-09 direct bKash — BLOCKED on E8.** Three undocumented contract
    surfaces (the callback request contract, the `Authorization` value format,
    the signature/IPN verification procedures). Its design and the verified
    contract are preserved in `docs/plans/bkash-integration-runbook.md`.
    Implementation and live acceptance move to **Batch 4**.
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
    four conditions a verified count requires.
  - **E8 — the bKash contract**, above.
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
- **Batch 3 (21)** — H-9 hosted/recovery execution (ON HOLD, with the
  uncommitted working-tree paths and the H1/F12/N0/PG17 evidence preserved), the
  migration-chain extension, **W4-04 and W4-05 (still BLOCKED — see above)**,
  and H-11's C5 restore rehearsal.

  **Inherited from Batch 2, unresolved (added 2026-10-23):**
  - **W2-03's remaining half — multilingual search over EXISTING SHOP
    MEDICINES.** Batch 2 shipped the Bangla/English/Banglish fold and applied it
    to the catalogue path only; `db/sales.ts` and `db/purchases.ts` still pass
    raw input to `medicines_fts`, so shop-inventory search is single-script.
    Closing it requires **a SQLite migration adding a folded search-key column
    to `medicines` plus an FTS index rebuild**, over a search index every
    existing shop depends on — so it is subject to Batch 3's approved migration
    and device-safety gates, not to be slipped in as a patch. Until then
    **W2-03 stays PARTIAL and multilingual medicine search is NOT accepted.**
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
- **Batch 5 (6)** — RC gates.

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
| E5 | **Payment provider decision** | founder | See below. Needs a decision before any payment work, not an engineering fix |
| E6 | **Live payment acceptance** | 5 | Real gateway credentials and sandbox/live validation. Currently fails closed with no credentials configured |

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
