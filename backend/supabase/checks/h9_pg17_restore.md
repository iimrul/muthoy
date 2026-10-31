# H5 — verified DEV backup and isolated PG17 restoration

**F7 IMPLEMENTATION READY — HOSTED BACKUP/PG17 RESTORE PROOF PENDING**

No backup, restore, password retrieval or software installation occurred during
local remediation. PostgreSQL 18.6/PGlite 18 tests are supplemental only. The local
Docker daemon was unavailable; no image was downloaded or container started.

## Approval and isolation

H5 explicitly names DEV `btfprhticjgeihcngpif`, the backup directory, retention,
restoration owner, RPO/RTO and an EMPTY isolated local PG17 target. It does not
authorize DEV restore, database reset, deletion or running H-11's corrupt-values drill.
Founder already has the DEV password; do not reset it or put it in chat/arguments/logs.

Use an already approved, hash-pinned PG17 client and compatible PG17 server/image
matching the source's required Supabase extensions. Verify binaries with --version
and server_version_num >=170000 and <180000. A stock image/tag is not proof of
extension compatibility. Missing tools/extensions block; installation is separate.
The restore service points ONLY to 127.0.0.1, an approved unique port, database
`h9_restore_<run-id>` and independently recorded instance identity. No existing
database is reused. Disable schedulers/cron workers and outbound network access in
the isolated server before restoration; no hooks, SMS, platform clients or sync traffic.

## Reproducible sequence (only after explicit H5 approval)

1. Accept A5/A2/A3. Record API-verified DEV ref/org/name/region and live PG17 identity,
   exact 31-version history, source catalog, extension names/versions/schemas/owners,
   roles/memberships/ACL inventory, settings/hooks and function-source manifests.
   Verify endpoint tenancy in-session, not just a shared TLS wildcard certificate.
2. Approve a maintenance interval covering backup through migration acceptance, or
   a specific recovery/replay window. Pause all approved sync/admin writers and prove
   no in-flight operations remain. Phone OFF alone does not pause existing JWT traffic.
   If the interval is broken, invalidate the checkpoint and take a fresh backup.
