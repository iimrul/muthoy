# Rollback and recovery — per migration

H-11 C1 and C4. Companion to [README.md](README.md), which owns migration ORDER
and rollout STATUS. This file owns one question only: **when a migration turns
out to be wrong, what is the way back?**

It is deliberately not a set of `down.sql` files. A plausible-looking reverse
script for a step that cannot actually be reversed is worse than none — it
invites someone to run it at the moment they are least able to check it.

Nothing here has been rehearsed. The rehearsal is C5, against the finished
Wave-2 state. Treat this as the plan it is until that rehearsal signs it off.

> **Corrected 2026-09-20.** The first version of this table classified
> migrations by grepping for DML anywhere in the file, which counted `UPDATE`
> and `INSERT` statements living inside `CREATE OR REPLACE FUNCTION` bodies.
> Those are runtime code the migration *ships*, not data the migration
> *writes*. Seven migrations were marked forward-only on that mistake, and the
> headline count was wrong by the same seven. The classification is now
> produced by [`scripts/classify-migrations.mjs`](../../../scripts/classify-migrations.mjs),
> which strips function and trigger bodies first, and
> `apps/mobile/tests/migration-rollback-classification.test.ts` fails if this
> document stops matching it.

<!-- rollback-classification:start -->
**A: 8 · B: 19 · C: 9 — of 36.**

PostgreSQL classifications: `20260813000000_initial_schema` (C) · `20260817000000_admin_read_grants` (A) · `20260817000100_sync_roles_read_grant` (A) · `20260818000000_inventory_movement_ledger` (B) · `20260818000100_sync_batches_stock_server_derived` (B) · `20260819000000_staff_device_login` (C) · `20260821000000_phase_b1_navigation_roles` (B) · `20260821010000_phase_b2_sales_inventory_sync` (C) · `20260822000000_owner_dashboard_credit_period` (A) · `20260822010000_b3_group1_shop_settings` (B) · `20260823000000_b3_group2_payment_note` (A) · `20260823010000_b3_group2_cash_reconcile` (A) · `20260823020000_b3_group2_sync_completion` (B) · `20260823030000_b3_group3_expense_category_taxonomy` (C) · `20260823040000_b3_groups456_schema_additions` (B) · `20260823050000_b3_groups456_sync_completion` (B) · `20260824000000_b3_group7_purchase_return_sync` (B) · `20260825000000_inventory_add_purchase_sync` (B) · `20260827000000_b3_group8_report_indexes` (C) · `20260827010000_b3_group9_sale_tax_snapshot` (B) · `20260831000000_b4_commercial_platform` (C) · `20260905000000_b4_canonical_onboarding` (B) · `20260907000000_h7_security_hardening` (B) · `20260907010000_h7_revoke_api_role_truncate` (A) · `20260907020000_h7_fix_pass_b` (C) · `20260909000000_h7_actor_binding_staff_reactivation` (B) · `20260923000000_a23_device_registry` (B) · `20260926000000_a23_persistent_enrollment_holds` (B) · `20261001000000_h5_auth_sms_dispatch` (B) · `20261004000000_h5_sms_dispatch_claim_owner` (C) · `20261005000000_h5_revoke_auth_user_sessions` (B) · `20261008000000_h9_enrollment_hold_constraint_normalization` (B) · `20261008000100_h9_sync_staging_cleanup_schedule` (A) · `20261015000000_h9_api_role_table_privileges` (A) · `20261023000000_e4_batch3_admin_platform` (C) · `20261030000000_e4b_publication_snapshots` (B)

SQLite migration-time data writes: `0001` · `0002` · `0006` · `0007` · `0009` · `0010` · `0011` · `0012` · `0018` · `0024` · `0029` · `0033`

SQLite table drops: `0006` · `0011` · `0012` · `0033`
<!-- rollback-classification:end -->

---

## 1. The decision table (C4)

