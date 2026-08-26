-- Phase B3 Group 7: server-side grouped-sync support for purchase_return.
--
-- purchase_return has existed as client-side SyncOperationGroup bookkeeping
-- only since this batch (db/sync-helpers.ts, db/purchaseReturns.ts) — this
-- migration adds the matching Postgres validation/apply branch, following
-- the exact reapply-safe wrapper pattern already used by
-- 20260823050000_b3_groups456_sync_completion.sql: rename whatever function
-- is currently named sync_apply_operation, then create-or-replace a new one
-- that owns only this kind and delegates every other kind, unchanged, to
-- the renamed predecessor.
--
-- Never trusts the client's claimed remaining quantity or credit amount —
-- both are re-derived here from the purchase_item's own current row (locked
-- FOR UPDATE) and the current sum of its own prior returns, exactly like
-- purchase_receive_line's total re-derivation and purchase_void's
-- movement/payment re-derivation in the migration this one delegates to.
--
-- No server-side closed-day re-check: matching every other kind in this
-- dispatcher (supplier_payment, purchase_receive_line, purchase_void,
-- purchase_create), the closed-day guard is a client-side (SQLite)
-- concept — assertBusinessDateOpen — never re-validated here.
--
-- Local file only. Do not execute remotely without separate approval.

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_operation_kind_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_operation_kind_check
  check (operation_kind in (
    'sale','refund','inventory_import','draft_complete','credit_collection',
    'withdrawal','expense_create','expense_delete','draft_hold','draft_cancel',
    'supplier_payment','purchase_receive_line','purchase_void','purchase_create',
    'purchase_return'
  ));

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_purchase_return_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_purchase_return_count_check
  check (operation_kind<>'purchase_return' or expected_row_count=3);

do $rename_group7_operation$
begin
  if to_regprocedure(
    'public.sync_apply_operation_pre_b3_group7(uuid,uuid,text,uuid,text,jsonb)'
  ) is null then
    alter function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
      rename to sync_apply_operation_pre_b3_group7;
  end if;
end
$rename_group7_operation$;

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
  v_row_count integer;
  v_result text;

  -- Residual-cash COD purchase_create / purchase_receive_line remediation.
  v_drawer_count integer;
  v_drawer_id uuid;
  v_business_date date;
  v_payment_count integer;
  v_item_row jsonb;
  v_purchase_update_row jsonb;
  v_batch_row jsonb;
  v_cod_payment_row jsonb;
  v_purchases_row jsonb;
  v_items_total bigint;
  v_recomputed_total bigint;
  v_line_value bigint;
  v_supplier_credit bigint;
  v_expected_residual_cash bigint;

  -- purchase_return
  v_return_row jsonb;
  v_movement_row jsonb;
  v_audit_row jsonb;
  v_existing_item purchase_items%rowtype;
  v_existing_purchase purchases%rowtype;
  v_resolved_batch_id uuid;
  v_current_batch_stock integer;
  v_already_returned integer;
  v_ledger_remaining integer;
  v_max_returnable integer;
  v_expected_credit bigint;
