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
11. **Census the outbox before losing it.** First, **before** aeroplane mode in
    step 10, record a baseline: push until the queue holds no `pending` or
    `failed` row for this shop, and record `Q_sent` as the high-water mark. A
    census taken without that baseline cannot attribute a `pending` row to this
    offline window.

    Then capture, for this shop:

    | Symbol | Query | Meaning |
    |---|---|---|
    | `Q_pending` | `count(*) where status='pending'` | not marked sent |
    | `Q_failed` | `count(*) where status='failed'` | gave up retrying |
    | `Q_sent` | `count(*) where status='sent'` | acknowledged — NOT loss |
    | `Q_total` | all three | queue HISTORY, not loss |
    | **`Q_at_risk`** | **`Q_pending + Q_failed`** | **an UPPER BOUND on lost operations** |
    | `G_at_risk` | `count(distinct operation_group_id)` over those rows | business events affected |

    plus, and this is the part step 14 cannot work without, the **row identity
    set**: every `(table_name, row_id, op, status, operation_group_id)` among
    the at-risk rows, and each affected `operation_group_id` with its
    `operation_expected_count` and the number of its rows actually present.

    **`Q_at_risk` is an upper bound, not measured loss.** The outbox is
    at-least-once by design: `apps/mobile/sync/push.ts:258` completes the server
    call and only then marks rows sent individually (`:306`, `:313`), so a lost
    response or a crash between those two steps leaves an **already-applied**
    row `pending`, and eventually `failed`. Such a row is at risk on the device
    and present on the server. Only reconciling the row identities against the
    server turns the bound into a measurement — step 14(a).

    **`Q_total` is not the loss either.** A successful push sets `status='sent'`
    and deletes nothing (`apps/mobile/db/sync-helpers.ts:1804-1809`); the only
    production delete is the conflict `take_remote` path
    (`apps/mobile/db/conflicts.ts:362-383`). So `sent` rows accumulate for the
    life of the installation. See the 2026-11-04 addendum for the original
    wording and why it was corrected.

    Note also that `sent` is not proof the server KEPT the value: an equal
    `updated_at` makes `sync_apply_row`'s strict `<` predicate write nothing
    while still answering `applied` (`sync-helpers.ts:828-845`). Such a row is
    recorded in `conflict_queue`, so it is detectable — which is why step 14
    checks that table too.

    **`Q_total` is not the loss.** A successful push sets `status='sent'` and
    deletes nothing (`apps/mobile/db/sync-helpers.ts:1804-1809`); the only
    production delete is the conflict `take_remote` path
    (`apps/mobile/db/conflicts.ts:362-383`). So `sent` rows accumulate for the
    life of the installation, and a total count overstates loss by the whole
    synced history. See the 2026-11-04 addendum for the original wording and why
    it was corrected.

    Note also that `sent` is not proof the server KEPT the value: an equal
    `updated_at` makes `sync_apply_row`'s strict `<` predicate write nothing
    while still answering `applied` (`sync-helpers.ts:828-845`). Such a row is
    recorded in `conflict_queue`, so it is detectable — which is why step 14
    checks that table too.
12. **Destroy the device database.** Clear app data. This is the realistic
    failure: a corrupt database, a failed key unwrap, a reinstall.
13. **Recover.** Relaunch, sign in with phone + PIN, and let
    `recoverDatabaseFromServer` run its full `pullChanges(shopId, null)`. Record
    wall-clock time from launch to a usable dashboard.
