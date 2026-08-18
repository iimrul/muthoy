


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "supabase_migrations";


ALTER SCHEMA "supabase_migrations" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assert_fk_same_shop"("p_ref_table" "text", "p_ref_id" "uuid", "p_shop_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_ref_id is null then return true;
  elsif p_ref_table='roles' then return exists(select 1 from roles where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='users' then return exists(select 1 from users where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='medicines' then return exists(select 1 from medicines where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='batches' then return exists(select 1 from batches where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='customers' then return exists(select 1 from customers where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='sales' then return exists(select 1 from sales where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='sale_items' then return exists(select 1 from sale_items where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='suppliers' then return exists(select 1 from suppliers where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='purchases' then return exists(select 1 from purchases where id=p_ref_id and shop_id=p_shop_id);
  elsif p_ref_table='purchase_items' then return exists(select 1 from purchase_items where id=p_ref_id and shop_id=p_shop_id);
  else raise exception 'unsupported FK reference table: %',p_ref_table using errcode='MU004'; end if;
end $$;


ALTER FUNCTION "public"."assert_fk_same_shop"("p_ref_table" "text", "p_ref_id" "uuid", "p_shop_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_apply_row"("p_table" "text", "p_op" "text", "p_row" "jsonb", "p_caller_shop_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row_id uuid := (p_row->>'id')::uuid;
  v_affected integer;
begin
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
  elsif p_table='batches' then insert into batches select * from jsonb_populate_record(null::batches,p_row) on conflict(id) do update set (created_at,updated_at,is_deleted,deleted_at,deleted_by,shop_id,medicine_id,batch_no,expiry_date,stock,purchase_price,sale_price,is_discounted,original_price)=(excluded.created_at,excluded.updated_at,excluded.is_deleted,excluded.deleted_at,excluded.deleted_by,excluded.shop_id,excluded.medicine_id,excluded.batch_no,excluded.expiry_date,excluded.stock,excluded.purchase_price,excluded.sale_price,excluded.is_discounted,excluded.original_price) where batches.shop_id=p_caller_shop_id and batches.updated_at<excluded.updated_at;
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
end $$;


ALTER FUNCTION "public"."sync_apply_row"("p_table" "text", "p_op" "text", "p_row" "jsonb", "p_caller_shop_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_existing_row_owned_or_missing"("p_table" "text", "p_id" "uuid", "p_shop_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_table='shops' then return not exists(select 1 from shops where id=p_id) or p_id=p_shop_id;
  elsif p_table='permissions' then return not exists(select 1 from permissions where id=p_id) or exists(select 1 from permissions p join roles r on r.id=p.role_id where p.id=p_id and r.shop_id=p_shop_id);
  elsif p_table='subscriptions' then return not exists(select 1 from subscriptions where id=p_id) or exists(select 1 from subscriptions where id=p_id and shop_id=p_shop_id);
  elsif p_table='roles' then return not exists(select 1 from roles where id=p_id) or exists(select 1 from roles where id=p_id and shop_id=p_shop_id);
  elsif p_table='users' then return not exists(select 1 from users where id=p_id) or exists(select 1 from users where id=p_id and shop_id=p_shop_id);
  elsif p_table='medicines' then return not exists(select 1 from medicines where id=p_id) or exists(select 1 from medicines where id=p_id and shop_id=p_shop_id);
  elsif p_table='batches' then return not exists(select 1 from batches where id=p_id) or exists(select 1 from batches where id=p_id and shop_id=p_shop_id);
  elsif p_table='inventory_movements' then return not exists(select 1 from inventory_movements where id=p_id) or exists(select 1 from inventory_movements where id=p_id and shop_id=p_shop_id);
  elsif p_table='customers' then return not exists(select 1 from customers where id=p_id) or exists(select 1 from customers where id=p_id and shop_id=p_shop_id);
  elsif p_table='sales' then return not exists(select 1 from sales where id=p_id) or exists(select 1 from sales where id=p_id and shop_id=p_shop_id);
  elsif p_table='sale_items' then return not exists(select 1 from sale_items where id=p_id) or exists(select 1 from sale_items where id=p_id and shop_id=p_shop_id);
  elsif p_table='sales_returns' then return not exists(select 1 from sales_returns where id=p_id) or exists(select 1 from sales_returns where id=p_id and shop_id=p_shop_id);
  elsif p_table='suppliers' then return not exists(select 1 from suppliers where id=p_id) or exists(select 1 from suppliers where id=p_id and shop_id=p_shop_id);
  elsif p_table='purchases' then return not exists(select 1 from purchases where id=p_id) or exists(select 1 from purchases where id=p_id and shop_id=p_shop_id);
  elsif p_table='purchase_items' then return not exists(select 1 from purchase_items where id=p_id) or exists(select 1 from purchase_items where id=p_id and shop_id=p_shop_id);
  elsif p_table='purchase_returns' then return not exists(select 1 from purchase_returns where id=p_id) or exists(select 1 from purchase_returns where id=p_id and shop_id=p_shop_id);
  elsif p_table='credits' then return not exists(select 1 from credits where id=p_id) or exists(select 1 from credits where id=p_id and shop_id=p_shop_id);
  elsif p_table='expenses' then return not exists(select 1 from expenses where id=p_id) or exists(select 1 from expenses where id=p_id and shop_id=p_shop_id);
  elsif p_table='payments' then return not exists(select 1 from payments where id=p_id) or exists(select 1 from payments where id=p_id and shop_id=p_shop_id);
  elsif p_table='cash_drawer' then return not exists(select 1 from cash_drawer where id=p_id) or exists(select 1 from cash_drawer where id=p_id and shop_id=p_shop_id);
  else raise exception 'unsupported sync table: %',p_table using errcode='MU004'; end if;
end $$;


ALTER FUNCTION "public"."sync_existing_row_owned_or_missing"("p_table" "text", "p_id" "uuid", "p_shop_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_pull_changes"("p_shop_id" "uuid", "p_since_updated_at" timestamp with time zone, "p_since_table" "text", "p_since_id" "uuid", "p_limit" integer) RETURNS TABLE("table_name" "text", "row_id" "uuid", "updated_at" timestamp with time zone, "row_data" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with all_changes as (
    select 'shops'::text table_name,id row_id,updated_at,to_jsonb(t.*) row_data from shops t where id=p_shop_id
    union all select 'subscriptions',id,updated_at,to_jsonb(t.*) from subscriptions t where shop_id=p_shop_id
    union all select 'roles',id,updated_at,to_jsonb(t.*) from roles t where shop_id=p_shop_id
    union all select 'permissions',id,updated_at,to_jsonb(t.*) from permissions t where role_id in(select id from roles where shop_id=p_shop_id)
    union all select 'users',id,updated_at,to_jsonb(t.*) from users t where shop_id=p_shop_id
    union all select 'medicines',id,updated_at,to_jsonb(t.*) from medicines t where shop_id=p_shop_id
    union all select 'batches',id,updated_at,to_jsonb(t.*) from batches t where shop_id=p_shop_id
    union all select 'inventory_movements',id,updated_at,to_jsonb(t.*) from inventory_movements t where shop_id=p_shop_id
    union all select 'customers',id,updated_at,to_jsonb(t.*) from customers t where shop_id=p_shop_id
    union all select 'sales',id,updated_at,to_jsonb(t.*) from sales t where shop_id=p_shop_id
    union all select 'sale_items',id,updated_at,to_jsonb(t.*) from sale_items t where shop_id=p_shop_id
    union all select 'sales_returns',id,updated_at,to_jsonb(t.*) from sales_returns t where shop_id=p_shop_id
    union all select 'suppliers',id,updated_at,to_jsonb(t.*) from suppliers t where shop_id=p_shop_id
    union all select 'purchases',id,updated_at,to_jsonb(t.*) from purchases t where shop_id=p_shop_id
    union all select 'purchase_items',id,updated_at,to_jsonb(t.*) from purchase_items t where shop_id=p_shop_id
    union all select 'purchase_returns',id,updated_at,to_jsonb(t.*) from purchase_returns t where shop_id=p_shop_id
    union all select 'credits',id,updated_at,to_jsonb(t.*) from credits t where shop_id=p_shop_id
    union all select 'expenses',id,updated_at,to_jsonb(t.*) from expenses t where shop_id=p_shop_id
    union all select 'payments',id,updated_at,to_jsonb(t.*) from payments t where shop_id=p_shop_id
    union all select 'cash_drawer',id,updated_at,to_jsonb(t.*) from cash_drawer t where shop_id=p_shop_id
    union all select 'audit_logs',id,updated_at,to_jsonb(t.*) from audit_logs t where shop_id=p_shop_id
  )
  select table_name,row_id,updated_at,row_data from all_changes
  where p_since_updated_at is null or (updated_at,table_name,row_id)>(p_since_updated_at,p_since_table,p_since_id)
  order by updated_at,table_name,row_id limit p_limit
$$;


ALTER FUNCTION "public"."sync_pull_changes"("p_shop_id" "uuid", "p_since_updated_at" timestamp with time zone, "p_since_table" "text", "p_since_id" "uuid", "p_limit" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "actor_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "target" "text",
    "meta" "text"
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."batches" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_no" "text" NOT NULL,
    "expiry_date" "date",
    "stock" integer DEFAULT 0 NOT NULL,
    "purchase_price" bigint NOT NULL,
    "sale_price" bigint NOT NULL,
    "is_discounted" boolean DEFAULT false NOT NULL,
    "original_price" bigint
);


ALTER TABLE "public"."batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_drawer" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "business_date" "date" NOT NULL,
    "opening_cash" bigint DEFAULT 0 NOT NULL,
    "opened_by" "uuid" NOT NULL,
    "closed_by" "uuid",
    "opened_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "closing_expected" bigint,
    "closing_counted" bigint
);


ALTER TABLE "public"."cash_drawer" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credits" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "sale_id" "uuid",
    "amount" bigint NOT NULL,
    "balance" bigint NOT NULL
);


ALTER TABLE "public"."credits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "address" "text",
    "notes" "text"
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."expenses" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "amount" bigint NOT NULL,
    "description" "text",
    "receipt_image" "text",
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."expenses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inventory_movements" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "change_qty" integer NOT NULL,
    "reason" "text" NOT NULL,
    "ref_id" "uuid",
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."inventory_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."medicines" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "generic" "text",
    "manufacturer" "text",
    "type" "text",
    "strength" "text",
    "category" "text",
    "unit_of_measure" "text" DEFAULT 'piece'::"text" NOT NULL,
    "requires_prescription" boolean DEFAULT false NOT NULL,
    "barcode" "text",
    "threshold" integer DEFAULT 20 NOT NULL
);


ALTER TABLE "public"."medicines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "party_id" "uuid",
    "amount" bigint NOT NULL,
    "method" "text" DEFAULT 'cash'::"text" NOT NULL,
    "ref_id" "uuid",
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "role_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "allowed" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_items" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "purchase_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_no" "text" NOT NULL,
    "expiry_date" "date",
    "qty" integer NOT NULL,
    "purchase_price" bigint NOT NULL,
    "sale_price" bigint NOT NULL
);


ALTER TABLE "public"."purchase_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchase_returns" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "purchase_id" "uuid" NOT NULL,
    "purchase_item_id" "uuid" NOT NULL,
    "qty" integer NOT NULL,
    "reason" "text",
    "credit_amount" bigint NOT NULL,
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."purchase_returns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."purchases" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "invoice_no" "text" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "total" bigint NOT NULL,
    "payment_terms" "text" NOT NULL,
    "paid_amount" bigint DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."purchases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_system" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sale_items" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "medicine_id" "uuid" NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "qty" integer NOT NULL,
    "unit_price" bigint NOT NULL,
    "discount_type" "text",
    "discount_value" double precision,
    "discount_amount" bigint DEFAULT 0 NOT NULL,
    "line_total" bigint NOT NULL,
    "cogs" bigint NOT NULL
);


ALTER TABLE "public"."sale_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "invoice_no" "text" NOT NULL,
    "total" bigint NOT NULL,
    "paid" bigint NOT NULL,
    "change" bigint DEFAULT 0 NOT NULL,
    "payment_type" "text" NOT NULL,
    "customer_id" "uuid",
    "staff_id" "uuid" NOT NULL
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_returns" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "sale_id" "uuid" NOT NULL,
    "sale_item_id" "uuid" NOT NULL,
    "qty" integer NOT NULL,
    "reason" "text",
    "refund_amount" bigint NOT NULL,
    "refund_method" "text" DEFAULT 'cash'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."sales_returns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shop_claims" (
    "shop_id" "uuid" NOT NULL,
    "claimed_by_user_id" "uuid" NOT NULL,
    "claimed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."shop_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shops" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "name_en" "text",
    "phone" "text" NOT NULL,
    "latitude" double precision,
    "longitude" double precision,
    "thana" "text",
    "district" "text",
    "location_captured_at" timestamp with time zone,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "trial_ends_at" timestamp with time zone
);


ALTER TABLE "public"."shops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "plan" "text" NOT NULL,
    "status" "text" DEFAULT 'trialing'::"text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "next_billing_at" timestamp with time zone,
    "payment_provider" "text",
    "payment_reference" "text"
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "address" "text",
    "email" "text",
    "contact_person" "text"
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    "deleted_by" "uuid",
    "shop_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "pin_hash" "text" NOT NULL,
    "pin_set_at" timestamp with time zone,
    "role_id" "uuid" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "supabase_migrations"."schema_migrations" (
    "version" "text" NOT NULL,
    "statements" "text"[],
    "name" "text"
);


ALTER TABLE "supabase_migrations"."schema_migrations" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_drawer"
    ADD CONSTRAINT "cash_drawer_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."credits"
    ADD CONSTRAINT "credits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."medicines"
    ADD CONSTRAINT "medicines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_returns"
    ADD CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shop_claims"
    ADD CONSTRAINT "shop_claims_claimed_by_user_id_key" UNIQUE ("claimed_by_user_id");



ALTER TABLE ONLY "public"."shop_claims"
    ADD CONSTRAINT "shop_claims_pkey" PRIMARY KEY ("shop_id");



ALTER TABLE ONLY "public"."shops"
    ADD CONSTRAINT "shops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "supabase_migrations"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("version");



CREATE INDEX "audit_logs_actor_idx" ON "public"."audit_logs" USING "btree" ("actor_id");



CREATE INDEX "audit_logs_shop_idx" ON "public"."audit_logs" USING "btree" ("shop_id");



CREATE INDEX "batches_medicine_expiry_idx" ON "public"."batches" USING "btree" ("medicine_id", "expiry_date");



CREATE INDEX "batches_medicine_idx" ON "public"."batches" USING "btree" ("medicine_id");



CREATE INDEX "batches_shop_idx" ON "public"."batches" USING "btree" ("shop_id");



CREATE UNIQUE INDEX "batches_shop_medicine_batchno_unique" ON "public"."batches" USING "btree" ("shop_id", "medicine_id", "batch_no");



CREATE UNIQUE INDEX "cash_drawer_shop_date_unique" ON "public"."cash_drawer" USING "btree" ("shop_id", "business_date");



CREATE INDEX "cash_drawer_shop_idx" ON "public"."cash_drawer" USING "btree" ("shop_id");



CREATE INDEX "credits_customer_idx" ON "public"."credits" USING "btree" ("customer_id");



CREATE INDEX "credits_shop_idx" ON "public"."credits" USING "btree" ("shop_id");



CREATE INDEX "customers_shop_idx" ON "public"."customers" USING "btree" ("shop_id");



CREATE INDEX "customers_shop_phone_idx" ON "public"."customers" USING "btree" ("shop_id", "phone");



CREATE INDEX "expenses_shop_created_idx" ON "public"."expenses" USING "btree" ("shop_id", "created_at");



CREATE INDEX "expenses_shop_idx" ON "public"."expenses" USING "btree" ("shop_id");



CREATE INDEX "inventory_batch_idx" ON "public"."inventory_movements" USING "btree" ("batch_id");



CREATE INDEX "inventory_movements_shop_idx" ON "public"."inventory_movements" USING "btree" ("shop_id");



CREATE INDEX "medicines_barcode_idx" ON "public"."medicines" USING "btree" ("barcode");



CREATE INDEX "medicines_shop_idx" ON "public"."medicines" USING "btree" ("shop_id");



CREATE INDEX "payments_shop_created_idx" ON "public"."payments" USING "btree" ("shop_id", "created_at");



CREATE INDEX "payments_shop_idx" ON "public"."payments" USING "btree" ("shop_id");



CREATE INDEX "permissions_role_idx" ON "public"."permissions" USING "btree" ("role_id");



CREATE INDEX "purchase_items_purchase_idx" ON "public"."purchase_items" USING "btree" ("purchase_id");



CREATE INDEX "purchase_items_shop_idx" ON "public"."purchase_items" USING "btree" ("shop_id");



CREATE INDEX "purchase_returns_purchase_idx" ON "public"."purchase_returns" USING "btree" ("purchase_id");



CREATE INDEX "purchase_returns_shop_idx" ON "public"."purchase_returns" USING "btree" ("shop_id");



CREATE INDEX "purchases_shop_idx" ON "public"."purchases" USING "btree" ("shop_id");



CREATE UNIQUE INDEX "purchases_shop_invoice_unique" ON "public"."purchases" USING "btree" ("shop_id", "invoice_no");



CREATE INDEX "purchases_supplier_idx" ON "public"."purchases" USING "btree" ("supplier_id");



CREATE INDEX "roles_shop_idx" ON "public"."roles" USING "btree" ("shop_id");



CREATE INDEX "sale_items_sale_idx" ON "public"."sale_items" USING "btree" ("sale_id");



CREATE INDEX "sale_items_shop_idx" ON "public"."sale_items" USING "btree" ("shop_id");



CREATE INDEX "sales_returns_sale_idx" ON "public"."sales_returns" USING "btree" ("sale_id");



CREATE INDEX "sales_returns_shop_idx" ON "public"."sales_returns" USING "btree" ("shop_id");



CREATE INDEX "sales_shop_created_idx" ON "public"."sales" USING "btree" ("shop_id", "created_at");



CREATE INDEX "sales_shop_idx" ON "public"."sales" USING "btree" ("shop_id");



CREATE UNIQUE INDEX "sales_shop_invoice_unique" ON "public"."sales" USING "btree" ("shop_id", "invoice_no");



CREATE INDEX "sales_staff_idx" ON "public"."sales" USING "btree" ("staff_id");



CREATE INDEX "shops_owner_idx" ON "public"."shops" USING "btree" ("owner_id");



CREATE INDEX "subscriptions_shop_idx" ON "public"."subscriptions" USING "btree" ("shop_id");



CREATE INDEX "subscriptions_shop_status_idx" ON "public"."subscriptions" USING "btree" ("shop_id", "status");



CREATE INDEX "suppliers_shop_idx" ON "public"."suppliers" USING "btree" ("shop_id");



CREATE INDEX "users_shop_active_idx" ON "public"."users" USING "btree" ("shop_id", "is_active");



CREATE INDEX "users_shop_idx" ON "public"."users" USING "btree" ("shop_id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_drawer"
    ADD CONSTRAINT "cash_drawer_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cash_drawer"
    ADD CONSTRAINT "cash_drawer_opened_by_fkey" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."cash_drawer"
    ADD CONSTRAINT "cash_drawer_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."credits"
    ADD CONSTRAINT "credits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."credits"
    ADD CONSTRAINT "credits_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."credits"
    ADD CONSTRAINT "credits_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."expenses"
    ADD CONSTRAINT "expenses_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."inventory_movements"
    ADD CONSTRAINT "inventory_movements_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."medicines"
    ADD CONSTRAINT "medicines_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permissions"
    ADD CONSTRAINT "permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_items"
    ADD CONSTRAINT "purchase_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "public"."purchase_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."purchase_returns"
    ADD CONSTRAINT "purchase_returns_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."purchases"
    ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_medicine_id_fkey" FOREIGN KEY ("medicine_id") REFERENCES "public"."medicines"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sale_items"
    ADD CONSTRAINT "sale_items_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_returns"
    ADD CONSTRAINT "sales_returns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales_returns"
    ADD CONSTRAINT "sales_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_returns"
    ADD CONSTRAINT "sales_returns_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales_returns"
    ADD CONSTRAINT "sales_returns_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE CASCADE;



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."batches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cash_drawer" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."expenses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."inventory_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."medicines" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchase_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."purchases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sale_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shop_claims" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "shop_insert" ON "public"."audit_logs" FOR INSERT WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."batches" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."cash_drawer" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."credits" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."customers" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."expenses" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."inventory_movements" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."medicines" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."payments" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."permissions" USING (("role_id" IN ( SELECT "roles"."id"
   FROM "public"."roles"
  WHERE ("roles"."shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")))) WITH CHECK (("role_id" IN ( SELECT "roles"."id"
   FROM "public"."roles"
  WHERE ("roles"."shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"))));



CREATE POLICY "shop_isolation" ON "public"."purchase_items" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."purchase_returns" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."purchases" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."roles" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."sale_items" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."sales" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."sales_returns" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."shops" USING (("id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."subscriptions" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."suppliers" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_isolation" ON "public"."users" USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid")) WITH CHECK (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



CREATE POLICY "shop_select" ON "public"."audit_logs" FOR SELECT USING (("shop_id" = ((("auth"."jwt"() -> 'app_metadata'::"text") ->> 'shop_id'::"text"))::"uuid"));



ALTER TABLE "public"."shops" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."assert_fk_same_shop"("p_ref_table" "text", "p_ref_id" "uuid", "p_shop_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_fk_same_shop"("p_ref_table" "text", "p_ref_id" "uuid", "p_shop_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_apply_row"("p_table" "text", "p_op" "text", "p_row" "jsonb", "p_caller_shop_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_apply_row"("p_table" "text", "p_op" "text", "p_row" "jsonb", "p_caller_shop_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_existing_row_owned_or_missing"("p_table" "text", "p_id" "uuid", "p_shop_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_existing_row_owned_or_missing"("p_table" "text", "p_id" "uuid", "p_shop_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_pull_changes"("p_shop_id" "uuid", "p_since_updated_at" timestamp with time zone, "p_since_table" "text", "p_since_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_pull_changes"("p_shop_id" "uuid", "p_since_updated_at" timestamp with time zone, "p_since_table" "text", "p_since_id" "uuid", "p_limit" integer) TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_logs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."batches" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."batches" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."batches" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cash_drawer" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cash_drawer" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cash_drawer" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credits" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credits" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."credits" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customers" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customers" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."customers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."expenses" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."expenses" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."expenses" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_movements" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_movements" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."inventory_movements" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."medicines" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."medicines" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."medicines" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payments" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."permissions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_items" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_items" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_returns" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_returns" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchase_returns" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchases" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchases" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."purchases" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."roles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sale_items" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sale_items" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sale_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_returns" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_returns" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sales_returns" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."shop_claims" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."shops" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."shops" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."shops" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subscriptions" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subscriptions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subscriptions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."suppliers" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."suppliers" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."suppliers" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."users" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."users" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."users" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";







