-- Muthoy cloud mirror. SQLite remains the mobile source of truth.
-- Client timestamps are preserved for Beta last-write-wins; no updated_at trigger.

create table shops (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  owner_id uuid not null, name text not null, name_en text, phone text not null,
  latitude double precision, longitude double precision, thana text, district text,
  location_captured_at timestamptz, plan text not null default 'free', trial_ends_at timestamptz
);
create index shops_owner_idx on shops(owner_id);

-- Independent first-claim-wins registry. Claims precede the cloud shops row.
create table shop_claims (
  shop_id uuid primary key,
  claimed_by_user_id uuid not null unique,
  claimed_at timestamptz not null default now()
);
alter table shop_claims enable row level security;
revoke all on table shop_claims from public, anon, authenticated;
grant select, insert on table shop_claims to service_role;

create table subscriptions (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  plan text not null, status text not null default 'trialing', starts_at timestamptz not null,
  ends_at timestamptz, next_billing_at timestamptz, payment_provider text, payment_reference text
);
create index subscriptions_shop_idx on subscriptions(shop_id);
create index subscriptions_shop_status_idx on subscriptions(shop_id, status);

create table roles (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null, is_system boolean not null default true
);
create index roles_shop_idx on roles(shop_id);

create table permissions (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  role_id uuid not null references roles(id) on delete restrict,
  key text not null, allowed boolean not null default false
);
create index permissions_role_idx on permissions(role_id);

create table users (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null, phone text, pin_hash text not null, pin_set_at timestamptz,
  role_id uuid not null references roles(id) on delete restrict,
  is_active boolean not null default true
);
create index users_shop_idx on users(shop_id);
create index users_shop_active_idx on users(shop_id, is_active);

create table medicines (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null, generic text, manufacturer text, type text, strength text, category text,
  unit_of_measure text not null default 'piece', requires_prescription boolean not null default false,
  barcode text, threshold integer not null default 20
);
create index medicines_shop_idx on medicines(shop_id);
create index medicines_barcode_idx on medicines(barcode);

create table batches (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  medicine_id uuid not null references medicines(id) on delete cascade,
  batch_no text not null, expiry_date date, stock integer not null default 0,
  purchase_price bigint not null, sale_price bigint not null,
  is_discounted boolean not null default false, original_price bigint
);
create index batches_shop_idx on batches(shop_id);
create index batches_medicine_idx on batches(medicine_id);
create index batches_medicine_expiry_idx on batches(medicine_id, expiry_date);
create unique index batches_shop_medicine_batchno_unique on batches(shop_id, medicine_id, batch_no);

create table inventory_movements (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete restrict,
  change_qty integer not null, reason text not null, ref_id uuid,
  created_by uuid not null references users(id) on delete restrict
);
create index inventory_movements_shop_idx on inventory_movements(shop_id);
create index inventory_batch_idx on inventory_movements(batch_id);

create table customers (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null, phone text, address text, notes text
);
create index customers_shop_idx on customers(shop_id);
create index customers_shop_phone_idx on customers(shop_id, phone);

create table sales (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  invoice_no text not null, total bigint not null, paid bigint not null, change bigint not null default 0,
  payment_type text not null, customer_id uuid references customers(id) on delete set null,
  staff_id uuid not null references users(id) on delete restrict
);
create index sales_shop_idx on sales(shop_id);
create index sales_shop_created_idx on sales(shop_id, created_at);
create index sales_staff_idx on sales(staff_id);
create unique index sales_shop_invoice_unique on sales(shop_id, invoice_no);

create table sale_items (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  sale_id uuid not null references sales(id) on delete cascade,
  medicine_id uuid not null references medicines(id) on delete restrict,
  batch_id uuid not null references batches(id) on delete restrict,
  qty integer not null, unit_price bigint not null, discount_type text,
  discount_value double precision, discount_amount bigint not null default 0,
  line_total bigint not null, cogs bigint not null
);
create index sale_items_shop_idx on sale_items(shop_id);
create index sale_items_sale_idx on sale_items(sale_id);

create table sales_returns (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  sale_id uuid not null references sales(id) on delete cascade,
  sale_item_id uuid not null references sale_items(id) on delete restrict,
  qty integer not null, reason text, refund_amount bigint not null,
  refund_method text not null default 'cash',
  created_by uuid not null references users(id) on delete restrict
);
create index sales_returns_shop_idx on sales_returns(shop_id);
create index sales_returns_sale_idx on sales_returns(sale_id);

create table suppliers (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null, phone text, address text, email text, contact_person text
);
create index suppliers_shop_idx on suppliers(shop_id);

create table purchases (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  invoice_no text not null, supplier_id uuid not null references suppliers(id) on delete restrict,
  total bigint not null, payment_terms text not null, paid_amount bigint not null default 0
);
create index purchases_shop_idx on purchases(shop_id);
create index purchases_supplier_idx on purchases(supplier_id);
create unique index purchases_shop_invoice_unique on purchases(shop_id, invoice_no);

create table purchase_items (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  purchase_id uuid not null references purchases(id) on delete cascade,
  medicine_id uuid not null references medicines(id) on delete restrict,
  batch_no text not null, expiry_date date, qty integer not null,
  purchase_price bigint not null, sale_price bigint not null
);
create index purchase_items_shop_idx on purchase_items(shop_id);
create index purchase_items_purchase_idx on purchase_items(purchase_id);