| Failure class | Symptom | Action | Who decides |
|---|---|---|---|
| **Deploy failure** | The migration aborted; the ledger shows it unapplied | Fix forward. Nothing ran, so nothing needs undoing | Engineer |
| **Additive step, wrong shape** | A new column/index/grant is wrong, nothing written through it yet | Reverse the single object (class A) | Engineer |
| **Function/policy regression** | A dispatcher or RLS policy refuses valid work | Re-deploy the previous definition from git (class B) | Engineer |
| **Backfill wrote wrong values** | A class C step produced wrong rows | **Restore from backup.** Never "correct" a backfill with a second backfill unless the prechecks proved the exact affected set | Founder |
| **Money or stock discrepancy** | `ledger_invariant.sql` fails, or a shop's cash/stock disagrees | **Stop. Restore from backup.** No forward fix touches money without the founder | Founder |
| **Device database unusable** | The SQLCipher migration failed, or SQLite is corrupt | No rollback exists on the device. Re-hydrate from the server (§3) | Engineer, then founder if any row is lost |
| **Cross-shop leakage** | A shop can read another shop's rows | Cut access first (stop the function deploy), then restore | Founder |

Two rules sit above the table:

1. **A backfill is never rolled back by another backfill** unless the precheck
   identified the exact rows. The expense-taxonomy and business-date steps both
   rewrite existing rows in place; a "corrective" second pass over a set nobody
   measured makes the loss permanent.
2. **Anything touching money or stock is the founder's call**, per CLAUDE.md's
   review workflow. Engineering proposes; it does not decide.

---

## 2. PostgreSQL — per migration

- **A — Reversible.** Purely additive objects. `ADD COLUMN` → `DROP COLUMN`,
  `CREATE INDEX` → `DROP INDEX`, `GRANT` → `REVOKE`. Safe only while nothing
  has written through the new object.
- **B — Redeployable.** Ships a function, policy, trigger or constraint whose
  previous definition is in git. Reverting is a deploy, not a data operation.
  **A class B migration is not harmless** — reverting H-7's hardening re-opens
  the cross-shop hole. It means the reverse exists, not that it is wise.
- **C — Forward-only.** The migration wrote or destroyed DATA. Recovery is
  restore-from-backup ([../checks/restore_drill.md](../checks/restore_drill.md)).
  An `ADD COLUMN` whose DEFAULT is volatile (`gen_random_uuid()`,
  `clock_timestamp()`, …) counts: PostgreSQL computes it for every existing row
  and writes it there, and no `DROP COLUMN` gives those values back. A constant
  or stable default writes no row and stays class A.

**A: 8 · B: 19 · C: 9 — of 36.**

The "why" column is the migration's own migration-time statement counts, with
function and trigger bodies excluded.

