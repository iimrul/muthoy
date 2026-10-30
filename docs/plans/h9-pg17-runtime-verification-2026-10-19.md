# H9 — isolated PG17 runtime verification, 2026-10-19

**STATUS: PARTIAL.** PostgreSQL 17.6 started and accepted a local connection.
An incorrect test assertion stopped execution before extension installation and
synthetic SQL checks. No runtime compatibility PASS or real H5 acceptance.

## Scope and image

Founder approved exactly one disposable container, including synthetic local writes
and cleanup. No hosted connection, credential access, backup, restore, migration,
deployment, download, installation, device action, commit or push occurred.

Existing local image: `supabase/postgres:17.6.1.136`, `linux/amd64`, pinned as
`docker.io/supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`.
Image identity/platform were inspected before container creation; pull was disabled.

The image's default entrypoint is `docker-entrypoint.sh`, command is
`postgres -D /etc/postgresql`, PGDATA is `/var/lib/postgresql/data`, and declared
volumes are null. Its config includes cron/network preloads and key scripts.
Those defaults were bypassed: an inert shell entrypoint, fresh initdb cluster,
separate config without includes, only `pg_stat_statements` preloaded, empty key/
archive/restore hooks, workers disabled and autovacuum off. Vault's installed SQL
chain was inspected: 0.3.0 installation followed by 0.3.1's no-SQL-change upgrade;
the unrelated historical 0.2.8/pgsodium installation path was not executed.

## Actual results

| Check | Result |
|---|---|
| Server | PostgreSQL 17.6, x86_64, `server_version_num=170006` |
| Clients | `pg_dump`, `pg_dumpall`, `pg_restore`, `psql`: 17.6 |
| Other tools | `initdb`, `pg_ctl`: 17.6 |
| Fresh initialization | Completed; no inherited auto.conf settings or recovery signals |
| Readiness | pg_isready accepted connections through the private Unix socket |
| SQL identity | Connected to local `postgres` as synthetic `supabase_admin`; expected config path |
| Five extensions available/installable | **Not reached** |
| Exact extension schemas/owners | **Not reached** |
| Synthetic CRUD/FK/rollback/functions | **Not reached** |
| Post-start scheduler/process and final socket assertions | **Not reached** |

DEV inventory retained from the previous authorized read; no new DEV query:

| Extension | Version | Schema | Owner |
|---|---|---|---|
| pg_stat_statements | 1.11 | extensions | postgres |
| pgcrypto | 1.3 | extensions | postgres |
| plpgsql | 1.0 | pg_catalog | supabase_admin |
| supabase_vault | 0.3.1 | vault | supabase_admin |
| uuid-ossp | 1.1 | extensions | postgres |

The prepared synthetic owner role is not evidence of authentic DEV role attributes,
memberships or ACLs. No Vault encryption/key operation or real-data recovery tested.

## Isolation, cleanup and preservation

Only new container `h9-pg17-verify-20261019-49b032fed9` was created and started;
ID `32b05424307dd8d78a15fa87b6cf20d87d3353b397e9f63fbd08ff060949550f`.
Identity, unique labels and isolation were checked before start and again during
cleanup. Network mode `none`; loopback only, zero routes before PostgreSQL;
no published ports, bind mounts, existing volumes or anonymous volumes.
Storage used private tmpfs; root filesystem read-only, user 100:101, capabilities
dropped, no-new-privileges, restart policy `no`. PostgreSQL logged only its Unix
socket listener. Scheduler isolation was configured; the post-start observation
was not reached, so full runtime isolation acceptance remains incomplete.

PostgreSQL stopped cleanly. Only the owned container was stopped/removed; its tmpfs
was discarded. The temporary 367,254,016-byte local image export was removed after
inspection; extracted configuration/SQL evidence remains. No Docker image removed.

After cleanup: exact **12 container IDs, 14 image IDs, 3 volume names** match the
baseline; all existing containers exited, Running=false, Restarting=false;
zero containers running. No old stack started. Volume byte identity was not tested.
All **131 protected H1 file hashes** matched; N0 and extension runtime manifest
hashes unchanged. H1/F12 artifacts and prior reports were not rewritten.

## Failure and prepared correction

The aggregate SQL guard raised `server-isolation-contract`. My assertion required
`current_setting('archive_command')=''`. PostgreSQL 17.6 instead displays
`(disabled)` when archiving is off. That predicate necessarily rejects this safe
configuration. [PostgreSQL 17.6 show hook](https://github.com/postgres/postgres/blob/REL_17_6/src/backend/access/transam/xlog.c).
Individual guard values were not emitted before failure; no claim that every
other predicate was independently measured.

Original executed script and logs remain unchanged. Separate
`verify-runtime.next.sh` is **prepared, not executed**: accept the disabled display
only alongside archive_mode=off and an empty command in the include-free config;
emit guard values before asserting; use a private empty regular passfile to avoid
the harmless `/dev/null` warnings. No second container was created.

## Checks and evidence

Actually run: image/config inspection; local-image export/selected-file inspection;
container create/inspect/start; shell syntax check; actual PG17 tool versions;
initdb/pg_ctl/pg_isready; SQL identity and failed isolation guard; owned pg_ctl
stop/container stop/remove; Docker object comparison; protected-file hash checks.
Initial Vault direct-file lookup missed the version's upgrade-chain layout; the
subsequent control/base/upgrade inspection succeeded without database changes.

Sanitized ignored receipts: `audit-artifacts/h9-pg17-runtime/`, especially
`execution-result.json`, `runtime-output.log`, `runtime-stderr.log`,
`owned-container-diagnostics.log`, `docker-command-receipts.json`,
`docker-preservation.json`, `protected-evidence-preservation.json`,
`failure-analysis.json` and `evidence-manifest.json`.

Executed shell SHA-256:
`ba0bed79b2842af9adda239c41b916aecc33b87cd46f9ec9a9e10e214cd941c4`.
Prepared correction SHA-256:
`5c4f091593c40282cdb246bc7fcdd8295c4846a27a35d466fa2193652b5f6468`.
Evidence records uncommitted bytes on Git base
`354fa2a70597cb3c40c459e480530674c85eff21`; no containing commit is claimed.
Historical SOURCE_REVISION and stale audit-artifact hash facts remain unchanged.

## Exact next action

Authorize one replacement isolated container to run the corrected guard and finish
the five extension/version/schema/owner and synthetic SQL checks. This is additional
authorization because the approved **ONE** container has already been removed.
Keep the same pinned local image and isolation; no pull or real restore.

Real H5 PG17 restore acceptance remains pending separate approval and the reviewed
A5/A2/A3, backup, role/ACL, data/catalog/ledger and recovery-coverage gates. DEV and
rehearsal remain preserved; no hosted allocation, paid upgrade or deletion.

Files changed: this report, appended `DECISIONS.md`, ignored sanitized receipts.
Suggested commit, not executed: `docs(h9): record partial isolated PG17 runtime verification`.
