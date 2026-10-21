# Muthoy POS — five-batch delivery ledger

**Purpose:** one place that says which task sits in which delivery batch, and
what each batch's status actually is.
**Last updated:** 2026-10-21 (Batch 1, Gate 5 — after Codex final review)

> The five batches are **delivery groups**, not replacement development phases.
> The project roadmap is still the original Waves 1–5
> (`docs/plans/pre-rc-master-plan.md`). A batch says *when work ships together*;
> a wave says *what it is*.

| Batch | Tasks | Status |
|---|---:|---|
| **1** | **9** | **CODE-COMPLETE** — all nine implemented and automatically tested; device validation (Definition of Done clauses 2–3) outstanding. 2 tasks reassigned out (below) |
| 2 | 9 | not started |
| 3 | 21 | not started — owns the H-9 hosted/recovery work **and the two tasks reassigned from Batch 1** |
| 4 | 18 | not started |
| 5 | 6 | not started |

---

## Batch 1 — code-complete, pending device validation

Nine tasks. Every one carries its own tests; the full suite is green at exit 0.

| ID | Task | Before | After | Evidence |
|---|---|---|---|---|
| **W3-01** | H-6 conflict queue — durable detection + persistence | H-6 `NOT DONE`; `conflict_queue` existed since migration `0000` with **no writer at all** | **CODE-COMPLETE** | migration `0031`, `db/conflicts.ts`, `domain/serverOwnedFields.ts`, detector in `db/sync-helpers.ts`. 14 + 15 + 18 tests |
| **W3-02** | Conflict resolution UI — permission-aware | no surface; a conflict was invisible on both sides | **CODE-COMPLETE** | `app/sync-conflicts.tsx`, `domain/conflictTables.ts`, route rule. 15 + 12 tests |
| **W3-04** | H-8 monitoring core | nothing existed; `dev/runtimeDiagnostics.ts` said *"H-8 will add deliberate observability"* | **core CODE-COMPLETE; H-8 itself stays `NOT DONE`** | `domain/errorRedaction.ts`, `monitoring/*`, wired into `db/init.ts` + `sync/index.ts`. 13 + 11 tests |
| **W3-06** | Payment integration testing | provider contract covered; the **pipeline** was unreachable (`Deno.serve` at import time) | **CODE-COMPLETE** | `payment-webhook/handler.ts` extracted; 23 + 24 tests |
| **W3-08** | Localization (D8/D9 + verified siblings) | 6 screens rendered English under `locale=bn` | **CODE-COMPLETE (partial — 3 screens only partly localized)** | 38 catalog keys ×2 locales; 6 screens; `tests/localization-and-ui-consistency.test.ts` (24) pins them |
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

- **Batch 2 (9)** — the next wave slice. Not scoped here.
- **Batch 3 (21)** — H-9 hosted/recovery execution (currently ON HOLD, with 40
  uncommitted working-tree paths and the H1/F12/N0/PG17 evidence preserved), the
  migration-chain extension, **W4-04 and W4-05**, and H-11's C5 restore
  rehearsal.
- **Batch 4 (18)** — remaining pre-RC hardening.
- **Batch 5 (6)** — RC gates.

---

## Carried forward from Batch 1, explicitly not closed

| Item | Why it stays open |
|---|---|
| **H-8** | stays `NOT DONE`. W3-04 shipped the core only: no provider, no payment/auth/crash coverage, no device proof. The repository gate wants all five failure classes visible in a real provider |
| **H-6 physical two-device test** | Batch 1 proves conflict detection and resolution synthetically on real SQLite with both devices' timestamps simulated. The physical two-device run is **not** claimed — the same gap H-7's convergence row already carries |
| **Push-side detection blind spot** | only the provable case is queued (exact timestamp equality + a differing client-owned field). If a dropped row's server timestamp never advances past this device's pull cursor, the row is never re-sent and no client-side mechanism can see it. Closes only with a server-side `'stale'` return from `sync_apply_row` — a migration **and** a function redeploy |
| **Legacy `sales_returns` with NULL `refund_id`** | `db/reports.ts` INNER JOINs them away, so the canonical report already ignores them. Pre-existing; Batch 1 neither introduces nor fixes it |
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

Also carried: **W3-08 is partial**. `inventory/batches.tsx`,
`inventory/expiry.tsx` and `sale/held.tsx` have their verified defects fixed and
locked by a static ratchet, but their wider surface (field labels, section
titles, some placeholders) is still English. That is owed work.
