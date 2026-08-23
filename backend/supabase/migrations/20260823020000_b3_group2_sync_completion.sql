-- Phase B3 Group 2 corrective sync migration.
--
-- 1. Adds `withdrawal` to the EXISTING grouped-operation path. No RPC is
--    added: sync_stage_operation_chunk still stages and idempotently applies
--    the complete graph, while sync_apply_operation is wrapped for the new
--    strict two/three-row shape.
-- 2. Wraps sync_apply_row_base so cash_drawer's mid-day reconcile columns
--    participate in the existing LWW update without re-transcribing the
--    security-sensitive base dispatcher. Old clients that omit the keys keep
--    the server's current values.
--
-- Local file only. Do not execute remotely without separate approval.

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_operation_kind_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_operation_kind_check
  check (operation_kind in (
    'sale','refund','inventory_import','draft_complete','credit_collection',
    'withdrawal','draft_hold','draft_cancel'
  ));
alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_withdrawal_expected_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_withdrawal_expected_count_check
  check (operation_kind<>'withdrawal' or expected_row_count in (2,3));

-- Reapply-safe rename: a second application replaces the wrapper below; it
-- never renames that wrapper into its own callee.
do $rename_cash_reconcile_base$
begin
  if to_regprocedure(
    'public.sync_apply_row_base_pre_b3_cash_reconcile(text,text,jsonb,uuid)'
  ) is null then
    alter function sync_apply_row_base(text,text,jsonb,uuid)
      rename to sync_apply_row_base_pre_b3_cash_reconcile;
  end if;
end
$rename_cash_reconcile_base$;

