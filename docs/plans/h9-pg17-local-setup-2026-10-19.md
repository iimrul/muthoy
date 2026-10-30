# H-9 PG17 local setup — 2026-10-19

**STATUS: BLOCKED before pull.** Docker Desktop/WSL2 started successfully. Official
PG17 image publisher/source/platform/digests verified; compatibility with the full
DEV extension inventory could not be established. **Images pulled: 0.** No alternate
image was downloaded, and no new container was created.

## Completed

- Installed Docker Desktop `4.87.0.236836`: Authenticode valid, Docker Inc publisher.
- Docker CLI/server `29.7.2`; Linux engine `desktop-linux`, `x86_64`, WSL2.
- WSL `docker-desktop`: stopped before start, running afterward.
- Disk before start: C: 16.93 GiB free, D: 82.17 GiB, E: 108.62 GiB.
  C: 16.52 GiB after Desktop startup and existing-stack shutdown.
- Existing settings retained; no installation, WSL update, daemon reset, prune,
  container creation, volume deletion, compose startup, or image pull was issued.
- Existing Docker object identifiers preserved: **12 containers, 13 images,
  3 volumes**. Two PG17 Supabase images (`17.6.1.155`, `17.6.1.159`) already existed;
  neither was substituted for the unverified-compatible candidate below.
- All 131 protected H1 file hashes and the protected N0 manifest hash remain unchanged.

## Verified official candidate — metadata only

- Registry/repository: `docker.io/supabase/postgres`.
- Release tag: `17.6.1.136`, referenced by the official Supabase Compose source.
- Index digest: `sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`.
- Selected platform: **linux/amd64**, matching the Docker engine.
- Platform manifest digest:
  `sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`.
- Registry-reported compressed platform size: `367203535` bytes.
- Official Git tag and published build provenance agree on source commit
  `d156ba65c14694c12cc5e782bc15b9b8ed2d1376`, `Dockerfile-17`.
- That Dockerfile builds `psql_17_slim/bin`; its extension version definitions include
  PostgreSQL-17-compatible Supabase extensions. These definitions alone do not prove
  exact compatibility with DEV's installed extensions.

Sources: [official Compose](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml),
[immutable PG17 Dockerfile](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/Dockerfile-17),
[immutable extension definitions](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/nix/ext/versions.json),
[official Docker Hub release metadata](https://hub.docker.com/v2/repositories/supabase/postgres/tags/17.6.1.136).

## Blocker and exact next action

The reviewed [PG17 recovery contract](../../backend/supabase/checks/h9_pg17_restore.md)
requires compatibility with source extensions. The retained accepted A5 READ 2
(`3a9c02297c13c19690f42fd116623db413e53c301539b8c86bc5b070068b5a95`)
has no full installed-extension inventory: its snapshot contains roles, checks,
version, database, memberships, publications and platformRolePresent. Its collector
proves `pg_cron` absent but does not collect all extension names/versions/schemas/owners.
The earlier readiness document's claim that A5 already held that inventory is
therefore unsupported. Historical evidence and that old document were not rewritten.

**Next:** provide/recover a trusted DEV extension inventory (name, version, schema,
owner). If none exists, obtain separate authorization for only that read-only
inventory; this setup approval excludes hosted calls. Then compare it with the
candidate before the already-authorized single digest pull. No duplicate Docker
startup/image-pull approval is needed within the existing scope.

No candidate binary or server-version runtime check was performed: no new container
was permitted. Isolated local database testing and H5 restore readiness remain unproven.
DEV and rehearsal are preserved; the founder's confirmed two-project Free limit,
no paid upgrade and no deletion constraints remain in force.

## Docker automatic-resume incident

Starting Docker Desktop automatically resumed the old `b4-20260901-154941` restore
stack through its existing restart policies, including PostgreSQL. No explicit
container start/run command was issued. The database started at
`2026-10-19T13:44:44.3529862Z` and stopped at `13:46:40.587900729Z`.
Only the identified auto-resumed containers were gracefully stopped; restart-policy
configuration and object identities were retained. Final per-container inspection
proved **12/12 exited, Running=false, Restarting=false**; `docker ps -q` was empty.
Docker info still reported one running container, inconsistent with those individual
states; engine API responsiveness is verified, but this counter discrepancy remains.

Container/volume existence is preserved. Volume byte identity is not asserted after
automatic startup; no rollback or volume rewrite was attempted. Samsung POS/device
was never accessed. No hosted database/API command, backup, migration, secrets change,
deployment, Git commit or push was issued.

## Checks and retained receipts

Actually run: Docker signature/version/context checks; WSL status/list; DriveInfo;
Docker info/ps/image inspect/image list/volume list; registry manifest inspection;
public GitHub tag/source and Docker Hub metadata reads; Buildx provenance inspection;
targeted stop of the automatically resumed stack; final per-container state and
object-identity comparison; protected evidence hashes. No application tests apply.

Ignored receipts: `audit-artifacts/h9-pg17-setup/`. Source changes: this record and an
appended `DECISIONS.md` entry only; prior uncommitted work was preserved.
Suggested commit, not executed: `docs(h9): record PG17 setup and extension inventory blocker`.
