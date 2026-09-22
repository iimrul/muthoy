# Restore drill

H-11 C3. The written procedure for the drill the Pre-RC plan requires: *"a
restore-from-backup drill completes with no irreversible loss."*

It has **not been run**. Running it is C5, against the finished Wave-2 build.
Nothing in this file may be recorded as passing until it has actually been
executed on a device and a project.

`pgtest/restore-baseline.pgtest.ts` executes the fingerprint and a
corrupt/compare/restore cycle in disposable PGlite PostgreSQL. That is automated
SQL and trigger validation only. It is not the C5 backup-provider restore
rehearsal and does not change any `_not run_` result below.

Read [../migrations/ROLLBACK.md](../migrations/ROLLBACK.md) first — it says which
migrations this drill is the only recovery path for (seven of twenty-six).

---

## Why it is a drill and not a runbook

The recovery code already exists and is proven in isolation: `db/databaseRecovery.ts`,
`sync/databaseRecovery.ts`, and H-3's copy-verify-swap were all signed off
2026-09-17 with an independent 0-diff verification. What has never been done is
running them **in sequence, under the conditions of an actual failure**, and
measuring what is lost. That gap is the whole point.

The drill's output is two numbers and one verdict:

- **Recovery time** — how long a shop is off the air.
- **Rows lost** — unpushed outbox work, counted rather than estimated.
- **Values returned** — the per-table digests from `restore_baseline.sql`,
  identical before and after. Row counts alone cannot see a corrupted amount.
- **Verdict** — did money and stock reconcile exactly afterwards.

---

## Prerequisites

| # | Item | Why it blocks |
|---|---|---|
| 1 | A backup capability decision on the Supabase project | The free tier's retention may not support a point-in-time restore. **Founder decision** — the drill cannot be designed around a capability the project does not have |
| 2 | A second Android device, or willingness to wipe the current one | "Restore onto a new device" is the case that matters |
| 3 | A DEV/staging Supabase project | This drill never runs against a project holding a real pharmacy's data |
| 4 | The year-of-history fixture | `node scripts/generate-history-fixture.mjs --out ./history.db` — default run: 97,165 rows / 21.8 MiB across 24 tables |

**Rule: no step in this document is ever executed against production.** Every
command below assumes a disposable project and a disposable device.

---

## Part A — server restore

The drill proves VALUES return, not that row counts match. A corrupted amount,
a rewritten category or a flipped payment type leaves every count identical —
which is exactly the corruption a pharmacy would care about and the first
version of this drill would have passed.

1. **Capture the canonical fingerprint.** Run `restore_baseline.sql` and save
   its output verbatim. It emits, per table, the row count, the summed paisa,
   and an `md5` digest over the ordered per-row values (ids, invoice numbers,
   totals, cash/credit splits, batch stock and prices, movement deltas, expense
   amounts). This file is the thing the restore has to reproduce.
2. **Record the surrounding state.** Run `ledger_invariant.sql` (check 0 =
   `PASS`, zero rows from checks 1-4, four triggers in check 5) and
   `supabase migration list --linked`. Nothing proceeds on a project already
   failing its own invariant.
3. **Take the backup**, using whatever capability prerequisite 1 settled on.
   Record what it covers — schema, data, or both — and its timestamp.
4. **Corrupt actual VALUES, not rows.** Pick a handful of real rows and record
   their before-values first. All three, so the drill covers money, attribution
   and stock:
   - a `sales.total` and its matching `cash_applied`, changed to a different
     amount (row count unchanged);
   - an `expenses.category`, rewritten to a different canonical value (the
     shape migration `20260823030000` performs, which is forward-only);
   - a `batches.stock`, moved away from the sum of its movements. Direct stock
     writes are correctly blocked by the production trigger. On the disposable
     database only, perform the update inside a transaction after
     `select set_config('muthoy.ledger_apply','on',true)`, the same guarded seam
     the ledger trigger itself uses. Never disable or drop the trigger. Confirm
     `ledger_invariant.sql` then fails, because a drill whose corruption the
     checks cannot see is not a test of anything.