14. **Reconcile what came back — three checks, never one.** The old single
    equality compared unlike units and could not be satisfied; see the
    2026-11-04 addendum. **No equality between unlike units may be used as a
    PASS criterion.**

    - **(a) Row IDENTITIES, not counts.** For each table, compute the SET of
      `(table_name, row_id)` present before the clear and after recovery. Every
      identity that is missing afterwards must appear in step 11's at-risk
      identity set with `op='insert'`, and every at-risk `insert` identity must
      be either missing (lost) or present (it had already reached the server —
      the at-least-once case). **Compare sets, never counts.** `sync_queue` has
      no uniqueness constraint tying one queue row to one business row
      (`apps/mobile/db/schema.ts:1366-1395`), so a retry can enqueue the same
      `row_id` twice and any count-to-count equality is wrong. A missing
      identity that is NOT in the at-risk set is loss outside the known offline
      window, and a blocker.
    - **(b) Values, row-addressed.** Every row whose identity is NOT in the
      at-risk set must match its pre-clear fingerprint exactly. For a row named
      by an at-risk `update` or `delete`, compare against the server: if the
      recovered value equals the server's, **recovery worked and the local edit
      is gone.** Record that as `recovery integrity: PASS` **and** add the row
      to the **known local value loss** set. It is not a pass of the drill's
      objective — see "Two verdicts" below.
    - **(c) Operation-group and conflict integrity.** No
      `operation_group_id` may be partially applied server-side;
      `apps/mobile/sync/push.ts:144-165` enforces `operation_expected_count`, so
      a half-landed group is a defect to report, not acceptable loss. Dump
      `conflict_queue` in full and account for every row. Also record the
      server's staging state for the affected groups — a group can be fully
      applied with every local row still `pending`, and the reverse.

    ### Two verdicts, never one

    The drill's stated objective is *"a restore-from-backup drill completes with
    **no irreversible loss**"*. A revision of step 14 that called a lost
    `cash_drawer` update a PASS because the server's older value came back would
    report success after confirmed business-value loss. So Part B reports two
    things, and the second governs:

    | Verdict | Meaning |
    |---|---|
    | **Recovery integrity** | Everything the server held came back correctly, and every device-side difference is explained by a row in step 11's at-risk set. |
    | **Known local value loss** | The set of rows whose local value is gone. |

    **The drill's no-irreversible-loss objective is PASS only when the known
    local value loss set is EMPTY.** A non-empty set may still be an acceptable
    product outcome — that is the founder's call, per CLAUDE.md's review
    workflow — but it is recorded as loss, not as a pass.

    **Units, stated once so they are never conflated again:** step 11's figures
    count QUEUE ROWS (operations); step (a) compares BUSINESS-ROW IDENTITIES.
    One business event produces several queue rows —
    `apps/mobile/db/sales.ts:685-692` computes the group size, and a one-item
    cash sale is 5-6 queue rows against 4-5 inserted business rows. The two are
    related only through the row identity set captured in step 11, which is why
    that set is mandatory rather than a convenience.
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
| Clean queue baseline before aeroplane mode (step 11) | zero pending/failed | _not run_ |
| Outbox census + row identity set (step 11) | all figures + every at-risk identity | _not run_ |
| Row identities reconciled (14a) | set comparison; every difference explained | _not run_ |
| Values returned (14b) | every non-at-risk fingerprint matches exactly | _not run_ |
| Operation-group + conflict integrity (14c) | no partial group; `conflict_queue` dumped and accounted | _not run_ |
| **Known local value loss** | **EMPTY for the no-irreversible-loss objective** | _not run_ |
| Money/stock reconciliation after restore | exact | _not run_ |
| Device-local stores reset (step 16) | as listed, shop id unchanged | _not run_ |
| Encryption migration, 21.8 MiB | — (record it) | _not run_ |
| Mid-migration kill | fails closed, no loss | _not run_ |

A drill with any row still reading *not run* has not been passed, and H-11 stays
open. Record the completed table in `DECISIONS.md` with the date and the device
model, the way H-3's sign-off was recorded.

---

## Addendum, 2026-10-31 - tooling verified; every row above is still *not run*

