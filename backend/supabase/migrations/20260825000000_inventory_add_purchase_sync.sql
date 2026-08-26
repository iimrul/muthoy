-- Sales + Inventory remediation: narrow grouped sync for Add Medicine.
--
-- A staff member with the explicit inventory_add override may create exactly
-- one new medicine and the one received purchase line that establishes its
-- first batch. This does not change purchase_create, inventory_write, supplier
-- management, purchase receiving/voiding, or any other financial permission.
-- Local file only. Do not execute remotely without separate approval.

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_operation_kind_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_operation_kind_check
  check (operation_kind in (
    'sale','refund','inventory_import','draft_complete','credit_collection',
    'withdrawal','expense_create','expense_delete','draft_hold','draft_cancel',
    'draft_cancel_create',
    'supplier_payment','purchase_receive_line','purchase_void','purchase_create',
    'purchase_return','inventory_add_purchase'
  ));

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_inventory_add_purchase_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_inventory_add_purchase_count_check
  check (operation_kind<>'inventory_add_purchase' or expected_row_count in (5,7,8));

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_draft_cancel_create_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_draft_cancel_create_count_check
  check (operation_kind<>'draft_cancel_create' or expected_row_count between 2 and 10000);

do $rename_inventory_add_purchase$
begin
  if to_regprocedure(
    'public.sync_apply_operation_pre_inventory_add_purchase(uuid,uuid,text,uuid,text,jsonb)'
  ) is null then
    alter function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
      rename to sync_apply_operation_pre_inventory_add_purchase;
  end if;
end
$rename_inventory_add_purchase$;

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
  v_result text;
  v_row_count integer;
  v_medicine jsonb;
  v_purchase jsonb;
  v_item jsonb;
  v_batch jsonb;
  v_movement jsonb;
  v_payment jsonb;
  v_medicine_id uuid;
  v_purchase_id uuid;
  v_batch_id uuid;
  v_supplier_id uuid;
  v_total bigint;
  v_supplier_credit bigint;
  v_expected_cash bigint;
  v_payment_count integer;
  v_drawer_count integer;
  v_drawer_id uuid;
  v_business_date date;
  v_expected_closing bigint;
  v_existing_drawer cash_drawer%rowtype;