| Migration | Class | Migration-time statements |
|---|---|---|
| `20260813000000_initial_schema` | **C** | 4 function, 4 policy, 22 table, 43 index, 5 GRANT, 5 REVOKE — **declared override**: creates the whole schema, so the only reverse is dropping it |
| `20260817000000_admin_read_grants` | A | 2 GRANT |
| `20260817000100_sync_roles_read_grant` | A | 1 GRANT |
| `20260818000000_inventory_movement_ledger` | B | 4 DROP TRIGGER, 4 function, 4 trigger, 1 ADD COLUMN, 4 REVOKE |
| `20260818000100_sync_batches_stock_server_derived` | B | 1 function, 1 GRANT, 1 REVOKE |
| `20260819000000_staff_device_login` | **C** | 4 UPDATE, 1 DROP TABLE, 4 DROP FUNCTION, 1 DROP POLICY, 2 DROP TRIGGER, 13 function, 1 policy, 2 trigger, 3 table, 5 index, 1 ADD COLUMN, 20 GRANT, 13 REVOKE |
| `20260821000000_phase_b1_navigation_roles` | B | 2 function, 2 ADD COLUMN, 1 GRANT, 1 REVOKE |
| `20260821010000_phase_b2_sales_inventory_sync` | **C** | 2 UPDATE, 2 INSERT, 12 DROP POLICY, 12 function, 9 policy, 1 trigger, 13 table, 9 index, 20 ADD COLUMN, 8 GRANT, 17 REVOKE |
| `20260822000000_owner_dashboard_credit_period` | A | 1 ADD COLUMN |
| `20260822010000_b3_group1_shop_settings` | B | 1 function, 3 ADD COLUMN, 1 GRANT, 1 REVOKE |
| `20260823000000_b3_group2_payment_note` | A | 1 ADD COLUMN |
| `20260823010000_b3_group2_cash_reconcile` | A | 3 ADD COLUMN |
| `20260823020000_b3_group2_sync_completion` | B | 2 DROP CONSTRAINT, 2 function, 2 GRANT, 4 REVOKE |
| `20260823030000_b3_group3_expense_category_taxonomy` | **C** | 4 UPDATE, 4 DROP CONSTRAINT, 3 function, 1 GRANT, 5 REVOKE |
| `20260823040000_b3_groups456_schema_additions` | B | 2 DROP CONSTRAINT, 10 ADD COLUMN |
| `20260823050000_b3_groups456_sync_completion` | B | 4 DROP CONSTRAINT, 2 function, 2 GRANT, 4 REVOKE |
| `20260824000000_b3_group7_purchase_return_sync` | B | 2 DROP CONSTRAINT, 1 function, 1 GRANT, 3 REVOKE |
| `20260825000000_inventory_add_purchase_sync` | B | 3 DROP CONSTRAINT, 1 function, 1 GRANT, 2 REVOKE |
| `20260827000000_b3_group8_report_indexes` | **C** | 1 UPDATE, 3 index |
| `20260827010000_b3_group9_sale_tax_snapshot` | B | 2 function, 1 trigger, 3 ADD COLUMN, 1 GRANT, 1 REVOKE |
| `20260831000000_b4_commercial_platform` | **C** | 4 INSERT, 23 function, 5 trigger, 7 table, 10 index, 6 ADD COLUMN, 22 GRANT, 16 REVOKE |
| `20260905000000_b4_canonical_onboarding` | B | 2 function, 2 GRANT, 2 REVOKE |
| `20260907000000_h7_security_hardening` | B | 1 DROP FUNCTION, 18 DROP POLICY, 10 function, 12 policy, 8 GRANT, 8 REVOKE |
| `20260907010000_h7_revoke_api_role_truncate` | A | 1 REVOKE |
| `20260907020000_h7_fix_pass_b` | **C** | 1 INSERT, 1 DROP TRIGGER, 2 function, 1 trigger, 1 table, 1 GRANT, 4 REVOKE |
| `20260909000000_h7_actor_binding_staff_reactivation` | B | 1 function, 1 table, 1 GRANT, 2 REVOKE |
| `20260923000000_a23_device_registry` | B | 20 function, 1 trigger, 5 table, 7 index, 1 ADD COLUMN, 1 GRANT, 6 REVOKE |
| `20260926000000_a23_persistent_enrollment_holds` | B | 2 function, 1 GRANT, 2 REVOKE — persistent hold constraint + one-shot approval state machine |
| `20261001000000_h5_auth_sms_dispatch` | B | 2 function, 1 table, 3 index, 2 GRANT, 3 REVOKE — the SMS dispatch ledger: a new table with no grants, read and written only through its two service-role functions. Reverting is a redeploy; dropping the table loses only send history |
| `20261004000000_h5_sms_dispatch_claim_owner` | **C** | 1 volatile DEFAULT, 2 DROP FUNCTION, 2 function, 1 ADD COLUMN, 2 GRANT, 2 REVOKE — every dispatch claim names its owner, and both ledger functions are recreated with an owner parameter. The new column's `gen_random_uuid()` default writes a fresh owner into every existing row before it is dropped, so this migration writes data: forward-only. Those owners are held by no invocation, but the way back is still the data backup or a new forward migration, never a hand-written reverse. Applied with DEV's Phone provider paused — never the Send SMS hook — and the matching `auth-send-sms` deployed straight after (README.md, H-5 rollout) |
| `20261005000000_h5_revoke_auth_user_sessions` | B | 1 function, 1 GRANT, 1 REVOKE — one SECURITY DEFINER function, service_role only, that deletes ONE auth user's sessions (their refresh tokens and AMR claims cascade) for the two sync paths holding no JWT of that user: the auth-account rebind and `signOutAppUser`. The migration writes no data; reverting is `drop function`, and only together with the `sync` build that calls it — without it the rebind fails closed and `signOutAppUser` reports a failure |
| `20261008000000_h9_enrollment_hold_constraint_normalization` | B | 3 DROP CONSTRAINT — all inside one guarded DO block, which runs at migration time and which the classifier reads (its `$h9_normalize$` tag carries a digit, so the body-stripping pattern leaves it visible). Two of the three are the migration's own temporary NOT VALID probes; the third is the unnamed `device_enrollment_holds_check1`, dropped only after its stored parse tree proves it is the same rule as `device_enrollment_holds_consumption_check` (fresh bootstrap only; absent on DEV). Every other shape aborts the whole migration. It writes no data. Way back: none needed — the dropped constraint was an exact duplicate, so recreating it would change no behaviour |
| `20261008000100_h9_sync_staging_cleanup_schedule` | A | Nothing the classifier counts — scheduling goes through `cron.schedule`, which is not a counted statement — so A, where the master plan (§8.4) expected B. Without pg_cron it only raises a notice. With pg_cron it verifies, or creates through `cron.schedule`, the single `muthoy-b2-sync-staging-cleanup` job the B2 migration already schedules, and aborts on any mismatch instead of overwriting. It writes no application data. Way back, under approval: `select cron.unschedule('muthoy-b2-sync-staging-cleanup');` — staging graphs the job has already deleted are not recreated |
| `20261015000000_h9_api_role_table_privileges` | A | 7 GRANT, 5 REVOKE — textual classifier counts; no GRANT statement executes. One atomic guarded DO block normalizes held API table/sequence rights and postgres public defaults only. R4 adds exact 48-item platform-profile pre/post checks, all-creator global/schema default rules, CREATE and six-attribute guards over conservative Reach, and snapshots of every non-system schema, memberships and role attributes. Exact 25 column grants, service_role, function ACLs, RLS and shop data stay unchanged. Forward-only by choice: inverse grants reopen F12. See [R4 controls and verification](../../../docs/plans/h9-f12-r4.md). |

