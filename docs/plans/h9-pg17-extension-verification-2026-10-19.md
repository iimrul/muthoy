# H-9 PG17 extension verification and conditional pull — 2026-10-19

**DEV inventory: VERIFIED. PG17 image-selection compatibility: PASS.
Docker image: PULLED; exact digest/platform verified.**

No current blocker within this approved scope. Running PostgreSQL binaries/server,
creating the isolated target and proving H5 restoration remain outside this approval.
This record supersedes the extension-inventory blocker in the earlier local setup
record; that historical record and all sealed H1/F12 evidence remain unchanged.

## DEV inventory

One request at `2026-10-19T14:08:58.200Z` / **20:08:58 Asia/Dhaka**.

| Extension | Installed version | Schema | Owner |
|---|---|---|---|
| `pg_stat_statements` | `1.11` | `extensions` | `postgres` |
| `pgcrypto` | `1.3` | `extensions` | `postgres` |
| `plpgsql` | `1.0` | `pg_catalog` | `supabase_admin` |
| `supabase_vault` | `0.3.1` | `vault` | `supabase_admin` |
| `uuid-ossp` | `1.1` | `extensions` | `postgres` |

Target: `btfprhticjgeihcngpif`. Same-query identity proof: role and session role both
`supabase_read_only_user`, database `postgres`, `server_version_num=170006`,
`transaction_read_only=on`, instance fingerprint
`1ccbfe38fbca65d87281693735c6230f`, exactly matching accepted H1 READ 2.

Founder clarified that the fixed DEV SQL endpoint is permitted. Exactly one
`POST /v1/projects/btfprhticjgeihcngpif/database/query`, with explicit
`read_only:true`, executed one fixed catalog SELECT. The current transaction's
READ ONLY state was measured and required in that same result. No organization,
project-list, project-metadata or other account endpoint was called. No literal
BEGIN/COMMIT string or arbitrary SQL was sent; the approved API read-only mode
provided the transaction context. Catalogs accessed: `pg_extension`, `pg_namespace`,
`pg_roles`; only extension name/version/schema/owner were projected.

## Exact image and compatibility basis

- Official release: `supabase/postgres:17.6.1.136`, **linux/amd64**.
- Official multi-platform index:
  `sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`.
- Selected/pulled Linux/amd64 manifest:
  `sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b`.
- Git tag and published Linux/amd64 build provenance bind source commit
  `d156ba65c14694c12cc5e782bc15b9b8ed2d1376`, `Dockerfile-17`.

