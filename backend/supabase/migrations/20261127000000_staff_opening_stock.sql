-- Migration 45: Staff may add opening stock without a supplier (founder
-- decision B2, 2026-11-27: "মেডিসিন এড করার সময় সাপ্লাইয়ার এড করাটা অপশনাল
-- করে দাও", for the Owner AND for Staff; "হ্যাঁ, DEV-তে শুরু করো").
--
-- WHAT IT ALLOWS. The Owner's supplier-less Add Medicine (opening stock,
-- apps/mobile/db/inventoryImport.ts createOpeningStock) is a one-row
-- inventory_import group: the import header, an optional new medicine, the
-- batch, ONE csv_import movement bound to the header, and ONE audit row. No
-- purchase, no payment, no cash drawer. That group is Owner-only in three
-- places (sync_apply_operation, sync_row_permitted, sync_apply_b2_row). This
-- lets a staff member holding the explicit inventory_add grant send EXACTLY
-- that graph. Never a CSV file (row_count 1, fingerprint 'opening:<id>'),
-- never a second batch, never another table. The Owner path, the CSV path
-- and every other operation kind are untouched.
--
-- SHAPE. The same as inventory_add_purchase (20260825000000): the operation
-- wrapper validates the whole graph once and then applies each row through
-- sync_apply_row, so the commercial gate, actor binding and every later row
-- wrapper stay in the path. The header alone is Owner-only inside
-- sync_apply_b2_row, so that function is wrapped too: it takes a non-Owner
-- header only while this operation has armed a transaction-local flag that
-- carries that exact header id.
--
-- No table, column, trigger or constraint changes. Rollback class B:
-- restore the two `_pre_staff_opening` functions under their original names.
--
-- DEV first; PROD only with the founder's separate approval (CLAUDE.md 16).

do $staff_opening_rename$
begin
  if to_regprocedure('public.sync_apply_operation_pre_staff_opening(uuid,uuid,text,uuid,text,jsonb)') is null then
    alter function public.sync_apply_operation(uuid, uuid, text, uuid, text, jsonb)
      rename to sync_apply_operation_pre_staff_opening;
  end if;
  if to_regprocedure('public.sync_apply_b2_row_pre_staff_opening(text,text,jsonb,uuid,uuid,text)') is null then
    alter function public.sync_apply_b2_row(text, text, jsonb, uuid, uuid, text)
      rename to sync_apply_b2_row_pre_staff_opening;
  end if;
end
$staff_opening_rename$;

