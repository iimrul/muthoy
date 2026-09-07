-- ============================================================================
-- DEV PROJECT ONLY. Removes shops created by the temporary DEV registration
-- harness (H-2), and the auth users behind them.
-- ============================================================================
--
-- Run manually, in the SQL editor, against the DEV project. Deliberately NOT a
-- migration and NOT a SECURITY DEFINER function: a migration would install a
-- destructive helper on production too, and no grant here is worth that. It
-- needs the service role / SQL editor, which the DEV project's operator
-- already has and a client never does.
--
-- WHY THE OLD PROCEDURE COULD NOT WORK
--
-- dev/README.md used to say `delete from public.shops where id in (...)`.
-- B4 introduced a mutual RESTRICT pair:
--
--     billing_accounts.primary_shop_id -> shops(id)            ON DELETE RESTRICT
--     shops.billing_account_id         -> billing_accounts(id) ON DELETE RESTRICT
--
-- so the shop cannot go while its billing account exists, and the billing
-- account cannot go while the shop points at it. The delete failed every time.
--
-- Dozens of business tables also carry `created_by/actor_id -> users(id)
-- ON DELETE RESTRICT` while cascading from `shops`. Within a single
-- `DELETE FROM shops`, PostgreSQL fires RESTRICT immediately, so whether the
-- cascade reaches those child rows before it reaches `users` is not something
-- to rely on. The order below removes them explicitly instead.
--
-- SELECTION
--
-- Every row is chosen through `auth.users.raw_app_meta_data->>'dev_harness'`,
-- which `sync/link-device` stamps with the service role when it admits a
-- harness caller. It is the only selector that survives the email rewrite
-- `ensureAuthBinding` performs, and the only one a client cannot forge.
-- Production accounts never carry it, so no production row can be matched even
-- if this is run somewhere it should not be.
--
-- IDEMPOTENT. Every statement is a delete by key; a second run removes nothing
-- and reports zero rows. Safe to re-run after an interruption.

begin;

-- ── 0. Inspect. Run this ALONE first and read it. ───────────────────────────
-- Expect only "DEV Test Shop" rows. Anything else means STOP and roll back.
with harness_auth as (
  select id from auth.users
  where raw_app_meta_data->>'dev_harness' = 'true'
)
select s.id as shop_id, s.name, s.created_at, sc.claimed_by_user_id
from public.shop_claims sc
join public.shops s on s.id = sc.shop_id
where sc.claimed_by_user_id in (select id from harness_auth)
order by s.created_at;

-- ── The working set, resolved once. ─────────────────────────────────────────
create temporary table dev_harness_auth on commit drop as
  select id from auth.users where raw_app_meta_data->>'dev_harness' = 'true';

create temporary table dev_harness_shops on commit drop as
  select distinct sc.shop_id as id
  from public.shop_claims sc
  where sc.claimed_by_user_id in (select id from dev_harness_auth);

create temporary table dev_harness_accounts on commit drop as
  select distinct ba.id
  from public.billing_accounts ba
  where ba.primary_shop_id in (select id from dev_harness_shops);

-- ── 1. Break the mutual RESTRICT cycle. ─────────────────────────────────────
-- shops.billing_account_id is nullable; primary_shop_id is not. So the shop
-- side is the one that can let go first.
update public.shops set billing_account_id = null
where id in (select id from dev_harness_shops);

-- ── 2. Commercial rows that reference the billing account. ──────────────────
delete from public.payment_orders
where billing_account_id in (select id from dev_harness_accounts);

delete from public.entitlements
where billing_account_id in (select id from dev_harness_accounts);

delete from public.subscriptions
where billing_account_id in (select id from dev_harness_accounts);

delete from public.shop_memberships
where shop_id in (select id from dev_harness_shops);

-- ── 3. The billing accounts themselves. ─────────────────────────────────────
-- Now unreferenced by shops (step 1), so their primary_shop_id RESTRICT on
-- shops is the only thing left holding the shop, and it goes with this row.
delete from public.billing_accounts
where id in (select id from dev_harness_accounts);

-- ── 4. The shop and everything scoped to it. ────────────────────────────────
-- Cascade handles the ~40 shop-scoped business tables. Fresh DEV shops hold no
-- sales, so the users(id) RESTRICT references from those tables have nothing
-- to block; if a DEV shop was actually traded in, delete its sales, purchases,
-- inventory_movements, cash_* and audit_logs rows first and re-run.
delete from public.shops where id in (select id from dev_harness_shops);

-- ── 5. Rows with no FK to shops, so no cascade reaches them. ────────────────
delete from public.shop_claims
where claimed_by_user_id in (select id from dev_harness_auth);

delete from public.auth_bindings
where auth_user_id in (select id from dev_harness_auth);

-- ── 6. The auth accounts. Last: everything above selects through them. ──────
delete from auth.users where id in (select id from dev_harness_auth);

-- Review the row counts, then:
commit;
-- rollback;

-- ── Verification (run after commit; both must return zero rows). ────────────
-- select count(*) from auth.users where raw_app_meta_data->>'dev_harness' = 'true';
-- select count(*) from public.shops where name = 'DEV Test Shop';