3. Use owner-only encrypted backup storage outside repo/EAS archives, for example a
   new run directory under `%USERPROFILE%\.muthoy-secrets\backups\`. Verify ownership,
   no untrusted ACL writer or reparse path, encryption, available space and retention.
   Never enumerate/read an existing secrets directory as part of local preparation.
4. Founder enters the password through the approved protected prompt/one-use passfile
   workflow. No password argument, URL password, PGPASSWORD, transcript or debug log.
   Pin service/passfile paths and TLS verify-full with approved CA; reject arbitrary
   libpq overrides. The live backup executor needs its own reviewed target binding;
   the rehearsal-only F12 launcher must not be retargeted or modified.
5. Capture `restore_baseline.sql`, `ledger_invariant.sql`, catalog-v1 rows and full
   per-table count/value digests INCLUDING tombstones and Auth business dependencies.
   Existing restore_baseline's active-business subset is a critical check, not the
   entire completeness proof. Store sensitive failure details privately; print only
   check names/counts/status. Preserve original history rows/NULL statements.
6. Export a consistent custom-format schema-and-data archive using PG17 pg_dump,
   including auth/storage metadata and app schemas. No schema/data split from unrelated
   snapshots. With source writes frozen, capture globals using PG17 pg_dumpall
   `--roles-only --no-role-passwords`; retain authentic attributes/memberships separately.
   Never log database credential hashes or restore a blind globals script into a
   shared/managed server. Record every schema exclusion and why it is recoverable.
7. Record archive inventory (`pg_restore --list`), all files' SHA-256s and nonempty
   lengths. Compare source history/catalog/value/ledger fingerprints again while the
   pause holds. Any unexplained change invalidates the backup. Hashes prove integrity,
   not restorability. Create the manifest described below.
8. Independently verify the EMPTY isolated target identity/version/network isolation.
   Prepare actual required roles/extensions from the source inventory in the compatible
   local platform. Existing bootstrap roles must match source metadata; create only
   missing approved roles without passwords. Review role script and extension setup
   before executing; do not invent application metadata or silently ignore errors.
9. Restore to that NEW target with PG17 pg_restore, `--exit-on-error` and
   `--single-transaction`, preserving owners/privileges. Do not use --clean,
   --no-owner, --no-privileges or trigger-disabling shortcuts. Source-side dumps remain
   untouched. Roles/bootstrap setup precedes the archive transaction and is isolated.
10. Re-run the exact catalog/value/history/ledger checks. Verify all application FK
    relationships, constraints, index validity, triggers, RLS, owner/ACL/defaults,
    integer-paisa totals, movement-derived stock and required Auth bindings/sessions.
    Compare the full exported data set, including deleted rows. Preserve canonical
    before/after hashes; matching counts alone fail. Verify extension compatibility.
11. Confirm recovery coverage beyond PostgreSQL: actual Storage object bytes require
    a separately approved immutable object backup/recovery procedure; database bucket
    metadata alone is insufficient. Auth settings/hooks, API/Edge secrets, function
    sources, EAS/signing and provider state each require a named recovery source/owner.
    No real SMS/OTP or secret replay is part of this drill. Reconcile dispatch ledger
    versus provider outcomes before any future Phone restoration to avoid duplicate SMS.
12. Save commands with values suppressed, UTC times, exit codes, tool/image hashes,
    actual SQL results/digests, coverage decisions, elapsed recovery time, target
    identities and signed operational acceptance. Verify the receipt OFFLINE using
    `node scripts/h9/recovery-contract.mjs <manifest.json> <proof.json>`.

Command shapes, with protected services/passfiles configured only in the future
approved execution session (verify flags on actual PG17 binaries before use):

```text
<PG17-pg_dump> --dbname=service=h9_dev_verified --format=custom --file=<private-run>/database.dump
<PG17-pg_dumpall> --dbname=service=h9_dev_verified --roles-only --no-role-passwords --file=<private-run>/roles.sql
<PG17-pg_restore> --list <private-run>/database.dump
<PG17-pg_restore> --dbname=service=h9_restore_verified --exit-on-error --single-transaction <private-run>/database.dump
```

The service files contain independently verified host/user/database/port, TLS settings
and protected passfile path. They are not evidence artifacts and contain no password
in any command. Remove the one-use credential file through its approved lifecycle;
do not automatically delete backups, restore targets or retained evidence.

## Offline acceptance contract

Manifest v1 records source project/PG major, dump tool major, approval ID, UTC capture
and retention timestamps, owner, RPO/RTO, traffic pause, verified private ACL/encryption,
and exact path/SHA-256 files for `database`, `roles`, `extensions`, `sourceCatalog`,
`sourceValues`, `sourceLedger`, `authScope`, `storageRecovery`, `settingsHooks`,
`functionSources`. These are real output files/approved recovery receipts, not
invented success checkboxes. File hashes are checked by the offline validator.

Proof v1 binds the exact manifest SHA-256 (`JSON.stringify` representation), approved
loopback empty PG17 target, actual restore/extension/role/schema/FK/stock/money/Auth
results, Storage/settings recovery approvals, before/after catalog/value/ledger
hashes and elapsed time. Evidence assertions must reference the actual saved command
results and reviewed receipts. The validator checks consistency, not server attestation;
founder operational acceptance remains mandatory. Synthetic unit fixtures are never
accepted or reported as the real H5 proof. Any missing component or PG18 target refuses.

## Failure and DEV recovery

On dump/hash/restore/check failure: stop, preserve logs/backup and the isolated target,
report the failed check. Do not retry with ignored errors or altered business values.
No H6 migration approval until a new valid proof exists. H5 does not close H-11 C5.

If a later DEV migration fails: keep Phone OFF and approved traffic pause, preserve
device SQLite/outbox, inspect actual committed versions/catalog and per-file errors.
Do not assume the multi-file batch was atomic. Reconcile the exact checkpoint/RPO,
then obtain separate founder authorization for DEV recovery. No inverse grant set for
34, no corrective stock/money backfill, no reset/history repair. Historical 0818 is
conservatively forward-only regardless of the unchanged classifier's B label.

---

## Addendum, 2026-10-31 - the procedure executed against a real PG17 target

The paragraph at the top of this file recorded that *"The local Docker daemon was
unavailable; no image was downloaded or container started."* That is no longer
the case. Two `public.ecr.aws/supabase/postgres:17.6.1.159` containers were run on
**127.0.0.1 only** (ports 54329/54330), each `server_version_num = 170006`, each
carrying a **PG17.6 `pg_dump`** - which is how the PG17-client requirement is met
on a host whose own client is 18.6.

**Synthetic data only. No DEV credential was requested or used, and no hosted
project was contacted.** This does not close H-11 C5, and the rule stated above
still governs: *"H5 does not close H-11 C5."*

Four steps of the sequence above fail when executed literally, and each refusal is
recorded below. The two a machine can see - a PG17 client and a PG17 archive -
are enforced by `scripts/h11/dev-backup.mjs`, which **captures only**: an earlier
revision of it also restored, with emptiness and pg_cron gates fed from the
command line, which checked what the operator typed rather than what the target
held. Steps 8-10 stay a human operation with independent target verification.

1. **Step 8's "EMPTY isolated target" is unobtainable in the image's own
   `postgres` database.** It ships `auth`, `cron`, `vault` and `storage`
   pre-created, so step 9's restore - correctly forbidden from using `--clean` -
   aborts on `ERROR: schema "auth" already exists`. Only a freshly created
   database is empty (`public` + `plpgsql`).
2. **A `pg_cron`-enabled archive needs the scheduler's own database.** pg_cron
   refuses: *"can only create extension in database postgres... the pg_cron
   background worker reads job descriptions from this database."* With (1) the
   procedure as written has nowhere to put such an archive, because the only
   database it permits is the one that is never empty. **Scope, corrected after
   review:** on a *local* target `cron.database_name` is changeable with a server
   restart, so this is a **configuration requirement**, not an impossibility; on
   a hosted project, where the setting is not yours, it is a hard stop. **And it
   is a PROD-shaped problem either way; DEV has no pg_cron.**
3. **Step 9's "preserving owners/privileges" needs superuser.** Objects owned by
   `supabase_admin` require `SET ROLE supabase_admin`. Measured: `postgres` is
   `super=false` and is **not** a member of `supabase_admin`. A hosted project
   only ever grants `postgres`, so an owner-preserving round trip between two
   hosted projects is not available by this route.
4. **A postgres-owned synthetic SUBSET restores cleanly.** A source without
   pg_cron, restored by `postgres` into a fresh database: `pg_restore` **exit 0**,
   rows 2/2, and `SECURITY DEFINER`, owner and ACLs (`anon` denied,
   `service_role` granted) all preserved. **This is not DEV's shape**, and an
   earlier draft of this addendum said it was. DEV's recorded inventory
   (`docs/plans/h9-pg17-extension-verification-2026-10-19.md`) includes
   `supabase_admin`-owned extensions - precisely the ownership class that fails
   in (3) - which this fixture did not contain. Whether DEV itself restores
   cleanly remains **unmeasured**.

Also measured, correcting an assumption: **a dump DOES carry the schedule.**
`pg_restore --list` contains `TABLE DATA cron job`, because pg_cron marks its job
table for extension config dump.

Separately, migration 33 was applied verbatim against real `pg_cron 1.6.4` and
produced a job matching the PGlite stub in all seven columns. This is **not** the
first execution of that branch: `h9-verification-report.md` records migrations
32-33 applied on the 2026-10-15 hosted rehearsal with pg_cron enabled. The
difference is which half of the conditional ran. There, *"B2 created cron job 1
itself"*, so 33 took its `v_jobs = 1` verify branch. Here there was no
pre-existing job, so 33 took `v_jobs = 0` and called `cron.schedule` itself. Both
halves are now covered against real pg_cron.

Full record: `docs/plans/muthoy-batch-3-final-closure-execution-2026-10-31.md`.
