-- 44 · A pull follows the SERVER's clock, not the device's. Founder-approved
-- plan "খ", 2026-11-26.
--
-- Found on DEV the same day (offline oversell test). The owner's phone and a
-- cashier's phone both sold offline. The owner's phone came online first, then
-- pulled. The cashier's sale reached the server minutes later, still carrying
-- the time it was MADE (updated_at is the device's clock). The pull cursor
-- orders by updated_at, and the owner's cursor was already past that time, so
-- the owner's phone never received the sale: missing from history, today's
-- total short, stock wrong. Nothing on the server was lost; the pull skipped it.
-- Every offline sale from another device was exposed the same way.
--
-- The fix keeps updated_at exactly as it is (it still decides last-write-wins)
-- and gives the pull its own column:
--
-- 1. server_changed_at on every table the pull reads, stamped by a trigger with
--    the server's clock_timestamp() on every insert and update, whatever the
--    payload says. It is stripped from the rows the pull sends, so devices
--    never see or store it.
--
-- 2. The pull orders and pages by server_changed_at. Its output column keeps
--    the name updated_at, and the Edge function already passes that value
--    through as an opaque cursor, so neither the Edge function nor any shipped
--    app has to change.
--
-- 3. A row is pulled only once it is two seconds old by the server's clock.
--    A row stamped inside a transaction that has not committed yet is invisible
--    to a concurrent pull; without the wait, a pull could pass its stamp and
--    never come back for it. Every push applies a row in its own short
--    transaction, so two seconds is generous. (muthoy.pull_settle_ms overrides
--    the wait; the test harness sets it to 0.)
--
-- 4. A cursor is trusted only when the row it names carries a server stamp at
--    or after the cursor's time. Every cursor this pull hands out passes (a
--    stamp only ever moves forward). A device-clock cursor from before this
--    migration passes only when it is older than the stamps below, and then
--    the re-send in 5 reaches it anyway; one from a phone whose clock ran fast,
--    or naming a row the caller can no longer find, starts again from the
--    beginning.
--
-- 5. Existing rows are stamped with this migration's time, table by table in
--    the device's parent-first order (one millisecond apart). Every device's
--    next pull therefore re-sends every row once, parents first. That is what
--    repairs rows already skipped: re-applying a row the device has is a no-op
--    (last-write-wins on equal updated_at; the stock ledger moves only on a
--    movement's first INSERT). The stamp is a constant column default, so
--    adding it rewrites no row and fires no trigger.

-- Fail closed: the inner pull must be the H-7 body that 20261111000000 renamed,
-- or this migration's own body on a re-apply. Anything else is a later change
-- this migration was not written against.
do $pull_clock_guard$
declare
  v_actual record;
begin
  select md5(replace(p.prosrc,chr(13)||chr(10),chr(10))) source_md5,
    r.rolname owner, p.prosecdef, p.proconfig
    into v_actual from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid=to_regprocedure('public.sync_pull_changes_b2_pre_role_credit(uuid,uuid,timestamptz,text,uuid,integer)');
  if not found or v_actual.owner<>'postgres' or not v_actual.prosecdef
    or v_actual.proconfig is distinct from array['search_path=public']::text[] then
    raise exception 'pull server clock: inner pull missing, or owner/security settings changed';
  end if;
  if v_actual.source_md5 not in (
    '3f45500b15eddafea01de62e63cf2ed6', -- H-7, renamed by 20261111000000
    '1673e24f8e69520c0083a04dd16d2acc'  -- this migration (re-apply)
  ) then
    raise exception 'pull server clock: inner pull is a later or unknown version (%)', v_actual.source_md5;
  end if;
end
$pull_clock_guard$;

create or replace function public.sync_stamp_server_changed_at()
returns trigger language plpgsql set search_path = public as $stamp$
begin
  new.server_changed_at := clock_timestamp();
  return new;
end
$stamp$;

revoke all on function public.sync_stamp_server_changed_at() from public, anon, authenticated;

do $pull_clock_columns$
declare
  v_tables text[] := array[
    -- The device's parent-first order (apps/mobile db/sync-helpers.ts
    -- HYDRATION_TABLE_ORDER), with shop_b2_settings beside its shop.
    'shops','shop_b2_settings','subscriptions','roles','permissions','users',
    'user_permissions','medicines','suppliers','customers','batches',
    'batch_promotions','purchases','purchase_items','sales','sale_drafts',
    'sale_draft_items','sale_items','sale_attachments','sale_refunds',
    'sales_returns','refund_tenders','purchase_returns','inventory_movements',
    'credits','payments','credit_payment_allocations',
    'credit_reconciliation_states','expenses','cash_drawer','inventory_imports',
    'audit_logs'
  ];
  v_base timestamptz := clock_timestamp();
  v_rank integer := 0;
  v_table text;
begin
  foreach v_table in array v_tables loop
    v_rank := v_rank + 1;
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=v_table and column_name='server_changed_at'
    ) then
      execute format(
        'alter table public.%I add column server_changed_at timestamptz not null default %L',
        v_table, v_base + make_interval(secs => v_rank / 1000.0)
      );
    end if;
    execute format('alter table public.%I alter column server_changed_at set default clock_timestamp()', v_table);
    execute format('drop trigger if exists sync_server_changed_at on public.%I', v_table);
    execute format(
      'create trigger sync_server_changed_at before insert or update on public.%I '
      'for each row execute function public.sync_stamp_server_changed_at()',
      v_table
    );
  end loop;
end
$pull_clock_columns$;