create table purchase_returns (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  purchase_id uuid not null references purchases(id) on delete cascade,
  purchase_item_id uuid not null references purchase_items(id) on delete restrict,
  qty integer not null, reason text, credit_amount bigint not null,
  created_by uuid not null references users(id) on delete restrict
);
create index purchase_returns_shop_idx on purchase_returns(shop_id);
create index purchase_returns_purchase_idx on purchase_returns(purchase_id);

create table credits (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  sale_id uuid references sales(id) on delete set null,
  amount bigint not null, balance bigint not null
);
create index credits_shop_idx on credits(shop_id);
create index credits_customer_idx on credits(customer_id);

create table expenses (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  category text not null, amount bigint not null, description text, receipt_image text,
  created_by uuid not null references users(id) on delete restrict
);
create index expenses_shop_idx on expenses(shop_id);
create index expenses_shop_created_idx on expenses(shop_id, created_at);

create table payments (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  type text not null, party_id uuid, amount bigint not null, method text not null default 'cash',
  ref_id uuid, created_by uuid not null references users(id) on delete restrict
);
create index payments_shop_idx on payments(shop_id);
create index payments_shop_created_idx on payments(shop_id, created_at);

create table cash_drawer (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  business_date date not null, opening_cash bigint not null default 0,
  opened_by uuid not null references users(id) on delete restrict,
  closed_by uuid references users(id) on delete restrict,
  opened_at timestamptz, closed_at timestamptz,
  closing_expected bigint, closing_counted bigint
);
create index cash_drawer_shop_idx on cash_drawer(shop_id);
create unique index cash_drawer_shop_date_unique on cash_drawer(shop_id, business_date);

create table audit_logs (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  actor_id uuid not null references users(id) on delete restrict,
  action text not null, target text, meta text
);
create index audit_logs_shop_idx on audit_logs(shop_id);
create index audit_logs_actor_idx on audit_logs(actor_id);

-- RLS: direct PostgREST access is shop-scoped. Service-role RPC access is
-- separately constrained by the Edge Function and function EXECUTE grants.
alter table shops enable row level security;
create policy shop_isolation on shops for all
  using (id = (auth.jwt() -> 'app_metadata' ->> 'shop_id')::uuid)
  with check (id = (auth.jwt() -> 'app_metadata' ->> 'shop_id')::uuid);

alter table permissions enable row level security;
create policy shop_isolation on permissions for all
  using (role_id in (select id from roles where shop_id = (auth.jwt() -> 'app_metadata' ->> 'shop_id')::uuid))
  with check (role_id in (select id from roles where shop_id = (auth.jwt() -> 'app_metadata' ->> 'shop_id')::uuid));

do $rls$
declare table_name text;
begin
  foreach table_name in array array[
    'subscriptions','roles','users','medicines','batches','inventory_movements',
    'customers','sales','sale_items','sales_returns','suppliers','purchases',
    'purchase_items','purchase_returns','credits','expenses','payments','cash_drawer'
  ] loop
    execute format('alter table %I enable row level security', table_name);
    execute format(
      'create policy shop_isolation on %I for all using (shop_id = (auth.jwt() -> ''app_metadata'' ->> ''shop_id'')::uuid) with check (shop_id = (auth.jwt() -> ''app_metadata'' ->> ''shop_id'')::uuid)',
      table_name
    );
  end loop;
end
$rls$;

alter table audit_logs enable row level security;
create policy shop_select on audit_logs for select
  using (shop_id = (auth.jwt() -> 'app_metadata' ->> 'shop_id')::uuid);
create policy shop_insert on audit_logs for insert
  with check (shop_id = (auth.jwt() -> 'app_metadata' ->> 'shop_id')::uuid);

-- Service-role-only sync RPCs. Table dispatch is explicit: no client-controlled SQL identifiers.
create or replace function assert_fk_same_shop(p_ref_table text,p_ref_id uuid,p_shop_id uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
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
end $fn$;

create or replace function sync_existing_row_owned_or_missing(p_table text,p_id uuid,p_shop_id uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
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
end $fn$;

revoke execute on function assert_fk_same_shop(text,uuid,uuid) from public,anon,authenticated;
grant execute on function assert_fk_same_shop(text,uuid,uuid) to service_role;
revoke execute on function sync_existing_row_owned_or_missing(text,uuid,uuid) from public,anon,authenticated;
grant execute on function sync_existing_row_owned_or_missing(text,uuid,uuid) to service_role;

create or replace function sync_apply_row(p_table text,p_op text,p_row jsonb,p_caller_shop_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
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
end $fn$;

revoke execute on function sync_apply_row(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function sync_apply_row(text,text,jsonb,uuid) to service_role;

create or replace function sync_pull_changes(p_shop_id uuid,p_since_updated_at timestamptz,p_since_table text,p_since_id uuid,p_limit int)
returns table(table_name text,row_id uuid,updated_at timestamptz,row_data jsonb)
language sql security definer set search_path=public as $fn$
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
$fn$;

revoke execute on function sync_pull_changes(uuid,timestamptz,text,uuid,int) from public,anon,authenticated;
grant execute on function sync_pull_changes(uuid,timestamptz,text,uuid,int) to service_role;
