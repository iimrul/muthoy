-- Phase B3 Groups 4-6 review-fix: server-side grouped-sync support for
-- supplier_payment, purchase_receive_line, purchase_void, purchase_create.
--
-- These four kinds have existed as client-side SyncOperationGroup bookkeeping
-- only since the prior B3 Groups 4-6 batch (db/sync-helpers.ts) — this
-- migration adds the matching Postgres validation/apply branches, following
-- the exact reapply-safe wrapper pattern already used by 20260823020000
-- (withdrawal) and 20260823030000 (expense_create/expense_delete): rename
-- whatever function is currently named sync_apply_operation, then
-- create-or-replace a new one that owns only these 4 kinds and delegates
-- every other kind, unchanged, to the renamed predecessor.
--
-- Old-client rollout safety: this migration does NOT touch push.ts's
-- ungrouped-row acceptance for `purchases`/`purchase_items` — an
-- un-updated client that never stamps an operation kind on those tables
-- keeps pushing them ungrouped exactly as it does today. Deployment order
-- for when this eventually goes remote: server compatibility (this
-- migration) first, grouped mobile build second — nothing here is executed
-- against the remote project in this batch.
--
-- Local file only. Do not execute remotely without separate approval.

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_operation_kind_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_operation_kind_check
  check (operation_kind in (
    'sale','refund','inventory_import','draft_complete','credit_collection',
    'withdrawal','expense_create','expense_delete','draft_hold','draft_cancel',
    'supplier_payment','purchase_receive_line','purchase_void','purchase_create'
  ));

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_purchase_void_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_purchase_void_count_check
  check (operation_kind<>'purchase_void' or expected_row_count=2);

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_supplier_payment_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_supplier_payment_count_check
  check (operation_kind<>'supplier_payment' or expected_row_count between 2 and 4);

alter table sync_operation_staging
  drop constraint if exists sync_operation_staging_purchase_receive_line_count_check;
alter table sync_operation_staging
  add constraint sync_operation_staging_purchase_receive_line_count_check
  check (operation_kind<>'purchase_receive_line' or expected_row_count between 3 and 7);

-- purchase_create has no fixed count (variable line-item count), matching
-- the existing precedent for 'sale'/'refund'/'inventory_import' — no CHECK
-- constraint added for it either.

-- sync_apply_row_base's suppliers/purchases/purchase_items branches
-- (20260818000100_sync_batches_stock_server_derived.sql) hardcode their
-- ON CONFLICT(id) DO UPDATE SET column lists from before migrations
-- 0019-0023 existed — archived_at/archived_by/manufacturer/notes
-- (suppliers), voided_at/voided_by/invoice_date/source (purchases), and
-- status/received_at (purchase_items) are therefore NOT in those lists.
-- jsonb_populate_record's INSERT arm still populates them correctly on
-- first create, but an UPDATE-only write (archiveSupplier, voidPurchase,
-- markPurchaseLineReceived) would apply locally and queue correctly in the
-- outbox, then silently fail to reach this Postgres mirror once sync is
-- enabled — exactly the class of gap 20260823020000_b3_group2_sync_completion
-- already fixed once for cash_drawer's reconcile columns. Same wrapper
-- pattern here, same old-client-omission safety (only touches a column when
-- the payload actually carries that key).
do $rename_groups456_row_base$
begin
  if to_regprocedure(
    'public.sync_apply_row_base_pre_b3_groups456(text,text,jsonb,uuid)'
  ) is null then
    alter function sync_apply_row_base(text,text,jsonb,uuid)
      rename to sync_apply_row_base_pre_b3_groups456;
  end if;
end
$rename_groups456_row_base$;

