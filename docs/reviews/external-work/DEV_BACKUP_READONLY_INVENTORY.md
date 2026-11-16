> Historical external record imported on 2026-11-15. Source: D:\MuthoyAudit-20261109\implementation\DEV_BACKUP_READONLY_INVENTORY.md.
> Integration grants no operational approval. Existing evidence remains at the original external paths.
> Current source lives in D:/Muthoy; historical runtime/native/hosted verdicts below retain their original scope.

# DEV backup read-only inventory — 11 November 2026

**Backup prerequisite: BLOCKED.** No independently verified restorable backup is established. This is not proof that Supabase has no automated backup; its backup list is inaccessible through the connected tool set.

1. Exact project identity — PASS: API verified ref btfprhticjgeihcngpif; Muthoy Dev/Test; organization yenthtwadrdgjtfusxbd; region ap-northeast-1; ACTIVE_HEALTHY; hosted PostgreSQL 17.6.1.166. SQL transaction explicitly read-only. Hosted migration history remains 31, last 20261005000000. H-5 shop7e95674d-894b-4df7-ad91-45eb8821c373, Owner6ce8cbaa-e175-4e73-9f9c-ed10bae1a9a6; actual counts: 11 sales / 15 items / 26 movements / 8 batches; no in-flight staged operations at13:31:31 UTC.
2. Existing backup ID/path/timestamp — NOT FOUND in authorized local evidence. Founder explicitly confirmed none is available. Searched named backup/dump/restore receipts and existing audit/current report references, excluding credentials, dependencies, artifacts and unrelated private secrets directories. Prior PG17 rehearsals are explicitly synthetic, not this DEV backup.
3. Schema/data coverage — NOT VERIFIED for any backup. Source metadata at13:42:12 UTC:53 public tables, 195 public policies, 96 public functions, 27 auth tables, 8 storage tables and 1 migration table; 48 auth users; 1 storage bucket and 0 objects. No raw user data, credentials, keys or object bytes exported. Existing extension inventory matches the five versions below. Source metadata alone is not a backup.
4. Integrity — NOT RUN: no backup artifact, SHA256 inventory, consistent snapshot binding, role/ACL catalog comparison, independently surviving protected copy or accepted manifest/proof exists for this execution.
5. Isolated restore — NOT RUN: no authentic DEV dump has been restored/verified. Existing synthetic PG17/PGlite history does not satisfy this gate. No target created or existing database touched.
6. Missing evidence/permissions — connected Supabase tools expose project/migrations/SQL but no backup-list operation. Official GET /v1/projects/{ref}/database/backups requires database:read authorization not exposed here; no token was retrieved or existing protected launcher retargeted. No private DB service connection is configured in this session. Host clients are18.6; existing contract requires17. Docker daemon is unavailable. No Docker startup, pull, backup/export, restore, migration, function deployment, hosted write or phone action was performed.

| Extension | Version | Schema | Owner |
|---|---|---|---|
| pg_stat_statements |1.11|extensions|postgres|
| pgcrypto |1.3|extensions|postgres|
| plpgsql |1.0|pg_catalog|supabase_admin|
| supabase_vault |0.3.1|vault|supabase_admin|
| uuid-ossp |1.1|extensions|postgres|

Official metadata endpoint: https://supabase.com/docs/reference/api/v1-list-all-backups
Database backups cover Storage metadata, not object bytes: https://supabase.com/docs/guides/platform/backups

## Scope A4 — Founder-approved protected DEV backup and isolated restore

APPROVED by Founder on 11 November; NOT EXECUTED because prerequisites remain missing. Reuse backend/supabase/checks/h9_pg17_restore.md and scripts/h9/recovery-contract.mjs; do not recreate the deleted unsafe dev-backup executor or retarget any F12/H1 credential launcher.

Source only btfprhticjgeihcngpif, current exact31-chain; no migration candidate execution. Founder supplies a private service/passfile through the existing approved prompt; no password in chat, command arguments, logs, source or inherited PGPASSWORD. Verify TLS and exact project identity. Export under a separately agreed bounded writer-pause/consistency window; no account revocations or app/device changes to manufacture a pause. Stop if the window cannot be established.

SUPERSEDED destination proposal: the earlier %USERPROFILE%/.muthoy-secrets/backups/... path is on C: and is NOT an approved surviving backup target. At most, local staging could be considered under a separate verified protection/capacity scope; none is currently configured or authorized for export. The required real destination is the independently encrypted OFF-DISK/OFF-COMPUTER target in DEV_BACKUP_PRIVATE_SETUP.md section 2. Its exact path, physical independence, owner/ACL/no-reparse protection, encryption/capacity and separate decryption-key custody/retention must be confirmed before export. No existing secrets directory is enumerated and no new key is generated silently.

Tools/target: request isolated local PG17 provisioning separately if the existing verified image is unavailable. Known historical candidate supabase/postgres@sha256:5a4314708484bec672de2c09653a5c01fb1c84a998564ac231b0325e2238ed5b had all five exact DEV extensions in a SYNTHETIC October test. Reverify current bytes/versions/extensions/owners; historical compatibility is not current proof. Docker startup can resume old stacks, so it requires its own bounded provisioning/containment approval. Never start or modify unrelated containers/volumes. No paid Supabase project/branch.

Capture one consistent PG17 custom schema+data archive including required public/auth/storage/migration schemas, exact role metadata/memberships/ACLs without role passwords, function/policy/constraint/trigger/catalog/history and full canonical data/ledger fingerprints. Record every exclusion and its recovery source. Hashes/listing are necessary, not proof of restorability. No Storage object payload export in this DB-only scope; source object count currently0 and must be rechecked.

Restore only to a NEW EMPTY isolated PG17 database with explicit unique identity, network disabled, schedulers/archive/network hooks disabled, local bootstrap superuser for authentic supabase_admin ownership and exact roles/extensions. Preserve owners/ACLs; exit-on-error and single transaction. No --clean/no-owner/no-privileges/error ignoring or business-data normalization. No restore to DEV/Production/rehearsal/existing local databases. Preserve failing targets and evidence; no destructive cleanup without scope.

Verify authentic schema/data/Auth/roles/ACL/defaults/extensions/FK/stock/integer-paisa/history equality, canonical full data digests including tombstones, and independent altered-copy detection. Run the existing offline recovery contract against real manifest/proof; obtain independent Claude review and Founder operational acceptance. Retain backup/target without automatic deletion. No hosting change is proposed until this gate actually passes.

Still required to make A4 executable: protected destination/key custody and retention, a private DEV connection, approved consistency window, exact locally available PG17 provisioning identity, independent restore target and RPO/RTO. This approval grants no blanket authority. No export or restoration has run. The private connection, protected directory/independent key custody, retention, writer window and compatible PG17 target remain unverified.


## Follow-up local inventory and private setup instructions
See [DEV_BACKUP_PRIVATE_SETUP.md](<D:/MuthoyAudit-20261109/implementation/DEV_BACKUP_PRIVATE_SETUP.md>) and evidence/dev-backup-private-setup-readonly-20261111.json. No standard connection files or overrides found. C/D/E share disk0; independent storage and encryption remain unverified. Docker4.87 is installed but stopped; existing stacks cannot be listed. PG18 only. Proposed retention: at least30days and3distinct restore-verified generations, no automatic deletion. A4remainsAPPROVED/NOTEXECUTED; export/restoreBLOCKED.
