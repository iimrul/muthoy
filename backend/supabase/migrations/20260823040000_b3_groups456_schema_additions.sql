-- Phase B3 Groups 4-6 review-fix: Postgres mirrors for the SQLite migrations
-- 0019-0023 (supplier archive, purchase item status/received_at, purchase
-- void, supplier profile fields, purchase invoice metadata).
--
-- Purely additive nullable/defaulted columns on already-allowlisted sync
-- tables (suppliers, purchases, purchase_items) — no grant, RLS, or
-- sync-allowlist change needed, matching the 20260823010000 cash_reconcile
-- precedent. purchase_items.status and purchases.source get a CHECK
-- constraint in place of SQLite's insert/update triggers.
--
-- Local file only. Do not execute remotely without separate approval.

-- 0019_supplier_archive.sql
alter table suppliers add column if not exists archived_at timestamptz;
alter table suppliers add column if not exists archived_by uuid references users(id) on delete restrict;

-- 0020_purchase_item_status.sql
alter table purchase_items add column if not exists status text not null default 'received';
alter table purchase_items add column if not exists received_at timestamptz;
alter table purchase_items drop constraint if exists purchase_items_status_check;
alter table purchase_items add constraint purchase_items_status_check
  check (status in ('received', 'pending'));

-- 0021_purchase_void.sql
alter table purchases add column if not exists voided_at timestamptz;
alter table purchases add column if not exists voided_by uuid references users(id) on delete restrict;

-- 0022_supplier_profile_fields.sql
alter table suppliers add column if not exists manufacturer text;
alter table suppliers add column if not exists notes text;

-- 0023_purchase_invoice_metadata.sql. invoice_date is descriptive only (see
-- CreatePurchaseInput.invoiceDate in db/purchases.ts) — never referenced by
-- any server-side date/business-date logic.
alter table purchases add column if not exists invoice_date date;
alter table purchases add column if not exists source text not null default 'manual';
alter table purchases drop constraint if exists purchases_source_check;
alter table purchases add constraint purchases_source_check
  check (source in ('manual', 'ocr'));
