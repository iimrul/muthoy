-- Phase B2 sales/inventory cloud mirror and atomic sync operations.
-- SQLite remains the mobile source of truth; these objects validate and mirror
-- complete outbox graphs without exposing partially-applied money/stock rows.

alter table medicines add column low_stock_threshold_override integer;
update medicines set low_stock_threshold_override = threshold
where low_stock_threshold_override is null;
alter table medicines add constraint medicines_low_stock_override_nonnegative
  check (low_stock_threshold_override is null or low_stock_threshold_override >= 0);
create index medicines_shop_barcode_b2_idx on medicines(shop_id, barcode);

alter table sales add column business_date date;
alter table sales add column subtotal bigint not null default 0;
alter table sales add column discount_type text;
alter table sales add column discount_value bigint;
alter table sales add column discount_amount bigint not null default 0;
alter table sales add column cash_applied bigint not null default 0;
alter table sales add column credit_amount bigint not null default 0;
alter table sales add column seller_name_snapshot text;
alter table sales add column customer_name_snapshot text;
alter table sales add column prescription_no text;
alter table sales add column patient_name text;
alter table sales add column prescriber_name text;
update sales set
  business_date = (created_at at time zone 'Asia/Dhaka')::date,
  subtotal = total,
  cash_applied = case when payment_type = 'cash' then total else 0 end,
  credit_amount = case when payment_type = 'credit' then total else 0 end;
alter table sales add constraint sales_b2_money_nonnegative check (
  subtotal >= 0 and discount_amount >= 0 and total >= 0 and paid >= 0
  and change >= 0 and cash_applied >= 0 and credit_amount >= 0
);
alter table sales add constraint sales_b2_discount_cap check (
  discount_amount <= subtotal and total = subtotal - discount_amount
);
alter table sales add constraint sales_b2_payment_shape check (
  (payment_type = 'free' and total = 0 and paid = 0 and change = 0
    and cash_applied = 0 and credit_amount = 0)
  or (payment_type = 'cash' and cash_applied = total and credit_amount = 0
    and paid >= total and change = paid - total)
  or (payment_type = 'credit' and cash_applied = 0 and credit_amount = total
    and paid = 0 and change = 0)
  or (payment_type = 'split' and cash_applied > 0 and credit_amount > 0
    and cash_applied + credit_amount = total and paid = cash_applied and change = 0)
);

alter table sale_items add column promotion_bps integer not null default 0;
alter table sale_items add column promotion_amount bigint not null default 0;
alter table sale_items alter column discount_value type bigint using round(discount_value)::bigint;
alter table sale_items add column medicine_name_snapshot text;
alter table sale_items add column batch_no_snapshot text;
alter table sale_items add column strength_snapshot text;
alter table sale_items add column unit_snapshot text;
alter table sale_items add constraint sale_items_b2_amounts check (
  qty > 0 and unit_price >= 0 and promotion_bps between 0 and 10000
  and promotion_amount >= 0 and discount_amount >= 0 and line_total >= 0 and cogs >= 0
);

create table shop_b2_settings (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  low_stock_default integer not null default 10 check (low_stock_default >= 0),
  expiry_near_days integer not null default 30 check (expiry_near_days >= 0),
  expiry_far_days integer not null default 60 check (expiry_far_days > expiry_near_days),
  max_refund_days integer not null default 7 check (max_refund_days >= 0),
  unique(shop_id)
);

insert into shop_b2_settings(id, shop_id, created_at, updated_at)
select overlay(s.id::text placing 'b' from 15 for 1)::uuid, s.id, now(), now()
from shops s on conflict(shop_id) do nothing;

create table batch_promotions (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  batch_id uuid not null references batches(id) on delete restrict,
  discount_bps integer not null check (discount_bps between 1 and 10000),
  is_active boolean not null default true,
  created_by uuid not null references users(id) on delete restrict,
  reversed_by uuid references users(id) on delete restrict,
  reversed_at timestamptz,
  check ((is_active and reversed_by is null and reversed_at is null)
    or (not is_active and reversed_by is not null and reversed_at is not null))
);
create unique index batch_promotions_one_active_idx
  on batch_promotions(shop_id, batch_id) where is_active and not is_deleted;
create index batch_promotions_shop_batch_idx on batch_promotions(shop_id, batch_id, is_active);

create table sale_drafts (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','held','cancelled','completed')),
  origin_device_id text not null check (length(origin_device_id) between 1 and 200),
  actor_id uuid not null references users(id) on delete restrict,
  customer_id uuid references customers(id) on delete set null,
  completed_sale_id uuid references sales(id) on delete restrict,
  checkout_snapshot text,
  prescription_no text, patient_name text, prescriber_name text
);
create unique index sale_drafts_completed_sale_idx on sale_drafts(completed_sale_id)
  where completed_sale_id is not null;
create index sale_drafts_shop_status_idx on sale_drafts(shop_id, status, updated_at);

create table sale_draft_items (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  draft_id uuid not null references sale_drafts(id) on delete cascade,
  medicine_id uuid not null references medicines(id) on delete restrict,
  qty integer not null check (qty > 0),
  unique(draft_id, medicine_id)
);

create table sale_attachments (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  sale_id uuid not null references sales(id) on delete restrict,
  storage_path text,
  mime_type text not null default 'image/jpeg',
  content_hash text
);
create index sale_attachments_sale_idx on sale_attachments(sale_id);

create table refund_claims (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete restrict,
  sale_id uuid not null references sales(id) on delete restrict,
  operation_id uuid not null,
  actor_id uuid not null references users(id) on delete restrict,
  device_id text not null check (length(device_id) between 1 and 200),
  claim_token uuid not null default gen_random_uuid(),
  status text not null default 'claimed' check (status in ('claimed','committed','reconciliation_required')),
  claimed_at timestamptz not null default now(), committed_at timestamptz,
  unique(shop_id, sale_id), unique(operation_id), unique(claim_token)
);

create table sale_refunds (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  sale_id uuid not null references sales(id) on delete restrict,
  claim_id uuid not null references refund_claims(id) on delete restrict,
  claim_token uuid not null,
  reason text not null check (length(btrim(reason)) > 0),
  total_amount bigint not null check (total_amount >= 0),
  business_date date not null,
  created_by uuid not null references users(id) on delete restrict,
  unique(shop_id, sale_id)
);

alter table sales_returns add column refund_id uuid references sale_refunds(id) on delete restrict;
create unique index sales_returns_refund_item_unique
  on sales_returns(refund_id, sale_item_id) where refund_id is not null;

create table refund_tenders (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  refund_id uuid not null references sale_refunds(id) on delete restrict,
  kind text not null check (kind in ('cash','credit_cancel','collection_refund')),
  method text check (method in ('cash','bkash','nagad','rocket','card','bank','other')),
  amount bigint not null check (amount >= 0),
  source_payment_id uuid
);
create index refund_tenders_refund_idx on refund_tenders(refund_id);

create table credit_payment_allocations (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  payment_id uuid not null references payments(id) on delete restrict,
  credit_id uuid not null references credits(id) on delete restrict,
  amount bigint not null check (amount > 0),
  unique(payment_id, credit_id)
);
create index credit_payment_allocations_customer_idx
  on credit_payment_allocations(shop_id, customer_id);

create table credit_reconciliation_states (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','verified','blocked')),
  canonical_hash text,
  verified_by uuid references users(id) on delete restrict,
  verified_at timestamptz,
  unique(shop_id, customer_id)
);

-- Existing credit/payment history cannot be proven allocation-complete by a
-- schema-only upgrade. Quarantine those customers until audited backfill;
-- new clean credit sales create a verified state in their atomic sale graph.
-- Deterministic id = customer_id, identical to the SQLite 0010 backfill, so the
-- same (shop, customer) reconciliation row carries the same primary key on both
-- engines and cannot collide across sync on the unique(shop_id, customer_id).
insert into credit_reconciliation_states(id,shop_id,customer_id,status,created_at,updated_at)
select c.id,c.shop_id,c.id,'pending',now(),now()
from customers c
where not c.is_deleted and (
  exists(select 1 from credits cr where cr.shop_id=c.shop_id and cr.customer_id=c.id and not cr.is_deleted)
  or exists(select 1 from payments p where p.shop_id=c.shop_id and p.party_id=c.id and p.type='customer_payment' and not p.is_deleted)
)
on conflict(shop_id,customer_id) do nothing;

create table inventory_imports (
  id uuid primary key,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  is_deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  file_fingerprint text not null,
  row_count integer not null check (row_count between 1 and 1000),
  status text not null check (status in ('validated','committed','failed')),
  created_by uuid not null references users(id) on delete restrict,
  unique(shop_id, file_fingerprint)
);