create or replace function sync_apply_row_base(
  p_table text,
  p_op text,
  p_row jsonb,
  p_caller_shop_id uuid
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_row_id uuid := (p_row->>'id')::uuid;
  v_existing cash_drawer%rowtype;
  v_should_apply_reconcile boolean := false;
  v_result text;
begin
  if p_table='cash_drawer' and p_op<>'delete' then
    select * into v_existing from cash_drawer
      where id=v_row_id and shop_id=p_caller_shop_id;

    if found then
      v_should_apply_reconcile :=
        v_existing.updated_at < (p_row->>'updated_at')::timestamptz;
      -- A pre-Group-2 complete-row payload has no reconcile keys. Fill only
      -- missing keys from server state; explicit JSON null from a new client
      -- remains an intentional value under the ordinary LWW contract.
      if not p_row ? 'reconciled_counted_amount' then
        p_row := p_row || jsonb_build_object(
          'reconciled_counted_amount', v_existing.reconciled_counted_amount
        );
      end if;
      if not p_row ? 'reconciled_at' then
        p_row := p_row || jsonb_build_object('reconciled_at', v_existing.reconciled_at);
      end if;
      if not p_row ? 'reconciled_by' then
        p_row := p_row || jsonb_build_object('reconciled_by', v_existing.reconciled_by);
      end if;
    else
      v_should_apply_reconcile := true;
    end if;

    if p_row ? 'reconciled_by'
       and p_row->>'reconciled_by' is not null
       and not assert_fk_same_shop(
         'users',(p_row->>'reconciled_by')::uuid,p_caller_shop_id
       ) then
      raise exception 'cross-shop cash_drawer.reconciled_by'
        using errcode='MU003';
    end if;
  end if;

  v_result := sync_apply_row_base_pre_b3_cash_reconcile(
    p_table,p_op,p_row,p_caller_shop_id
  );

  if v_result='applied' and p_table='cash_drawer' and p_op<>'delete'
     and v_should_apply_reconcile then
    update cash_drawer set
      reconciled_counted_amount=(p_row->>'reconciled_counted_amount')::bigint,
      reconciled_at=(p_row->>'reconciled_at')::timestamptz,
      reconciled_by=(p_row->>'reconciled_by')::uuid
    where id=v_row_id and shop_id=p_caller_shop_id;
  end if;
  return v_result;
end
$fn$;

revoke execute on function
  sync_apply_row_base_pre_b3_cash_reconcile(text,text,jsonb,uuid)
  from public,anon,authenticated;
revoke execute on function sync_apply_row_base(text,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function
  sync_apply_row_base_pre_b3_cash_reconcile(text,text,jsonb,uuid),
  sync_apply_row_base(text,text,jsonb,uuid)
  to service_role;

-- Same reapply-safe wrapper pattern for the EXISTING grouped-operation
-- dispatcher. Every earlier kind delegates unchanged to the original body.
do $rename_withdrawal_operation$
begin
  if to_regprocedure(
    'public.sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)'
  ) is null then
    alter function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
      rename to sync_apply_operation_pre_b3_withdrawal;
  end if;
end
$rename_withdrawal_operation$;

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
  v_payment jsonb;
  v_drawer_id uuid;
  v_business_date date;
  v_row_count integer;
  v_drawer_count integer;
  v_result text;
begin
  if p_operation_kind<>'withdrawal' then
    return sync_apply_operation_pre_b3_withdrawal(
      p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,p_rows
    );
  end if;

  if jsonb_typeof(p_rows)<>'array' then
    raise exception 'withdrawal rows must be an array' using errcode='MU024';
  end if;
  v_row_count := jsonb_array_length(p_rows);
  if v_row_count not in (2,3) then
    raise exception 'withdrawal operation requires 2 or 3 rows'
      using errcode='MU024';
  end if;
  if not exists(
    select 1 from users u join roles r on r.id=u.role_id
    where u.id=p_actor_id and u.shop_id=p_shop_id
      and u.is_active and not u.is_deleted and not r.is_deleted
      and r.name='owner'
  ) then
    raise exception 'withdrawal is Owner-only' using errcode='MU015';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name') not in ('payments','cash_drawer')
       or e->'payload' is null
       or jsonb_typeof(e->'payload')<>'object'
       or coalesce(e->>'rowId',e->>'row_id') is distinct from e->'payload'->>'id'
       or e->'payload'->>'shop_id' is distinct from p_shop_id::text
  ) then
    raise exception 'invalid or cross-shop withdrawal row' using errcode='MU003';
  end if;

  select e->'payload' into v_payment
  from jsonb_array_elements(p_rows) e
  where coalesce(e->>'tableName',e->>'table_name')='payments';
  if (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments')<>1
     or v_payment is null
     or (v_payment->>'id')::uuid is distinct from p_operation_id
     or (v_payment->>'created_by')::uuid is distinct from p_actor_id
     or v_payment->>'type' is distinct from 'withdrawal'
     or v_payment->>'method' is distinct from 'cash'
     or v_payment->>'party_id' is not null
     or v_payment->>'ref_id' is not null
     or coalesce((v_payment->>'amount')::bigint,0)<=0
     or coalesce((v_payment->>'is_deleted')::boolean,false) then
    raise exception 'withdrawal requires one bound positive cash payment'
      using errcode='MU024';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='payments'
      and e->>'op'<>'insert'
  ) then
    raise exception 'withdrawal payment must be insert-only' using errcode='MU001';
  end if;
  v_business_date :=
    ((v_payment->>'created_at')::timestamptz at time zone 'Asia/Dhaka')::date;

  select count(*) into v_drawer_count
  from jsonb_array_elements(p_rows) e
  where coalesce(e->>'tableName',e->>'table_name')='cash_drawer';
  select (e->'payload'->>'id')::uuid into v_drawer_id
  from jsonb_array_elements(p_rows) e
  where coalesce(e->>'tableName',e->>'table_name')='cash_drawer'
  limit 1;
  if v_drawer_count<>v_row_count-1
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
    raise exception 'withdrawal drawer rows are invalid' using errcode='MU024';
  end if;

  if v_row_count=2 then
    if coalesce(p_rows->0->>'tableName',p_rows->0->>'table_name') is distinct from 'payments'
       or p_rows->0->>'op' is distinct from 'insert'
       or coalesce(p_rows->1->>'tableName',p_rows->1->>'table_name') is distinct from 'cash_drawer'
       or p_rows->1->>'op' is distinct from 'update'
       or (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='cash_drawer'
          and e->>'op'='update')<>1
       or not exists(
         select 1 from cash_drawer d
         where d.id=v_drawer_id and d.shop_id=p_shop_id
           and d.business_date=v_business_date
           and d.closed_at is null and not d.is_deleted
       ) then
      raise exception 'existing-drawer withdrawal requires one open drawer update'
        using errcode='MU022';
    end if;
  else
    if coalesce(p_rows->0->>'tableName',p_rows->0->>'table_name') is distinct from 'cash_drawer'
       or p_rows->0->>'op' is distinct from 'insert'
       or coalesce(p_rows->1->>'tableName',p_rows->1->>'table_name') is distinct from 'payments'
       or p_rows->1->>'op' is distinct from 'insert'
       or coalesce(p_rows->2->>'tableName',p_rows->2->>'table_name') is distinct from 'cash_drawer'
       or p_rows->2->>'op' is distinct from 'update'
       or (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='cash_drawer'
          and e->>'op'='insert')<>1
       or (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='cash_drawer'
          and e->>'op'='update')<>1
       or exists(
         select 1 from cash_drawer d
         where d.shop_id=p_shop_id and d.business_date=v_business_date
       ) then
      raise exception 'first-drawer withdrawal requires insert plus update'
        using errcode='MU024';
    end if;
  end if;

  -- One PostgreSQL function call is one transaction. Any rejected row rolls
  -- back the payment and every drawer row together.
  for v_entry in
    select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ord)
    order by e.ord
  loop
    if not sync_row_permitted(
      p_actor_id,
      coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name'),
      v_entry.value->'payload'
    ) then
      raise exception 'withdrawal contains unauthorized row' using errcode='MU010';
    end if;
    v_result := sync_apply_row(
      coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name'),
      v_entry.value->>'op',v_entry.value->'payload',
      p_shop_id,p_actor_id,p_device_id
    );
    if v_result<>'applied' then
      raise exception 'withdrawal row rejected: %',v_result using errcode='MU024';
    end if;
  end loop;
  return 'applied';
end
$fn$;

revoke execute on function
  sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke execute on function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function
  sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb),
  sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  to service_role;
