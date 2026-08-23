-- Phase B3 Group 2 (Cash) — PostgreSQL mirror of
-- apps/mobile/db/migrations/0017_cash_reconcile.sql.
--
-- Three additive nullable columns on cash_drawer, separating the mid-day
-- reconcile count from the day-close count (founder decision D-2, contract
-- §5.9): reconciled_counted_amount / reconciled_at / reconciled_by. May be
-- overwritten any number of times before close and NEVER locks the business
-- date — only closing_counted/closed_by/closed_at (End of Day's closeDay)
-- do that.
--
-- NOT PUSHED. Local file only until remote migration execution is approved
-- separately, same safety gate as 20260822010000_b3_group1_shop_settings.sql.
--
-- No grant, policy, or sync-allowlist change is required: cash_drawer is
-- already allowlisted table-wide in functions/sync/_shared/tables.ts and its
-- RLS/grants are unaffected by adding a column.
--
-- The base dispatcher originally omitted these columns from its cash_drawer
-- conflict-update list. The following local corrective migration fixes that
-- before physical testing, while preserving old-client omissions:
--   20260823020000_b3_group2_sync_completion.sql
--
-- sync_apply_row_base's cash_drawer branch
-- (20260818000100_sync_batches_stock_server_derived.sql:119) hardcodes the
-- ON CONFLICT(id) DO UPDATE SET column list:
--   (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,
--    business_date,opening_cash,opened_by,closed_by,opened_at,closed_at,
--    closing_expected,closing_counted)
-- These three new columns are NOT in that list. jsonb_populate_record's
-- INSERT arm would still populate them correctly the first time a shop's
-- cash_drawer row for a business date is created, but reconcileCashDrawer
-- (apps/mobile/db/cash.ts) always UPDATEs an existing row (ensureOpenDrawer
-- reuses one for that date whenever it already exists, which is the normal
-- case for a mid-day reconcile). Under the current dispatcher, that UPDATE
-- would apply locally and queue correctly in the outbox, but the
-- reconciled_* values would silently fail to reach this Postgres mirror
-- once sync is enabled without that corrective migration. Keep the files in
-- order; neither migration has been executed remotely here.

alter table cash_drawer
  add column reconciled_counted_amount bigint;

alter table cash_drawer
  add column reconciled_at timestamptz;

alter table cash_drawer
  add column reconciled_by uuid references users(id) on delete restrict;