create or replace function sync_apply_row_base(
  p_table text,
  p_op text,
  p_row jsonb,
  p_caller_shop_id uuid
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_row_id uuid := (p_row->>'id')::uuid;
  v_row jsonb := p_row;
  v_result text;
begin
  -- Old-client rollout safety: purchases.source and purchase_items.status
  -- are NOT NULL at the Postgres level (matching the SQLite trigger-enforced
  -- enum), but jsonb_populate_record does NOT fall back to a column's table
  -- DEFAULT for a JSON key the payload never included — an old client's
  -- insert (built against a schema.ts that predates migrations 0020/0023)
  -- would otherwise fail outright. Default them here, before delegating,
  -- the same way sync_apply_row already backfills sales/sale_items columns.
  if p_table='purchases' and p_op<>'delete' and not (p_row ? 'source') then
    v_row := v_row || jsonb_build_object('source', 'manual');
  end if;
  if p_table='purchase_items' and p_op<>'delete' and not (p_row ? 'status') then
    v_row := v_row || jsonb_build_object('status', 'received');
  end if;

  v_result := sync_apply_row_base_pre_b3_groups456(p_table,p_op,v_row,p_caller_shop_id);
  if v_result='applied' and p_op<>'delete' then
    if p_table='suppliers' then
      update suppliers set
        archived_at = case when p_row ? 'archived_at' then (p_row->>'archived_at')::timestamptz else archived_at end,
        archived_by = case when p_row ? 'archived_by' then (p_row->>'archived_by')::uuid else archived_by end,
        manufacturer = case when p_row ? 'manufacturer' then p_row->>'manufacturer' else manufacturer end,
        notes = case when p_row ? 'notes' then p_row->>'notes' else notes end
      where id=v_row_id and shop_id=p_caller_shop_id;
    elsif p_table='purchases' then
      update purchases set
        voided_at = case when p_row ? 'voided_at' then (p_row->>'voided_at')::timestamptz else voided_at end,
        voided_by = case when p_row ? 'voided_by' then (p_row->>'voided_by')::uuid else voided_by end,
        invoice_date = case when p_row ? 'invoice_date' then (p_row->>'invoice_date')::date else invoice_date end,
        source = case when p_row ? 'source' then coalesce(p_row->>'source','manual') else source end
      where id=v_row_id and shop_id=p_caller_shop_id;
    elsif p_table='purchase_items' then
      update purchase_items set
        status = case when p_row ? 'status' then coalesce(p_row->>'status','received') else status end,
        received_at = case when p_row ? 'received_at' then (p_row->>'received_at')::timestamptz else received_at end
      where id=v_row_id and shop_id=p_caller_shop_id;
    end if;
  end if;
  return v_result;
end
$fn$;

revoke execute on function
  sync_apply_row_base_pre_b3_groups456(text,text,jsonb,uuid)
  from public,anon,authenticated;
revoke execute on function sync_apply_row_base(text,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function
  sync_apply_row_base_pre_b3_groups456(text,text,jsonb,uuid),
  sync_apply_row_base(text,text,jsonb,uuid)
  to service_role;

do $rename_groups456_operation$
begin
  if to_regprocedure(
    'public.sync_apply_operation_pre_b3_groups456(uuid,uuid,text,uuid,text,jsonb)'
  ) is null then
    alter function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
      rename to sync_apply_operation_pre_b3_groups456;
  end if;
end
$rename_groups456_operation$;

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
  v_drawer_count integer;

  -- purchase_void
  v_purchase_row jsonb;
  v_audit_row jsonb;
  v_purchase_id uuid;
  v_movement_count integer;
  v_payment_count integer;

  -- supplier_payment
  v_payment_row jsonb;
  v_purchase_update_row jsonb;
  v_existing_purchase purchases%rowtype;

  -- purchase_receive_line
  v_item_row jsonb;
  v_batch_row jsonb;
  v_movement_row jsonb;
  v_cod_payment_row jsonb;
  v_existing_item purchase_items%rowtype;
  v_recomputed_total bigint;
  v_line_value bigint;
  v_resolved_batch_id uuid;

  -- purchase_create
  v_purchases_row jsonb;
  v_items_total bigint;
begin
  if p_operation_kind not in
    ('supplier_payment','purchase_receive_line','purchase_void','purchase_create') then
    return sync_apply_operation_pre_b3_groups456(
      p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,p_rows
    );
  end if;

  if jsonb_typeof(p_rows)<>'array' then
    raise exception '% rows must be an array',p_operation_kind using errcode='MU024';
  end if;
  v_row_count:=jsonb_array_length(p_rows);

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
    where case p_operation_kind
      when 'purchase_void' then coalesce(e->>'tableName',e->>'table_name') not in
        ('purchases','audit_logs')
      when 'supplier_payment' then coalesce(e->>'tableName',e->>'table_name') not in
        ('payments','purchases','cash_drawer')
      when 'purchase_receive_line' then coalesce(e->>'tableName',e->>'table_name') not in
        ('purchase_items','batches','inventory_movements','purchases','payments','cash_drawer')
      when 'purchase_create' then coalesce(e->>'tableName',e->>'table_name') not in
        ('purchases','purchase_items','batches','inventory_movements','payments','cash_drawer')
      else true end
  ) then raise exception 'table is not allowed in operation kind' using errcode='MU004'; end if;

  ----------------------------------------------------------------------
  -- purchase_void (contract §5.13): void only when zero stock movements
  -- AND zero payments — re-derived independently of the client payload,
  -- never trusted from it. This is the safety-critical guarantee of void.
  ----------------------------------------------------------------------
  if p_operation_kind='purchase_void' then
    if v_row_count<>2 then
      raise exception 'purchase_void requires exactly 2 rows' using errcode='MU024';
    end if;
    select e->'payload' into v_purchase_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchases';
    select e->'payload' into v_audit_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='audit_logs';
    if v_purchase_row is null or v_audit_row is null then
      raise exception 'purchase_void requires one purchase update and one audit row'
        using errcode='MU024';
    end if;
    v_purchase_id:=(v_purchase_row->>'id')::uuid;
    if (v_purchase_row->>'voided_at') is null
       or (v_purchase_row->>'voided_by')::uuid is distinct from p_actor_id
       or v_audit_row->>'action' is distinct from 'purchase_voided'
       or v_audit_row->>'target' is distinct from v_purchase_id::text
       or (v_audit_row->>'actor_id')::uuid is distinct from p_actor_id
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where (coalesce(e->>'tableName',e->>'table_name')='purchases' and e->>'op'<>'update')
            or (coalesce(e->>'tableName',e->>'table_name')='audit_logs' and e->>'op'<>'insert')
       ) then
      raise exception 'invalid purchase_void graph' using errcode='MU024';
    end if;

    select count(*) into v_movement_count from inventory_movements
      where shop_id=p_shop_id and ref_id=v_purchase_id;
    select count(*) into v_payment_count from payments
      where shop_id=p_shop_id and ref_id=v_purchase_id and type='supplier_payment'
        and not is_deleted;
    if v_movement_count>0 then
      raise exception 'purchase has stock movement and cannot be voided' using errcode='MU024';
    end if;
    if v_payment_count>0 then
      raise exception 'purchase has payment recorded and cannot be voided' using errcode='MU024';
    end if;
    if not exists(
      select 1 from purchases
      where id=v_purchase_id and shop_id=p_shop_id and not is_deleted and voided_at is null
    ) then
      raise exception 'purchase to void is missing or already voided' using errcode='MU019';
    end if;

  ----------------------------------------------------------------------
  -- supplier_payment (contract §5.11, review-corrected: CAP not reject).
  -- The remaining balance and the capped amount are both re-derived from
  -- the purchase's own current row — never trusted from the client.
  ----------------------------------------------------------------------
  elsif p_operation_kind='supplier_payment' then
    if v_row_count not in (2,3,4) then
      raise exception 'supplier_payment requires 2 to 4 rows' using errcode='MU024';
    end if;
    select e->'payload' into v_payment_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments';
    select e->'payload' into v_purchase_update_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchases';
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='payments')<>1
       or (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchases')<>1
       or v_payment_row is null or v_purchase_update_row is null then
      raise exception 'supplier_payment requires one bound payment and one purchase update'
        using errcode='MU024';
    end if;
    if (v_payment_row->>'id')::uuid is distinct from p_operation_id
       or v_payment_row->>'type' is distinct from 'supplier_payment'
       or (v_payment_row->>'created_by')::uuid is distinct from p_actor_id
       or coalesce((v_payment_row->>'amount')::bigint,0)<=0
       or coalesce((v_payment_row->>'is_deleted')::boolean,false)
       or (v_payment_row->>'ref_id')::uuid is distinct from (v_purchase_update_row->>'id')::uuid
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='payments' and e->>'op'<>'insert'
       )
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='purchases' and e->>'op'<>'update'
       ) then
      raise exception 'invalid supplier_payment graph' using errcode='MU024';
    end if;

    select * into v_existing_purchase from purchases
      where id=(v_purchase_update_row->>'id')::uuid and shop_id=p_shop_id and not is_deleted
      for update;
    if not found then
      raise exception 'purchase for supplier_payment is missing' using errcode='MU019';
    end if;
    if v_existing_purchase.voided_at is not null then
      raise exception 'purchase has been voided' using errcode='MU024';
    end if;
    if v_existing_purchase.payment_terms='cod' then
      raise exception 'this purchase was paid in full on delivery' using errcode='MU024';
    end if;
    if v_existing_purchase.total-v_existing_purchase.paid_amount<=0 then
      raise exception 'this purchase is already fully paid' using errcode='MU024';
    end if;
    if (v_payment_row->>'amount')::bigint >
       (v_existing_purchase.total-v_existing_purchase.paid_amount) then
      raise exception 'supplier_payment amount exceeds remaining balance' using errcode='MU024';
    end if;
    if (v_purchase_update_row->>'paid_amount')::bigint is distinct from
       (v_existing_purchase.paid_amount+(v_payment_row->>'amount')::bigint) then
      raise exception 'supplier_payment purchase update does not match payment amount'
        using errcode='MU024';
    end if;

    select count(*) into v_drawer_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer';
    if v_payment_row->>'method'='cash' then
      if v_drawer_count not in (1,2) then
        raise exception 'cash supplier_payment requires 1 or 2 drawer rows' using errcode='MU024';
      end if;
    elsif v_drawer_count<>0 then
      raise exception 'non-cash supplier_payment must not touch the drawer' using errcode='MU024';
    end if;

  ----------------------------------------------------------------------
  -- purchase_receive_line (contract §5.12 + COD atomic settlement, review
  -- §3/§4 fix). The recomputed total, the newly-received line's value, and
  -- COD-ness are all re-derived server-side, never trusted from the client.
  ----------------------------------------------------------------------
  elsif p_operation_kind='purchase_receive_line' then
    if v_row_count<3 or v_row_count>7 then
      raise exception 'purchase_receive_line requires 3 to 7 rows' using errcode='MU024';
    end if;
    select e->'payload' into v_item_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchase_items';
    select e->'payload' into v_purchase_update_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchases';
    select e->'payload' into v_movement_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_movements';
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchase_items')<>1
       or (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchases')<>1
       or (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='inventory_movements')<>1
       or v_item_row is null or v_purchase_update_row is null or v_movement_row is null then
      raise exception 'purchase_receive_line requires one item, one purchase, one movement row'
        using errcode='MU024';
    end if;
    if v_item_row->>'status' is distinct from 'received'
       or v_item_row->>'received_at' is null
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='purchase_items' and e->>'op'<>'update'
       )
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='purchases' and e->>'op'<>'update'
       )
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='inventory_movements' and e->>'op'<>'insert'
       ) then
      raise exception 'invalid purchase_receive_line graph' using errcode='MU024';
    end if;

    select * into v_existing_item from purchase_items
      where id=(v_item_row->>'id')::uuid and shop_id=p_shop_id and not is_deleted
      for update;
    if not found then
      raise exception 'purchase line to receive is missing' using errcode='MU019';
    end if;
    if v_existing_item.status<>'pending' then
      raise exception 'this line has already been received' using errcode='MU024';
    end if;
    select * into v_existing_purchase from purchases
      where id=v_existing_item.purchase_id and shop_id=p_shop_id and not is_deleted
      for update;
    if not found or v_existing_purchase.voided_at is not null then
      raise exception 'purchase for this line is missing or voided' using errcode='MU019';
    end if;
    if (v_purchase_update_row->>'id')::uuid is distinct from v_existing_purchase.id then
      raise exception 'purchase_receive_line purchase row mismatch' using errcode='MU024';
    end if;

    v_line_value:=v_existing_item.purchase_price*v_existing_item.qty;
    select coalesce(sum(purchase_price*qty),0) into v_recomputed_total from purchase_items
      where purchase_id=v_existing_purchase.id and shop_id=p_shop_id and not is_deleted
        and (status='received' or id=v_existing_item.id);
    if (v_purchase_update_row->>'total')::bigint is distinct from v_recomputed_total then
      raise exception 'purchase_receive_line total does not match server recomputation'
        using errcode='MU024';
    end if;

    select e->'payload' into v_batch_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='batches';
    if v_batch_row is not null then
      if (v_batch_row->>'medicine_id')::uuid is distinct from v_existing_item.medicine_id
         or v_batch_row->>'batch_no' is distinct from v_existing_item.batch_no
         or exists(
           select 1 from jsonb_array_elements(p_rows) e
           where coalesce(e->>'tableName',e->>'table_name')='batches' and e->>'op'<>'insert'
         ) then
        raise exception 'invalid batch row for purchase_receive_line' using errcode='MU024';
      end if;
      v_resolved_batch_id:=(v_batch_row->>'id')::uuid;
    else
      select id into v_resolved_batch_id from batches
        where shop_id=p_shop_id and medicine_id=v_existing_item.medicine_id
          and batch_no=v_existing_item.batch_no;
    end if;
    if v_resolved_batch_id is null
       or (v_movement_row->>'batch_id')::uuid is distinct from v_resolved_batch_id
       or (v_movement_row->>'change_qty')::integer is distinct from v_existing_item.qty
       or v_movement_row->>'reason' is distinct from 'purchase'
       or (v_movement_row->>'ref_id')::uuid is distinct from v_existing_purchase.id then
      raise exception 'invalid movement row for purchase_receive_line' using errcode='MU024';
    end if;

    select count(*) into v_drawer_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer';
    select e->'payload' into v_cod_payment_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments';
    if v_existing_purchase.payment_terms='cod' then
      if v_cod_payment_row is null or v_drawer_count not in (1,2) then
        raise exception
          'COD purchase_receive_line requires a settlement payment and drawer rows'
          using errcode='MU024';
      end if;
      if v_cod_payment_row->>'type' is distinct from 'supplier_payment'
         or coalesce((v_cod_payment_row->>'amount')::bigint,-1) is distinct from v_line_value
         or (v_cod_payment_row->>'ref_id')::uuid is distinct from v_existing_purchase.id
         or (v_cod_payment_row->>'created_by')::uuid is distinct from p_actor_id
         or exists(
           select 1 from jsonb_array_elements(p_rows) e
           where coalesce(e->>'tableName',e->>'table_name')='payments' and e->>'op'<>'insert'
         ) then
        raise exception 'invalid COD settlement payment for purchase_receive_line'
          using errcode='MU024';
      end if;
      if (v_purchase_update_row->>'paid_amount')::bigint is distinct from v_recomputed_total then
        raise exception 'COD purchase_receive_line must keep paid_amount equal to total'
          using errcode='MU024';
      end if;
    else
      if v_cod_payment_row is not null or v_drawer_count<>0 then
        raise exception 'non-COD purchase_receive_line must not touch payments or the drawer'
          using errcode='MU024';
      end if;
    end if;

  ----------------------------------------------------------------------
  -- purchase_create: the header total/paidAmount are re-derived from the
  -- purchase_items rows in the SAME payload — pending lines contribute 0
  -- (contract §5.12) — never trusted from the client's claimed total.
  ----------------------------------------------------------------------
  elsif p_operation_kind='purchase_create' then
    select e->'payload' into v_purchases_row from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchases';
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchases')<>1
       or v_purchases_row is null
       or (v_purchases_row->>'id')::uuid is distinct from p_operation_id
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='purchases' and e->>'op'<>'insert'
       ) then
      raise exception 'purchase_create requires exactly one purchase header insert'
        using errcode='MU024';
    end if;
    if v_purchases_row->>'source' not in ('manual','ocr') then
      raise exception 'invalid purchase source' using errcode='MU024';
    end if;
    if v_purchases_row->>'payment_terms' not in ('cod','credit') then
      raise exception 'invalid purchase_create payment_terms' using errcode='MU024';
    end if;

    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchase_items')=0 then
      raise exception 'purchase_create requires at least one purchase_items row'
        using errcode='MU024';
    end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='purchase_items'
        and (e->>'op'<>'insert' or e->'payload'->>'status' not in ('pending','received'))
    ) then
      raise exception 'invalid purchase_items row in purchase_create' using errcode='MU024';
    end if;

    select coalesce(sum(
      case when e->'payload'->>'status'='received'
        then (e->'payload'->>'purchase_price')::bigint*(e->'payload'->>'qty')::bigint
        else 0 end
    ),0) into v_items_total
    from jsonb_array_elements(p_rows) e
    where coalesce(e->>'tableName',e->>'table_name')='purchase_items';
    if (v_purchases_row->>'total')::bigint is distinct from v_items_total then
      raise exception 'purchase_create total does not match server recomputation'
        using errcode='MU024';
    end if;

    -- COD is always fully paid from creation; credit starts fully payable —
    -- matches db/purchases.ts's resolvePaymentEffect binary contract exactly.
    if v_purchases_row->>'payment_terms'='cod' then
      if (v_purchases_row->>'paid_amount')::bigint is distinct from v_items_total then
        raise exception 'COD purchase_create must be fully paid at creation' using errcode='MU024';
      end if;
    elsif coalesce((v_purchases_row->>'paid_amount')::bigint,-1)<>0 then
      raise exception 'credit purchase_create must start unpaid' using errcode='MU024';
    end if;

    if exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='batches' and e->>'op'<>'insert'
    ) then
      raise exception 'invalid batch row in purchase_create' using errcode='MU024';
    end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='inventory_movements')
       <> (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='purchase_items'
          and e->'payload'->>'status'='received') then
      raise exception 'purchase_create movement count does not match received line count'
        using errcode='MU024';
    end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_movements'
        and (e->>'op'<>'insert' or e->'payload'->>'reason' is distinct from 'purchase'
             or (e->'payload'->>'ref_id')::uuid is distinct from p_operation_id)
    ) then
      raise exception 'invalid movement row in purchase_create' using errcode='MU024';
    end if;

    select count(*) into v_drawer_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer';
    if v_purchases_row->>'payment_terms'='cod' then
      if (select count(*) from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='payments')<>1
         or v_drawer_count not in (1,2) then
        raise exception 'COD purchase_create requires one settlement payment and drawer rows'
          using errcode='MU024';
      end if;
      if exists(
        select 1 from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='payments' and (
          e->>'op'<>'insert'
          or e->'payload'->>'type' is distinct from 'supplier_payment'
          or coalesce((e->'payload'->>'amount')::bigint,-1) is distinct from v_items_total
          or (e->'payload'->>'ref_id')::uuid is distinct from p_operation_id
          or (e->'payload'->>'created_by')::uuid is distinct from p_actor_id
        )
      ) then
        raise exception 'invalid COD settlement payment in purchase_create' using errcode='MU024';
      end if;
    else
      if (select count(*) from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='payments')<>0
         or v_drawer_count<>0 then
        raise exception 'credit purchase_create must not touch payments or the drawer'
          using errcode='MU024';
      end if;
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
  sync_apply_operation_pre_b3_groups456(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
revoke execute on function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function
  sync_apply_operation_pre_b3_groups456(uuid,uuid,text,uuid,text,jsonb),
  sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  to service_role;