A local PG17 rehearsal was executed against two isolated
`public.ecr.aws/supabase/postgres:17.6.1.159` containers on loopback, with
synthetic data only. It verified the **tooling and the procedure**, and found four
defects in `h9_pg17_restore.md` (see that file's 2026-10-31 addendum).

**It changes no result in the table above, and none may be marked passed.** The
reasons are structural, not procedural:

- **Prerequisite 1 is still open**, though the documentation question is now
  settled and an earlier note here was wrong. Supabase's current Database Backups
  guide specifies **automatic backups for paid plans** and recommends **exports**
  for Free projects; and restoring into a **separate new project** *is* documented
  (its clone-project guide), but is **restricted to paid plans**. So the route
  exists and is simply not available on Free. What remains a founder dashboard
  read is which of these `btfprhticjgeihcngpif` actually offers today. The
  earlier claim that "nothing documents a separate-project restore" is retracted.
- **Prerequisite 2 is still open.** Part B (device restore) and Part C (the
  encryption migration at 21.8 MiB, plus the mid-migration kill) need a physical
  handset. `adb` is not installed and zero devices are attached. **C5 therefore
  cannot pass in any session without hardware**, however complete the server half
  becomes.
- **No real DEV data moved.** The DEV password is the founder's, by this
  project's own written rule, and is not in custody here.

The rehearsal did add a repeatable executor for Part A's capture step, but
**that executor was DELETED on 2026-11-01** after a fourth consecutive REVISE
whose verdict was "operational reliance: no" - a capture tool that can
mis-attribute a backup is worse than none. Part A's capture is therefore the
manual command shapes in `h9_pg17_restore.md` lines 87-89, which are unchanged
and authoritative. Nothing else in this drill depended on the executor.

---

## Addendum, 2026-11-02 - a device is attached; Part C is still blocked, and the reason has changed

A physical handset (SM-A047F, Android 14) was attached and used for other Batch
3 work on this date, so the 2026-10-31 statement that "`adb` is not installed
and zero devices are attached" no longer holds. Part C was re-examined against
real hardware. **Every row in the table above still reads `_not run_`, and none
may be marked passed.** What changed is the diagnosis.

**Prerequisite 4 is now satisfied.** `node scripts/generate-history-fixture.mjs`
produced **22,933,504 bytes (21.87 MiB)**, matching the documented 21.8 MiB,
exit 0. The next run starts at step 17 rather than at fixture generation.

**Steps 17-19 need to write a pre-migration database into app-private storage
and then SIGKILL the app mid-migration.** That requires a *debuggable* build.
What is on the device:

| Package | Debuggable | Usable for Part C |
|---|---|---|
| `com.muthoy.pos.preview` (the accepted artifact, `9ed99b4`) | **no** — and `allowBackup=false` | no: no `run-as`, no `adb backup`; the only ways in are rooting the founder's phone or replacing the live database, both out of bounds |
| `com.muthoy.pos.h3scratch`, `…h3scratch2` | **yes**, `run-as` works | no: Expo **dev-launcher** builds from 2026-10-06 that boot to `DevLauncherActivity` and need a Metro server; they do not carry the accepted revision |

Loading the accepted revision's JS into one of those dev clients over Metro was
considered and **rejected**: it would time Nov-2 JavaScript on an Oct-6 native
layer, and step 18 exists specifically to decide whether the *shipping* upgrade
needs a progress screen. A hybrid number cannot support that decision, and
recording one would be the same overclaim this drill already corrected once.

So the blocker is no longer "no device". It is precisely:

> **a debuggable build of the accepted revision.**

A debuggable build of `9ed99b4` makes steps 17-19 **executable** on the handset
already in hand, with the fixture generated and no founder data touched.

**Executable is not the same as representative, and step 18 needs both.** A
debug build differs from the shipped release in optimisation and packaging, so
its elapsed time does not by itself settle whether the real upgrade needs a
progress screen. Whoever runs this must state which build was timed and show
that its native dependencies and configuration match the shipping one, or
record the number as diagnostic only. The same objection is what ruled out the
Metro route above - it was never about the dates alone.

The alternative - approving the replacement of the Preview app's database - is
not recommended: it destroys the test shop that the Batch 3 device evidence
rests on.

---

## Addendum, 2026-11-04 — steps 11 and 14 corrected; every row above is still *not run*

Part B was executed on 2026-11-04 and is **NOT PASS**. In writing that up it
became clear that **steps 11 and 14 could not both be satisfied as written**.
The steps are corrected above under a scoped founder approval. No code, schema
or sync semantics were changed to suit the test. **No result row is marked
passed by this addendum.**

### The original signed text, verbatim

> 11. **Count the outbox before losing it.** Read the `sync_queue` row count. This
>    is the number Part B exists to measure — everything in it is what a device
>    restore cannot return.

> 14. **Count what came back.** Compare per-table row counts against step 10's
>     device state. The difference must equal exactly the step 11 outbox count — no
>     more. Anything beyond that is loss outside the known offline window, and a
>     blocker.

Result-table row, as signed: `| Rows lost on device restore | exactly the step
11 outbox count | _not run_ |`.

### Why it was wrong

Two independent defects, both verified in source:

1. **Step 11's "row count" overstates loss.** `markSyncRowSent` sets
   `status='sent'` and deletes nothing (`sync-helpers.ts:1804-1809`), and no
   purge exists anywhere — the single production delete is the conflict
   `take_remote` path (`conflicts.ts:362-383`). So the queue retains the whole
   synced history, and `Q_total` counts rows that are safely on the server.
   Only `pending + failed` is unrecoverable.
2. **Step 14 compared unlike units, so it was non-diagnostic.** Step 11's figure
   counts QUEUE ROWS; step 14's difference counts BUSINESS-TABLE ROWS. One
   business event emits several queue rows — `sales.ts:685-692` computes
   `1 + items×2 + credit + customer + attachment + drawer + 1`, so a one-item
   cash sale is 5-6 queue rows against 4-5 inserted business rows. Worse,
   `update` and `delete` operations emit a queue row and change **no** row
   count, so a lost edit leaves every count identical while a value is wrong —
   exactly the failure Part A was rewritten to catch ("The drill proves VALUES
   return, not that row counts match").

   An earlier version of this addendum called that equality "unsatisfiable" and
   said "no choice of arithmetic makes one number equal the other". **That was
   overstated:** the equality *can* hold by coincidence. The accurate claim is
   that it is **non-diagnostic** — it is incompatible with the grouped workload
   step 10 prescribes, and passing it proves nothing.

**What the correction preserves, and where it is now STRICTER.** Step 11's
original sentence is right about `pending` and `failed` and wrong only about
`sent`. But a first draft of this correction was itself rejected for being
*weaker* than the original: it declared a lost `cash_drawer` update a PASS
because the server's older value came back, which would report success after
confirmed business-value loss — something the original's blunt count-based rule
would mechanically have rejected. That is why step 14 now reports **two
verdicts**, and why the no-irreversible-loss objective passes only when the
known local value loss set is empty. The lesson is the same one as the run
itself: making a criterion *measurable* must not quietly make it *weaker*.

**The failure this came out of was mine, not the spec's.** The 2026-11-04 run
substituted "unsynced sale headers" for step 11's number and defended the
substitution. The right response to an ill-defined required measurement is to
report that it is ill-defined, not to quietly replace it.

### Required acceptance evidence for a Part B PASS

All eleven, or it is not a pass:

1. **Clean queue baseline** recorded before aeroplane mode — zero `pending` and
   zero `failed`, plus the `Q_sent` high-water mark.
2. Verified pre-clear device baseline (step 10 workload recorded: cash sale,
   credit sale, stock adjustment, expense).
3. Status-wise queue census — every figure in step 11's table.
4. The **row identity set**: every `(table_name, row_id, op, status,
   operation_group_id)` among the at-risk rows. Without this, 14(a) and 14(b)
   are not executable at all.
5. Post-recovery **set** comparison of row identities, per table, with every
   difference explained by item 4.
6. Value-level fingerprints, both sides of the clear, and **proof of their
   validity**: untruncated, row-addressable, covering every affected table, and
   stating which columns were hashed. A `null` or partial fingerprint is not
   evidence.
7. **Server staging state** for every affected `operation_group_id`, and a full
   `conflict_queue` dump with every row accounted for.
8. Exact money and stock reconciliation (step 15).
9. Auth / session / device-local reset checks (step 16), shop id unchanged.
10. Measured recovery duration (step 13), wall-clock.
11. **The known local value loss set**, explicitly — empty or enumerated. An
    absent item 11 is not an empty item 11.

### How the census is taken — corrected 2026-11-04, and simpler than it looked

An earlier version of this section claimed `sync_queue` "cannot be read from
outside the app process at any privilege" because `modules/muthoy-db-key` wraps
the SQLCipher key with a non-exportable AndroidKeyStore key, and concluded that
in-app instrumentation was therefore mandatory. **That claim was false for the
build Part B actually uses, and the instrumentation built on it was withdrawn.**

The Keystore protects the **wrapping** key. It does not protect the plaintext
the app legitimately derives from it. `MuthoyDbKeyModule.kt:20` says so in its
own words — the key *"never leaves this module **except as the hex string**"* —
`getOrCreateDatabaseKeyHexAsync` returns 64 hex characters to JavaScript
(`:104-110`), and `apps/mobile/db/databaseKey.ts:30,110` caches that plaintext
in module memory for the life of the process.

On a **debuggable** build — which is exactly what Part B and Part C require —
that plaintext is readable by an attached debugger. So the route is:

1. Attach to the debuggable DEV package and read the cached key hex.
2. `adb shell run-as <pkg> cat files/SQLite/<db>` to copy the ciphertext off.
3. Open the copy off-device with SQLCipher and query it with full SQL.

That yields **exactly** what the revised steps 11 and 14 need and what a
counts-only in-app census could not give: the complete
`(table_name, row_id, op, status, operation_group_id)` identity set, per-row
values, and arbitrary joins — with **zero application code**, no production
bytes, no new gate and no new attack surface. It is also why 14(a) can compare
identity sets rather than counts.

Two notes on scope. This route only works because the test APK is deliberately
debuggable; it is **not** a weakness of the shipped release, where the same
extraction needs a rooted device. And the key must be treated as a live
credential for the DEV test shop: it is never logged, pasted into a document,
or committed.

Still outstanding: the debuggable DEV APK, and a second founder-approved
app-data clear.