| `20261023000000_e4_batch3_admin_platform` | **C** | 3 function, 5 table, 5 index, 13 GRANT, 12 REVOKE — the first file added to this chain since H-9 sealed it at 34, and the reason the chain now has a SUCCESSOR acceptance check (`../checks/e4_postmigration_checks.sql`) rather than an edited one. Writes no data, so the mechanical rule calls it B. **Declared override to C**: the way back would mean dropping `admin_audit_log`, and an audit log you roll back by deleting is not evidence. Per-component reversal, for the record and not as a procedure: the two SELECT re-grants reverse by restoring the prior privileges (`sale_refunds` had select+insert+update+delete for service_role from `20260821010000`, `audit_logs` the hosted default); the five new tables reverse by `drop table`, which is what the override refuses; and W4-05's two wrappers reverse by redeploying the previous definitions from git and renaming `_pre_w405` back — a deploy, not a data operation. Applied to no hosted project by this batch: see [the E4 runbook](../../../docs/plans/e4-migration-and-rollback.md) |
| `20261030000000_e4b_publication_snapshots` | B | 2 function, 2 trigger, 1 table, 1 index, 2 DROP TRIGGER, 2 GRANT, 2 REVOKE — the E4-B successor, and the first migration whose class was a DESIGN CONSTRAINT rather than an outcome. It would have been C had the published figures been their own append-only evidence store, and a second class-C migration is a second thing whose only recovery is the restore H-11 C5 has never rehearsed. So the publication EVIDENCE is written to `admin_audit_log` (already C) inside the same transaction, and `financial_publications` is the SERVING copy: `drop table` loses what the panel reads, not the record of what was published, and a later republish at a different value would contradict the audit log. Reverses by `drop table public.financial_publications` and `drop function public.publish_financial_snapshot(...)`, in that order. **The reversal does NOT make a published period publishable again:** the RPC reads `admin_audit_log` and refuses a period that was published before but whose serving row is absent, because a second value for one period is the difference the table exists to prevent. **That guard is exactly as strong as audit retention** — truncating `admin_audit_log` reopens it, which takes a privileged session (migration 35 grants `service_role` only INSERT and SELECT, so the panel cannot), and retention is an operator decision taken outside the application. Applied to no hosted project by this batch. |

> **Open finding — H-9 Batch A, 2026-10-14 (not acted on here).** The
> classifier strips every dollar-quoted body whose tag is letters or
> underscores only, and that includes `DO` blocks, which run at migration
> time. (The two H-9 migrations use digit-bearing tags, so their `DO` bodies
> stay visible; that is why migration 32 counts as B.) Measured by exposing
> every `DO` body in memory: exactly one existing classification changes —
> `20260818000000_inventory_movement_ledger`, whose top-level `BACKFILL` `DO`
> block writes synthetic movement rows for any pre-ledger batch, would be
> **C**, not B. The "backfills nothing" note in the table below predates that
> check. Correcting the classifier changes this signed-off H-11 tool and its
> test, so it awaits the founder's approval as separate work. Until then,
> plan any recovery past 0818 as forward-only — in practice it already is,
> behind the class C `20260819000000` and `20260821010000`.

