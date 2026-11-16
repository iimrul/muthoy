# Protected remediation — local implementation approved

16 November: Founder approved local implementation in chat. Current changes and
test results: [REMEDIATION.md](REMEDIATION.md). Hosted activation remains separate.

Evidence: `evidence/database-parity.json`, `dev-effective-privileges.json`,
`dev-migrations.json`, and the printer requirement test log.

## DEV database and Admin

Observed history is migrations 1–31 plus `20261115172840`, not a contiguous
32-migration prefix. Seven earlier repository migrations are missing. Do not run
an unrestricted `db push`, nor assume applying the Admin migration alone is safe.

Candidate sources requiring review in `backend/supabase/migrations/`:

- `20261008000000_h9_enrollment_hold_constraint_normalization.sql`
- `20261008000100_h9_sync_staging_cleanup_schedule.sql`
- `20261015000000_h9_api_role_table_privileges.sql`
- `20261023000000_e4_batch3_admin_platform.sql`
- `20261030000000_e4b_publication_snapshots.sql`
- `20261031000000_e11_entitlement_verification.sql`
- `20261111000000_role_switch_credit_link_contract.sql`

First approved work should prepare a minimal forward candidate against the exact
DEV catalog, retaining the already-applied Staff sale repair. Inspect function
definitions/ACLs, grants, triggers and migration preconditions. Existing committed
migrations remain immutable. Any necessary adaptation is a new migration, not an
edit to historical SQL. Do not activate all seven just to repair the Admin.

Risks: service-role privileges, authorization, audit durability, sync wrapper
ordering, financial publication isolation and concurrent shop writes.

Tests before activation: exact DEV-order and repository-order PostgreSQL fixtures;
anonymous/authenticated/service-role denial controls; current Staff split-sale and
role-switch contracts; Admin login/revocation/audit/support/settings/export flows;
catalog diff proving only approved objects changed; rollback/restore rehearsal.
Existing backup/restore gates must be satisfied before hosted activation. A
prepared candidate and its results require explicit activation approval.

## Receipt/report printing

Candidate files: `apps/mobile/domain/escpos.ts`, `apps/mobile/native/printer.ts`.
Fix LF encoding and required feed before cut; prevent automatic resend after an
uncertain delivery. Preserve amounts, financial calculations and receipt content.

Risks: receipt/report output changes; a retry could print twice after partial
delivery. Existing golden expectations may encode the current defect: assess
them against the independent paper model rather than weakening requirements.

Tests: existing hardware requirement suite and native printer/ESC-POS suites;
uncertain delivery sends once; explicit user retry remains possible; printed
money unchanged. Physical Android and iPhone BLE-printer acceptance is required.

## Platform acceptance

Use the same application and isolated test shops. Obtain macOS/Xcode and a real
iPhone; build/link the three Apple modules plus ML Kit, SQLite and MMKV. Validate
fresh install, PIN/key custody, upgrade/restart, airplane-mode business day,
kill during write/sync, role/shop switches, camera/OCR/barcode, notifications,
BLE permission/printing, share/export and payment deep-link cancellation.
Repeat on Android. Do not clear, reinstall over, hydrate, or mutate an existing
shop/device without separately approved bounded steps and a recovery path.

No schema, sync, auth, money/stock writer, hosted mutation, device operation or
deployment was performed by the original report. Local implementation is now
approved under `AGENTS.md` → Safety Gate; hosted activation and existing-device
data operations retain their separate boundaries.