-- The H-7 pull, unchanged in WHAT it selects for whom. Only the ordering
-- column (server_changed_at, still returned as updated_at), the stripped
-- row_data, the settle wait and the cursor check are new.
create or replace function public.sync_pull_changes_b2_pre_role_credit(
  p_shop_id uuid, p_app_user_id uuid, p_since_updated_at timestamptz,
  p_since_table text, p_since_id uuid, p_limit integer
)
returns table(table_name text, row_id uuid, updated_at timestamptz, row_data jsonb)
language sql security definer set search_path = public as $fn$
  with caller as (
    select user_has_permission(p_app_user_id,'sale_history') can_history
    where exists(select 1 from users u where u.id = p_app_user_id and u.shop_id = p_shop_id
      and u.is_active and not u.is_deleted)
  ), readable as (
    select t.name from unnest(array[
      'shops','subscriptions','roles','permissions','users','user_permissions',
      'shop_b2_settings','medicines','batches','batch_promotions',
      'inventory_movements','customers','sales','sale_items','sale_drafts',
      'sale_draft_items','sale_attachments','sale_refunds','sales_returns',
      'refund_tenders','suppliers','purchases','purchase_items','purchase_returns',
      'credits','credit_payment_allocations','credit_reconciliation_states',
      'expenses','payments','cash_drawer','inventory_imports','audit_logs'
    ]) as t(name)
    where exists(select 1 from caller) and sync_table_readable(p_app_user_id, t.name)
  ), all_changes as (
    select 'shops'::text table_name,id row_id,server_changed_at updated_at,to_jsonb(t.*)-'server_changed_at' row_data from shops t where id=p_shop_id
    union all select 'subscriptions',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from subscriptions t where shop_id=p_shop_id
    union all select 'roles',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from roles t where shop_id=p_shop_id
    union all select 'permissions',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from permissions t where role_id in(select id from roles where shop_id=p_shop_id)
    union all select 'users',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from users t where shop_id=p_shop_id
    union all select 'user_permissions',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from user_permissions t where shop_id=p_shop_id
    union all select 'shop_b2_settings',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from shop_b2_settings t where shop_id=p_shop_id
    union all select 'medicines',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from medicines t where shop_id=p_shop_id
    union all select 'batches',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from batches t where shop_id=p_shop_id
    union all select 'batch_promotions',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from batch_promotions t where shop_id=p_shop_id
    union all select 'inventory_movements',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from inventory_movements t where shop_id=p_shop_id
    union all select 'customers',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from customers t where shop_id=p_shop_id
    -- Row-level, exactly as b2_sales_history_read reads it.
    union all select 'sales',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from sales t where shop_id=p_shop_id
      and exists(select 1 from caller c where c.can_history or t.staff_id=p_app_user_id)
    union all select 'sale_items',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from sale_items t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sale_drafts',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from sale_drafts t where shop_id=p_shop_id
    union all select 'sale_draft_items',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from sale_draft_items t where shop_id=p_shop_id
    union all select 'sale_attachments',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from sale_attachments t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sale_refunds',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from sale_refunds t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sales_returns',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from sales_returns t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'refund_tenders',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from refund_tenders t where shop_id=p_shop_id
      and exists(select 1 from sale_refunds r join sales s on s.id=r.sale_id cross join caller c
        where r.id=t.refund_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'suppliers',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from suppliers t where shop_id=p_shop_id
    union all select 'purchases',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from purchases t where shop_id=p_shop_id
    union all select 'purchase_items',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from purchase_items t where shop_id=p_shop_id
    union all select 'purchase_returns',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from purchase_returns t where shop_id=p_shop_id
    union all select 'credits',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from credits t where shop_id=p_shop_id
    union all select 'credit_payment_allocations',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from credit_payment_allocations t where shop_id=p_shop_id
    union all select 'credit_reconciliation_states',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from credit_reconciliation_states t where shop_id=p_shop_id
    union all select 'expenses',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from expenses t where shop_id=p_shop_id
    union all select 'payments',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from payments t where shop_id=p_shop_id
    union all select 'cash_drawer',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from cash_drawer t where shop_id=p_shop_id
    union all select 'inventory_imports',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from inventory_imports t where shop_id=p_shop_id
    union all select 'audit_logs',id,server_changed_at,to_jsonb(t.*)-'server_changed_at' from audit_logs t where shop_id=p_shop_id
  ), since as (
    -- Trusted only when the row it names was stamped at or after it (see 4).
    select case when exists(
      select 1 from all_changes c
      where c.table_name = p_since_table and c.row_id = p_since_id
        and c.updated_at >= p_since_updated_at
    ) then p_since_updated_at end as at
  ), settled as (
    select clock_timestamp() - make_interval(secs =>
      coalesce(nullif(current_setting('muthoy.pull_settle_ms', true), '')::numeric, 2000) / 1000.0
    ) as before
  )
  -- The table gate is a JOIN rather than a per-arm predicate so that adding a
  -- union arm without a rule in sync_table_readable yields nothing at all,
  -- instead of yielding everything.
  select a.table_name,a.row_id,a.updated_at,a.row_data
  from all_changes a join readable r on r.name = a.table_name
    cross join since s cross join settled st
  where a.updated_at <= st.before
    and (s.at is null or (a.updated_at,a.table_name,a.row_id)>
      (s.at,coalesce(p_since_table,''),coalesce(p_since_id,'00000000-0000-0000-0000-000000000000'::uuid)))
  order by a.updated_at,a.table_name,a.row_id limit p_limit
$fn$;

