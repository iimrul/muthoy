-- Owner Dashboard recovery, founder decision 2 — PostgreSQL mirror of
-- apps/mobile/db/migrations/0013_owner_dashboard_credit_period.sql.
--
-- The dues card's overdue count needs a credit period and `credits` carries
-- no due date. Additive column on the already-synced shop settings row,
-- default 7 days, same shape as max_refund_days. Existing rows inherit the
-- default; nothing is backfilled and no shop's behaviour changes.
--
-- NOT PUSHED. Local file only until remote migration execution is approved
-- separately (docs/plans/owner-dashboard-parity-recovery.md safety gate).
--
-- No grant, policy, or sync-allowlist change is required: shop_b2_settings is
-- already allowlisted table-wide in functions/sync/_shared/tables.ts and its
-- RLS and grants are unaffected by adding a column.

alter table shop_b2_settings
  add column credit_max_days integer not null default 7
  check (credit_max_days >= 0);