The immutable build configuration selects PostgreSQL **17.6**, matching DEV. Its
world build includes the required core/contrib extensions, OpenSSL and OSSP UUID
support. PostgreSQL 17.6 control files confirm `pg_stat_statements 1.11`,
`pgcrypto 1.3`, `plpgsql 1.0`, `uuid-ossp 1.1`.
[PG17 build config](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/nix/config.nix),
[build flags](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/nix/postgresql/generic.nix),
[PostgreSQL 17.6 source](https://github.com/postgres/postgres/tree/REL_17_6).

`psql_17_slim` includes Vault and selects the latest supported version, **0.3.1**.
Its control template fixes schema `vault`. `plpgsql` fixes `pg_catalog`; the other
three extensions are relocatable and support DEV's `extensions` schema.
[image package selection](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/nix/packages/postgres.nix),
[Vault build selection](https://github.com/supabase/postgres/blob/d156ba65c14694c12cc5e782bc15b9b8ed2d1376/nix/ext/vault.nix),
[Vault schema](https://github.com/supabase/vault/blob/v0.3.1/supabase_vault.control.in).

**5/5 exact extension versions and supported schemas: PASS for the conditional
image download.** Owners `postgres` and `supabase_admin` remain explicit restoration
requirements. No roles or ownership were changed. The reviewed recovery contract
still requires approved target bootstrap, scheduler/network isolation, actual PG17
runtime versions and exact extension/role/owner/ACL validation before H5 acceptance.
No runtime/restore proof is claimed from source inspection or image metadata.

## Pull and preservation

The compatibility receipt was written and SHA-256-pinned before pulling. One command:

```text
docker --context desktop-linux pull --platform linux/amd64 docker.io/supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b
```

Exit **0**. Docker reported that exact digest. Post-pull image inspection confirmed
`RepoDigests`, image ID and selected manifest digest match, OS `linux`, architecture
`amd64`. Verification completed `2026-10-19T14:15:54.730Z` / **20:15:54 Asia/Dhaka**.

Docker image IDs increased **13 → 14**, exactly the approved image. All 13 existing
image IDs, 12 container IDs and 3 volume names were preserved. All 12 containers
were individually `exited`, Running=false, Restarting=false; no old-stack restart
occurred in this task. Docker Desktop was already running and was not restarted.
All 131 protected H1 hashes, original A5/N0 source hashes and N0 staging manifest
remained unchanged. No F12/rehearsal query was made.

## Credential custody and checks actually run

Original A5-only and N0 launchers were preserved. A separate one-use extension
boundary follows the existing Credential Manager custody pattern: native startup
checks, private ACL/owner/reparse checks, pinned files/Node/PowerShell, read locks
before hashes, fixed child command/environment, token-free child ACL verification,
strict response projection and sanitized errors. No token/password was printed or
stored in evidence. New runtime provenance identifies uncommitted SHA-256-pinned
bytes on base `354fa2a70597cb3c40c459e480530674c85eff21`; containing runtime commit
is `null`. Historical SOURCE_REVISION was not rewritten.

- Focused Node tests: **12/12 PASS** (one initial test regex confused an EXTRACT
  function reference with a catalog reference; corrected before execution).
- Credential-free launcher controls: **25/25 PASS**.
- PowerShell parse and source-pin checks: PASS; fresh self-review recorded, no
  independent-review claim or Codex review loop.
- Protected staging VerifyOnly: exit 0; one live inventory: exit 0.
- Inventory checksum, six runtime file hashes, exact image digest/platform and
  Docker preservation checks: PASS. Report/source whitespace checks: PASS.

| Receipt | SHA-256 |
|---|---|
| Protected `extensions.json` | `70d5540c7b03e3299b702d56f56e054ffab8df459c93ce6486af4a6fc071d9f4` |
| Fixed SQL | `522440e7545a24005b51db4dd3d2e4051fe6a19678e6c929bf2037c5af757a6e` |
| Extension runtime manifest | `b8124d676c043366cf5d95d02234d0c6034c62b01c37f124a29e5e6ba8458335` |
| Pre-pull compatibility receipt | `bc20535c449d0c37323f85f165061e63f148cf12337235773e0436bf94551985` |

Ignored receipts: `audit-artifacts/h9-pg17-extension/`. Public build evidence uses
the immutable source references above; an optional slow public GitHub tree request
was canceled and those files were read through the web tool instead.

## Next executable action

Separately authorize one isolated local PG17 verification container using this exact
local digest, with no outbound network, no real DEV data and schedulers disabled.
Then verify actual server/client versions and extension availability. Container
creation/start and all backup/restore/migration operations remain unexecuted.

No database writes, account inventory calls, deployments, upgrades, commit/push,
SMS, EAS or device action occurred. DEV and rehearsal are preserved; no paid route.

Files changed: this record, appended `DECISIONS.md`,
`scripts/h9/{dev-extension-inventory.mjs,extension-runtime.mjs,extensions-with-token.ps1,run-extensions.cmd,verify-extensions.cmd,stage-extension-runtime.ps1}`,
`scripts/h9/test/{dev-extension-inventory.test.mjs,extension-launcher.test.ps1}`.
Suggested commit, not executed: `chore(h9): record DEV extensions and pin PG17 recovery image`.