### What changed from the first audit

Seven migrations were wrongly marked forward-only because DML inside their
function bodies was counted as migration-time mutation:

| Migration | Was | Is | The statements counted were |
|---|---|---|---|
| `20260818000000_inventory_movement_ledger` | C | B | Inside the four trigger/ledger functions it installs. The migration itself backfills nothing |
| `20260823020000_b3_group2_sync_completion` | C | B | Inside the two dispatcher functions |
| `20260823050000_b3_groups456_sync_completion` | C | B | Inside the two dispatcher functions |
| `20260827010000_b3_group9_sale_tax_snapshot` | C | B | Inside the snapshot trigger function. Sales are stamped as they are written, not retroactively |
| `20260905000000_b4_canonical_onboarding` | C | B | Inside `b4_onboard_owner`, which runs per registration |
| `20260909000000_h7_actor_binding_staff_reactivation` | C | B | Inside the binding function |
| `20260813000000_initial_schema` | C | C | Unchanged, but now for a DECLARED reason rather than an inferred one |

Two further descriptions were wrong in the first version and are corrected in
the table above: `20260831000000_b4_commercial_platform` replaces no policies
(it creates none and drops none), and `20260821000000_phase_b1_navigation_roles`
performs no policy swap — it adds two columns and ships two functions.

### What every class C row depends on

`README.md`'s "Required sequence for future migrations" already requires a
schema **and** data backup at step 2. That backup is the entire recovery path
for those eight. A migration applied without one has no way back at all.

---

## 3. Local SQLite — there is no rollback

The device runner applies Drizzle migrations forward, in journal order, with no
down-migration mechanism. That is not an omission waiting to be fixed: a
pharmacy phone has no operator, no backup window and no second attempt, so the
device's recovery story is re-hydration rather than reversal.

**The recovery path:** clear app data → relaunch or reinstall → phone + PIN
through `sync/databaseRecovery.ts`'s `recoverDatabaseFromServer`, which runs a
full `pullChanges(shopId, null)`. Whatever the server holds comes back.

**What it cannot return** — which is what a device rollback actually costs:

- Any row still sitting unpushed in the `sync_queue` outbox. Offline work since
  the last successful push is lost. Measuring that number is a C5 deliverable.
- Device-local state that is deliberately never synced: the H-4 attempt budget,
  the pull cursor, printer pairing, locale, business-day state. All rebuild
  themselves; none is business data.

Applying the same body-stripping rule to the 30 local migrations, the ones that
write DATA at migration time — where a half-applied upgrade is most expensive —
are:

`0001` · `0002` · `0006` · `0007` · `0009` · `0010` · `0011` · `0012` · `0018` ·
`0024` · `0029`

(The first audit listed seven of these and missed `0001`, `0009`, `0011` and
`0012`.) Of those, `0006`, `0011` and `0012` also **drop tables**, which no
re-run can undo. `0004`, `0028` and `0029` drop indexes, which are re-creatable.

### The encryption migration is separate

H-3's plain → SQLCipher step (`db/encryptionMigration.ts`) is a
copy-verify-swap, not a schema migration: the original file is retained until
the copy verifies byte-for-byte, so an interrupted run fails closed onto the
original rather than a half-converted file. Rehearsed on a populated clone and
signed off 2026-09-17.

What has **not** been measured is how long it takes at real scale — the only
figure is 4.3–5.0 s for 249 rows / 811 KB on one low-end device.
`scripts/generate-history-fixture.mjs` exists to close that gap, and C5 should
be timed against it.

---

## 4. What is still owed (C5)

This document is a plan. None of it is rehearsed. Before RC:

1. Restore drill executed end to end ([../checks/restore_drill.md](../checks/restore_drill.md)),
   including its value-and-hash comparison — row counts alone do not detect a
   corrupted amount.
2. Encryption-migration timing measured against the year-of-history fixture.
3. A forced mid-migration kill, on device, confirming the fail-closed path.
4. The unpushed-outbox loss in §3 measured, not estimated.

Until then, no row in §1 may be described as tested.
