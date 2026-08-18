-- Corrective migration: take batches.stock out of sync_apply_row entirely.
--
-- 20260818000000 made batches.stock a ledger projection and installed the
-- `batches_stock_guard` trigger, which silently discards any absolute a client
-- pushes. That works, but it leaves sync_apply_row still *asking* to write
-- `excluded.stock` -- the contract says one thing and a trigger quietly does
-- another. A reader of the sync function cannot tell that client stock is
-- ignored, and the next person to touch that trigger reintroduces the lost-
-- update bug without changing a line of sync code.
--
-- So the function now states the rule itself. `stock` is gone from the batches
-- upsert, and the payload is sanitised before it reaches jsonb_populate_record
-- so the INSERT arm cannot carry one in either. The trigger stays as a second
-- line of defence for any writer that is not this function.
--
-- 20260813000000 is applied history and is NOT edited. This redefines the
-- function in place with `create or replace`: same name, same signature, same
-- SECURITY DEFINER, same search_path -- so existing grants (service_role only),
-- every other table branch, the cross-shop FK assertions and the delete path
-- all carry over untouched. Only the batches branch differs.

create or replace function sync_apply_row(p_table text,p_op text,p_row jsonb,p_caller_shop_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_row_id uuid := (p_row->>'id')::uuid;
  v_affected integer;
begin
  -- batches.stock and batches.oversold_at are SERVER ledger state, never client
  -- input. The upsert below no longer names `stock` in its update list, but its
  -- INSERT arm still populates the whole record from p_row, so overwrite both
  -- fields with what this server already holds -- 0 and null for a batch it has
  -- not seen. A device that pushes stock=3 now writes the server's own value,
  -- which is a no-op, and the quantity moves only when its movements arrive.
  if p_table='batches' then
    p_row := p_row || jsonb_build_object(
      'stock', coalesce((select b.stock from batches b where b.id=v_row_id),0),
      'oversold_at', (select to_jsonb(b.oversold_at) from batches b where b.id=v_row_id)
    );
  end if;
  if p_op not in ('insert','update','delete') then
    raise exception 'unsupported sync operation: %', p_op using errcode='MU002';
  end if;
  if p_table <> 'audit_logs' and not sync_existing_row_owned_or_missing(p_table,v_row_id,p_caller_shop_id) then
    return 'rejected_not_owned';
  end if;
  if p_op <> 'delete' then
    if p_table='permissions' and not assert_fk_same_shop('roles',(p_row->>'role_id')::uuid,p_caller_shop_id) then raise exception 'cross-shop permissions.role_id' using errcode='MU003';
    elsif p_table='users' and not assert_fk_same_shop('roles',(p_row->>'role_id')::uuid,p_caller_shop_id) then raise exception 'cross-shop users.role_id' using errcode='MU003';
    elsif p_table='batches' and not assert_fk_same_shop('medicines',(p_row->>'medicine_id')::uuid,p_caller_shop_id) then raise exception 'cross-shop batches.medicine_id' using errcode='MU003';
    elsif p_table='inventory_movements' and (not assert_fk_same_shop('batches',(p_row->>'batch_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('users',(p_row->>'created_by')::uuid,p_caller_shop_id)) then raise exception 'cross-shop inventory_movements reference' using errcode='MU003';
    elsif p_table='sales' and (not assert_fk_same_shop('customers',(p_row->>'customer_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('users',(p_row->>'staff_id')::uuid,p_caller_shop_id)) then raise exception 'cross-shop sales reference' using errcode='MU003';
    elsif p_table='sale_items' and (not assert_fk_same_shop('sales',(p_row->>'sale_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('medicines',(p_row->>'medicine_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('batches',(p_row->>'batch_id')::uuid,p_caller_shop_id)) then raise exception 'cross-shop sale_items reference' using errcode='MU003';
    elsif p_table='sales_returns' and (not assert_fk_same_shop('sales',(p_row->>'sale_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('sale_items',(p_row->>'sale_item_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('users',(p_row->>'created_by')::uuid,p_caller_shop_id)) then raise exception 'cross-shop sales_returns reference' using errcode='MU003';
    elsif p_table='purchases' and not assert_fk_same_shop('suppliers',(p_row->>'supplier_id')::uuid,p_caller_shop_id) then raise exception 'cross-shop purchases.supplier_id' using errcode='MU003';
    elsif p_table='purchase_items' and (not assert_fk_same_shop('purchases',(p_row->>'purchase_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('medicines',(p_row->>'medicine_id')::uuid,p_caller_shop_id)) then raise exception 'cross-shop purchase_items reference' using errcode='MU003';
    elsif p_table='purchase_returns' and (not assert_fk_same_shop('purchases',(p_row->>'purchase_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('purchase_items',(p_row->>'purchase_item_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('users',(p_row->>'created_by')::uuid,p_caller_shop_id)) then raise exception 'cross-shop purchase_returns reference' using errcode='MU003';
    elsif p_table='credits' and (not assert_fk_same_shop('customers',(p_row->>'customer_id')::uuid,p_caller_shop_id) or not assert_fk_same_shop('sales',(p_row->>'sale_id')::uuid,p_caller_shop_id)) then raise exception 'cross-shop credits reference' using errcode='MU003';
    elsif p_table='expenses' and not assert_fk_same_shop('users',(p_row->>'created_by')::uuid,p_caller_shop_id) then raise exception 'cross-shop expenses.created_by' using errcode='MU003';
    elsif p_table='payments' and not assert_fk_same_shop('users',(p_row->>'created_by')::uuid,p_caller_shop_id) then raise exception 'cross-shop payments.created_by' using errcode='MU003';
    elsif p_table='cash_drawer' and (not assert_fk_same_shop('users',(p_row->>'opened_by')::uuid,p_caller_shop_id) or not assert_fk_same_shop('users',(p_row->>'closed_by')::uuid,p_caller_shop_id)) then raise exception 'cross-shop cash_drawer reference' using errcode='MU003';
    elsif p_table='audit_logs' and not assert_fk_same_shop('users',(p_row->>'actor_id')::uuid,p_caller_shop_id) then raise exception 'cross-shop audit_logs.actor_id' using errcode='MU003';
    end if;
  end if;
  if p_table = 'audit_logs' then
    if p_op <> 'insert' then
      raise exception 'audit_logs is append-only; op % is not permitted', p_op using errcode='MU001';
    end if;
    insert into audit_logs select * from jsonb_populate_record(null::audit_logs,p_row) on conflict(id) do nothing;
    return 'applied';
  end if;
  if p_op = 'delete' then
    if p_table='shops' then update shops set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='subscriptions' then update subscriptions set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='roles' then update roles set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='permissions' then update permissions set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and exists(select 1 from roles r where r.id=permissions.role_id and r.shop_id=p_caller_shop_id) and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='users' then update users set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='medicines' then update medicines set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='batches' then update batches set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='inventory_movements' then update inventory_movements set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='customers' then update customers set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='sales' then update sales set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='sale_items' then update sale_items set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='sales_returns' then update sales_returns set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='suppliers' then update suppliers set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='purchases' then update purchases set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='purchase_items' then update purchase_items set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='purchase_returns' then update purchase_returns set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='credits' then update credits set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='expenses' then update expenses set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='payments' then update payments set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    elsif p_table='cash_drawer' then update cash_drawer set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz where id=v_row_id and shop_id=p_caller_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    else raise exception 'unsupported sync table: %',p_table using errcode='MU004'; end if;
    get diagnostics v_affected = row_count;
    if v_affected=0 and not sync_existing_row_owned_or_missing(p_table,v_row_id,p_caller_shop_id) then
      return 'rejected_not_owned';
    end if;
    return 'applied';
  end if;

  if p_table='shops' then insert into shops select * from jsonb_populate_record(null::shops,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,owner_id,name,name_en,phone,latitude,longitude,thana,district,location_captured_at,plan,trial_ends_at)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.owner_id,excluded.name,excluded.name_en,excluded.phone,excluded.latitude,excluded.longitude,excluded.thana,excluded.district,excluded.location_captured_at,excluded.plan,excluded.trial_ends_at) where shops.id=p_caller_shop_id and shops.updated_at<excluded.updated_at;
  elsif p_table='subscriptions' then insert into subscriptions select * from jsonb_populate_record(null::subscriptions,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,plan,status,starts_at,ends_at,next_billing_at,payment_provider,payment_reference)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.plan,excluded.status,excluded.starts_at,excluded.ends_at,excluded.next_billing_at,excluded.payment_provider,excluded.payment_reference) where subscriptions.shop_id=p_caller_shop_id and subscriptions.updated_at<excluded.updated_at;
  elsif p_table='roles' then insert into roles select * from jsonb_populate_record(null::roles,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,name,is_system)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.name,excluded.is_system) where roles.shop_id=p_caller_shop_id and roles.updated_at<excluded.updated_at;
  elsif p_table='permissions' then insert into permissions select * from jsonb_populate_record(null::permissions,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,role_id,key,allowed)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.role_id,excluded.key,excluded.allowed) where exists(select 1 from roles r where r.id=permissions.role_id and r.shop_id=p_caller_shop_id) and permissions.updated_at<excluded.updated_at;
  elsif p_table='users' then insert into users select * from jsonb_populate_record(null::users,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,name,phone,pin_hash,pin_set_at,role_id,is_active)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.name,excluded.phone,excluded.pin_hash,excluded.pin_set_at,excluded.role_id,excluded.is_active) where users.shop_id=p_caller_shop_id and users.updated_at<excluded.updated_at;
  elsif p_table='medicines' then insert into medicines select * from jsonb_populate_record(null::medicines,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,name,generic,manufacturer,type,strength,category,unit_of_measure,requires_prescription,barcode,threshold)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.name,excluded.generic,excluded.manufacturer,excluded.type,excluded.strength,excluded.category,excluded.unit_of_measure,excluded.requires_prescription,excluded.barcode,excluded.threshold) where medicines.shop_id=p_caller_shop_id and medicines.updated_at<excluded.updated_at;
  elsif p_table='batches' then insert into batches select * from jsonb_populate_record(null::batches,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,medicine_id,batch_no,expiry_date,purchase_price,sale_price,is_discounted,original_price)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.medicine_id,excluded.batch_no,excluded.expiry_date,excluded.purchase_price,excluded.sale_price,excluded.is_discounted,excluded.original_price) where batches.shop_id=p_caller_shop_id and batches.updated_at<excluded.updated_at;
  elsif p_table='inventory_movements' then insert into inventory_movements select * from jsonb_populate_record(null::inventory_movements,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,batch_id,change_qty,reason,ref_id,created_by)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.batch_id,excluded.change_qty,excluded.reason,excluded.ref_id,excluded.created_by) where inventory_movements.shop_id=p_caller_shop_id and inventory_movements.updated_at<excluded.updated_at;
  elsif p_table='customers' then insert into customers select * from jsonb_populate_record(null::customers,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,name,phone,address,notes)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.name,excluded.phone,excluded.address,excluded.notes) where customers.shop_id=p_caller_shop_id and customers.updated_at<excluded.updated_at;
  elsif p_table='sales' then insert into sales select * from jsonb_populate_record(null::sales,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,invoice_no,total,paid,change,payment_type,customer_id,staff_id)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.invoice_no,excluded.total,excluded.paid,excluded.change,excluded.payment_type,excluded.customer_id,excluded.staff_id) where sales.shop_id=p_caller_shop_id and sales.updated_at<excluded.updated_at;
  elsif p_table='sale_items' then insert into sale_items select * from jsonb_populate_record(null::sale_items,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,sale_id,medicine_id,batch_id,qty,unit_price,discount_type,discount_value,discount_amount,line_total,cogs)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.sale_id,excluded.medicine_id,excluded.batch_id,excluded.qty,excluded.unit_price,excluded.discount_type,excluded.discount_value,excluded.discount_amount,excluded.line_total,excluded.cogs) where sale_items.shop_id=p_caller_shop_id and sale_items.updated_at<excluded.updated_at;
  elsif p_table='sales_returns' then insert into sales_returns select * from jsonb_populate_record(null::sales_returns,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,sale_id,sale_item_id,qty,reason,refund_amount,refund_method,created_by)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.sale_id,excluded.sale_item_id,excluded.qty,excluded.reason,excluded.refund_amount,excluded.refund_method,excluded.created_by) where sales_returns.shop_id=p_caller_shop_id and sales_returns.updated_at<excluded.updated_at;
  elsif p_table='suppliers' then insert into suppliers select * from jsonb_populate_record(null::suppliers,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,name,phone,address,email,contact_person)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.name,excluded.phone,excluded.address,excluded.email,excluded.contact_person) where suppliers.shop_id=p_caller_shop_id and suppliers.updated_at<excluded.updated_at;
  elsif p_table='purchases' then insert into purchases select * from jsonb_populate_record(null::purchases,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,invoice_no,supplier_id,total,payment_terms,paid_amount)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.invoice_no,excluded.supplier_id,excluded.total,excluded.payment_terms,excluded.paid_amount) where purchases.shop_id=p_caller_shop_id and purchases.updated_at<excluded.updated_at;
  elsif p_table='purchase_items' then insert into purchase_items select * from jsonb_populate_record(null::purchase_items,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,purchase_id,medicine_id,batch_no,expiry_date,qty,purchase_price,sale_price)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.purchase_id,excluded.medicine_id,excluded.batch_no,excluded.expiry_date,excluded.qty,excluded.purchase_price,excluded.sale_price) where purchase_items.shop_id=p_caller_shop_id and purchase_items.updated_at<excluded.updated_at;
  elsif p_table='purchase_returns' then insert into purchase_returns select * from jsonb_populate_record(null::purchase_returns,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,purchase_id,purchase_item_id,qty,reason,credit_amount,created_by)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.purchase_id,excluded.purchase_item_id,excluded.qty,excluded.reason,excluded.credit_amount,excluded.created_by) where purchase_returns.shop_id=p_caller_shop_id and purchase_returns.updated_at<excluded.updated_at;
  elsif p_table='credits' then insert into credits select * from jsonb_populate_record(null::credits,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,customer_id,sale_id,amount,balance)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.customer_id,excluded.sale_id,excluded.amount,excluded.balance) where credits.shop_id=p_caller_shop_id and credits.updated_at<excluded.updated_at;
  elsif p_table='expenses' then insert into expenses select * from jsonb_populate_record(null::expenses,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,category,amount,description,receipt_image,created_by)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.category,excluded.amount,excluded.description,excluded.receipt_image,excluded.created_by) where expenses.shop_id=p_caller_shop_id and expenses.updated_at<excluded.updated_at;
  elsif p_table='payments' then insert into payments select * from jsonb_populate_record(null::payments,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,type,party_id,amount,method,ref_id,created_by)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.type,excluded.party_id,excluded.amount,excluded.method,excluded.ref_id,excluded.created_by) where payments.shop_id=p_caller_shop_id and payments.updated_at<excluded.updated_at;
  elsif p_table='cash_drawer' then insert into cash_drawer select * from jsonb_populate_record(null::cash_drawer,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,business_date,opening_cash,opened_by,closed_by,opened_at,closed_at,closing_expected,closing_counted)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.business_date,excluded.opening_cash,excluded.opened_by,excluded.closed_by,excluded.opened_at,excluded.closed_at,excluded.closing_expected,excluded.closing_counted) where cash_drawer.shop_id=p_caller_shop_id and cash_drawer.updated_at<excluded.updated_at;
  else raise exception 'unsupported sync table: %',p_table using errcode='MU004'; end if;
  get diagnostics v_affected = row_count;
  if v_affected=0 and not sync_existing_row_owned_or_missing(p_table,v_row_id,p_caller_shop_id) then
    return 'rejected_not_owned';
  end if;
  return 'applied';
end $fn$;

-- Signature unchanged, so the initial schema's grants still stand. Restated so
-- this file is self-contained if replayed onto a fresh database.
revoke execute on function sync_apply_row(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function sync_apply_row(text,text,jsonb,uuid) to service_role;
