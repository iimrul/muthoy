# Supabase migration order and rollout status

Apply timestamped files in lexical order. Committed migrations are immutable;
schema changes require a new file. SQLite remains the mobile source of truth,
and every PostgreSQL money column mirrors integer paisa.

## Exact PostgreSQL order

```text
20260813000000_initial_schema.sql
20260817000000_admin_read_grants.sql
20260817000100_sync_roles_read_grant.sql
20260818000000_inventory_movement_ledger.sql
20260818000100_sync_batches_stock_server_derived.sql
20260819000000_staff_device_login.sql
20260821000000_phase_b1_navigation_roles.sql
20260821010000_phase_b2_sales_inventory_sync.sql
20260822000000_owner_dashboard_credit_period.sql
20260822010000_b3_group1_shop_settings.sql
20260823000000_b3_group2_payment_note.sql
20260823010000_b3_group2_cash_reconcile.sql
20260823020000_b3_group2_sync_completion.sql
20260823030000_b3_group3_expense_category_taxonomy.sql
20260823040000_b3_groups456_schema_additions.sql
20260823050000_b3_groups456_sync_completion.sql
20260824000000_b3_group7_purchase_return_sync.sql
20260825000000_inventory_add_purchase_sync.sql
20260827000000_b3_group8_report_indexes.sql
20260827010000_b3_group9_sale_tax_snapshot.sql
```

Do not reorder the function-wrapper migrations: each later grouped-operation
dispatcher delegates to the function version installed immediately before it.
The report-index migration must precede the tax-snapshot migration.

## Local SQLite order

The mobile runner and Drizzle journal register this exact numeric order:

```text
0000_open_senator_kelly.sql
0001_medicines_fts.sql
0002_furry_celestials.sql
0003_curious_wild_pack.sql
0004_deep_boomer.sql
0005_eminent_legion.sql
0006_inventory_movement_ledger.sql
0007_staff_device_login.sql
0008_native_pin_lookup.sql
0009_strong_gargoyle.sql
0010_known_ares.sql
0011_black_zarda.sql
0012_small_meltdown.sql
0013_owner_dashboard_credit_period.sql
0014_owner_dashboard_credit_period_guard.sql
0015_b3_shop_settings.sql
0016_payment_note.sql
0017_cash_reconcile.sql
0018_expense_category_taxonomy.sql
0019_supplier_archive.sql
0020_purchase_item_status.sql
0021_purchase_void.sql
0022_supplier_profile_fields.sql
0023_purchase_invoice_metadata.sql
0024_b3_report_indexes.sql
0025_b3_sale_tax_snapshot.sql
```

B1 starts at `0009`; B2 sales/inventory occupies `0010`-`0012`, followed by
dashboard credit-period migrations `0013`-`0014`; B3 occupies `0015`-`0025`.

`0018` backfills the old expense categories to
Rent/Salary/Utilities/Conveyance/Other. `0024` backfills missing sale business
dates using Asia/Dhaka. `0025` adds immutable MRP-inclusive integer-paisa tax
snapshots. These data-shape steps need production backups and postchecks; they
are not routine column-only changes.

## Current status — 2026-08-30

- All repository migration files are written and covered by real SQLite/PGlite
  migration tests, including fresh order, legacy upgrade/backfill, repeated
  application where supported, RLS/shop isolation, grouped operation replay,
  inventory ledger, `inventory_add`, reporting, and tax constraints.
- Full automated suite: **PASS** — 124 files, 1,268 tests (`pnpm test`).
- Founder-reported final Supabase migration dry-run: **PASS**.
- The exact dry-run command/output transcript is not committed. Treat PASS as a
  recorded manual result, not a reproducible artifact.
- B1-B3 remote Supabase migration execution: **PENDING**.
- Matching Edge Function deployment: **PENDING**.
- Tests execute migration SQL only in ephemeral SQLite/PGlite databases. This
  recovery runs no migration against a persistent app database or linked
  Supabase project and performs no deploy, push, or commit.

Repository evidence does not prove the exact migration version currently
installed in the linked remote project. Confirm it before rollout; never infer
remote state from the presence of local files.

## Required rollout sequence

1. Confirm the linked project/environment and current remote migration table.
2. Take schema and data backups.
3. Run actorless-ledger and data-shape prechecks, especially legacy expense
   categories, null/mismatched business dates, ledger gaps, and money ranges.
4. Re-run the CLI dry-run and review this exact ordered list.
5. Apply the pending migrations once, in order.
6. Run `backend/supabase/checks/ledger_invariant.sql`; PASS is check 0 =
   `PASS`, zero rows from checks 1-4, and all four triggers present in check 5.
7. Deploy the matching sync Edge Function only after schema success.
8. Register `public.custom_access_token_hook` in Supabase Auth Hooks; migrations
   cannot perform this manual step. Mint/decode a token and verify
   `app_metadata.app_user_id`, `shop_id`, `role`, and `permission_version`.
9. Run post-deploy B1-B3 smoke tests: role revocation, `inventory_add`, sale and
   stale quote, grouped replay, refund claim, credit convergence, purchase/
   return/supplier credit, reports/tax/export, and two-device stock convergence.

Do not deploy the app before both schema and matching function versions are
live. Several B2/B3 operations intentionally require atomic server dispatchers;
a new client against an old backend can halt or reject queued groups.

## Inventory ledger invariant

`20260818000000_inventory_movement_ledger.sql` and
`20260818000100_sync_batches_stock_server_derived.sql` replace absolute LWW
stock with `batches.stock = SUM(inventory_movements.change_qty)`. Only the
movement trigger changes stock. Movements are append-only; correction is a
tombstone/compensating movement, never physical deletion. Deterministic
backfill IDs prevent SQLite and PostgreSQL from double-counting the same legacy
gap. An actorless gap aborts instead of being skipped.

Run the read-only postcheck from the repository root:

```bash
psql "$DATABASE_URL" -f backend/supabase/checks/ledger_invariant.sql
```

## Service-role grants

`BYPASSRLS` skips policies but grants no table privilege. Direct PostgREST reads
still require explicit least-privilege grants:

| Migration | Grant | Consumer |
| --- | --- | --- |
| `20260817000000_admin_read_grants.sql` | `SELECT` on `shops`, `sales` | P0 admin pages |
| `20260817000100_sync_roles_read_grant.sql` | `SELECT` on `roles` | sync permission-row authorization |

No migration grants table writes to `anon` or `authenticated`, and no default
privilege grants future tables automatically. New direct reads must add an
explicit grant and extend the grant tests.

## Known rollout risks

- Remote version is not durably recorded in this repo; environment mismatch is
  the first check.
- Expense-category and business-date backfills touch existing data.
- Ledger backfill needs a valid actor for every historical gap.
- Client/function/schema version skew can strand atomic groups.
- The access-token hook is manual and fails closed when absent.
- Live two-device convergence, refund authority, and revocation must be checked
  after deploy even though PGlite coverage passes.
- SQLCipher, production OTP/provider hardening, DEV bypass removal, and broader
  BLE printer-model rollout remain separate release gates.
