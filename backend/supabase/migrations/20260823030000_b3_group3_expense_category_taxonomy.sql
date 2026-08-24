-- Phase B3 Group 3 (Expenses) — PostgreSQL mirror of
-- apps/mobile/db/migrations/0018_expense_category_taxonomy.sql.
--
-- Founder decision D-4 (locked 2026-08-22): production's original 6-category
-- expense taxonomy (rent, electricity, transport, staff_salary, supplies,
-- other) is replaced by the prototype's 5-category set (rent, salary,
-- utilities, conveyance, other).
--
-- This migration also adds the server half of atomic expense create/delete
-- and canonical category enforcement. Both the Edge function and this SQL
-- boundary normalize legacy values, so either may deploy first without a
-- stale-client sync dead zone.
-- Existing ungrouped clients remain accepted during that compatibility
-- window. Deploy both server pieces before releasing the grouped mobile
-- writer; after that, new expense mutations use only the atomic path.
--
-- NOT PUSHED. Local file only until remote migration execution is approved
-- separately, same safety gate as 20260822010000_b3_group1_shop_settings.sql
-- and 20260823010000_b3_group2_cash_reconcile.sql. This is the first
-- migration in the B3 plan that rewrites existing data rather than only
-- adding columns — it deserves the same verified, non-routine rollout the
-- plan document calls for (docs/plans/phase-b3-exact-prototype-parity.md
-- §7.1/§7.3), including a check against real shop data before it runs.
--
update expenses set category = 'utilities' where category = 'electricity';
update expenses set category = 'conveyance' where category = 'transport';
update expenses set category = 'salary' where category = 'staff_salary';
update expenses set category = 'other' where category = 'supplies';

alter table expenses
  drop constraint if exists expenses_category_canonical_check;
alter table expenses
  add constraint expenses_category_canonical_check
  check (category in ('rent','salary','utilities','conveyance','other'));

create or replace function sync_canonical_expense_category(p_category text)
returns text language plpgsql immutable set search_path=public as $fn$
begin
  return case p_category
    when 'electricity' then 'utilities'
    when 'transport' then 'conveyance'
    when 'staff_salary' then 'salary'
    when 'supplies' then 'other'
    when 'rent' then 'rent'
    when 'salary' then 'salary'
    when 'utilities' then 'utilities'
    when 'conveyance' then 'conveyance'
    when 'other' then 'other'
    else null
  end;
end
$fn$;

-- Defense in depth for migration-before-edge rollout. Old ungrouped and
-- grouped clients both reach this six-argument dispatcher.
do $rename_expense_category_row$
begin
  if to_regprocedure(
    'public.sync_apply_row_pre_b3_expense_category(text,text,jsonb,uuid,uuid,text)'
  ) is null then
    alter function sync_apply_row(text,text,jsonb,uuid,uuid,text)
      rename to sync_apply_row_pre_b3_expense_category;
  end if;
end
$rename_expense_category_row$;