begin
  if p_operation_kind not in ('inventory_add_purchase','draft_cancel_create') then
    return sync_apply_operation_pre_inventory_add_purchase(
      p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,p_rows
    );
  end if;

  if p_operation_kind='draft_cancel_create' then
    if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<2 then
      raise exception 'draft_cancel_create requires a header and items' using errcode='MU024';
    end if;
    if p_device_id is null or length(p_device_id) not between 1 and 200
       or not exists(select 1 from users where id=p_actor_id and shop_id=p_shop_id
            and is_active and not is_deleted)
       or not user_has_permission(p_actor_id,'sales') then
      raise exception 'draft_cancel_create requires sale permission' using errcode='MU015';
    end if;
    if coalesce(p_rows->0->>'tableName',p_rows->0->>'table_name')<>'sale_drafts'
       or p_rows->0->>'op'<>'insert'
       or (p_rows->0->'payload'->>'id')::uuid is distinct from p_operation_id
       or p_rows->0->'payload'->>'shop_id' is distinct from p_shop_id::text
       or (p_rows->0->'payload'->>'actor_id')::uuid is distinct from p_actor_id
       or p_rows->0->'payload'->>'origin_device_id' is distinct from p_device_id
       or p_rows->0->'payload'->>'status' is distinct from 'cancelled'
       or p_rows->0->'payload'->>'completed_sale_id' is not null
       or coalesce((p_rows->0->'payload'->>'is_deleted')::boolean,false)
       or exists(select 1 from sale_drafts where id=p_operation_id) then
      raise exception 'invalid cancelled draft header' using errcode='MU024';
    end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) with ordinality e(value,ord)
      where e.ord>1 and (
        coalesce(e.value->>'tableName',e.value->>'table_name')<>'sale_draft_items'
        or e.value->>'op'<>'insert'
        or e.value->'payload'->>'shop_id' is distinct from p_shop_id::text
        or (e.value->'payload'->>'draft_id')::uuid is distinct from p_operation_id
        or coalesce((e.value->'payload'->>'qty')::integer,0)<=0
        or coalesce((e.value->'payload'->>'is_deleted')::boolean,false)
        or coalesce(e.value->>'rowId',e.value->>'row_id') is distinct from e.value->'payload'->>'id'
        or not exists(select 1 from medicines m
          where m.id=(e.value->'payload'->>'medicine_id')::uuid
            and m.shop_id=p_shop_id and not m.is_deleted)
        or exists(select 1 from sale_draft_items i
          where i.id=(e.value->'payload'->>'id')::uuid)
      )
    ) or exists(
      select 1 from jsonb_array_elements(p_rows) with ordinality a(value,ord)
      join jsonb_array_elements(p_rows) with ordinality b(value,ord)
        on a.ord>1 and b.ord>a.ord
       and a.value->'payload'->>'medicine_id'=b.value->'payload'->>'medicine_id'
    ) then
      raise exception 'invalid or duplicate cancelled draft item' using errcode='MU024';
    end if;

    for v_entry in
      select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ord)
      order by e.ord
    loop
      v_result:=sync_apply_row(
        coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name'),
        v_entry.value->>'op',v_entry.value->'payload',
        p_shop_id,p_actor_id,p_device_id
      );
      if v_result<>'applied' then
        raise exception 'draft_cancel_create row rejected: %',v_result using errcode='MU024';
      end if;
    end loop;
    return 'applied';
  end if;

  if jsonb_typeof(p_rows)<>'array' then
    raise exception 'inventory_add_purchase rows must be an array' using errcode='MU024';
  end if;
  v_row_count:=jsonb_array_length(p_rows);
  if v_row_count not in (5,7,8) then
    raise exception 'inventory_add_purchase requires 5, 7, or 8 rows' using errcode='MU024';
  end if;

  -- The capability is explicit and live. It is deliberately checked once
  -- for this fully validated graph instead of widening sync_row_permitted for
  -- medicines/purchases/payments globally.
  if not exists(
    select 1 from users u join roles r on r.id=u.role_id and r.shop_id=u.shop_id
    where u.id=p_actor_id and u.shop_id=p_shop_id
      and u.is_active and not u.is_deleted and not r.is_deleted
  ) or not user_has_permission(p_actor_id,'inventory_add') then
    raise exception 'inventory_add_purchase requires inventory_add' using errcode='MU015';
  end if;

  if exists(
    select 1 from jsonb_array_elements(p_rows) e
    where e->'payload' is null
       or jsonb_typeof(e->'payload')<>'object'
       or coalesce(e->>'rowId',e->>'row_id') is distinct from e->'payload'->>'id'
       or e->'payload'->>'shop_id' is distinct from p_shop_id::text
       or e->>'op' not in ('insert','update')
  ) then
    raise exception 'invalid or cross-shop inventory_add_purchase row' using errcode='MU003';
  end if;

  -- Exact counts plus exact order match the only local writer. There is no
  -- spare table/row slot in which to smuggle another medicine, batch, payment,
  -- purchase line, movement, or drawer mutation.
  if (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='medicines')<>1
     or (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchases')<>1
     or (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchase_items')<>1
     or (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='batches')<>1
     or (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_movements')<>1
     or exists(select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name') not in
        ('medicines','purchases','purchase_items','batches','inventory_movements','payments','cash_drawer'))
     or coalesce(p_rows->0->>'tableName',p_rows->0->>'table_name')<>'medicines'
     or coalesce(p_rows->1->>'tableName',p_rows->1->>'table_name')<>'purchases'
     or coalesce(p_rows->2->>'tableName',p_rows->2->>'table_name')<>'batches'
     or coalesce(p_rows->3->>'tableName',p_rows->3->>'table_name')<>'purchase_items'
     or coalesce(p_rows->4->>'tableName',p_rows->4->>'table_name')<>'inventory_movements' then
    raise exception 'invalid inventory_add_purchase graph shape' using errcode='MU024';
  end if;

  select e->'payload' into v_medicine from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='medicines';
  select e->'payload' into v_purchase from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='purchases';
  select e->'payload' into v_item from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='purchase_items';
  select e->'payload' into v_batch from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='batches';
  select e->'payload' into v_movement from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='inventory_movements';
  select e->'payload' into v_payment from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='payments';

  v_medicine_id:=(v_medicine->>'id')::uuid;
  v_purchase_id:=(v_purchase->>'id')::uuid;
  v_batch_id:=(v_batch->>'id')::uuid;
  v_supplier_id:=(v_purchase->>'supplier_id')::uuid;

  if p_rows->0->>'op'<>'insert'
     or nullif(trim(v_medicine->>'name'),'') is null
     or nullif(trim(v_medicine->>'unit_of_measure'),'') is null
     or v_medicine->>'requires_prescription' not in ('true','false')
     or coalesce((v_medicine->>'threshold')::integer,-1)<0
     or coalesce((v_medicine->>'is_deleted')::boolean,false)
     or v_medicine->>'deleted_at' is not null
     or v_medicine->>'deleted_by' is not null
     or exists(select 1 from medicines where id=v_medicine_id) then
    raise exception 'invalid new medicine in inventory_add_purchase' using errcode='MU024';
  end if;

  if p_rows->1->>'op'<>'insert'
     or v_purchase_id is distinct from p_operation_id
     or v_purchase->>'source' is distinct from 'manual'
     or v_purchase->>'payment_terms' not in ('cod','credit')
     or coalesce((v_purchase->>'is_deleted')::boolean,false)
     or v_purchase->>'voided_at' is not null
     or v_purchase->>'voided_by' is not null
     or not exists(select 1 from suppliers where id=v_supplier_id
          and shop_id=p_shop_id and not is_deleted)
     or exists(select 1 from purchases where id=v_purchase_id) then
    raise exception 'invalid purchase header in inventory_add_purchase' using errcode='MU024';
  end if;

  if p_rows->2->>'op'<>'insert'
     or (v_batch->>'medicine_id')::uuid is distinct from v_medicine_id
     or coalesce(v_batch->>'batch_no','')=''
     or coalesce((v_batch->>'stock')::integer,-1)<>0
     or coalesce((v_batch->>'purchase_price')::bigint,-1)<0
     or coalesce((v_batch->>'sale_price')::bigint,-1)<0
     or coalesce((v_batch->>'is_deleted')::boolean,false)
     or exists(select 1 from batches where id=v_batch_id) then
    raise exception 'invalid first batch in inventory_add_purchase' using errcode='MU024';
  end if;

  if p_rows->3->>'op'<>'insert'
     or (v_item->>'purchase_id')::uuid is distinct from v_purchase_id
     or (v_item->>'medicine_id')::uuid is distinct from v_medicine_id
     or v_item->>'batch_no' is distinct from v_batch->>'batch_no'
     or (v_item->>'expiry_date')::date is distinct from (v_batch->>'expiry_date')::date
     or coalesce((v_item->>'qty')::integer,0)<=0
     or (v_item->>'purchase_price')::bigint is distinct from (v_batch->>'purchase_price')::bigint
     or (v_item->>'sale_price')::bigint is distinct from (v_batch->>'sale_price')::bigint
     or v_item->>'status' is distinct from 'received'
     or v_item->>'received_at' is null
     or coalesce((v_item->>'is_deleted')::boolean,false) then
    raise exception 'invalid purchase line in inventory_add_purchase' using errcode='MU024';
  end if;

  if p_rows->4->>'op'<>'insert'
     or (v_movement->>'batch_id')::uuid is distinct from v_batch_id
     or (v_movement->>'change_qty')::integer is distinct from (v_item->>'qty')::integer
     or v_movement->>'reason' is distinct from 'purchase'
     or (v_movement->>'ref_id')::uuid is distinct from v_purchase_id
     or (v_movement->>'created_by')::uuid is distinct from p_actor_id
     or coalesce((v_movement->>'is_deleted')::boolean,false) then
    raise exception 'invalid stock movement in inventory_add_purchase' using errcode='MU024';
  end if;

  v_total:=(v_item->>'purchase_price')::bigint*(v_item->>'qty')::bigint;
  if (v_purchase->>'total')::bigint is distinct from v_total then
    raise exception 'inventory_add_purchase total mismatch' using errcode='MU024';
  end if;

  select greatest(0,
    coalesce((select sum(pr.credit_amount) from purchase_returns pr
      join purchases p on p.id=pr.purchase_id
      where p.shop_id=p_shop_id and p.supplier_id=v_supplier_id
        and not p.is_deleted and p.voided_at is null and not pr.is_deleted),0)
    - coalesce((select sum(greatest(0,p.total-p.paid_amount)) from purchases p
      where p.shop_id=p_shop_id and p.supplier_id=v_supplier_id
        and not p.is_deleted and p.voided_at is null),0)
  ) into v_supplier_credit;
  v_expected_cash:=case when v_purchase->>'payment_terms'='cod'
    then greatest(0,v_total-v_supplier_credit) else 0 end;
  if (v_purchase->>'paid_amount')::bigint is distinct from v_expected_cash then
    raise exception 'inventory_add_purchase paid amount mismatch' using errcode='MU024';
  end if;

  select count(*) into v_payment_count from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='payments';
  select count(*) into v_drawer_count from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='cash_drawer';
  if v_expected_cash=0 then
    if v_payment_count<>0 or v_drawer_count<>0 or v_row_count<>5 then
      raise exception 'non-cash inventory_add_purchase must not touch payment or drawer'
        using errcode='MU024';
    end if;
  else
    if v_payment_count<>1 or v_drawer_count not in (1,2)
       or v_row_count<>5+v_payment_count+v_drawer_count
       or coalesce(p_rows->5->>'tableName',p_rows->5->>'table_name')<>'payments'
       or p_rows->5->>'op'<>'insert'
       or v_payment->>'type' is distinct from 'supplier_payment'
       or v_payment->>'method' is distinct from 'cash'
       or (v_payment->>'party_id')::uuid is distinct from v_supplier_id
       or (v_payment->>'amount')::bigint is distinct from v_expected_cash
       or (v_payment->>'ref_id')::uuid is distinct from v_purchase_id
       or (v_payment->>'created_by')::uuid is distinct from p_actor_id
       or coalesce((v_payment->>'is_deleted')::boolean,false) then
      raise exception 'invalid COD settlement in inventory_add_purchase' using errcode='MU024';
    end if;

    v_business_date:=((v_payment->>'created_at')::timestamptz at time zone 'Asia/Dhaka')::date;
    select (e->'payload'->>'id')::uuid into v_drawer_id
      from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' limit 1;
    if exists(select 1 from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' and (
          (e->'payload'->>'id')::uuid is distinct from v_drawer_id
          or (e->'payload'->>'business_date')::date is distinct from v_business_date
          or coalesce((e->'payload'->>'is_deleted')::boolean,false)
          or e->'payload'->>'closed_at' is not null
          or e->'payload'->>'closed_by' is not null
          or e->'payload'->>'closing_counted' is not null
          or e->'payload'->>'reconciled_counted_amount' is not null
          or e->'payload'->>'reconciled_at' is not null
          or e->'payload'->>'reconciled_by' is not null
          or e->>'op' not in ('insert','update')
        ))
       or (v_drawer_count=1 and not (
         coalesce(p_rows->6->>'tableName',p_rows->6->>'table_name')='cash_drawer'
         and p_rows->6->>'op'='update'
         and exists(select 1 from cash_drawer d where d.id=v_drawer_id
           and d.shop_id=p_shop_id and d.business_date=v_business_date
           and d.closed_at is null and not d.is_deleted)
       ))
       or (v_drawer_count=2 and not (
         coalesce(p_rows->6->>'tableName',p_rows->6->>'table_name')='cash_drawer'
         and p_rows->6->>'op'='insert'
         and coalesce(p_rows->7->>'tableName',p_rows->7->>'table_name')='cash_drawer'
         and p_rows->7->>'op'='update'
         and not exists(select 1 from cash_drawer d where d.id=v_drawer_id
           or (d.shop_id=p_shop_id and d.business_date=v_business_date))
       )) then
      raise exception 'invalid cash drawer graph in inventory_add_purchase' using errcode='MU024';
    end if;
  end if;

  if v_expected_cash>0 then
    -- Serialize the payment + server cash recomputation before either row is
    -- applied. The shop row always exists, including when today's drawer does
    -- not yet, so concurrent first-COD operations cannot both observe an
    -- absent drawer or publish stale closing_expected projections.
    perform 1 from shops where id=p_shop_id for update;
  end if;

  -- One function call is one PostgreSQL transaction. Any row rejection rolls
  -- back the medicine, purchase, first batch, movement, and cash effects.
  for v_entry in
    select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ord)
    order by e.ord
  loop
    -- Drawer rows are delayed until the payment has landed, so their only
    -- mutable projection can be compared with a server-side recomputation.
    if coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name')='cash_drawer' then
      continue;
    end if;
    v_result:=sync_apply_row(
      coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name'),
      v_entry.value->>'op',v_entry.value->'payload',
      p_shop_id,p_actor_id,p_device_id
    );
    if v_result<>'applied' then
      raise exception 'inventory_add_purchase row rejected: %',v_result using errcode='MU024';
    end if;
  end loop;

  if v_expected_cash>0 then
    -- The fixed cash formula, recomputed from server rows after the bound
    -- supplier payment was applied. A staff payload cannot choose opening
    -- cash or closing_expected.
    select
      coalesce((select opening_cash from cash_drawer
        where shop_id=p_shop_id and business_date=v_business_date and not is_deleted limit 1),0)
      + coalesce((select sum(cash_applied) from sales
        where shop_id=p_shop_id and cash_applied>0 and not is_deleted
          and (created_at at time zone 'Asia/Dhaka')::date=v_business_date),0)
      + coalesce((select sum(amount) from payments
        where shop_id=p_shop_id and type='customer_payment' and method='cash' and not is_deleted
          and (created_at at time zone 'Asia/Dhaka')::date=v_business_date),0)
      - coalesce((select sum(amount) from expenses
        where shop_id=p_shop_id and not is_deleted
          and (created_at at time zone 'Asia/Dhaka')::date=v_business_date),0)
      - coalesce((select sum(amount) from refund_tenders
        where shop_id=p_shop_id and (kind='cash' or (kind='collection_refund' and method='cash'))
          and not is_deleted and (created_at at time zone 'Asia/Dhaka')::date=v_business_date),0)
      - coalesce((select sum(refund_amount) from sales_returns
        where shop_id=p_shop_id and refund_id is null and refund_method='cash' and not is_deleted
          and (created_at at time zone 'Asia/Dhaka')::date=v_business_date),0)
      - coalesce((select sum(amount) from payments
        where shop_id=p_shop_id and type='supplier_payment' and method='cash' and not is_deleted
          and (created_at at time zone 'Asia/Dhaka')::date=v_business_date),0)
      - coalesce((select sum(amount) from payments
        where shop_id=p_shop_id and type='withdrawal' and method='cash' and not is_deleted
          and (created_at at time zone 'Asia/Dhaka')::date=v_business_date),0)
      into v_expected_closing;

    if v_drawer_count=1 then
      select * into v_existing_drawer from cash_drawer
        where id=v_drawer_id and shop_id=p_shop_id and business_date=v_business_date
        for update;
      if not found
         or (p_rows->6->'payload'->>'opening_cash')::bigint is distinct from v_existing_drawer.opening_cash
         or (p_rows->6->'payload'->>'opened_by')::uuid is distinct from v_existing_drawer.opened_by
         or (p_rows->6->'payload'->>'opened_at')::timestamptz is distinct from v_existing_drawer.opened_at
         or (p_rows->6->'payload'->>'created_at')::timestamptz is distinct from v_existing_drawer.created_at
         or (p_rows->6->'payload'->>'closing_expected')::bigint is distinct from v_expected_closing then
        raise exception 'cash drawer update values do not match server state'
          using errcode='MU024';
      end if;
    else
      if coalesce((p_rows->6->'payload'->>'opening_cash')::bigint,-1)<>0
         or (p_rows->6->'payload'->>'opened_by')::uuid is distinct from p_actor_id
         or p_rows->6->'payload'->>'opened_at' is null
         or p_rows->6->'payload'->>'closing_expected' is not null
         or (p_rows->7->'payload'->>'opening_cash')::bigint is distinct from 0
         or (p_rows->7->'payload'->>'opened_by')::uuid is distinct from p_actor_id
         or (p_rows->7->'payload'->>'opened_at')::timestamptz is distinct from
            (p_rows->6->'payload'->>'opened_at')::timestamptz
         or (p_rows->7->'payload'->>'created_at')::timestamptz is distinct from
            (p_rows->6->'payload'->>'created_at')::timestamptz
         or (p_rows->7->'payload'->>'closing_expected')::bigint is distinct from v_expected_closing then
        raise exception 'new cash drawer values do not match server-derived defaults'
          using errcode='MU024';
      end if;
    end if;

    for v_entry in
      select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ord)
      where coalesce(e.value->>'tableName',e.value->>'table_name')='cash_drawer'
      order by e.ord
    loop
      v_result:=sync_apply_row(
        'cash_drawer',v_entry.value->>'op',v_entry.value->'payload',
        p_shop_id,p_actor_id,p_device_id
      );
      if v_result<>'applied' then
        raise exception 'inventory_add_purchase drawer rejected: %',v_result using errcode='MU024';
      end if;
    end loop;
  end if;
  return 'applied';
end
$fn$;

revoke execute on function
  sync_apply_operation_pre_inventory_add_purchase(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke execute on function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function
  sync_apply_operation_pre_inventory_add_purchase(uuid,uuid,text,uuid,text,jsonb),
  sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  to service_role;