begin
  if p_operation_kind not in ('purchase_return','purchase_create','purchase_receive_line') then
    return sync_apply_operation_pre_b3_group7(
      p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,p_rows
    );
  end if;

  if jsonb_typeof(p_rows)<>'array' then
    raise exception '% rows must be an array',p_operation_kind using errcode='MU024';
  end if;
  v_row_count:=jsonb_array_length(p_rows);
  if p_operation_kind='purchase_return' and v_row_count<>3 then
    raise exception 'purchase_return requires exactly 3 rows' using errcode='MU024';
  end if;

  if not exists(
    select 1 from users u join roles r on r.id=u.role_id
    where u.id=p_actor_id and u.shop_id=p_shop_id
      and u.is_active and not u.is_deleted and not r.is_deleted
      and r.name='owner'
  ) then
    raise exception '% is Owner-only',p_operation_kind using errcode='MU015';
  end if;

  if exists(
    select 1 from jsonb_array_elements(p_rows) e
    where e->'payload' is null
       or jsonb_typeof(e->'payload')<>'object'
       or coalesce(e->>'rowId',e->>'row_id') is distinct from e->'payload'->>'id'
       or e->'payload'->>'shop_id' is distinct from p_shop_id::text
  ) then
    raise exception 'invalid or cross-shop % row',p_operation_kind using errcode='MU003';
  end if;

  if exists(
    select 1 from jsonb_array_elements(p_rows) e
    where not (coalesce(e->>'tableName',e->>'table_name') = any
      (case p_operation_kind
        when 'purchase_return' then array['purchase_returns','inventory_movements','audit_logs']
        when 'purchase_receive_line' then array['purchase_items','batches','inventory_movements','purchases','payments','cash_drawer']
        when 'purchase_create' then array['purchases','purchase_items','batches','inventory_movements','payments','cash_drawer']
        else array[]::text[] end))
  ) then raise exception 'table is not allowed in operation kind' using errcode='MU004'; end if;

  ----------------------------------------------------------------------
  -- COD create/receive residual-cash compatibility. Credit-term operations
  -- still delegate byte-for-byte to the Groups 4-6 predecessor. The final
  -- standalone Supplier Credit is the positive excess of all live return
  -- credit over all live, non-voided purchase remaining balances; this is
  -- algebraically identical to the canonical two-pass FIFO allocation's
  -- final pool, without trusting any client-supplied credit figure.
  ----------------------------------------------------------------------
  if p_operation_kind='purchase_create' then
    select e->'payload' into v_purchases_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchases';
    if v_purchases_row is null or v_purchases_row->>'payment_terms'<>'cod' then
      return sync_apply_operation_pre_b3_group7(
        p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,p_rows
      );
    end if;

    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchases')<>1
       or (v_purchases_row->>'id')::uuid is distinct from p_operation_id
       or v_purchases_row->>'source' not in ('manual','ocr')
       or coalesce((v_purchases_row->>'is_deleted')::boolean,false)
       or exists(select 1 from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='purchases' and e->>'op'<>'insert') then
      raise exception 'invalid COD purchase_create header' using errcode='MU024';
    end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchase_items')=0
       or exists(select 1 from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='purchase_items'
            and (e->>'op'<>'insert' or e->'payload'->>'status' not in ('pending','received')
              or (e->'payload'->>'purchase_id')::uuid is distinct from p_operation_id
              or coalesce((e->'payload'->>'qty')::integer,0)<=0
              or coalesce((e->'payload'->>'purchase_price')::bigint,-1)<0
              or coalesce((e->'payload'->>'sale_price')::bigint,-1)<0
              or (e->'payload'->>'status'='received' and e->'payload'->>'received_at' is null)
              or (e->'payload'->>'status'='pending' and e->'payload'->>'received_at' is not null)
              or coalesce((e->'payload'->>'is_deleted')::boolean,false)
              or not exists(select 1 from medicines m
                   where m.id=(e->'payload'->>'medicine_id')::uuid
                     and m.shop_id=p_shop_id and not m.is_deleted))) then
      raise exception 'invalid purchase_items row in purchase_create' using errcode='MU024';
    end if;

    select coalesce(sum(case when e->'payload'->>'status'='received'
      then (e->'payload'->>'purchase_price')::bigint*(e->'payload'->>'qty')::bigint else 0 end),0)
      into v_items_total from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchase_items';
    if (v_purchases_row->>'total')::bigint is distinct from v_items_total then
      raise exception 'purchase_create total does not match server recomputation' using errcode='MU024';
    end if;

    perform 1 from suppliers where id=(v_purchases_row->>'supplier_id')::uuid
      and shop_id=p_shop_id and not is_deleted for update;
    if not found then raise exception 'supplier for purchase_create is missing' using errcode='MU019'; end if;
    select greatest(0,
      coalesce((select sum(pr.credit_amount) from purchase_returns pr
        join purchases p on p.id=pr.purchase_id
        where p.shop_id=p_shop_id and p.supplier_id=(v_purchases_row->>'supplier_id')::uuid
          and not p.is_deleted and p.voided_at is null and not pr.is_deleted),0)
      - coalesce((select sum(greatest(0,p.total-p.paid_amount)) from purchases p
        where p.shop_id=p_shop_id and p.supplier_id=(v_purchases_row->>'supplier_id')::uuid
          and not p.is_deleted and p.voided_at is null),0)
    ) into v_supplier_credit;
    v_expected_residual_cash:=greatest(0,v_items_total-v_supplier_credit);
    if (v_purchases_row->>'paid_amount')::bigint is distinct from v_expected_residual_cash
       or (v_purchases_row->>'paid_amount')::bigint<0
       or (v_purchases_row->>'paid_amount')::bigint>v_items_total then
      raise exception 'COD purchase_create paid_amount does not match residual cash' using errcode='MU024';
    end if;

    if exists(select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='batches' and
        (e->>'op'<>'insert'
         or coalesce((e->'payload'->>'stock')::integer,-1)<>0
         or coalesce((e->'payload'->>'is_deleted')::boolean,false)
         or exists(select 1 from batches existing
              where existing.shop_id=p_shop_id
                and existing.medicine_id=(e->'payload'->>'medicine_id')::uuid
                and existing.batch_no=e->'payload'->>'batch_no')
         or not exists(select 1 from jsonb_array_elements(p_rows) item
              where coalesce(item->>'tableName',item->>'table_name')='purchase_items'
                and item->'payload'->>'status'='received'
                and (item->'payload'->>'medicine_id')::uuid=(e->'payload'->>'medicine_id')::uuid
                and item->'payload'->>'batch_no'=e->'payload'->>'batch_no'
                and item->'payload'->>'expiry_date'=e->'payload'->>'expiry_date'
                and (item->'payload'->>'purchase_price')::bigint=(e->'payload'->>'purchase_price')::bigint
                and (item->'payload'->>'sale_price')::bigint=(e->'payload'->>'sale_price')::bigint))) then
      raise exception 'invalid batch row in purchase_create' using errcode='MU024';
    end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='inventory_movements')
       <> (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchase_items'
          and e->'payload'->>'status'='received')
       or exists(select 1 from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='inventory_movements' and
          (e->>'op'<>'insert' or e->'payload'->>'reason' is distinct from 'purchase'
            or (e->'payload'->>'ref_id')::uuid is distinct from p_operation_id
            or (e->'payload'->>'created_by')::uuid is distinct from p_actor_id
            or coalesce((e->'payload'->>'change_qty')::integer,0)<=0
            or coalesce((e->'payload'->>'is_deleted')::boolean,false))) then
      raise exception 'invalid movement rows in purchase_create' using errcode='MU024';
    end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) item
      where coalesce(item->>'tableName',item->>'table_name')='purchase_items'
        and item->'payload'->>'status'='received'
        and not exists(
          select 1 from jsonb_array_elements(p_rows) movement
          where coalesce(movement->>'tableName',movement->>'table_name')='inventory_movements'
            and (movement->'payload'->>'change_qty')::integer=(item->'payload'->>'qty')::integer
            and (movement->'payload'->>'batch_id')::uuid is not distinct from coalesce(
              (select (batch->'payload'->>'id')::uuid from jsonb_array_elements(p_rows) batch
                where coalesce(batch->>'tableName',batch->>'table_name')='batches'
                  and (batch->'payload'->>'medicine_id')::uuid=(item->'payload'->>'medicine_id')::uuid
                  and batch->'payload'->>'batch_no'=item->'payload'->>'batch_no' limit 1),
              (select existing.id from batches existing
                where existing.shop_id=p_shop_id
                  and existing.medicine_id=(item->'payload'->>'medicine_id')::uuid
                  and existing.batch_no=item->'payload'->>'batch_no'
                  and existing.expiry_date=(item->'payload'->>'expiry_date')::date
                  and not existing.is_deleted limit 1)
            )
        )
    ) then
      raise exception 'purchase_create item/movement/batch mismatch' using errcode='MU024';
    end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) movement
      where coalesce(movement->>'tableName',movement->>'table_name')='inventory_movements'
        and not exists(
          select 1 from jsonb_array_elements(p_rows) item
          where coalesce(item->>'tableName',item->>'table_name')='purchase_items'
            and item->'payload'->>'status'='received'
            and (movement->'payload'->>'batch_id')::uuid is not distinct from coalesce(
              (select (batch->'payload'->>'id')::uuid from jsonb_array_elements(p_rows) batch
                where coalesce(batch->>'tableName',batch->>'table_name')='batches'
                  and (batch->'payload'->>'medicine_id')::uuid=(item->'payload'->>'medicine_id')::uuid
                  and batch->'payload'->>'batch_no'=item->'payload'->>'batch_no' limit 1),
              (select existing.id from batches existing
                where existing.shop_id=p_shop_id
                  and existing.medicine_id=(item->'payload'->>'medicine_id')::uuid
                  and existing.batch_no=item->'payload'->>'batch_no'
                  and existing.expiry_date=(item->'payload'->>'expiry_date')::date
                  and not existing.is_deleted limit 1)
            )
        )
    ) or exists(
      select 1 from jsonb_array_elements(p_rows) item
      where coalesce(item->>'tableName',item->>'table_name')='purchase_items'
        and item->'payload'->>'status'='received'
        and (
          select coalesce(sum((same_item->'payload'->>'qty')::integer),0)
          from jsonb_array_elements(p_rows) same_item
          where coalesce(same_item->>'tableName',same_item->>'table_name')='purchase_items'
            and same_item->'payload'->>'status'='received'
            and coalesce(
              (select (batch->'payload'->>'id')::uuid from jsonb_array_elements(p_rows) batch
                where coalesce(batch->>'tableName',batch->>'table_name')='batches'
                  and (batch->'payload'->>'medicine_id')::uuid=(same_item->'payload'->>'medicine_id')::uuid
                  and batch->'payload'->>'batch_no'=same_item->'payload'->>'batch_no' limit 1),
              (select existing.id from batches existing
                where existing.shop_id=p_shop_id
                  and existing.medicine_id=(same_item->'payload'->>'medicine_id')::uuid
                  and existing.batch_no=same_item->'payload'->>'batch_no'
                  and existing.expiry_date=(same_item->'payload'->>'expiry_date')::date
                  and not existing.is_deleted limit 1)
            ) is not distinct from coalesce(
              (select (batch->'payload'->>'id')::uuid from jsonb_array_elements(p_rows) batch
                where coalesce(batch->>'tableName',batch->>'table_name')='batches'
                  and (batch->'payload'->>'medicine_id')::uuid=(item->'payload'->>'medicine_id')::uuid
                  and batch->'payload'->>'batch_no'=item->'payload'->>'batch_no' limit 1),
              (select existing.id from batches existing
                where existing.shop_id=p_shop_id
                  and existing.medicine_id=(item->'payload'->>'medicine_id')::uuid
                  and existing.batch_no=item->'payload'->>'batch_no'
                  and existing.expiry_date=(item->'payload'->>'expiry_date')::date
                  and not existing.is_deleted limit 1)
            )
        ) is distinct from (
          select coalesce(sum((movement->'payload'->>'change_qty')::integer),0)
          from jsonb_array_elements(p_rows) movement
          where coalesce(movement->>'tableName',movement->>'table_name')='inventory_movements'
            and (movement->'payload'->>'batch_id')::uuid is not distinct from coalesce(
              (select (batch->'payload'->>'id')::uuid from jsonb_array_elements(p_rows) batch
                where coalesce(batch->>'tableName',batch->>'table_name')='batches'
                  and (batch->'payload'->>'medicine_id')::uuid=(item->'payload'->>'medicine_id')::uuid
                  and batch->'payload'->>'batch_no'=item->'payload'->>'batch_no' limit 1),
              (select existing.id from batches existing
                where existing.shop_id=p_shop_id
                  and existing.medicine_id=(item->'payload'->>'medicine_id')::uuid
                  and existing.batch_no=item->'payload'->>'batch_no'
                  and existing.expiry_date=(item->'payload'->>'expiry_date')::date
                  and not existing.is_deleted limit 1)
            )
        )
    ) then
      raise exception 'purchase_create batch movement totals do not match items' using errcode='MU024';
    end if;

    select count(*) into v_payment_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments';
    select count(*) into v_drawer_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer';
    select e->'payload' into v_cod_payment_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments';
    if v_expected_residual_cash=0 then
      if v_payment_count<>0 or v_drawer_count<>0 then
        raise exception 'credit-covered COD purchase_create must not touch payment or drawer' using errcode='MU024';
      end if;
    elsif v_payment_count<>1 or v_drawer_count not in (1,2)
       or v_cod_payment_row->>'type' is distinct from 'supplier_payment'
       or v_cod_payment_row->>'method' is distinct from 'cash'
       or (v_cod_payment_row->>'party_id')::uuid is distinct from (v_purchases_row->>'supplier_id')::uuid
       or coalesce((v_cod_payment_row->>'amount')::bigint,-1) is distinct from v_expected_residual_cash
       or (v_cod_payment_row->>'ref_id')::uuid is distinct from p_operation_id
       or (v_cod_payment_row->>'created_by')::uuid is distinct from p_actor_id
       or coalesce((v_cod_payment_row->>'is_deleted')::boolean,false)
       or exists(select 1 from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='payments' and e->>'op'<>'insert') then
      raise exception 'invalid residual COD settlement in purchase_create' using errcode='MU024';
    end if;
    if v_expected_residual_cash>0 then
      v_business_date:=((v_cod_payment_row->>'created_at')::timestamptz at time zone 'Asia/Dhaka')::date;
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
            or e->>'op' not in ('insert','update')
          ))
         or (v_drawer_count=1 and not (
           exists(select 1 from jsonb_array_elements(p_rows) e
             where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' and e->>'op'='update')
           and exists(select 1 from cash_drawer d where d.id=v_drawer_id and d.shop_id=p_shop_id
             and d.business_date=v_business_date and d.closed_at is null and not d.is_deleted)
         ))
         or (v_drawer_count=2 and (
           (select count(*) from jsonb_array_elements(p_rows) e
             where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' and e->>'op'='insert')<>1
           or (select count(*) from jsonb_array_elements(p_rows) e
             where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' and e->>'op'='update')<>1
           or (select min(e.ord) from jsonb_array_elements(p_rows) with ordinality e(value,ord)
             where coalesce(e.value->>'tableName',e.value->>'table_name')='cash_drawer'
               and e.value->>'op'='insert') >=
              (select min(e.ord) from jsonb_array_elements(p_rows) with ordinality e(value,ord)
             where coalesce(e.value->>'tableName',e.value->>'table_name')='cash_drawer'
               and e.value->>'op'='update')
           or exists(select 1 from cash_drawer d where d.id=v_drawer_id
             or (d.shop_id=p_shop_id and d.business_date=v_business_date))
         )) then
        raise exception 'invalid cash drawer rows in purchase_create' using errcode='MU024';
      end if;
    end if;

  elsif p_operation_kind='purchase_receive_line' then
    select e->'payload' into v_item_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchase_items';
    select * into v_existing_item from purchase_items
      where id=(v_item_row->>'id')::uuid and shop_id=p_shop_id and not is_deleted for update;
    if not found then raise exception 'purchase line to receive is missing' using errcode='MU019'; end if;
    select * into v_existing_purchase from purchases
      where id=v_existing_item.purchase_id and shop_id=p_shop_id and not is_deleted for update;
    if not found or v_existing_purchase.voided_at is not null then
      raise exception 'purchase for this line is missing or voided' using errcode='MU019';
    end if;
    if v_existing_purchase.payment_terms<>'cod' then
      return sync_apply_operation_pre_b3_group7(
        p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,p_rows
      );
    end if;

    if v_row_count<3 or v_row_count>7 or v_existing_item.status<>'pending' then
      raise exception 'invalid COD purchase_receive_line state' using errcode='MU024';
    end if;
    select e->'payload' into v_purchase_update_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchases';
    select e->'payload' into v_movement_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_movements';
    if (select count(*) from jsonb_array_elements(p_rows) e where coalesce(e->>'tableName',e->>'table_name')='purchase_items')<>1
       or (select count(*) from jsonb_array_elements(p_rows) e where coalesce(e->>'tableName',e->>'table_name')='purchases')<>1
       or (select count(*) from jsonb_array_elements(p_rows) e where coalesce(e->>'tableName',e->>'table_name')='inventory_movements')<>1
       or v_item_row->>'status' is distinct from 'received' or v_item_row->>'received_at' is null
       or (v_item_row->>'purchase_id')::uuid is distinct from v_existing_item.purchase_id
       or (v_item_row->>'medicine_id')::uuid is distinct from v_existing_item.medicine_id
       or v_item_row->>'batch_no' is distinct from v_existing_item.batch_no
       or (v_item_row->>'expiry_date')::date is distinct from v_existing_item.expiry_date
       or (v_item_row->>'qty')::integer is distinct from v_existing_item.qty
       or (v_item_row->>'purchase_price')::bigint is distinct from v_existing_item.purchase_price
       or (v_item_row->>'sale_price')::bigint is distinct from v_existing_item.sale_price
       or (v_purchase_update_row->>'id')::uuid is distinct from v_existing_purchase.id
       or (v_purchase_update_row->>'supplier_id')::uuid is distinct from v_existing_purchase.supplier_id
       or v_purchase_update_row->>'invoice_no' is distinct from v_existing_purchase.invoice_no
       or v_purchase_update_row->>'payment_terms' is distinct from v_existing_purchase.payment_terms
       or v_purchase_update_row->>'source' is distinct from v_existing_purchase.source
       or (v_purchase_update_row->>'created_at')::timestamptz is distinct from v_existing_purchase.created_at
       or coalesce((v_item_row->>'is_deleted')::boolean,false)
       or coalesce((v_movement_row->>'is_deleted')::boolean,false)
       or exists(select 1 from jsonb_array_elements(p_rows) e where
          (coalesce(e->>'tableName',e->>'table_name')='purchase_items' and e->>'op'<>'update') or
          (coalesce(e->>'tableName',e->>'table_name')='purchases' and e->>'op'<>'update') or
          (coalesce(e->>'tableName',e->>'table_name')='inventory_movements' and e->>'op'<>'insert')) then
      raise exception 'invalid purchase_receive_line graph' using errcode='MU024';
    end if;

    v_line_value:=v_existing_item.purchase_price*v_existing_item.qty;
    select coalesce(sum(purchase_price*qty),0) into v_recomputed_total from purchase_items
      where purchase_id=v_existing_purchase.id and shop_id=p_shop_id and not is_deleted
        and (status='received' or id=v_existing_item.id);
    if (v_purchase_update_row->>'total')::bigint is distinct from v_recomputed_total then
      raise exception 'purchase_receive_line total does not match server recomputation' using errcode='MU024';
    end if;

    select e->'payload' into v_batch_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='batches';
    if v_batch_row is not null then
      if (select count(*) from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='batches')<>1
         or (v_batch_row->>'medicine_id')::uuid is distinct from v_existing_item.medicine_id
         or v_batch_row->>'batch_no' is distinct from v_existing_item.batch_no
         or (v_batch_row->>'expiry_date')::date is distinct from v_existing_item.expiry_date
         or (v_batch_row->>'purchase_price')::bigint is distinct from v_existing_item.purchase_price
         or (v_batch_row->>'sale_price')::bigint is distinct from v_existing_item.sale_price
         or coalesce((v_batch_row->>'stock')::integer,-1)<>0
         or coalesce((v_batch_row->>'is_deleted')::boolean,false)
         or exists(select 1 from jsonb_array_elements(p_rows) e
            where coalesce(e->>'tableName',e->>'table_name')='batches' and e->>'op'<>'insert') then
        raise exception 'invalid batch row for purchase_receive_line' using errcode='MU024';
      end if;
      v_resolved_batch_id:=(v_batch_row->>'id')::uuid;
    else
      select id into v_resolved_batch_id from batches where shop_id=p_shop_id
        and medicine_id=v_existing_item.medicine_id and batch_no=v_existing_item.batch_no and not is_deleted;
    end if;
    if v_resolved_batch_id is null
       or (v_movement_row->>'batch_id')::uuid is distinct from v_resolved_batch_id
       or (v_movement_row->>'change_qty')::integer is distinct from v_existing_item.qty
       or v_movement_row->>'reason' is distinct from 'purchase'
       or (v_movement_row->>'ref_id')::uuid is distinct from v_existing_purchase.id
       or (v_movement_row->>'created_by')::uuid is distinct from p_actor_id then
      raise exception 'invalid movement row for purchase_receive_line' using errcode='MU024';
    end if;

    perform 1 from suppliers where id=v_existing_purchase.supplier_id
      and shop_id=p_shop_id and not is_deleted for update;
    if not found then raise exception 'supplier for purchase_receive_line is missing' using errcode='MU019'; end if;
    select greatest(0,
      coalesce((select sum(pr.credit_amount) from purchase_returns pr join purchases p on p.id=pr.purchase_id
        where p.shop_id=p_shop_id and p.supplier_id=v_existing_purchase.supplier_id
          and not p.is_deleted and p.voided_at is null and not pr.is_deleted),0)
      - coalesce((select sum(greatest(0,p.total-p.paid_amount)) from purchases p
        where p.shop_id=p_shop_id and p.supplier_id=v_existing_purchase.supplier_id
          and not p.is_deleted and p.voided_at is null),0)
    ) into v_supplier_credit;
    v_expected_residual_cash:=greatest(0,v_line_value-v_supplier_credit);
    if (v_purchase_update_row->>'paid_amount')::bigint is distinct from
       v_existing_purchase.paid_amount+v_expected_residual_cash
       or (v_purchase_update_row->>'paid_amount')::bigint<0
       or (v_purchase_update_row->>'paid_amount')::bigint>v_recomputed_total then
      raise exception 'COD purchase_receive_line paid_amount does not match cumulative residual cash' using errcode='MU024';
    end if;

    select count(*) into v_payment_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments';
    select count(*) into v_drawer_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer';
    select e->'payload' into v_cod_payment_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments';
    if v_expected_residual_cash=0 then
      if v_payment_count<>0 or v_drawer_count<>0 then
        raise exception 'credit-covered COD purchase_receive_line must not touch payment or drawer' using errcode='MU024';
      end if;
    elsif v_payment_count<>1 or v_drawer_count not in (1,2)
       or v_cod_payment_row->>'type' is distinct from 'supplier_payment'
       or v_cod_payment_row->>'method' is distinct from 'cash'
       or (v_cod_payment_row->>'party_id')::uuid is distinct from v_existing_purchase.supplier_id
       or coalesce((v_cod_payment_row->>'amount')::bigint,-1) is distinct from v_expected_residual_cash
       or (v_cod_payment_row->>'ref_id')::uuid is distinct from v_existing_purchase.id
       or (v_cod_payment_row->>'created_by')::uuid is distinct from p_actor_id
       or coalesce((v_cod_payment_row->>'is_deleted')::boolean,false)
       or exists(select 1 from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='payments' and e->>'op'<>'insert') then
      raise exception 'invalid residual COD settlement in purchase_receive_line' using errcode='MU024';
    end if;
    if v_expected_residual_cash>0 then
      v_business_date:=((v_cod_payment_row->>'created_at')::timestamptz at time zone 'Asia/Dhaka')::date;
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
            or e->>'op' not in ('insert','update')
          ))
         or (v_drawer_count=1 and not (
           exists(select 1 from jsonb_array_elements(p_rows) e
             where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' and e->>'op'='update')
           and exists(select 1 from cash_drawer d where d.id=v_drawer_id and d.shop_id=p_shop_id
             and d.business_date=v_business_date and d.closed_at is null and not d.is_deleted)
         ))
         or (v_drawer_count=2 and (
           (select count(*) from jsonb_array_elements(p_rows) e
             where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' and e->>'op'='insert')<>1
           or (select count(*) from jsonb_array_elements(p_rows) e
             where coalesce(e->>'tableName',e->>'table_name')='cash_drawer' and e->>'op'='update')<>1
           or (select min(e.ord) from jsonb_array_elements(p_rows) with ordinality e(value,ord)
             where coalesce(e.value->>'tableName',e.value->>'table_name')='cash_drawer'
               and e.value->>'op'='insert') >=
              (select min(e.ord) from jsonb_array_elements(p_rows) with ordinality e(value,ord)
             where coalesce(e.value->>'tableName',e.value->>'table_name')='cash_drawer'
               and e.value->>'op'='update')
           or exists(select 1 from cash_drawer d where d.id=v_drawer_id
             or (d.shop_id=p_shop_id and d.business_date=v_business_date))
         )) then
        raise exception 'invalid cash drawer rows in purchase_receive_line' using errcode='MU024';
      end if;
    end if;

  else

  select e->'payload' into v_return_row from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='purchase_returns';
  select e->'payload' into v_movement_row from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='inventory_movements';
  select e->'payload' into v_audit_row from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='audit_logs';
  if (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchase_returns')<>1
     or (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_movements')<>1
     or (select count(*) from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='audit_logs')<>1
     or v_return_row is null or v_movement_row is null or v_audit_row is null then
    raise exception 'purchase_return requires one return, one movement, one audit row'
      using errcode='MU024';
  end if;

  if coalesce(p_rows->0->>'tableName',p_rows->0->>'table_name') is distinct from 'purchase_returns'
     or coalesce(p_rows->1->>'tableName',p_rows->1->>'table_name') is distinct from 'inventory_movements'
     or coalesce(p_rows->2->>'tableName',p_rows->2->>'table_name') is distinct from 'audit_logs' then
    raise exception 'purchase_return rows are out of order' using errcode='MU024';
  end if;

  if (v_return_row->>'id')::uuid is distinct from p_operation_id
     or (v_return_row->>'created_by')::uuid is distinct from p_actor_id
     or coalesce((v_return_row->>'qty')::integer,0)<=0
     or coalesce(nullif(trim(v_return_row->>'reason'),''),'') = ''
     or (v_return_row->>'is_deleted')::boolean is distinct from false
     or v_return_row->>'deleted_at' is not null
     or v_return_row->>'deleted_by' is not null
     or exists(
       select 1 from jsonb_array_elements(p_rows) e
       where coalesce(e->>'tableName',e->>'table_name')='purchase_returns' and e->>'op'<>'insert'
     ) then
    raise exception 'invalid purchase_return graph' using errcode='MU024';
  end if;

  -- Re-derive everything server-side; never trust the client's claimed
  -- remainder or credit amount. Locking purchase_items serializes any
  -- concurrent purchase_return against the SAME line, so the alreadyReturned
  -- sum read below cannot race with another commit on this same line.
  select * into v_existing_item from purchase_items
    where id=(v_return_row->>'purchase_item_id')::uuid and shop_id=p_shop_id and not is_deleted
    for update;
  if not found then
    raise exception 'purchase line for purchase_return is missing' using errcode='MU019';
  end if;
  if v_existing_item.status<>'received' then
    raise exception 'this line has not been received yet' using errcode='MU024';
  end if;
  if v_existing_item.purchase_id is distinct from (v_return_row->>'purchase_id')::uuid then
    raise exception 'purchase_return purchase/line mismatch' using errcode='MU024';
  end if;

  select * into v_existing_purchase from purchases
    where id=v_existing_item.purchase_id and shop_id=p_shop_id and not is_deleted
    for update;
  if not found or v_existing_purchase.voided_at is not null then
    raise exception 'purchase for this return is missing or voided' using errcode='MU019';
  end if;
  perform 1 from suppliers where id=v_existing_purchase.supplier_id
    and shop_id=p_shop_id and not is_deleted for update;
  if not found then raise exception 'supplier for purchase_return is missing' using errcode='MU019'; end if;

  -- Exact batch resolution — deterministic via the unique
  -- (shop_id, medicine_id, batch_no) index, never a fresh FEFO pick.
  select id, coalesce(stock,0) into v_resolved_batch_id, v_current_batch_stock
    from batches
    where shop_id=p_shop_id and medicine_id=v_existing_item.medicine_id
      and batch_no=v_existing_item.batch_no and not is_deleted
    for update;
  if v_resolved_batch_id is null then
    raise exception 'batch for purchase_return is missing' using errcode='MU019';
  end if;

  select coalesce(sum(qty),0) into v_already_returned from purchase_returns
    where purchase_item_id=v_existing_item.id and shop_id=p_shop_id and not is_deleted;
  v_ledger_remaining:=greatest(0, v_existing_item.qty - v_already_returned);
  v_max_returnable:=least(v_ledger_remaining, v_current_batch_stock);
  if (v_return_row->>'qty')::integer > v_max_returnable then
    raise exception 'purchase_return quantity exceeds available amount' using errcode='MU024';
  end if;

  v_expected_credit:=v_existing_item.purchase_price * (v_return_row->>'qty')::integer;
  if coalesce((v_return_row->>'credit_amount')::bigint,-1) is distinct from v_expected_credit then
    raise exception 'purchase_return credit_amount does not match server recomputation'
      using errcode='MU024';
  end if;

  if (v_movement_row->>'batch_id')::uuid is distinct from v_resolved_batch_id
     or (v_movement_row->>'change_qty')::integer is distinct from -(v_return_row->>'qty')::integer
     or v_movement_row->>'reason' is distinct from 'return'
     or (v_movement_row->>'ref_id')::uuid is distinct from (v_return_row->>'id')::uuid
     or (v_movement_row->>'created_by')::uuid is distinct from p_actor_id
     or (v_movement_row->>'is_deleted')::boolean is distinct from false
     or v_movement_row->>'deleted_at' is not null
     or v_movement_row->>'deleted_by' is not null
     or exists(
       select 1 from jsonb_array_elements(p_rows) e
       where coalesce(e->>'tableName',e->>'table_name')='inventory_movements' and e->>'op'<>'insert'
     ) then
    raise exception 'invalid movement row for purchase_return' using errcode='MU024';
  end if;

  if v_audit_row->>'action' is distinct from 'purchase_return_created'
     or v_audit_row->>'target' is distinct from (v_return_row->>'id')::text
     or (v_audit_row->>'actor_id')::uuid is distinct from p_actor_id
     or (v_audit_row->>'is_deleted')::boolean is distinct from false
     or v_audit_row->>'deleted_at' is not null
     or v_audit_row->>'deleted_by' is not null
     or exists(
       select 1 from jsonb_array_elements(p_rows) e
       where coalesce(e->>'tableName',e->>'table_name')='audit_logs' and e->>'op'<>'insert'
     ) then
    raise exception 'invalid audit row for purchase_return' using errcode='MU024';
  end if;

  end if;

  -- One PostgreSQL function call is one transaction. Any rejected row rolls
  -- back everything in this group together.
  for v_entry in
    select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ord)
    order by e.ord
  loop
    if not sync_row_permitted(
      p_actor_id,
      coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name'),
      v_entry.value->'payload'
    ) then
      raise exception '% contains unauthorized row',p_operation_kind using errcode='MU010';
    end if;
    v_result:=sync_apply_row(
      coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name'),
      v_entry.value->>'op',v_entry.value->'payload',
      p_shop_id,p_actor_id,p_device_id
    );
    if v_result<>'applied' then
      raise exception '% row rejected: %',p_operation_kind,v_result using errcode='MU024';
    end if;
  end loop;
  return 'applied';
end
$fn$;

revoke execute on function
  sync_apply_operation_pre_b3_group7(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke execute on function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function
  sync_apply_operation_pre_b3_group7(uuid,uuid,text,uuid,text,jsonb),
  sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  to service_role;

-- Defense-in-depth symmetry with the existing explicit revoke list
-- (20260821010000_phase_b2_sales_inventory_sync.sql) for financial/ledger
-- tables that already never had a grant in the first place. purchases,
-- purchase_items, and purchase_returns were flagged in the B3 Group 7 audit
-- as relying solely on "never granted" rather than an explicit revoke —
-- closing that gap here rather than leaving it silently asymmetric.
revoke insert,update,delete on table purchase_returns, purchases, purchase_items
  from anon, authenticated;
