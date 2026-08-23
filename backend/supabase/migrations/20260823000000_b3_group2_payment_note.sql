-- Phase B3 Group 2 (Cash) — PostgreSQL mirror of
-- apps/mobile/db/migrations/0016_payment_note.sql.
--
-- One additive nullable column: payments.note. Carries a withdrawal's reason
-- ("bank deposit", "personal use"...) or a supplier-payment note. Every other
-- payment type leaves it unset.
--
-- NOT PUSHED. Local file only until remote migration execution is approved
-- separately, same safety gate as 20260822010000_b3_group1_shop_settings.sql.
--
-- No grant, policy, or sync-allowlist change is required: payments is already
-- allowlisted table-wide in functions/sync/_shared/tables.ts, RLS/grants on
-- it are enforced entirely through the sync_apply_row_base/sync_apply_row
-- RPCs (security definer, granted only to service_role) rather than
-- column-enumerated table grants, so a new column needs no grant of its own.
--
-- KNOWN GAP (found during Group 2 implementation, not fixed here — payments
-- rows are insert-only in this app, so `note` always arrives via
-- sync_apply_row_base's INSERT arm, which uses jsonb_populate_record and
-- therefore already picks up this column dynamically; no dispatcher change
-- is needed for payments specifically). See
-- 20260823010000_b3_group2_cash_reconcile.sql for the column that DOES need
-- a dispatcher extension.

alter table payments
  add column note text;