5. **Prove the corruption is detectable.** Re-run `restore_baseline.sql`. The
   digests for `sales`, `expenses` and `batches` MUST differ from step 1, and
   the row counts MUST NOT. If a digest matches, the fingerprint is not
   covering the column that was changed and this file needs fixing before the
   drill continues.
6. **Restore.** Record wall-clock time from the decision to restore until the
   project accepts queries again.
7. **Prove the values came back.** Re-run `restore_baseline.sql` and diff it
   against step 1. **Every digest and every summed-paisa figure must match
   exactly.** A matching row count with a differing digest is a failed drill,
   not a partial pass.
8. **Re-run `ledger_invariant.sql`.** Same PASS criteria as step 2.
9. **Re-confirm the hosted settings a restore does not carry.** In particular
   `public.custom_access_token_hook` must still be selected in Supabase Auth
   Hooks — `README.md` flags it as a manual hosted setting migrations cannot
   preserve. Mint and decode a token; verify every Owner claim.

---

## Part B — device restore

10. **Populate a device and go offline.** Sign in, put the handset in aeroplane
   mode, then do real work: a cash sale, a credit sale, a stock adjustment, an
   expense. Record exactly what was done.
11. **Count the outbox before losing it.** Read the `sync_queue` row count. This
   is the number Part B exists to measure — everything in it is what a device
   restore cannot return.
12. **Destroy the device database.** Clear app data. This is the realistic
    failure: a corrupt database, a failed key unwrap, a reinstall.
13. **Recover.** Relaunch, sign in with phone + PIN, and let
    `recoverDatabaseFromServer` run its full `pullChanges(shopId, null)`. Record
    wall-clock time from launch to a usable dashboard.
14. **Count what came back.** Compare per-table row counts against step 10's
    device state. The difference must equal exactly the step 11 outbox count — no
    more. Anything beyond that is loss outside the known offline window, and a
    blocker.
15. **Reconcile money and stock.** `SUM(inventory_movements.change_qty)` per
    batch must equal `batches.stock`; the cash drawer's seven-term figure must
    match the server's view of the same day. Exact, not approximate.
16. **Check what should NOT have come back.** The device-local stores are not
    business data and are expected to be empty or rebuilt: the H-4 attempt
    budget, the pull cursor, printer pairing, locale, business-day state. Confirm
    the shop id is unchanged (CLAUDE.md rule 7) and that no previous owner's data
    is visible.

---

## Part C — migration timing at scale

17. **Load the fixture** from prerequisite 4 onto the device as an unencrypted
    database, in the state the H-3 migration expects as its input.
18. **Time the encryption migration.** Record the elapsed time and compare it
    against H-3's recorded 4.3–5.0 s for 249 rows / 811 KB. Whatever the real
    number turns out to be, it is what decides whether the upgrade needs a
    progress screen or a staged rollout.
19. **Force a mid-migration kill.** SIGKILL the app partway through and relaunch.
    The copy-verify-swap must fail closed onto the original file with no loss —
    H-3 proved this on a small database; this repeats it on a large one.

---

## Recording the result

| Measure | Target | Observed |
|---|---|---|
| Server restore time | — (record it) | _not run_ |
| Server row-count diff after restore | zero | _not run_ |
| `restore_baseline.sql` digests, before vs after | identical, every table | _not run_ |
| Corruption visible in the digests at step 5 | yes, counts unchanged | _not run_ |
| Corrupted `batches.stock` caught by `ledger_invariant.sql` | yes | _not run_ |
| `ledger_invariant.sql` after restore | PASS | _not run_ |
| Auth hook still selected after restore | yes | _not run_ |
| Device recovery time | — (record it) | _not run_ |
| Rows lost on device restore | exactly the step 11 outbox count | _not run_ |
| Money/stock reconciliation after restore | exact | _not run_ |
| Encryption migration, 21.8 MiB | — (record it) | _not run_ |
| Mid-migration kill | fails closed, no loss | _not run_ |

A drill with any row still reading *not run* has not been passed, and H-11 stays
open. Record the completed table in `DECISIONS.md` with the date and the device
model, the way H-3's sign-off was recorded.
