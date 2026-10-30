# H9 — final isolated PG17 runtime verification, 2026-10-19

**STATUS: PASS — synthetic runtime verification only. Real H5 restore acceptance
remains PENDING.** This new record preserves the previous PARTIAL report and logs.

## Execution and guard correction

Founder approved exactly one replacement. Used the existing local
`supabase/postgres:17.6.1.136`, Linux/amd64, pinned to
`sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`.
No pull, install, hosted call, real backup/restore, migration, deployment, device
action, commit or push.

Focused guard tests **21/21 PASS before creation**: accept the disabled display
only with effective archive_mode=off, empty applied command/library, approved
configuration source, no pending restart and no archiver activity. Unsafe modes,
masked commands/libraries, missing/overridden/unapplied config, wrong sources,
pending restart, archiver processes/activity and missing evidence are refused.
Node's subprocess test runner encountered sandbox spawn EPERM; the same test file
then ran in process, 21/21, before creation. Both receipts retained.

Live startup and final observations independently passed that tested guard:

- pg_settings: archive_mode=off; archive_library empty; archive_command displayed
  `(disabled)`; all three from the approved config, pending_restart=false.
- pg_file_settings: exactly three applied, error-free archive settings; actual
  mode off, command empty, library empty. Only the fresh config supplied settings.
- pg_stat_archiver: archived_count=0, failed_count=0, no last archived/failed WAL.
- Backend types: client backend, checkpointer, background writer, walwriter only.
  No archiver, cron, network, replication, autovacuum or other worker backend.

## Runtime and extension results

Actual server **PostgreSQL 17.6**, x86_64, server_version_num **170006**.
pg_dump, pg_dumpall, pg_restore, psql, initdb and pg_ctl all **17.6**.
Fresh initdb and Unix-socket readiness passed.

All five exact versions were available and successfully installed. Catalog
comparison matched the retained DEV inventory exactly, including schemas/owners:

| Extension | Version | Schema | Owner |
|---|---|---|---|
| pg_stat_statements | 1.11 | extensions | postgres |
| pgcrypto | 1.3 | extensions | postgres |
| plpgsql | 1.0 | pg_catalog | supabase_admin |
| supabase_vault | 0.3.1 | vault | supabase_admin |
| uuid-ossp | 1.1 | extensions | postgres |

The synthetic postgres owner was created NOSUPERUSER NOLOGIN. Three extensions
were installed through a temporary bootstrap administrator, then REASSIGN OWNED
preserved their postgres ownership; the installer role was removed. This proves
owner-name compatibility, not authentic DEV role attributes/memberships/ACLs.
No production requirement was changed or substituted.

Synthetic PL/pgSQL, pgcrypto digest, UUID v4, pg_stat_statements access, inserts,
updates, deletes, FK ON DELETE CASCADE, savepoint rollback and transaction rollback
passed. Vault installed in vault schema with an empty secrets table; encryption,
key recovery and encrypted-value restoration were not exercised.

## Isolation and cleanup

Created only `h9-pg17-verify-20261019-58a0ea01e6`, ID
`2880af6b7d82f31a6b19df314b65464c86a88c55d109372ddbe1eb0219b95a67`.
Image/config inspected first; no image-declared volumes. Image entrypoint/config
and initialization hooks bypassed. Healthcheck disabled. Fresh include-free PG
config preloaded only pg_stat_statements; key/restore/archive hooks empty,
max_worker_processes=0, logical workers/wal senders=0, autovacuum off,
cron.launch_active_jobs=off and cron.enable_superuser_jobs=off.
No pg_cron/pg_net/supautils/pgsodium extension or event trigger was installed.

Docker network none; loopback only, zero routes and zero IPv4/IPv6 TCP sockets.
No published ports, host binds, existing or anonymous volumes. Private tmpfs for
data/socket/temp storage, read-only root, UID/GID 100:101, all capabilities dropped,
no-new-privileges, private IPC, restart=no. Identity/isolation inspected before
start and during cleanup. Only this container started; PID 1 was inert sleep.

PostgreSQL stopped cleanly; the owned container was stopped/removed and tmpfs
discarded. Completion **2026-10-19T15:23:48.9487638Z** / **21:23:48 Asia/Dhaka**.
After cleanup, exact **12 container IDs, 3 volume names and 14 image IDs** matched
baseline. All old containers exited; their start/stop timestamps unchanged;
zero containers running. No old stack resumed. Volume byte hashes were not taken.

All **131 protected H1 hashes**, **47 previous runtime evidence hashes**, N0 and
extension runtime manifest hashes matched. H1/F12/N0 work was not rerun or edited.
Historical SOURCE_REVISION and stale audit hash facts remain intact. New execution
pins identify uncommitted bytes on base
`354fa2a70597cb3c40c459e480530674c85eff21`; containing runtime commit is null.

## Evidence and remaining gates

Sanitized receipts: `audit-artifacts/h9-pg17-runtime-final/`:
`runtime-verification.json`, `runtime-output.log`, `runtime-stderr.log` (empty),
both archive snapshots/guard logs, guard test receipts, creation/execution command
receipts, execution pins, preservation receipts and `evidence-manifest.json`.
Shell SHA-256: `650227f1a6d05386dc8a5bad0bf0f6b467d32342e41d57062cf1d229093d029e`.
Fresh self-review verified recorded results, exact extension parity, source pins
and unchanged old-container timestamps. No broad audit/review loop.

**No blocker remains for this runtime scope.** The reviewed H5 contract still needs
A5/A2/A3 acceptance, explicit real backup/restore scope, source roles/memberships/
ACLs, approved credential/backup custody and traffic pause, real archive and
catalog/data/history/ledger parity, Vault key recovery and broader recovery coverage.
This receipt is not an H5 acceptance manifest or proof. Both Free projects remain
preserved; no allocation, upgrade or deletion decision changed.

**Exact next action:** prepare the run-specific H5 approval plan with those remaining
gates, private backup destination, retention, RPO/RTO and isolated restore identity.
Real backup/restore requires separate authorization under
`backend/supabase/checks/h9_pg17_restore.md`.

Files changed: this report, appended DECISIONS.md,
`scripts/h9/pg17-archive-guard.mjs`, `scripts/h9/test/pg17-archive-guard.test.mjs`,
and ignored sanitized execution/evidence files. No prior report rewritten.
Suggested commit, not executed: `chore(h9): verify isolated PG17 runtime compatibility`.