-- ── the header gate ────────────────────────────────────────────────────────
create or replace function sync_apply_b2_row(
  p_table text, p_op text, p_row jsonb, p_shop_id uuid,
  p_actor_id uuid, p_device_id text default null
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_armed text := coalesce(current_setting('muthoy.staff_opening_stock', true), '');
begin
  -- Only the header the operation wrapper validated a moment ago, inside the
  -- same transaction. Anything else takes the unchanged Owner-only path.
  if p_table = 'inventory_imports' and p_op = 'insert'
     and v_armed <> '' and v_armed = p_row->>'id'
     and not b2_user_is_owner(p_actor_id) then
    if p_row->>'shop_id' is distinct from p_shop_id::text
       or (p_row->>'created_by')::uuid is distinct from p_actor_id then
      raise exception 'staff opening stock header does not match its operation' using errcode = 'MU011';
    end if;
    insert into inventory_imports select * from jsonb_populate_record(null::inventory_imports, p_row)
    on conflict (id) do nothing;
    return 'applied';
  end if;
  return sync_apply_b2_row_pre_staff_opening(p_table, p_op, p_row, p_shop_id, p_actor_id, p_device_id);
end
$fn$;

-- ── the operation ──────────────────────────────────────────────────────────
create or replace function sync_apply_operation(
  p_shop_id uuid, p_operation_id uuid, p_operation_kind text,
  p_actor_id uuid, p_device_id text, p_rows jsonb
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_count integer;
  v_has_medicine boolean;
  v_header jsonb;
  v_medicine jsonb;
  v_batch jsonb;
  v_movement jsonb;
  v_audit jsonb;
  v_medicine_id uuid;
  v_batch_id uuid;
  v_entry record;
  v_result text;
begin
  -- The Owner, every other kind, and a non-Owner WITHOUT inventory_add all
  -- keep the existing dispatcher, which refuses a non-Owner import (MU015).
  if p_operation_kind <> 'inventory_import'
     or b2_user_is_owner(p_actor_id)
     or not exists(
       select 1 from users u join roles r on r.id = u.role_id and r.shop_id = u.shop_id
       where u.id = p_actor_id and u.shop_id = p_shop_id
         and u.is_active and not u.is_deleted and not r.is_deleted)
     or not user_has_permission(p_actor_id, 'inventory_add') then
    return sync_apply_operation_pre_staff_opening(
      p_shop_id, p_operation_id, p_operation_kind, p_actor_id, p_device_id, p_rows);
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'staff opening stock rows must be an array' using errcode = 'MU024';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count not in (4, 5) then
    raise exception 'staff opening stock is one row: 4 or 5 sync rows' using errcode = 'MU024';
  end if;
  v_has_medicine := v_count = 5;

  if exists(
    select 1 from jsonb_array_elements(p_rows) e
    where e->'payload' is null
       or jsonb_typeof(e->'payload') <> 'object'
       or coalesce(e->>'rowId', e->>'row_id') is distinct from e->'payload'->>'id'
       or e->'payload'->>'shop_id' is distinct from p_shop_id::text
       or e->>'op' is distinct from 'insert'
       or coalesce((e->'payload'->>'is_deleted')::boolean, false)
  ) then
    raise exception 'invalid or cross-shop staff opening stock row' using errcode = 'MU003';
  end if;

  -- Exact order, no spare slot: header, [medicine], batch, movement, audit.
  if coalesce(p_rows->0->>'tableName', p_rows->0->>'table_name') <> 'inventory_imports'
     or (v_has_medicine and coalesce(p_rows->1->>'tableName', p_rows->1->>'table_name') <> 'medicines')
     or coalesce(p_rows->(v_count - 3)->>'tableName', p_rows->(v_count - 3)->>'table_name') <> 'batches'
     or coalesce(p_rows->(v_count - 2)->>'tableName', p_rows->(v_count - 2)->>'table_name') <> 'inventory_movements'
     or coalesce(p_rows->(v_count - 1)->>'tableName', p_rows->(v_count - 1)->>'table_name') <> 'audit_logs' then
    raise exception 'invalid staff opening stock graph shape' using errcode = 'MU024';
  end if;

  v_header := p_rows->0->'payload';
  if (v_header->>'id')::uuid is distinct from p_operation_id
     or v_header->>'file_fingerprint' is distinct from 'opening:' || p_operation_id::text
     or (v_header->>'row_count')::integer is distinct from 1
     or v_header->>'status' is distinct from 'committed'
     or (v_header->>'created_by')::uuid is distinct from p_actor_id
     or exists(select 1 from inventory_imports where id = p_operation_id) then
    raise exception 'invalid staff opening stock header' using errcode = 'MU024';
  end if;

  v_batch := p_rows->(v_count - 3)->'payload';
  v_batch_id := (v_batch->>'id')::uuid;
  if v_has_medicine then
    v_medicine := p_rows->1->'payload';
    v_medicine_id := (v_medicine->>'id')::uuid;
    if nullif(trim(v_medicine->>'name'), '') is null
       or nullif(trim(v_medicine->>'unit_of_measure'), '') is null
       or v_medicine->>'requires_prescription' not in ('true', 'false')
       or coalesce((v_medicine->>'threshold')::integer, -1) < 0
       or v_medicine->>'deleted_at' is not null
       or v_medicine->>'deleted_by' is not null
       or exists(select 1 from medicines where id = v_medicine_id) then
      raise exception 'invalid new medicine in staff opening stock' using errcode = 'MU024';
    end if;
  else
    v_medicine_id := (v_batch->>'medicine_id')::uuid;
    if not exists(select 1 from medicines
        where id = v_medicine_id and shop_id = p_shop_id and not is_deleted) then
      raise exception 'staff opening stock for an unknown medicine' using errcode = 'MU003';
    end if;
  end if;

  if (v_batch->>'medicine_id')::uuid is distinct from v_medicine_id
     or nullif(trim(v_batch->>'batch_no'), '') is null
     or coalesce((v_batch->>'stock')::integer, -1) <> 0
     or coalesce((v_batch->>'purchase_price')::bigint, -1) < 0
     or coalesce((v_batch->>'sale_price')::bigint, -1) < 0
     or exists(select 1 from batches where id = v_batch_id)
     or exists(select 1 from batches where shop_id = p_shop_id
          and medicine_id = v_medicine_id and batch_no = v_batch->>'batch_no') then
    raise exception 'invalid batch in staff opening stock' using errcode = 'MU024';
  end if;

  v_movement := p_rows->(v_count - 2)->'payload';
  if (v_movement->>'batch_id')::uuid is distinct from v_batch_id
     or v_movement->>'reason' is distinct from 'csv_import'
     or (v_movement->>'ref_id')::uuid is distinct from p_operation_id
     or coalesce((v_movement->>'change_qty')::integer, 0) <= 0
     or (v_movement->>'created_by')::uuid is distinct from p_actor_id then
    raise exception 'invalid stock movement in staff opening stock' using errcode = 'MU024';
  end if;

  v_audit := p_rows->(v_count - 1)->'payload';
  if (v_audit->>'actor_id')::uuid is distinct from p_actor_id
     or v_audit->>'action' is distinct from 'inventory_opening_stock_added'
     or v_audit->>'target' is distinct from p_operation_id::text then
    raise exception 'invalid audit row in staff opening stock' using errcode = 'MU024';
  end if;

  -- One function call is one transaction: any rejected row rolls back the
  -- header, the medicine, the batch, its stock and the audit row together.
  perform set_config('muthoy.staff_opening_stock', p_operation_id::text, true);
  for v_entry in
    select e.value from jsonb_array_elements(p_rows) with ordinality e(value, ord)
    order by e.ord
  loop
    v_result := sync_apply_row(
      coalesce(v_entry.value->>'tableName', v_entry.value->>'table_name'),
      v_entry.value->>'op', v_entry.value->'payload',
      p_shop_id, p_actor_id, p_device_id
    );
    if v_result <> 'applied' then
      raise exception 'staff opening stock row rejected: %', v_result using errcode = 'MU024';
    end if;
  end loop;
  perform set_config('muthoy.staff_opening_stock', '', true);
  return 'applied';
end
$fn$;

revoke execute on function
  sync_apply_operation_pre_staff_opening(uuid, uuid, text, uuid, text, jsonb),
  sync_apply_operation(uuid, uuid, text, uuid, text, jsonb),
  sync_apply_b2_row_pre_staff_opening(text, text, jsonb, uuid, uuid, text),
  sync_apply_b2_row(text, text, jsonb, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function
  sync_apply_operation_pre_staff_opening(uuid, uuid, text, uuid, text, jsonb),
  sync_apply_operation(uuid, uuid, text, uuid, text, jsonb),
  sync_apply_b2_row_pre_staff_opening(text, text, jsonb, uuid, uuid, text),
  sync_apply_b2_row(text, text, jsonb, uuid, uuid, text)
  to service_role;