create or replace function sync_apply_row(
  p_table text,p_op text,p_row jsonb,p_caller_shop_id uuid,p_caller_user_id uuid,
  p_device_id text
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_category text;
begin
  if p_table='expenses' and p_op<>'delete' then
    v_category:=sync_canonical_expense_category(p_row->>'category');
    if v_category is null then
      raise exception 'invalid expense category' using errcode='MU024';
    end if;
    p_row:=p_row || jsonb_build_object('category',v_category);
  end if;
  return sync_apply_row_pre_b3_expense_category(
    p_table,p_op,p_row,p_caller_shop_id,p_caller_user_id,p_device_id
  );
end
$fn$;

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_operation_kind_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_operation_kind_check
  check (operation_kind in (
    'sale','refund','inventory_import','draft_complete','credit_collection',
    'withdrawal','expense_create','expense_delete','draft_hold','draft_cancel'
  ));
alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_expense_create_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_expense_create_count_check
  check (operation_kind<>'expense_create' or expected_row_count in (3,4));
alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_expense_delete_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_expense_delete_count_check
  check (operation_kind<>'expense_delete' or expected_row_count in (3,4));

do $rename_expense_operation$
begin
  if to_regprocedure(
    'public.sync_apply_operation_pre_b3_expenses(uuid,uuid,text,uuid,text,jsonb)'
  ) is null then
    alter function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
      rename to sync_apply_operation_pre_b3_expenses;
  end if;
end
$rename_expense_operation$;

create or replace function sync_apply_operation(
  p_shop_id uuid,
  p_operation_id uuid,
  p_operation_kind text,
  p_actor_id uuid,
  p_device_id text,
  p_rows jsonb
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_entry record;
  v_expense jsonb;
  v_payment jsonb;
  v_expense_row expenses%rowtype;
  v_payment_row payments%rowtype;
  v_drawer_id uuid;
  v_business_date date;
  v_row_count integer;
  v_drawer_count integer;
  v_result text;
begin
  if p_operation_kind not in ('expense_create','expense_delete') then
    return sync_apply_operation_pre_b3_expenses(
      p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,p_rows
    );
  end if;
  if jsonb_typeof(p_rows)<>'array' then
    raise exception 'expense rows must be an array' using errcode='MU024';
  end if;
  v_row_count:=jsonb_array_length(p_rows);
  if v_row_count not in (3,4) then
    raise exception 'expense operation requires 3 or 4 rows' using errcode='MU024';
  end if;
  if not exists(
    select 1 from users u join roles r on r.id=u.role_id
    where u.id=p_actor_id and u.shop_id=p_shop_id
      and u.is_active and not u.is_deleted and not r.is_deleted
      and r.name='owner'
  ) then
    raise exception 'expenses are Owner-only' using errcode='MU015';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name') not in
        ('expenses','payments','cash_drawer')
       or e->'payload' is null
       or jsonb_typeof(e->'payload')<>'object'
       or coalesce(e->>'rowId',e->>'row_id') is distinct from e->'payload'->>'id'
       or e->'payload'->>'shop_id' is distinct from p_shop_id::text
  ) then
    raise exception 'invalid or cross-shop expense row' using errcode='MU003';
  end if;

  select e->'payload' into v_expense from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='expenses';
  select e->'payload' into v_payment from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='payments';
  if (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='expenses')<>1
     or (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments')<>1
     or v_expense is null or v_payment is null then
    raise exception 'expense operation requires one bound expense and payment'
      using errcode='MU024';
  end if;

  if p_operation_kind='expense_create' then
    if (v_expense->>'id')::uuid is distinct from p_operation_id
       or sync_canonical_expense_category(v_expense->>'category') is null
       or (v_expense->>'created_by')::uuid is distinct from p_actor_id
       or coalesce((v_expense->>'amount')::bigint,0)<=0
       or coalesce((v_expense->>'is_deleted')::boolean,false)
       or v_payment->>'type' is distinct from 'expense'
       or v_payment->>'method' is distinct from 'cash'
       or v_payment->>'party_id' is not null
       or (v_payment->>'ref_id')::uuid is distinct from p_operation_id
       or (v_payment->>'created_by')::uuid is distinct from p_actor_id
       or (v_payment->>'amount')::bigint is distinct from (v_expense->>'amount')::bigint
       or (v_payment->>'created_at')::timestamptz is distinct from
          (v_expense->>'created_at')::timestamptz
       or coalesce((v_payment->>'is_deleted')::boolean,false)
       or exists(select 1 from expenses where id=p_operation_id)
       or exists(select 1 from payments where id=(v_payment->>'id')::uuid)
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name') in ('expenses','payments')
           and e->>'op'<>'insert'
       ) then
      raise exception 'invalid expense creation graph' using errcode='MU024';
    end if;
    v_business_date:=
      ((v_expense->>'created_at')::timestamptz at time zone 'Asia/Dhaka')::date;
  else
    select * into v_expense_row from expenses
      where id=(v_expense->>'id')::uuid and shop_id=p_shop_id and not is_deleted for update;
    if not found then
      raise exception 'expense to delete is missing' using errcode='MU019';
    end if;
    select * into v_payment_row from payments
      where id=(v_payment->>'id')::uuid and shop_id=p_shop_id
        and type='expense' and ref_id=(v_expense->>'id')::uuid and not is_deleted for update;
    if not found
       or (select count(*) from payments where shop_id=p_shop_id
           and type='expense' and ref_id=(v_expense->>'id')::uuid and not is_deleted)<>1
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name') in ('expenses','payments')
           and e->>'op'<>'delete'
       )
       or coalesce((v_expense->>'is_deleted')::boolean,false)<>true
       or coalesce((v_payment->>'is_deleted')::boolean,false)<>true
       or v_expense->>'deleted_at' is null
       or v_payment->>'deleted_at' is null
       or v_expense->>'updated_at' is null
       or v_payment->>'updated_at' is null
       or (v_expense->>'deleted_by')::uuid is distinct from p_actor_id
       or (v_payment->>'deleted_by')::uuid is distinct from p_actor_id
       or (v_expense->>'deleted_at')::timestamptz is distinct from
          (v_payment->>'deleted_at')::timestamptz
       or (v_expense->>'updated_at')::timestamptz is distinct from
          (v_payment->>'updated_at')::timestamptz then
      raise exception 'invalid expense deletion graph' using errcode='MU024';
    end if;
    v_business_date:=(v_expense_row.created_at at time zone 'Asia/Dhaka')::date;
  end if;

  select count(*) into v_drawer_count from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='cash_drawer';
  select (e->'payload'->>'id')::uuid into v_drawer_id
    from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' limit 1;
  if v_drawer_count<>v_row_count-2
     or exists(
       select 1 from jsonb_array_elements(p_rows) e
       where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' and (
         (e->'payload'->>'id')::uuid is distinct from v_drawer_id
         or (e->'payload'->>'business_date')::date is distinct from v_business_date
         or coalesce((e->'payload'->>'is_deleted')::boolean,false)
         or e->'payload'->>'closed_at' is not null
         or e->'payload'->>'closed_by' is not null
         or e->'payload'->>'closing_counted' is not null
       )
     ) then
    raise exception 'expense drawer rows are invalid' using errcode='MU024';
  end if;

  if v_row_count=3 then
    if coalesce(p_rows->0->>'tableName',p_rows->0->>'table_name') is distinct from 'expenses'
       or p_rows->0->>'op' is distinct from
          (case when p_operation_kind='expense_create' then 'insert' else 'delete' end)
       or coalesce(p_rows->1->>'tableName',p_rows->1->>'table_name') is distinct from 'payments'
       or p_rows->1->>'op' is distinct from
          (case when p_operation_kind='expense_create' then 'insert' else 'delete' end)
       or coalesce(p_rows->2->>'tableName',p_rows->2->>'table_name') is distinct from 'cash_drawer'
       or p_rows->2->>'op' is distinct from 'update'
       or not exists(
         select 1 from cash_drawer where id=v_drawer_id and shop_id=p_shop_id
           and business_date=v_business_date and closed_at is null and not is_deleted
       ) then
      raise exception 'existing-drawer expense order is invalid' using errcode='MU024';
    end if;
  else
    if (
         p_operation_kind='expense_create' and (
           coalesce(p_rows->0->>'tableName',p_rows->0->>'table_name') is distinct from 'cash_drawer'
           or p_rows->0->>'op' is distinct from 'insert'
           or coalesce(p_rows->1->>'tableName',p_rows->1->>'table_name') is distinct from 'expenses'
           or p_rows->1->>'op' is distinct from 'insert'
           or coalesce(p_rows->2->>'tableName',p_rows->2->>'table_name') is distinct from 'payments'
           or p_rows->2->>'op' is distinct from 'insert'
         )
       ) or (
         p_operation_kind='expense_delete' and (
           coalesce(p_rows->0->>'tableName',p_rows->0->>'table_name') is distinct from 'expenses'
           or p_rows->0->>'op' is distinct from 'delete'
           or coalesce(p_rows->1->>'tableName',p_rows->1->>'table_name') is distinct from 'payments'
           or p_rows->1->>'op' is distinct from 'delete'
           or coalesce(p_rows->2->>'tableName',p_rows->2->>'table_name') is distinct from 'cash_drawer'
           or p_rows->2->>'op' is distinct from 'insert'
         )
       )
       or coalesce(p_rows->3->>'tableName',p_rows->3->>'table_name') is distinct from 'cash_drawer'
       or p_rows->3->>'op' is distinct from 'update'
       or exists(select 1 from cash_drawer where shop_id=p_shop_id
          and business_date=v_business_date) then
      raise exception 'first-drawer expense order is invalid' using errcode='MU024';
    end if;
  end if;

  -- One function invocation is one PostgreSQL transaction. Any validation or
  -- row failure rolls back the expense, payment, and every drawer row.
  for v_entry in
    select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ord)
    order by e.ord
  loop
    if not sync_row_permitted(
      p_actor_id,
      coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name'),
      v_entry.value->'payload'
    ) then
      raise exception 'expense contains unauthorized row' using errcode='MU010';
    end if;
    v_result:=sync_apply_row(
      coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name'),
      v_entry.value->>'op',v_entry.value->'payload',
      p_shop_id,p_actor_id,p_device_id
    );
    if v_result<>'applied' then
      raise exception 'expense row rejected: %',v_result using errcode='MU024';
    end if;
  end loop;
  if p_operation_kind='expense_create' then
    if not exists(select 1 from expenses where id=p_operation_id and shop_id=p_shop_id and not is_deleted)
       or not exists(select 1 from payments where id=(v_payment->>'id')::uuid
         and shop_id=p_shop_id and type='expense' and ref_id=p_operation_id and not is_deleted) then
      raise exception 'expense creation did not converge' using errcode='MU024';
    end if;
  else
    if not exists(select 1 from expenses where id=(v_expense->>'id')::uuid and shop_id=p_shop_id and is_deleted)
       or not exists(select 1 from payments where id=(v_payment->>'id')::uuid
         and shop_id=p_shop_id and type='expense'
         and ref_id=(v_expense->>'id')::uuid and is_deleted) then
      raise exception 'expense deletion did not converge' using errcode='MU024';
    end if;
  end if;
  return 'applied';
end
$fn$;

revoke execute on function sync_canonical_expense_category(text)
  from public,anon,authenticated;
revoke execute on function
  sync_apply_row_pre_b3_expense_category(text,text,jsonb,uuid,uuid,text)
  from public,anon,authenticated;
revoke execute on function sync_apply_row(text,text,jsonb,uuid,uuid,text)
  from public,anon,authenticated;
revoke execute on function
  sync_apply_operation_pre_b3_expenses(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke execute on function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function sync_canonical_expense_category(text),
  sync_apply_row_pre_b3_expense_category(text,text,jsonb,uuid,uuid,text),
  sync_apply_row(text,text,jsonb,uuid,uuid,text),
  sync_apply_operation_pre_b3_expenses(uuid,uuid,text,uuid,text,jsonb),
  sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  to service_role;