-- Server-only staging. No business row is visible until a complete operation
-- validates and applies in the same database transaction.
create table sync_operation_staging (
  operation_id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  operation_kind text not null check (operation_kind in ('sale','refund','inventory_import','draft_complete','credit_collection','draft_hold','draft_cancel')),
  actor_id uuid not null references users(id) on delete restrict,
  device_id text not null,
  expected_row_count integer not null check (expected_row_count between 1 and 10000),
  payload_hash text not null check (length(payload_hash) between 16 and 200),
  received_row_count integer not null default 0,
  status text not null default 'staging' check (status in ('staging','applying','applied','rejected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  applied_at timestamptz
);

create table sync_operation_chunks (
  operation_id uuid not null references sync_operation_staging(operation_id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  row_count integer not null check (row_count > 0),
  chunk_hash text not null,
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  received_at timestamptz not null default now(),
  primary key(operation_id, sequence)
);

alter table shop_b2_settings enable row level security;
alter table batch_promotions enable row level security;
alter table sale_drafts enable row level security;
alter table sale_draft_items enable row level security;
alter table sale_attachments enable row level security;
alter table sale_refunds enable row level security;
alter table refund_tenders enable row level security;
alter table credit_payment_allocations enable row level security;
alter table credit_reconciliation_states enable row level security;
alter table inventory_imports enable row level security;
alter table refund_claims enable row level security;
alter table sync_operation_staging enable row level security;
alter table sync_operation_chunks enable row level security;

revoke all on table refund_claims, sync_operation_staging, sync_operation_chunks
  from public, anon, authenticated;
grant select, insert, update, delete on table refund_claims, sync_operation_staging, sync_operation_chunks
  to service_role;

-- Completed financial/ledger graphs are service-applied only. RLS cannot
-- prove cross-row arithmetic, so authenticated table DML is intentionally
-- absent even when SELECT remains permission-scoped.
revoke insert,update,delete on table sales,sale_items,sale_refunds,sales_returns,
  refund_tenders,credits,credit_payment_allocations,payments,cash_drawer,
  inventory_movements,inventory_imports from public,anon,authenticated;

-- New business tables are read through shop/permission-scoped policies. All
-- writes still travel through the sync function's validated RPCs.
do $b2_rls$
declare v_table text;
begin
  foreach v_table in array array[
    'shop_b2_settings','batch_promotions','sale_drafts','sale_draft_items',
    'sale_attachments','sale_refunds','refund_tenders','credit_payment_allocations',
    'credit_reconciliation_states','inventory_imports'
  ] loop
    execute format(
      'create policy b2_shop_read on %I for select using (shop_id = nullif(auth.jwt() -> ''app_metadata'' ->> ''shop_id'','''')::uuid)',
      v_table
    );
    execute format('revoke insert, update, delete on table %I from anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table %I to service_role', v_table);
  end loop;
end
$b2_rls$;

-- Direct completed-financial/ledger/import writes cannot prove cross-row sums.
revoke insert, update, delete on table sales, sale_items, sales_returns,
  inventory_movements, credits, payments, cash_drawer, audit_logs
  from anon, authenticated;

-- Staff Sales/audit is Owner-only. Sales history is permissioned, with the
-- staff member's own receipts retained for required own-sale views.
drop policy if exists muthoy_read on audit_logs;
drop policy if exists shop_select on audit_logs;
create policy b2_owner_audit_read on audit_logs for select
  using (shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid and auth_is_owner());

drop policy if exists muthoy_read on sales;
drop policy if exists shop_isolation on sales;
create policy b2_sales_history_read on sales for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and (auth_has_permission('sale_history')
    or staff_id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid)
);

drop policy if exists muthoy_read on sale_items;
drop policy if exists shop_isolation on sale_items;
create policy b2_sale_items_history_read on sale_items for select using (
  shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and exists(select 1 from sales s where s.id=sale_items.sale_id and s.shop_id=sale_items.shop_id
    and (auth_has_permission('sale_history')
      or s.staff_id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);

-- Storage policies are installed only on Supabase, not PGlite's platform shim.
create or replace function auth_can_access_sale_attachment_path(p_name text)
returns boolean language sql stable security definer set search_path=public as $fn$
  select split_part(p_name, '/', 1) = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')
    and split_part(p_name, '/', 4) = ''
    and exists(
      select 1 from sale_attachments a join sales s on s.id=a.sale_id and s.shop_id=a.shop_id
      join users u on u.id=nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid
      where a.shop_id=nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
        and a.sale_id::text=split_part(p_name,'/',2)
        and a.id::text=split_part(p_name,'/',3) and a.storage_path=p_name
        and u.shop_id=a.shop_id and u.is_active and not u.is_deleted
        and (user_has_permission(u.id,'sale_history') or s.staff_id=u.id)
    )
$fn$;
revoke execute on function auth_can_access_sale_attachment_path(text) from public, anon;
grant execute on function auth_can_access_sale_attachment_path(text) to authenticated, service_role;

do $storage_policies$
begin
  if to_regclass('storage.objects') is not null then
    execute $bucket$insert into storage.buckets(id,name,public)
      values ('prescriptions','prescriptions',false)
      on conflict(id) do update set public=false$bucket$;
    execute 'drop policy if exists muthoy_sale_attachments_read on storage.objects';
    execute 'drop policy if exists muthoy_sale_attachments_write on storage.objects';
    execute $policy$create policy muthoy_sale_attachments_read on storage.objects
      for select using (bucket_id = 'prescriptions' and auth_can_access_sale_attachment_path(name))$policy$;
    execute $policy$create policy muthoy_sale_attachments_write on storage.objects
      for insert with check (bucket_id = 'prescriptions' and auth_can_access_sale_attachment_path(name))$policy$;
  end if;
end
$storage_policies$;

create or replace function b2_user_is_owner(p_app_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $fn$
  select exists(
    select 1 from users u join roles r on r.id=u.role_id and r.shop_id=u.shop_id
    where u.id=p_app_user_id and u.is_active and not u.is_deleted
      and not r.is_deleted and r.name='owner'
  )
$fn$;

-- Complete B2 permission dispatch. In particular, customer returns no longer
-- ride the legacy sales grant and imported opening stock is Owner-only.
create or replace function sync_row_permitted(p_app_user_id uuid, p_table text, p_row jsonb)
returns boolean language sql stable security definer set search_path=public as $fn$
  select case p_table
    when 'shops' then user_has_permission(p_app_user_id, 'settings_manage')
    when 'subscriptions' then user_has_permission(p_app_user_id, 'settings_manage')
    when 'roles' then user_has_permission(p_app_user_id, 'staff_management')
    when 'permissions' then user_has_permission(p_app_user_id, 'staff_management')
    when 'users' then user_has_permission(p_app_user_id, 'staff_management')
    when 'user_permissions' then user_has_permission(p_app_user_id, 'staff_management')
    when 'shop_b2_settings' then b2_user_is_owner(p_app_user_id)
    when 'medicines' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'batches' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'batch_promotions' then user_has_permission(p_app_user_id, 'expiry_manage')
      and user_has_permission(p_app_user_id, 'sale_discount')
    when 'inventory_movements' then case
      when p_row ->> 'reason' = 'sale' then user_has_permission(p_app_user_id, 'sales')
      when p_row ->> 'reason' = 'return' then user_has_permission(p_app_user_id, 'sale_return')
      when p_row ->> 'reason' = 'csv_import' then b2_user_is_owner(p_app_user_id)
      -- Negative expiry disposal must clear BOTH gates, matching the client's
      -- adjustBatchStock (inventory_edit + expiry_manage). An inventory write
      -- alone cannot write off expiry stock through the sync path.
      when p_row ->> 'reason' = 'expiry_disposal' then
        user_has_permission(p_app_user_id, 'expiry_manage')
        and user_has_permission(p_app_user_id, 'inventory_write')
      else user_has_permission(p_app_user_id, 'inventory_write') end
    when 'customers' then user_has_permission(p_app_user_id, 'sales')
      or user_has_permission(p_app_user_id, 'credit_management')
    when 'sales' then user_has_permission(p_app_user_id, 'sales')
    when 'sale_items' then user_has_permission(p_app_user_id, 'sales')
    when 'sale_drafts' then user_has_permission(p_app_user_id, 'sales')
    when 'sale_draft_items' then user_has_permission(p_app_user_id, 'sales')
    when 'sale_attachments' then user_has_permission(p_app_user_id, 'sales')
    when 'sale_refunds' then user_has_permission(p_app_user_id, 'sale_return')
    when 'sales_returns' then user_has_permission(p_app_user_id, 'sale_return')
    when 'refund_tenders' then user_has_permission(p_app_user_id, 'sale_return')
    when 'credits' then user_has_permission(p_app_user_id, 'sales')
      or user_has_permission(p_app_user_id, 'credit_management')
      or user_has_permission(p_app_user_id, 'sale_return')
    when 'credit_payment_allocations' then user_has_permission(p_app_user_id, 'credit_management')
      or user_has_permission(p_app_user_id, 'sale_return')
    when 'credit_reconciliation_states' then user_has_permission(p_app_user_id, 'credit_management')
    when 'cash_drawer' then user_has_permission(p_app_user_id, 'sales')
      or user_has_permission(p_app_user_id, 'cash_management')
      or user_has_permission(p_app_user_id, 'sale_return')
    when 'payments' then user_has_permission(p_app_user_id, 'cash_management')
      or user_has_permission(p_app_user_id, 'credit_management')
      or user_has_permission(p_app_user_id, 'inventory_write')
      or user_has_permission(p_app_user_id, 'sale_return')
    when 'expenses' then user_has_permission(p_app_user_id, 'cash_management')
    when 'suppliers' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'purchases' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'purchase_items' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'purchase_returns' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'inventory_imports' then b2_user_is_owner(p_app_user_id)
    when 'audit_logs' then true
    else false
  end
$fn$;

revoke execute on function b2_user_is_owner(uuid) from public,anon,authenticated;
revoke execute on function sync_row_permitted(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function b2_user_is_owner(uuid), sync_row_permitted(uuid,text,jsonb) to service_role;

create or replace function sync_apply_b2_row(
  p_table text, p_op text, p_row jsonb, p_shop_id uuid,
  p_actor_id uuid, p_device_id text default null
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_id uuid := (p_row->>'id')::uuid;
  v_is_owner boolean := b2_user_is_owner(p_actor_id);
  v_actor uuid;
  v_storage_path text;
begin
  if p_op not in ('insert','update','delete') then
    raise exception 'unsupported sync operation: %',p_op using errcode='MU002';
  end if;
  if p_row->>'shop_id' is distinct from p_shop_id::text then
    raise exception 'row does not belong to authenticated shop' using errcode='MU003';
  end if;
  if not sync_row_permitted(p_actor_id,p_table,p_row) then
    raise exception 'caller lacks permission for B2 row' using errcode='MU010';
  end if;

  if p_table='shop_b2_settings' then
    if not v_is_owner or p_op='delete' then
      raise exception 'B2 settings are Owner-managed' using errcode='MU015';
    end if;
    insert into shop_b2_settings select * from jsonb_populate_record(null::shop_b2_settings,p_row)
    on conflict(id) do update set
      updated_at=excluded.updated_at,is_deleted=excluded.is_deleted,deleted_at=excluded.deleted_at,
      deleted_by=excluded.deleted_by,low_stock_default=excluded.low_stock_default,
      expiry_near_days=excluded.expiry_near_days,expiry_far_days=excluded.expiry_far_days,
      max_refund_days=excluded.max_refund_days
    where shop_b2_settings.shop_id=p_shop_id and shop_b2_settings.updated_at<excluded.updated_at;

  elsif p_table='batch_promotions' then
    v_actor := coalesce((p_row->>'reversed_by')::uuid,(p_row->>'created_by')::uuid);
    if not assert_fk_same_shop('batches',(p_row->>'batch_id')::uuid,p_shop_id)
       or not assert_fk_same_shop('users',v_actor,p_shop_id) then
      raise exception 'cross-shop batch promotion reference' using errcode='MU003';
    end if;
    if not v_is_owner and v_actor<>p_actor_id then
      raise exception 'promotion attributed to another user' using errcode='MU011';
    end if;
    if coalesce((p_row->>'is_active')::boolean,true) and not exists(
      select 1 from batches b left join shop_b2_settings st on st.shop_id=b.shop_id
      where b.id=(p_row->>'batch_id')::uuid and b.shop_id=p_shop_id and not b.is_deleted
        and b.expiry_date is not null
        and b.expiry_date >= (now() at time zone 'Asia/Dhaka')::date
        and b.expiry_date <= (now() at time zone 'Asia/Dhaka')::date
          + coalesce(st.expiry_far_days,60)
    ) then
      raise exception 'promotion batch is not in an eligible expiry band' using errcode='MU016';
    end if;
    if p_op='delete' then
      raise exception 'promotion history is reversible, not deletable' using errcode='MU001';
    end if;
    insert into batch_promotions select * from jsonb_populate_record(null::batch_promotions,p_row)
    on conflict(id) do update set
      updated_at=excluded.updated_at,is_deleted=excluded.is_deleted,deleted_at=excluded.deleted_at,
      deleted_by=excluded.deleted_by,discount_bps=excluded.discount_bps,is_active=excluded.is_active,
      reversed_by=excluded.reversed_by,reversed_at=excluded.reversed_at
    where batch_promotions.shop_id=p_shop_id and batch_promotions.updated_at<excluded.updated_at;

  elsif p_table='sale_drafts' then
    if not assert_fk_same_shop('users',(p_row->>'actor_id')::uuid,p_shop_id)
       or not assert_fk_same_shop('customers',(p_row->>'customer_id')::uuid,p_shop_id)
       or not assert_fk_same_shop('sales',(p_row->>'completed_sale_id')::uuid,p_shop_id) then
      raise exception 'cross-shop sale draft reference' using errcode='MU003';
    end if;
    if not v_is_owner and (p_row->>'actor_id')::uuid<>p_actor_id then
      raise exception 'draft attributed to another user' using errcode='MU011';
    end if;
    if p_device_id is null or p_row->>'origin_device_id'<>p_device_id then
      raise exception 'draft may mutate only on its origin device' using errcode='MU017';
    end if;
    insert into sale_drafts select * from jsonb_populate_record(null::sale_drafts,p_row)
    on conflict(id) do update set
      updated_at=excluded.updated_at,is_deleted=excluded.is_deleted,deleted_at=excluded.deleted_at,
      deleted_by=excluded.deleted_by,status=excluded.status,customer_id=excluded.customer_id,
      completed_sale_id=excluded.completed_sale_id,checkout_snapshot=excluded.checkout_snapshot,
      prescription_no=excluded.prescription_no,patient_name=excluded.patient_name,
      prescriber_name=excluded.prescriber_name
    where sale_drafts.shop_id=p_shop_id
      and sale_drafts.origin_device_id=p_device_id
      and sale_drafts.updated_at<excluded.updated_at;

  elsif p_table='sale_draft_items' then
    if not exists(select 1 from sale_drafts d where d.id=(p_row->>'draft_id')::uuid
      and d.shop_id=p_shop_id and d.origin_device_id=p_device_id)
      or not assert_fk_same_shop('medicines',(p_row->>'medicine_id')::uuid,p_shop_id) then
      raise exception 'cross-shop or non-origin draft item' using errcode='MU003';
    end if;
    if p_op='delete' then
      update sale_draft_items set is_deleted=true,deleted_at=(p_row->>'deleted_at')::timestamptz,
        deleted_by=(p_row->>'deleted_by')::uuid,updated_at=(p_row->>'updated_at')::timestamptz
      where id=v_id and shop_id=p_shop_id and updated_at<(p_row->>'updated_at')::timestamptz;
    else
      insert into sale_draft_items select * from jsonb_populate_record(null::sale_draft_items,p_row)
      on conflict(id) do update set updated_at=excluded.updated_at,is_deleted=excluded.is_deleted,
        deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,medicine_id=excluded.medicine_id,
        qty=excluded.qty
      where sale_draft_items.shop_id=p_shop_id and sale_draft_items.updated_at<excluded.updated_at;
    end if;

  elsif p_table='sale_attachments' then
    if not assert_fk_same_shop('sales',(p_row->>'sale_id')::uuid,p_shop_id) then
      raise exception 'cross-shop sale attachment' using errcode='MU003';
    end if;
    v_storage_path:=p_row->>'storage_path';
    if v_storage_path is not null
       and v_storage_path<>p_shop_id::text||'/'||(p_row->>'sale_id')||'/'||v_id::text then
      raise exception 'invalid sale attachment storage path' using errcode='MU018';
    end if;
    if p_op='delete' then
      raise exception 'sale attachment metadata is immutable' using errcode='MU001';
    end if;
    insert into sale_attachments select * from jsonb_populate_record(null::sale_attachments,p_row)
    on conflict(id) do update set updated_at=excluded.updated_at,storage_path=excluded.storage_path,
      mime_type=excluded.mime_type,content_hash=excluded.content_hash
    where sale_attachments.shop_id=p_shop_id and sale_attachments.sale_id=excluded.sale_id
      and sale_attachments.updated_at<excluded.updated_at;

  elsif p_table='sale_refunds' then
    if p_op<>'insert' then raise exception 'refund headers are immutable' using errcode='MU001'; end if;
    insert into sale_refunds select * from jsonb_populate_record(null::sale_refunds,p_row)
    on conflict(id) do nothing;

  elsif p_table='refund_tenders' then
    if p_op<>'insert' then raise exception 'refund tenders are immutable' using errcode='MU001'; end if;
    if not exists(select 1 from sale_refunds r where r.id=(p_row->>'refund_id')::uuid and r.shop_id=p_shop_id)
       or ((p_row->>'source_payment_id') is not null and not exists(
         select 1 from payments x where x.id=(p_row->>'source_payment_id')::uuid and x.shop_id=p_shop_id
       )) then
      raise exception 'cross-shop refund tender reference' using errcode='MU003';
    end if;
    insert into refund_tenders select * from jsonb_populate_record(null::refund_tenders,p_row)
    on conflict(id) do nothing;

  elsif p_table='credit_payment_allocations' then
    if p_op<>'insert' then raise exception 'credit allocations are immutable' using errcode='MU001'; end if;
    if not assert_fk_same_shop('customers',(p_row->>'customer_id')::uuid,p_shop_id)
       or not exists(select 1 from payments x where x.id=(p_row->>'payment_id')::uuid and x.shop_id=p_shop_id)
       or not exists(select 1 from credits x where x.id=(p_row->>'credit_id')::uuid and x.shop_id=p_shop_id) then
      raise exception 'cross-shop credit allocation' using errcode='MU003';
    end if;
    insert into credit_payment_allocations select * from jsonb_populate_record(null::credit_payment_allocations,p_row)
    on conflict(id) do nothing;

  elsif p_table='credit_reconciliation_states' then
    if not assert_fk_same_shop('customers',(p_row->>'customer_id')::uuid,p_shop_id)
       or not assert_fk_same_shop('users',(p_row->>'verified_by')::uuid,p_shop_id) then
      raise exception 'cross-shop credit reconciliation' using errcode='MU003';
    end if;
    insert into credit_reconciliation_states select * from jsonb_populate_record(null::credit_reconciliation_states,p_row)
    on conflict(id) do update set updated_at=excluded.updated_at,status=excluded.status,
      canonical_hash=excluded.canonical_hash,verified_by=excluded.verified_by,verified_at=excluded.verified_at
    where credit_reconciliation_states.shop_id=p_shop_id
      and credit_reconciliation_states.updated_at<excluded.updated_at;

  elsif p_table='inventory_imports' then
    if not v_is_owner or p_op<>'insert' then
      raise exception 'inventory import is an immutable Owner operation' using errcode='MU015';
    end if;
    if (p_row->>'created_by')::uuid<>p_actor_id then
      raise exception 'inventory import attributed to another user' using errcode='MU011';
    end if;
    insert into inventory_imports select * from jsonb_populate_record(null::inventory_imports,p_row)
    on conflict(id) do nothing;
  else
    raise exception 'unsupported B2 sync table: %',p_table using errcode='MU004';
  end if;
  return 'applied';
end
$fn$;

-- Preserve the hardened B1 dispatcher and add B2 tables/columns around it.
alter function sync_apply_row(text,text,jsonb,uuid,uuid) rename to sync_apply_row_pre_b2;

create or replace function sync_apply_row(
  p_table text,p_op text,p_row jsonb,p_caller_shop_id uuid,p_caller_user_id uuid,
  p_device_id text
)
returns text language plpgsql security definer set search_path=public as $fn$
declare v_result text; v_row jsonb:=p_row;
begin
  if p_table in ('shop_b2_settings','batch_promotions','sale_drafts','sale_draft_items',
    'sale_attachments','sale_refunds','refund_tenders','credit_payment_allocations',
    'credit_reconciliation_states','inventory_imports') then
    return sync_apply_b2_row(p_table,p_op,p_row,p_caller_shop_id,p_caller_user_id,p_device_id);
  end if;
  -- Pre-B2 outbox rows remain valid after upgrade. jsonb_populate_record
  -- yields NULL for absent new columns, so normalize them before dispatch.
  if p_table='sales' and p_op<>'delete' then
    v_row:=p_row || jsonb_build_object(
      'business_date',coalesce(p_row->>'business_date',
        ((p_row->>'created_at')::timestamptz at time zone 'Asia/Dhaka')::date::text),
      'subtotal',coalesce((p_row->>'subtotal')::bigint,(p_row->>'total')::bigint,0),
      'discount_amount',coalesce((p_row->>'discount_amount')::bigint,0),
      'cash_applied',coalesce((p_row->>'cash_applied')::bigint,
        case when p_row->>'payment_type'='cash' then (p_row->>'total')::bigint else 0 end),
      'credit_amount',coalesce((p_row->>'credit_amount')::bigint,
        case when p_row->>'payment_type'='credit' then (p_row->>'total')::bigint else 0 end)
    );
  elsif p_table='sale_items' and p_op<>'delete' then
    v_row:=p_row || jsonb_build_object(
      'promotion_bps',coalesce((p_row->>'promotion_bps')::integer,0),
      'promotion_amount',coalesce((p_row->>'promotion_amount')::bigint,0)
    );
  end if;
  v_result:=sync_apply_row_pre_b2(p_table,p_op,v_row,p_caller_shop_id,p_caller_user_id);
  if v_result<>'applied' then return v_result; end if;
  -- The legacy dispatcher applied the common columns and timestamp. Extend only
  -- the exact same version; stale rows cannot overwrite B2 fields.
  if p_table='medicines' and p_op<>'delete' then
    update medicines set low_stock_threshold_override=(p_row->>'low_stock_threshold_override')::integer
    where id=(p_row->>'id')::uuid and shop_id=p_caller_shop_id
      and updated_at=(p_row->>'updated_at')::timestamptz;
  elsif p_table='sales' and p_op<>'delete' then
    update sales set business_date=(v_row->>'business_date')::date,
      subtotal=(v_row->>'subtotal')::bigint,discount_type=v_row->>'discount_type',
      discount_value=(v_row->>'discount_value')::bigint,
      discount_amount=(v_row->>'discount_amount')::bigint,
      cash_applied=(v_row->>'cash_applied')::bigint,credit_amount=(v_row->>'credit_amount')::bigint,
      seller_name_snapshot=v_row->>'seller_name_snapshot',customer_name_snapshot=v_row->>'customer_name_snapshot',
      prescription_no=v_row->>'prescription_no',patient_name=v_row->>'patient_name',
      prescriber_name=v_row->>'prescriber_name'
    where id=(v_row->>'id')::uuid and shop_id=p_caller_shop_id
      and updated_at=(v_row->>'updated_at')::timestamptz;
  elsif p_table='sale_items' and p_op<>'delete' then
    update sale_items set promotion_bps=coalesce((p_row->>'promotion_bps')::integer,0),
      promotion_amount=coalesce((p_row->>'promotion_amount')::bigint,0),
      medicine_name_snapshot=p_row->>'medicine_name_snapshot',batch_no_snapshot=p_row->>'batch_no_snapshot',
      strength_snapshot=p_row->>'strength_snapshot',unit_snapshot=p_row->>'unit_snapshot'
    where id=(p_row->>'id')::uuid and shop_id=p_caller_shop_id
      and updated_at=(p_row->>'updated_at')::timestamptz;
  elsif p_table='sales_returns' and p_op<>'delete' then
    update sales_returns set refund_id=(p_row->>'refund_id')::uuid
    where id=(p_row->>'id')::uuid and shop_id=p_caller_shop_id
      and updated_at=(p_row->>'updated_at')::timestamptz;
  end if;
  return v_result;
end
$fn$;

create or replace function sync_apply_row(
  p_table text,p_op text,p_row jsonb,p_caller_shop_id uuid,p_caller_user_id uuid
)
returns text language sql security definer set search_path=public as $fn$
  select sync_apply_row(p_table,p_op,p_row,p_caller_shop_id,p_caller_user_id,null)
$fn$;

revoke execute on function sync_apply_b2_row(text,text,jsonb,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function sync_apply_row_pre_b2(text,text,jsonb,uuid,uuid) from public,anon,authenticated;
revoke execute on function sync_apply_row(text,text,jsonb,uuid,uuid,text) from public,anon,authenticated;
revoke execute on function sync_apply_row(text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function sync_apply_b2_row(text,text,jsonb,uuid,uuid,text),
  sync_apply_row_pre_b2(text,text,jsonb,uuid,uuid),
  sync_apply_row(text,text,jsonb,uuid,uuid,text),
  sync_apply_row(text,text,jsonb,uuid,uuid) to service_role;

create or replace function sync_claim_refund(
  p_shop_id uuid,p_sale_id uuid,p_operation_id uuid,p_actor_id uuid,p_device_id text
)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare
  v_claim refund_claims%rowtype;
  v_sale sales%rowtype;
  v_today date := (now() at time zone 'Asia/Dhaka')::date;
  v_max_days integer;
begin
  if p_device_id is null or length(p_device_id) not between 1 and 200 then
    raise exception 'invalid refund device identity' using errcode='MU017';
  end if;
  if not exists(select 1 from users u where u.id=p_actor_id and u.shop_id=p_shop_id
      and u.is_active and not u.is_deleted)
     or not user_has_permission(p_actor_id,'sale_return') then
    raise exception 'caller lacks sale_return' using errcode='MU010';
  end if;
  select * into v_sale from sales where id=p_sale_id and shop_id=p_shop_id and not is_deleted;
  if not found then raise exception 'refund sale is not synced' using errcode='MU019'; end if;
  if exists(select 1 from sale_refunds where shop_id=p_shop_id and sale_id=p_sale_id and not is_deleted) then
    raise exception 'sale is already refunded' using errcode='MU020';
  end if;
  select coalesce(s.max_refund_days,7) into v_max_days
    from (select 1) seed left join shop_b2_settings s on s.shop_id=p_shop_id and not s.is_deleted;
  if v_today > coalesce(v_sale.business_date,(v_sale.created_at at time zone 'Asia/Dhaka')::date)+v_max_days then
    raise exception 'refund window has closed' using errcode='MU021';
  end if;
  if not exists(select 1 from cash_drawer d where d.shop_id=p_shop_id
      and d.business_date=v_today and d.closed_at is null and not d.is_deleted) then
    raise exception 'current business day is not open' using errcode='MU022';
  end if;
  if v_sale.customer_id is not null
     and exists(select 1 from credits c where c.sale_id=p_sale_id and c.shop_id=p_shop_id and not c.is_deleted)
     and not exists(select 1 from credit_reconciliation_states r
       where r.shop_id=p_shop_id and r.customer_id=v_sale.customer_id
         and r.status='verified' and not r.is_deleted) then
    raise exception 'credit allocation reconciliation is not verified' using errcode='MU023';
  end if;

  insert into refund_claims(shop_id,sale_id,operation_id,actor_id,device_id)
  values(p_shop_id,p_sale_id,p_operation_id,p_actor_id,p_device_id)
  on conflict(shop_id,sale_id) do nothing;

  select * into v_claim from refund_claims
  where shop_id=p_shop_id and sale_id=p_sale_id for update;
  if v_claim.operation_id<>p_operation_id or v_claim.actor_id<>p_actor_id
     or v_claim.device_id<>p_device_id then
    raise exception 'refund authority is already claimed' using errcode='MU020';
  end if;
  return jsonb_build_object(
    'claimId',v_claim.id,'claimToken',v_claim.claim_token,
    'operationId',v_claim.operation_id,'status',v_claim.status
  );
end
$fn$;

revoke execute on function sync_claim_refund(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function sync_claim_refund(uuid,uuid,uuid,uuid,text) to service_role;

create or replace function sync_apply_operation(
  p_shop_id uuid,p_operation_id uuid,p_operation_kind text,
  p_actor_id uuid,p_device_id text,p_rows jsonb
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_entry record;
  v_table text;
  v_op text;
  v_payload jsonb;
  v_result text;
  v_sale jsonb;
  v_refund jsonb;
  v_claim refund_claims%rowtype;
  v_count integer;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then
    raise exception 'operation rows must be a non-empty array' using errcode='MU024';
  end if;
  if p_operation_kind not in ('sale','refund','inventory_import','draft_complete','credit_collection','draft_hold','draft_cancel') then
    raise exception 'unsupported operation kind' using errcode='MU004';
  end if;
  if not exists(select 1 from users where id=p_actor_id and shop_id=p_shop_id
      and is_active and not is_deleted) then
    raise exception 'caller is not a live shop user' using errcode='MU010';
  end if;
  if p_operation_kind='inventory_import' and not b2_user_is_owner(p_actor_id) then
    raise exception 'CSV import is Owner-only' using errcode='MU015';
  elsif p_operation_kind='refund' and not user_has_permission(p_actor_id,'sale_return') then
    raise exception 'refund requires sale_return' using errcode='MU010';
  elsif p_operation_kind in ('sale','draft_complete') and not user_has_permission(p_actor_id,'sales') then
    raise exception 'sale operation requires sales' using errcode='MU010';
  elsif p_operation_kind in ('draft_hold','draft_cancel') and not user_has_permission(p_actor_id,'sales') then
    raise exception 'draft operation requires sales' using errcode='MU010';
  elsif p_operation_kind='credit_collection' and not user_has_permission(p_actor_id,'credit_management') then
    raise exception 'credit collection requires credit_management' using errcode='MU010';
  end if;

  -- Operation kind is a server allowlist, not client decoration.
  if exists(
    select 1 from jsonb_array_elements(p_rows) e
    where case p_operation_kind
      when 'sale' then coalesce(e->>'tableName',e->>'table_name') not in
        ('customers','sales','sale_items','credits','credit_reconciliation_states','cash_drawer','inventory_movements','audit_logs','sale_attachments')
      when 'draft_complete' then coalesce(e->>'tableName',e->>'table_name') not in
        ('sale_drafts','sale_draft_items','customers','sales','sale_items','credits','credit_reconciliation_states','cash_drawer','inventory_movements','audit_logs','sale_attachments')
      when 'refund' then coalesce(e->>'tableName',e->>'table_name') not in
        ('sale_refunds','sales_returns','refund_tenders','credits','payments','cash_drawer','inventory_movements','audit_logs','medicines','batches')
      when 'inventory_import' then coalesce(e->>'tableName',e->>'table_name') not in
        ('inventory_imports','medicines','batches','inventory_movements','audit_logs')
      when 'credit_collection' then coalesce(e->>'tableName',e->>'table_name') not in
        ('payments','credit_payment_allocations','credits','cash_drawer')
      when 'draft_hold' then coalesce(e->>'tableName',e->>'table_name') not in
        ('sale_drafts','sale_draft_items')
      when 'draft_cancel' then coalesce(e->>'tableName',e->>'table_name')<>'sale_drafts'
      else true end
  ) then raise exception 'table is not allowed in operation kind' using errcode='MU004'; end if;

  if p_operation_kind in ('sale','draft_complete') then
    select count(*) into v_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='sales';
    select e->'payload' into v_sale from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='sales';
    if v_count<>1 or v_sale is null then raise exception 'sale operation requires one header' using errcode='MU024'; end if;
    if (v_sale->>'id')::uuid<>p_operation_id then
      raise exception 'sale operation id must equal sale id' using errcode='MU024';
    end if;
    if (v_sale->>'discount_amount')::bigint>0
       and not user_has_permission(p_actor_id,'sale_discount') then
      raise exception 'discounted sale requires sale_discount' using errcode='MU010';
    end if;
    if (v_sale->>'discount_amount')::bigint=0 and v_sale->>'discount_type' is not null
       or (v_sale->>'discount_type'='amount' and (v_sale->>'discount_value')::bigint<0)
       or (v_sale->>'discount_type'='percentage' and (v_sale->>'discount_value')::integer not between 0 and 10000)
       or (v_sale->>'discount_type'='amount' and (v_sale->>'discount_amount')::bigint
          <>least((v_sale->>'subtotal')::bigint,(v_sale->>'discount_value')::bigint))
       or (v_sale->>'discount_type'='percentage' and (v_sale->>'discount_amount')::bigint
          <>least((v_sale->>'subtotal')::bigint,
            ((v_sale->>'subtotal')::bigint*(v_sale->>'discount_value')::bigint+5000)/10000))
       or ((v_sale->>'discount_amount')::bigint>0 and coalesce(v_sale->>'discount_type','') not in ('amount','percentage')) then
      raise exception 'sale discount rule is invalid' using errcode='MU024';
    end if;
    if (select coalesce(sum((e->'payload'->>'line_total')::bigint),0)
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='sale_items')
       <>(v_sale->>'total')::bigint then
      raise exception 'sale line totals do not equal header total' using errcode='MU024';
    end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='sale_items' and (
        (e->'payload'->>'sale_id')::uuid<>p_operation_id
        or (e->'payload'->>'qty')::integer<=0
        or (e->'payload'->>'discount_amount')::bigint<0
        or (e->'payload'->>'line_total')::bigint
          <>(e->'payload'->>'unit_price')::bigint*(e->'payload'->>'qty')::integer
            -(e->'payload'->>'discount_amount')::bigint
      )
    ) or (select coalesce(sum((e->'payload'->>'unit_price')::bigint*(e->'payload'->>'qty')::integer),0)
          from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='sale_items')
          <>(v_sale->>'subtotal')::bigint
       or (select coalesce(sum((e->'payload'->>'discount_amount')::bigint),0)
          from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='sale_items')
          <>(v_sale->>'discount_amount')::bigint then
      raise exception 'sale item arithmetic does not match header' using errcode='MU024';
    end if;
    if exists(
      select 1
      from jsonb_array_elements(p_rows) e
      left join batches b on b.id=(e->'payload'->>'batch_id')::uuid
        and b.shop_id=p_shop_id
        and b.medicine_id=(e->'payload'->>'medicine_id')::uuid
        and not b.is_deleted
      where coalesce(e->>'tableName',e->>'table_name')='sale_items'
        and (
          b.id is null
          or (b.expiry_date is not null and b.expiry_date<(v_sale->>'business_date')::date)
          or (e->'payload'->>'promotion_bps')::integer not between 0 and 10000
          or (e->'payload'->>'promotion_amount')::bigint<0
          or (e->'payload'->>'promotion_amount')::bigint
             % (e->'payload'->>'qty')::integer<>0
          or (e->'payload'->>'unit_price')::bigint
             <> (e->'payload'->>'unit_price')::bigint
                + (e->'payload'->>'promotion_amount')::bigint
                  / (e->'payload'->>'qty')::integer
                - (((e->'payload'->>'unit_price')::bigint
                    + (e->'payload'->>'promotion_amount')::bigint
                      / (e->'payload'->>'qty')::integer)
                   * (e->'payload'->>'promotion_bps')::integer + 5000) / 10000
          or (e->'payload'->>'promotion_amount')::bigint
             <> ((((e->'payload'->>'unit_price')::bigint
                    + (e->'payload'->>'promotion_amount')::bigint
                      / (e->'payload'->>'qty')::integer)
                   * (e->'payload'->>'promotion_bps')::integer + 5000) / 10000)
                * (e->'payload'->>'qty')::integer
          or ((e->'payload'->>'promotion_bps')::integer>0 and not exists(
            select 1 from batch_promotions bp
            where bp.shop_id=p_shop_id and bp.batch_id=b.id and not bp.is_deleted
              and bp.discount_bps=(e->'payload'->>'promotion_bps')::integer
              and bp.created_at<=(v_sale->>'created_at')::timestamptz
              and (bp.reversed_at is null or bp.reversed_at>(v_sale->>'created_at')::timestamptz)
          ))
        )
    ) then
      raise exception 'sale batch or promotion snapshot is invalid' using errcode='MU024';
    end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_movements' and (
        e->'payload'->>'reason'<>'sale'
        or (e->'payload'->>'ref_id')::uuid<>p_operation_id
        or (e->'payload'->>'change_qty')::integer>=0
        or (e->'payload'->>'created_by')::uuid<>(v_sale->>'staff_id')::uuid
      )
    ) or exists(
      with expected as (
        select (e->'payload'->>'batch_id')::uuid batch_id,
          sum((e->'payload'->>'qty')::integer) qty
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='sale_items' group by 1
      ), actual as (
        select (e->'payload'->>'batch_id')::uuid batch_id,
          sum(-(e->'payload'->>'change_qty')::integer) qty
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='inventory_movements' group by 1
      )
      select 1 from expected full join actual using(batch_id)
      where coalesce(expected.qty,-1)<>coalesce(actual.qty,-1)
    ) then
      raise exception 'sale stock graph is incomplete' using errcode='MU024';
    end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='credits')
       <>(case when (v_sale->>'credit_amount')::bigint>0 then 1 else 0 end)
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='credits' and (
           (e->'payload'->>'sale_id')::uuid<>p_operation_id
           or (e->'payload'->>'amount')::bigint<>(v_sale->>'credit_amount')::bigint
           or (e->'payload'->>'balance')::bigint<>(v_sale->>'credit_amount')::bigint
         )
       ) then raise exception 'sale credit graph is invalid' using errcode='MU024'; end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='credit_reconciliation_states')
       <>(case when (v_sale->>'credit_amount')::bigint>0 then 1 else 0 end)
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='credit_reconciliation_states' and (
           e->'payload'->>'status'<>'verified'
           or (e->'payload'->>'customer_id')::uuid<>(v_sale->>'customer_id')::uuid
         )
       ) then raise exception 'sale credit reconciliation state is invalid' using errcode='MU024'; end if;
    if (v_sale->>'cash_applied')::bigint>0 and not exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer'
    ) then raise exception 'cash sale requires drawer state' using errcode='MU024'; end if;
    if coalesce(v_sale->>'payment_type','')='free' and exists(
      select 1 from jsonb_array_elements(p_rows) e where coalesce(e->>'tableName',e->>'table_name') in ('credits','payments')
    ) then raise exception 'free sale cannot contain payment or credit rows' using errcode='MU024'; end if;
    if p_operation_kind='draft_complete' then
      if (select count(*) from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='sale_drafts')<>1
         or exists(select 1 from jsonb_array_elements(p_rows) e
          where coalesce(e->>'tableName',e->>'table_name')='sale_drafts' and (
            e->'payload'->>'status'<>'completed'
            or (e->'payload'->>'completed_sale_id')::uuid<>p_operation_id
            or e->'payload'->>'origin_device_id'<>p_device_id
          ))
         or not exists(select 1 from sale_drafts d
          join jsonb_array_elements(p_rows) e on coalesce(e->>'tableName',e->>'table_name')='sale_drafts'
            and (e->'payload'->>'id')::uuid=d.id
          where d.shop_id=p_shop_id and d.origin_device_id=p_device_id
            and d.status in ('draft','held') and not d.is_deleted) then
        raise exception 'draft completion is not bound to an active origin draft' using errcode='MU024';
      end if;
    end if;

  elsif p_operation_kind='refund' then
    select count(*) into v_count from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='sale_refunds';
    select e->'payload' into v_refund from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='sale_refunds';
    if v_count<>1 or v_refund is null or (v_refund->>'id')::uuid<>p_operation_id then
      raise exception 'refund operation requires one deterministic header' using errcode='MU024';
    end if;
    select * into v_claim from refund_claims where id=(v_refund->>'claim_id')::uuid for update;
    if not found or v_claim.shop_id<>p_shop_id or v_claim.sale_id<>(v_refund->>'sale_id')::uuid
       or v_claim.operation_id<>p_operation_id or v_claim.actor_id<>p_actor_id
       or v_claim.device_id<>p_device_id or v_claim.claim_token<>(v_refund->>'claim_token')::uuid
       or v_claim.status not in ('claimed','committed') then
      raise exception 'refund operation does not own its server claim' using errcode='MU020';
    end if;
    if v_claim.status='committed' then return 'applied'; end if;
    if (v_refund->>'sale_id')::uuid<>v_claim.sale_id
       or (v_refund->>'total_amount')::bigint<>(select s.total from sales s where s.id=v_claim.sale_id)
       or (v_refund->>'created_by')::uuid<>p_actor_id
       or length(btrim(coalesce(v_refund->>'reason','')))=0 then
      raise exception 'refund header does not match the claimed sale' using errcode='MU024';
    end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='sales_returns')
       <>(select count(*) from sale_items i where i.sale_id=v_claim.sale_id and not i.is_deleted) then
      raise exception 'refund must return every sale item' using errcode='MU024';
    end if;
    if exists(
      select 1 from sale_items i
      left join lateral (
        select (e->'payload'->>'sale_item_id')::uuid sale_item_id,
          (e->'payload'->>'qty')::integer qty
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='sales_returns'
      ) r on r.sale_item_id=i.id
      where i.sale_id=v_claim.sale_id and not i.is_deleted and (r.sale_item_id is null or r.qty<>i.qty)
    ) then raise exception 'refund item quantities are not full-sale exact' using errcode='MU024'; end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) e
      join sale_items i on i.id=(e->'payload'->>'sale_item_id')::uuid
      where coalesce(e->>'tableName',e->>'table_name')='sales_returns' and (
        i.sale_id<>v_claim.sale_id or i.is_deleted
        or (e->'payload'->>'sale_id')::uuid<>v_claim.sale_id
        or (e->'payload'->>'refund_id')::uuid<>p_operation_id
        or (e->'payload'->>'qty')::integer<>i.qty
        or (e->'payload'->>'refund_amount')::bigint<>i.line_total
        or (e->'payload'->>'created_by')::uuid<>p_actor_id
      )
    ) then raise exception 'refund return rows do not match original items' using errcode='MU024'; end if;
    if (select coalesce(sum((e->'payload'->>'refund_amount')::bigint),0)
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='sales_returns')
       <>(v_refund->>'total_amount')::bigint then
      raise exception 'refund line total mismatch' using errcode='MU024';
    end if;
    if (select coalesce(sum((e->'payload'->>'amount')::bigint),0)
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='refund_tenders')
       <>(v_refund->>'total_amount')::bigint then
      raise exception 'refund tender total mismatch' using errcode='MU024';
    end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_movements' and (
        e->'payload'->>'reason'<>'return'
        or (e->'payload'->>'ref_id')::uuid<>p_operation_id
        or (e->'payload'->>'change_qty')::integer<=0
        or (e->'payload'->>'created_by')::uuid<>p_actor_id
      )
    ) or exists(
      with expected as (
        select i.batch_id,sum(i.qty)::bigint qty from sale_items i
        where i.sale_id=v_claim.sale_id and not i.is_deleted group by i.batch_id
      ), actual as (
        select (e->'payload'->>'batch_id')::uuid batch_id,
          sum((e->'payload'->>'change_qty')::integer)::bigint qty
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='inventory_movements' group by 1
      )
      select 1 from expected full join actual using(batch_id)
      where coalesce(expected.qty,-1)<>coalesce(actual.qty,-1)
    ) then raise exception 'refund stock graph does not restore original batches' using errcode='MU024'; end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='refund_tenders'
          and e->'payload'->>'kind'='cash')
       <>(case when (select s.cash_applied from sales s where s.id=v_claim.sale_id)>0 then 1 else 0 end)
       or (select coalesce(sum((e->'payload'->>'amount')::bigint),0)
           from jsonb_array_elements(p_rows) e
           where coalesce(e->>'tableName',e->>'table_name')='refund_tenders'
             and e->'payload'->>'kind'='cash')
          <>(select s.cash_applied from sales s where s.id=v_claim.sale_id)
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='refund_tenders'
           and e->'payload'->>'kind'='cash'
           and (e->'payload'->>'method'<>'cash' or e->'payload'->>'source_payment_id' is not null)
       ) then raise exception 'refund cash tender does not match original sale' using errcode='MU024'; end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='refund_tenders'
          and e->'payload'->>'kind'='credit_cancel')
       <>(case when exists(select 1 from credits c where c.sale_id=v_claim.sale_id and not c.is_deleted) then 1 else 0 end)
       or (select coalesce(sum((e->'payload'->>'amount')::bigint),0)
           from jsonb_array_elements(p_rows) e
           where coalesce(e->>'tableName',e->>'table_name')='refund_tenders'
             and e->'payload'->>'kind'='credit_cancel')
          <>coalesce((select c.balance from credits c where c.sale_id=v_claim.sale_id and not c.is_deleted),0)
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='refund_tenders'
           and e->'payload'->>'kind'='collection_refund'
           and not exists(
             select 1 from credit_payment_allocations a
             join credits c on c.id=a.credit_id and c.sale_id=v_claim.sale_id
             join payments p on p.id=a.payment_id
             where a.payment_id=(e->'payload'->>'source_payment_id')::uuid
               and a.amount=(e->'payload'->>'amount')::bigint
               and p.method=e->'payload'->>'method' and not a.is_deleted and not c.is_deleted
           )
       ) or exists(
         select 1 from credit_payment_allocations a
         join credits c on c.id=a.credit_id and c.sale_id=v_claim.sale_id
         join payments p on p.id=a.payment_id
         where not a.is_deleted and not c.is_deleted and not exists(
           select 1 from jsonb_array_elements(p_rows) e
           where coalesce(e->>'tableName',e->>'table_name')='refund_tenders'
             and e->'payload'->>'kind'='collection_refund'
             and (e->'payload'->>'source_payment_id')::uuid=a.payment_id
             and (e->'payload'->>'amount')::bigint=a.amount
             and e->'payload'->>'method'=p.method
         )
       ) then raise exception 'refund credit tender graph is invalid' using errcode='MU024'; end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='credits')
       <>(case when exists(select 1 from credits c where c.sale_id=v_claim.sale_id and not c.is_deleted) then 1 else 0 end)
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='credits' and (
           (e->'payload'->>'id')::uuid<>(select c.id from credits c where c.sale_id=v_claim.sale_id and not c.is_deleted)
           or (e->'payload'->>'balance')::bigint<>0
         )
       ) then raise exception 'refund credit mutation is invalid' using errcode='MU024'; end if;
    if exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='refund_tenders'
        and (e->'payload'->>'kind'='cash'
          or (e->'payload'->>'kind'='collection_refund' and e->'payload'->>'method'='cash'))
    ) and not exists(
      select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer'
    ) then raise exception 'cash refund requires drawer state' using errcode='MU024'; end if;
    if not exists(select 1 from cash_drawer d where d.shop_id=p_shop_id
      and d.business_date=(v_refund->>'business_date')::date and d.closed_at is null and not d.is_deleted) then
      raise exception 'refund business day is not open' using errcode='MU022';
    end if;

  elsif p_operation_kind='credit_collection' then
    select e->'payload' into v_sale from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='payments';
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='payments')<>1
       or (v_sale->>'id')::uuid<>p_operation_id
       or v_sale->>'type'<>'customer_payment'
       or (v_sale->>'created_by')::uuid<>p_actor_id
       or (v_sale->>'amount')::bigint<=0 then
      raise exception 'credit collection requires one bound payment' using errcode='MU024';
    end if;
    if (select coalesce(sum((e->'payload'->>'amount')::bigint),0)
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='credit_payment_allocations')
       <>(v_sale->>'amount')::bigint
       or exists(
         select 1 from jsonb_array_elements(p_rows) e
         where coalesce(e->>'tableName',e->>'table_name')='credit_payment_allocations' and (
           (e->'payload'->>'payment_id')::uuid<>p_operation_id
           or (e->'payload'->>'customer_id')::uuid<>(v_sale->>'party_id')::uuid
           or (e->'payload'->>'amount')::bigint<=0
           or not exists(select 1 from credits c where c.id=(e->'payload'->>'credit_id')::uuid
             and c.shop_id=p_shop_id and c.customer_id=(v_sale->>'party_id')::uuid and not c.is_deleted)
         )
       ) then raise exception 'credit collection allocations are invalid' using errcode='MU024'; end if;
    if exists(
      with allocated as (
        select (e->'payload'->>'credit_id')::uuid credit_id,
          sum((e->'payload'->>'amount')::bigint) amount
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='credit_payment_allocations' group by 1
      ), changed as (
        select (e->'payload'->>'id')::uuid credit_id,(e->'payload'->>'balance')::bigint balance
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='credits'
      )
      select 1 from allocated a full join changed ch using(credit_id)
      left join credits c on c.id=coalesce(a.credit_id,ch.credit_id) and c.shop_id=p_shop_id
      where a.credit_id is null or ch.credit_id is null or ch.balance<>c.balance-a.amount
    ) then raise exception 'credit collection balances are invalid' using errcode='MU024'; end if;
    if not exists(select 1 from credit_reconciliation_states r
      where r.shop_id=p_shop_id and r.customer_id=(v_sale->>'party_id')::uuid
        and r.status='verified' and not r.is_deleted) then
      raise exception 'credit collection requires verified reconciliation' using errcode='MU023';
    end if;
    if v_sale->>'method'='cash' and not exists(select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='cash_drawer') then
      raise exception 'cash credit collection requires drawer state' using errcode='MU024';
    end if;

  elsif p_operation_kind in ('draft_hold','draft_cancel') then
    select e->'payload' into v_sale from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='sale_drafts';
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='sale_drafts')<>1
       or (v_sale->>'id')::uuid<>p_operation_id
       or v_sale->>'origin_device_id'<>p_device_id
       or (p_operation_kind='draft_hold' and v_sale->>'status'<>'held')
       or (p_operation_kind='draft_cancel' and v_sale->>'status'<>'cancelled') then
      raise exception 'invalid bound draft operation' using errcode='MU024';
    end if;
    if p_operation_kind='draft_hold' and (
      not exists(select 1 from jsonb_array_elements(p_rows) e where coalesce(e->>'tableName',e->>'table_name')='sale_draft_items')
      or exists(select 1 from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='sale_draft_items'
          and ((e->'payload'->>'draft_id')::uuid<>p_operation_id or (e->'payload'->>'qty')::integer<=0))
    ) then raise exception 'held draft items are invalid' using errcode='MU024'; end if;
    if p_operation_kind='draft_hold' and exists(
      select 1 from (
        select e->'payload'->>'medicine_id' medicine_id,count(*) count
        from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='sale_draft_items'
        group by 1 having count(*)<>1
      ) duplicates
    ) then raise exception 'held draft medicines must be unique' using errcode='MU024'; end if;
    if p_operation_kind='draft_cancel' and not exists(select 1 from sale_drafts d
      where d.id=p_operation_id and d.shop_id=p_shop_id and d.origin_device_id=p_device_id
        and d.status in ('draft','held') and not d.is_deleted) then
      raise exception 'only the origin device may cancel an active draft' using errcode='MU024';
    end if;

  elsif p_operation_kind='inventory_import' then
    select e->'payload' into v_sale from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_imports';
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='inventory_imports')<>1
       or (v_sale->>'id')::uuid<>p_operation_id
       or (v_sale->>'created_by')::uuid<>p_actor_id
       or v_sale->>'status'<>'committed'
       or (v_sale->>'row_count')::integer<1
       or (select count(*) from jsonb_array_elements(p_rows) e
           where coalesce(e->>'tableName',e->>'table_name')='batches')<>(v_sale->>'row_count')::integer then
      raise exception 'CSV operation requires one import header' using errcode='MU024';
    end if;
    if exists(select 1 from jsonb_array_elements(p_rows) e
      where coalesce(e->>'tableName',e->>'table_name')='inventory_movements'
        and (e->'payload'->>'reason'<>'csv_import' or (e->'payload'->>'ref_id')::uuid<>p_operation_id)) then
      raise exception 'CSV stock must use bound csv_import movements' using errcode='MU024';
    end if;
    if (select count(*) from jsonb_array_elements(p_rows) e
        where coalesce(e->>'tableName',e->>'table_name')='audit_logs')<>1 then
      raise exception 'CSV operation requires one audit event' using errcode='MU024';
    end if;
  end if;

  -- Parent-first ordering keeps every FK inside this one transaction.
  for v_entry in
    select e.value from jsonb_array_elements(p_rows) with ordinality e(value,ord)
    order by case coalesce(e.value->>'tableName',e.value->>'table_name')
      when 'inventory_imports' then 5 when 'customers' then 10 when 'credit_reconciliation_states' then 15 when 'medicines' then 20
      when 'batches' then 30 when 'sale_drafts' then 35 when 'sales' then 40
      when 'sale_draft_items' then 45 when 'sale_items' then 50 when 'sale_refunds' then 60
      when 'sales_returns' then 70 when 'refund_tenders' then 75 when 'payments' then 80
      when 'credit_payment_allocations' then 85 when 'credits' then 90 when 'cash_drawer' then 95 when 'inventory_movements' then 100
      when 'sale_attachments' then 110 when 'audit_logs' then 120 else 95 end,
      e.ord
  loop
    v_table:=coalesce(v_entry.value->>'tableName',v_entry.value->>'table_name');
    v_op:=v_entry.value->>'op';
    v_payload:=v_entry.value->'payload';
    if v_payload is null or jsonb_typeof(v_payload)<>'object'
       or coalesce(v_entry.value->>'rowId',v_entry.value->>'row_id')<>v_payload->>'id'
       or v_payload->>'shop_id'<>p_shop_id::text then
      raise exception 'invalid or cross-shop operation row' using errcode='MU003';
    end if;
    -- Refund reactivation rows are metadata signals only. Do not apply their
    -- client-supplied full row: prove the ancestor belongs to the claimed sale,
    -- then clear only the archive markers server-side.
    if p_operation_kind='refund' and v_table='batches' then
      if v_op<>'update' or coalesce((v_payload->>'is_deleted')::boolean,true)
         or not exists(select 1 from sale_items i where i.sale_id=v_claim.sale_id
           and i.batch_id=(v_payload->>'id')::uuid and i.shop_id=p_shop_id) then
        raise exception 'invalid refund batch reactivation' using errcode='MU024';
      end if;
      update batches set is_deleted=false,deleted_at=null,deleted_by=null,
        updated_at=greatest(updated_at,(v_payload->>'updated_at')::timestamptz)
      where id=(v_payload->>'id')::uuid and shop_id=p_shop_id;
      continue;
    elsif p_operation_kind='refund' and v_table='medicines' then
      if v_op<>'update' or coalesce((v_payload->>'is_deleted')::boolean,true)
         or not exists(select 1 from sale_items i join batches b on b.id=i.batch_id
           where i.sale_id=v_claim.sale_id and b.medicine_id=(v_payload->>'id')::uuid
             and i.shop_id=p_shop_id and b.shop_id=p_shop_id) then
        raise exception 'invalid refund medicine reactivation' using errcode='MU024';
      end if;
      update medicines set is_deleted=false,deleted_at=null,deleted_by=null,
        updated_at=greatest(updated_at,(v_payload->>'updated_at')::timestamptz)
      where id=(v_payload->>'id')::uuid and shop_id=p_shop_id;
      continue;
    end if;
    if not sync_row_permitted(p_actor_id,v_table,v_payload)
       and not (p_operation_kind in ('sale','draft_complete') and v_table='credit_reconciliation_states') then
      raise exception 'operation contains unauthorized row' using errcode='MU010';
    end if;
    if v_table in ('sales','sale_items','sale_refunds','sales_returns','refund_tenders',
      'inventory_movements','inventory_imports') and v_op<>'insert' then
      raise exception 'operation financial and ledger rows are insert-only' using errcode='MU001';
    end if;
    v_result:=sync_apply_row(v_table,v_op,v_payload,p_shop_id,p_actor_id,p_device_id);
    if v_result<>'applied' then raise exception 'operation row rejected: %',v_result using errcode='MU024'; end if;
  end loop;

  if p_operation_kind='refund' then
    update refund_claims set status='committed',committed_at=now()
    where id=v_claim.id and status='claimed';
  end if;
  return 'applied';
end
$fn$;

create or replace function sync_stage_operation_chunk(
  p_shop_id uuid,p_operation_id uuid,p_operation_kind text,p_actor_id uuid,p_device_id text,
  p_expected_row_count integer,p_payload_hash text,p_sequence integer,p_chunk_hash text,p_rows jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare
  v_header sync_operation_staging%rowtype;
  v_existing sync_operation_chunks%rowtype;
  v_all_rows jsonb;
  v_received integer;
  v_server_chunk_hash text;
  v_server_payload_hash text;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0
     or p_expected_row_count not between 1 and 10000
     or jsonb_array_length(p_rows)>p_expected_row_count then
    raise exception 'invalid operation chunk shape' using errcode='MU024';
  end if;
  -- Client hashes are transport diagnostics only. Conflict detection uses a
  -- digest derived here from the canonical jsonb representation, so a caller
  -- cannot make two different chunks look identical by reusing a hash.
  v_server_chunk_hash:=md5('muthoy-b2-0:'||p_rows::text)||md5('muthoy-b2-1:'||p_rows::text);
  insert into sync_operation_staging(operation_id,shop_id,operation_kind,actor_id,device_id,
    expected_row_count,payload_hash)
  values(p_operation_id,p_shop_id,p_operation_kind,p_actor_id,p_device_id,p_expected_row_count,p_payload_hash)
  on conflict(operation_id) do nothing;
  select * into v_header from sync_operation_staging where operation_id=p_operation_id for update;
  if v_header.shop_id<>p_shop_id or v_header.operation_kind<>p_operation_kind
     or v_header.actor_id<>p_actor_id or v_header.device_id<>p_device_id
     or v_header.expected_row_count<>p_expected_row_count then
    raise exception 'conflicting operation retry' using errcode='MU025';
  end if;
  if v_header.status='applied' then
    return jsonb_build_object('status','applied','receivedRowCount',v_header.received_row_count);
  end if;
  select * into v_existing from sync_operation_chunks
    where operation_id=p_operation_id and sequence=p_sequence;
  if found and (v_existing.chunk_hash<>v_server_chunk_hash or v_existing.rows<>p_rows) then
    raise exception 'conflicting operation chunk retry' using errcode='MU025';
  end if;
  insert into sync_operation_chunks(operation_id,sequence,row_count,chunk_hash,rows)
  values(p_operation_id,p_sequence,jsonb_array_length(p_rows),v_server_chunk_hash,p_rows)
  on conflict(operation_id,sequence) do nothing;
  select coalesce(sum(row_count),0) into v_received from sync_operation_chunks
    where operation_id=p_operation_id;
  if v_received>p_expected_row_count then
    raise exception 'operation received more rows than declared' using errcode='MU025';
  end if;
  update sync_operation_staging set received_row_count=v_received,updated_at=now()
    where operation_id=p_operation_id;
  if v_received<p_expected_row_count then
    return jsonb_build_object('status','staged','receivedRowCount',v_received);
  end if;
  select jsonb_agg(e.value order by c.sequence,e.ordinality) into v_all_rows
  from sync_operation_chunks c
  cross join lateral jsonb_array_elements(c.rows) with ordinality e(value,ordinality)
  where c.operation_id=p_operation_id;
  v_server_payload_hash:=md5('muthoy-b2-0:'||v_all_rows::text)||md5('muthoy-b2-1:'||v_all_rows::text);
  update sync_operation_staging set status='applying',updated_at=now() where operation_id=p_operation_id;
  perform sync_apply_operation(p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,v_all_rows);
  update sync_operation_staging set status='applied',received_row_count=v_received,
    payload_hash=v_server_payload_hash,updated_at=now(),applied_at=now()
    where operation_id=p_operation_id;
  return jsonb_build_object('status','applied','receivedRowCount',v_received);
end
$fn$;

create or replace function sync_cleanup_incomplete_operations()
returns integer language plpgsql security definer set search_path=public as $fn$
declare v_count integer;
begin
  delete from sync_operation_staging
  where status in ('staging','rejected') and updated_at<now()-interval '7 days';
  get diagnostics v_count=row_count;
  return v_count;
end
$fn$;

revoke execute on function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
revoke execute on function sync_stage_operation_chunk(uuid,uuid,text,uuid,text,integer,text,integer,text,jsonb) from public,anon,authenticated;
revoke execute on function sync_cleanup_incomplete_operations() from public,anon,authenticated;
grant execute on function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb),
  sync_stage_operation_chunk(uuid,uuid,text,uuid,text,integer,text,integer,text,jsonb),
  sync_cleanup_incomplete_operations() to service_role;

-- Supabase projects with pg_cron enabled clean abandoned staging graphs daily.
-- The function stays callable by service_role for projects where pg_cron is
-- unavailable and operational scheduling is external.
do $schedule$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute 'select cron.schedule(''muthoy-b2-sync-staging-cleanup'', ''17 3 * * *'', ''select public.sync_cleanup_incomplete_operations();'')';
  end if;
exception when unique_violation then
  null;
end
$schedule$;

-- Apply valid late movements even when metadata was archived. The ledger delta
-- always lands; archived ancestors are then reactivated for reconciliation.
create or replace function b2_reactivate_late_movement()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_medicine_id uuid; v_batch_count integer; v_medicine_count integer;
begin
  select medicine_id into v_medicine_id from batches where id=new.batch_id and shop_id=new.shop_id;
  update batches set is_deleted=false,deleted_at=null,deleted_by=null,updated_at=greatest(updated_at,new.updated_at)
    where id=new.batch_id and is_deleted;
  get diagnostics v_batch_count=row_count;
  update medicines set is_deleted=false,deleted_at=null,deleted_by=null,updated_at=greatest(updated_at,new.updated_at)
    where id=v_medicine_id and is_deleted;
  get diagnostics v_medicine_count=row_count;
  if v_batch_count>0 or v_medicine_count>0 then
    insert into audit_logs(id,shop_id,actor_id,action,target,meta,created_at,updated_at)
    values(new.id,new.shop_id,new.created_by,
      'archived_batch_reactivated',new.batch_id,
      jsonb_build_object('movementId',new.id,'medicineId',v_medicine_id)::text,new.updated_at,new.updated_at)
    on conflict(id) do nothing;
  end if;
  return new;
end
$fn$;
create trigger inventory_movement_reactivates_archived
after insert on inventory_movements for each row execute function b2_reactivate_late_movement();
revoke execute on function b2_reactivate_late_movement() from public,anon,authenticated;

-- Tighten direct history reads for the new refund/attachment graph and Owner
-- import data. The Edge pull below applies the same predicates before rows can
-- enter SQLite.
drop policy if exists b2_shop_read on sale_refunds;
create policy b2_refund_history_read on sale_refunds for select using (
  shop_id=nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and exists(select 1 from sales s where s.id=sale_refunds.sale_id and s.shop_id=sale_refunds.shop_id
    and (auth_has_permission('sale_history')
      or s.staff_id=nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);
drop policy if exists b2_shop_read on refund_tenders;
create policy b2_refund_tender_history_read on refund_tenders for select using (
  shop_id=nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and exists(select 1 from sale_refunds r join sales s on s.id=r.sale_id
    where r.id=refund_tenders.refund_id and r.shop_id=refund_tenders.shop_id
      and (auth_has_permission('sale_history')
        or s.staff_id=nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);
drop policy if exists b2_shop_read on sale_attachments;
create policy b2_attachment_history_read on sale_attachments for select using (
  shop_id=nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and exists(select 1 from sales s where s.id=sale_attachments.sale_id and s.shop_id=sale_attachments.shop_id
    and (auth_has_permission('sale_history')
      or s.staff_id=nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);
drop policy if exists b2_shop_read on inventory_imports;
create policy b2_owner_import_read on inventory_imports for select using (
  shop_id=nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid and auth_is_owner()
);
drop policy if exists muthoy_read on sales_returns;
drop policy if exists shop_isolation on sales_returns;
create policy b2_returns_history_read on sales_returns for select using (
  shop_id=nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
  and exists(select 1 from sales s where s.id=sales_returns.sale_id and s.shop_id=sales_returns.shop_id
    and (auth_has_permission('sale_history')
      or s.staff_id=nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid))
);

create or replace function sync_pull_changes_b2(
  p_shop_id uuid,p_app_user_id uuid,p_since_updated_at timestamptz,
  p_since_table text,p_since_id uuid,p_limit integer
)
returns table(table_name text,row_id uuid,updated_at timestamptz,row_data jsonb)
language sql security definer set search_path=public as $fn$
  with caller as (
    select b2_user_is_owner(p_app_user_id) is_owner,
      user_has_permission(p_app_user_id,'sale_history') can_history
    where exists(select 1 from users u where u.id=p_app_user_id and u.shop_id=p_shop_id
      and u.is_active and not u.is_deleted)
  ), all_changes as (
    select 'shops'::text table_name,id row_id,updated_at,to_jsonb(t.*) row_data from shops t where id=p_shop_id
    union all select 'subscriptions',id,updated_at,to_jsonb(t.*) from subscriptions t where shop_id=p_shop_id
    union all select 'roles',id,updated_at,to_jsonb(t.*) from roles t where shop_id=p_shop_id
    union all select 'permissions',id,updated_at,to_jsonb(t.*) from permissions t where role_id in(select id from roles where shop_id=p_shop_id)
    union all select 'users',id,updated_at,to_jsonb(t.*) from users t where shop_id=p_shop_id
    union all select 'user_permissions',id,updated_at,to_jsonb(t.*) from user_permissions t where shop_id=p_shop_id
    union all select 'shop_b2_settings',id,updated_at,to_jsonb(t.*) from shop_b2_settings t where shop_id=p_shop_id
    union all select 'medicines',id,updated_at,to_jsonb(t.*) from medicines t where shop_id=p_shop_id
    union all select 'batches',id,updated_at,to_jsonb(t.*) from batches t where shop_id=p_shop_id
    union all select 'batch_promotions',id,updated_at,to_jsonb(t.*) from batch_promotions t where shop_id=p_shop_id
    union all select 'inventory_movements',id,updated_at,to_jsonb(t.*) from inventory_movements t where shop_id=p_shop_id
    union all select 'customers',id,updated_at,to_jsonb(t.*) from customers t where shop_id=p_shop_id
    union all select 'sales',id,updated_at,to_jsonb(t.*) from sales t where shop_id=p_shop_id
      and exists(select 1 from caller c where c.can_history or t.staff_id=p_app_user_id)
    union all select 'sale_items',id,updated_at,to_jsonb(t.*) from sale_items t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sale_drafts',id,updated_at,to_jsonb(t.*) from sale_drafts t where shop_id=p_shop_id
    union all select 'sale_draft_items',id,updated_at,to_jsonb(t.*) from sale_draft_items t where shop_id=p_shop_id
    union all select 'sale_attachments',id,updated_at,to_jsonb(t.*) from sale_attachments t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sale_refunds',id,updated_at,to_jsonb(t.*) from sale_refunds t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'sales_returns',id,updated_at,to_jsonb(t.*) from sales_returns t where shop_id=p_shop_id
      and exists(select 1 from sales s, caller c where s.id=t.sale_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'refund_tenders',id,updated_at,to_jsonb(t.*) from refund_tenders t where shop_id=p_shop_id
      and exists(select 1 from sale_refunds r join sales s on s.id=r.sale_id cross join caller c
        where r.id=t.refund_id and (c.can_history or s.staff_id=p_app_user_id))
    union all select 'suppliers',id,updated_at,to_jsonb(t.*) from suppliers t where shop_id=p_shop_id
    union all select 'purchases',id,updated_at,to_jsonb(t.*) from purchases t where shop_id=p_shop_id
    union all select 'purchase_items',id,updated_at,to_jsonb(t.*) from purchase_items t where shop_id=p_shop_id
    union all select 'purchase_returns',id,updated_at,to_jsonb(t.*) from purchase_returns t where shop_id=p_shop_id
    union all select 'credits',id,updated_at,to_jsonb(t.*) from credits t where shop_id=p_shop_id
    union all select 'credit_payment_allocations',id,updated_at,to_jsonb(t.*) from credit_payment_allocations t where shop_id=p_shop_id
    union all select 'credit_reconciliation_states',id,updated_at,to_jsonb(t.*) from credit_reconciliation_states t where shop_id=p_shop_id
    union all select 'expenses',id,updated_at,to_jsonb(t.*) from expenses t where shop_id=p_shop_id
    union all select 'payments',id,updated_at,to_jsonb(t.*) from payments t where shop_id=p_shop_id
    union all select 'cash_drawer',id,updated_at,to_jsonb(t.*) from cash_drawer t where shop_id=p_shop_id
    union all select 'inventory_imports',id,updated_at,to_jsonb(t.*) from inventory_imports t where shop_id=p_shop_id
      and exists(select 1 from caller c where c.is_owner)
    union all select 'audit_logs',id,updated_at,to_jsonb(t.*) from audit_logs t where shop_id=p_shop_id
      and exists(select 1 from caller c where c.is_owner)
  )
  select a.table_name,a.row_id,a.updated_at,a.row_data from all_changes a
  where exists(select 1 from caller)
    and (p_since_updated_at is null or (a.updated_at,a.table_name,a.row_id)>
      (p_since_updated_at,coalesce(p_since_table,''),coalesce(p_since_id,'00000000-0000-0000-0000-000000000000'::uuid)))
  order by a.updated_at,a.table_name,a.row_id limit p_limit
$fn$;

revoke execute on function sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)
  from public,anon,authenticated;
grant execute on function sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)
  to service_role;
