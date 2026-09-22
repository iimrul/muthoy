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
**A: 6 · B: 13 · C: 7 — of 26.**

PostgreSQL classifications: `20260813000000_initial_schema` (C) · `20260817000000_admin_read_grants` (A) · `20260817000100_sync_roles_read_grant` (A) · `20260818000000_inventory_movement_ledger` (B) · `20260818000100_sync_batches_stock_server_derived` (B) · `20260819000000_staff_device_login` (C) · `20260821000000_phase_b1_navigation_roles` (B) · `20260821010000_phase_b2_sales_inventory_sync` (C) · `20260822000000_owner_dashboard_credit_period` (A) · `20260822010000_b3_group1_shop_settings` (B) · `20260823000000_b3_group2_payment_note` (A) · `20260823010000_b3_group2_cash_reconcile` (A) · `20260823020000_b3_group2_sync_completion` (B) · `20260823030000_b3_group3_expense_category_taxonomy` (C) · `20260823040000_b3_groups456_schema_additions` (B) · `20260823050000_b3_groups456_sync_completion` (B) · `20260824000000_b3_group7_purchase_return_sync` (B) · `20260825000000_inventory_add_purchase_sync` (B) · `20260827000000_b3_group8_report_indexes` (C) · `20260827010000_b3_group9_sale_tax_snapshot` (B) · `20260831000000_b4_commercial_platform` (C) · `20260905000000_b4_canonical_onboarding` (B) · `20260907000000_h7_security_hardening` (B) · `20260907010000_h7_revoke_api_role_truncate` (A) · `20260907020000_h7_fix_pass_b` (C) · `20260909000000_h7_actor_binding_staff_reactivation` (B)

SQLite migration-time data writes: `0001` · `0002` · `0006` · `0007` · `0009` · `0010` · `0011` · `0012` · `0018` · `0024` · `0029`

SQLite table drops: `0006` · `0011` · `0012`
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

**A: 6 · B: 13 · C: 7 — of 26.**

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
for those seven. A migration applied without one has no way back at all.

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
