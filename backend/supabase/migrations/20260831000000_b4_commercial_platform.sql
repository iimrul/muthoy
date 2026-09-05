-- B4 commercial platform. Local file only; remote execution is intentionally deferred.

create table plan_offerings (
  tier text not null,
  billing_cycle text not null,
  amount_paisa bigint not null check (amount_paisa >= 0),
  currency text not null default 'BDT' check (currency = 'BDT'),
  max_active_shops integer check (max_active_shops is null or max_active_shops > 0),
  max_active_non_owner_staff_per_shop integer check (
    max_active_non_owner_staff_per_shop is null or max_active_non_owner_staff_per_shop > 0
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tier, billing_cycle),
  check (tier in ('free','pro','ultra')),
  check (billing_cycle in ('monthly','annual'))
);

insert into plan_offerings(
  tier,billing_cycle,amount_paisa,max_active_shops,max_active_non_owner_staff_per_shop
) values
  ('free','monthly',0,1,1),
  ('free','annual',0,1,1),
  ('pro','monthly',39900,3,4),
  ('pro','annual',383000,3,4),
  ('ultra','monthly',49900,null,null),
  ('ultra','annual',479000,null,null);

create table billing_accounts (
  id uuid primary key default gen_random_uuid(),
  principal_owner_user_id uuid not null unique references users(id) on delete restrict,
  primary_shop_id uuid not null references shops(id) on delete restrict,
  launch_trial_granted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table shops
  add column billing_account_id uuid references billing_accounts(id) on delete restrict,
  add column commercial_status text not null default 'active'
    check (commercial_status in ('active','read_only')),
  add column commercial_reason text,
  add column archived_at timestamptz;

create index shops_billing_active_idx
  on shops(billing_account_id,commercial_status,created_at,id)
  where is_deleted=false and archived_at is null;

alter table users
  add column plan_suspended_at timestamptz,
  add column plan_suspension_reason text;
create index users_shop_plan_active_idx
  on users(shop_id,created_at,id)
  where is_deleted=false and is_active=true and plan_suspended_at is null;

insert into billing_accounts(principal_owner_user_id,primary_shop_id,launch_trial_granted_at)
select u.id,u.shop_id,now()
from users u
join roles r on r.id=u.role_id and r.name='owner' and r.is_deleted=false
where u.is_deleted=false
on conflict(principal_owner_user_id) do nothing;

update shops s set billing_account_id=b.id
from billing_accounts b where b.primary_shop_id=s.id and s.billing_account_id is null;

create table shop_memberships (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references billing_accounts(id) on delete cascade,
  principal_user_id uuid not null references users(id) on delete restrict,
  shop_id uuid not null references shops(id) on delete restrict,
  actor_user_id uuid not null references users(id) on delete restrict,
  role text not null check (role in ('owner','manager','staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(principal_user_id,shop_id),
  unique(actor_user_id,shop_id)
);
create index shop_memberships_principal_active_idx
  on shop_memberships(principal_user_id,is_active,shop_id);
create index shop_memberships_billing_active_idx
  on shop_memberships(billing_account_id,is_active,shop_id);

insert into shop_memberships(
  billing_account_id,principal_user_id,shop_id,actor_user_id,role
)
select s.billing_account_id,u.id,u.shop_id,u.id,r.name
from users u
join shops s on s.id=u.shop_id
join roles r on r.id=u.role_id
where u.is_deleted=false
on conflict(principal_user_id,shop_id) do nothing;

create table billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references billing_accounts(id) on delete cascade,
  tier text not null check (tier in ('pro','ultra')),
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  status text not null check (status in ('active','past_due','grace','canceled','expired')),
  starts_at timestamptz not null,
  paid_through timestamptz not null,
  grace_ends_at timestamptz,
  canceled_at timestamptz,
  provider text not null check (provider='sslcommerz'),
  provider_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index billing_subscriptions_current_idx
  on billing_subscriptions(billing_account_id)
  where status in ('active','past_due','grace','canceled');
create index billing_subscriptions_account_idx
  on billing_subscriptions(billing_account_id,updated_at desc);

create table entitlement_snapshots (
  billing_account_id uuid primary key references billing_accounts(id) on delete cascade,
  tier text not null check (tier in ('free','pro','ultra')),
  status text not null check (status in ('trialing','active','past_due','grace','canceled','expired')),
  trial_ends_at timestamptz,
  paid_through timestamptz,
  grace_ends_at timestamptz,
  verified_at timestamptz not null,
  version bigint not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  check ((status='trialing' and trial_ends_at is not null) or status<>'trialing')
);
create index entitlement_snapshots_verification_idx on entitlement_snapshots(verified_at);

insert into entitlement_snapshots(
  billing_account_id,tier,status,trial_ends_at,verified_at
)
select id,'free','trialing',launch_trial_granted_at + interval '14 days',now()
from billing_accounts
on conflict(billing_account_id) do nothing;

update shops s set plan=e.tier,trial_ends_at=e.trial_ends_at
from entitlement_snapshots e where e.billing_account_id=s.billing_account_id;

create table payment_orders (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references billing_accounts(id) on delete restrict,
  requested_by_principal_user_id uuid not null references users(id) on delete restrict,
  client_request_id uuid not null,
  tier text not null check (tier in ('pro','ultra')),
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  amount_paisa bigint not null check (amount_paisa > 0),
  currency text not null default 'BDT' check (currency='BDT'),
  provider text not null default 'sslcommerz' check (provider='sslcommerz'),
  status text not null default 'created'
    check (status in ('created','pending','verified','failed','canceled','expired')),
  provider_session_key text,
  provider_transaction_id text unique,
  checkout_url text,
  failure_code text,
  expires_at timestamptz not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(billing_account_id,client_request_id)
);
create index payment_orders_account_status_idx
  on payment_orders(billing_account_id,status,created_at desc);
create unique index payment_orders_one_open_idx
  on payment_orders(billing_account_id) where status in ('created','pending');

create table payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider='sslcommerz'),
  event_key text not null,
  payment_order_id uuid references payment_orders(id) on delete restrict,
  validation_id text,
  payload jsonb not null,
  processing_status text not null default 'received'
    check (processing_status in ('received','verified','rejected','failed')),
  error_code text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(provider,event_key),
  unique(provider,validation_id)
);
create index payment_provider_events_order_idx on payment_provider_events(payment_order_id,received_at);

-- Server-owned commercial tables have no client policy. Edge Functions use service_role.
alter table plan_offerings enable row level security;
alter table billing_accounts enable row level security;
alter table shop_memberships enable row level security;
alter table billing_subscriptions enable row level security;
alter table entitlement_snapshots enable row level security;
alter table payment_orders enable row level security;
alter table payment_provider_events enable row level security;
revoke all on plan_offerings,billing_accounts,shop_memberships,billing_subscriptions,
  entitlement_snapshots,payment_orders,payment_provider_events from public,anon,authenticated;
grant select,insert,update on plan_offerings,billing_accounts,shop_memberships,billing_subscriptions,
  entitlement_snapshots,payment_orders,payment_provider_events to service_role;
grant select on table plan_offerings to service_role;
grant select on table billing_accounts to service_role;
grant select on table shop_memberships to service_role;
grant select on table entitlement_snapshots to service_role;
grant select on table payment_orders to service_role;
grant select on table payment_provider_events to service_role;

-- Legacy per-shop subscriptions remain pull-compatible, but cease to be writable.
revoke insert,update,delete on subscriptions from public,anon,authenticated;

create or replace function b4_protect_commercial_columns()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if current_user in ('authenticated','anon') then
    if tg_op='INSERT' and (
      new.plan is distinct from 'free' or new.trial_ends_at is not null or
      new.billing_account_id is not null or new.commercial_status is distinct from 'active' or
      new.commercial_reason is not null or new.archived_at is not null
    ) then
      raise exception 'commercial fields are server-owned' using errcode='MU030';
    elsif tg_op='UPDATE' and (
      new.plan is distinct from old.plan or
      new.trial_ends_at is distinct from old.trial_ends_at or
      new.billing_account_id is distinct from old.billing_account_id or
      new.commercial_status is distinct from old.commercial_status or
      new.commercial_reason is distinct from old.commercial_reason or
      new.archived_at is distinct from old.archived_at
    ) then
      raise exception 'commercial fields are server-owned' using errcode='MU030';
    end if;
  end if;
  return new;
end
$fn$;
create trigger shops_commercial_columns_server_owned
before insert or update on shops for each row execute function b4_protect_commercial_columns();

create or replace function b4_protect_user_commercial_columns()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if current_user in ('authenticated','anon') and (
    new.plan_suspended_at is distinct from old.plan_suspended_at or
    new.plan_suspension_reason is distinct from old.plan_suspension_reason
  ) then
    raise exception 'commercial fields are server-owned' using errcode='MU030';
  end if;
  return new;
end
$fn$;
create trigger users_commercial_columns_server_owned
before update on users for each row execute function b4_protect_user_commercial_columns();

create or replace function b4_reject_legacy_subscription_write()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if current_user in ('authenticated','anon') then
    raise exception 'subscriptions are server-owned' using errcode='MU030';
  end if;
  return coalesce(new,old);
end
$fn$;
create trigger subscriptions_server_owned
before insert or update or delete on subscriptions
for each row execute function b4_reject_legacy_subscription_write();

create or replace function b4_user_has_premium(p_app_user_id uuid,p_now timestamptz default now())
returns boolean language sql stable security definer set search_path=public as $fn$
  select coalesce((
    select case
      when e.status='trialing' and e.trial_ends_at>p_now then true
      when e.tier in ('pro','ultra') and e.status in ('active','canceled') and e.paid_through>p_now then true
      when e.tier in ('pro','ultra') and e.status in ('active','past_due','grace') and e.grace_ends_at>p_now then true
      else false end
    from users u join shops s on s.id=u.shop_id
    join entitlement_snapshots e on e.billing_account_id=s.billing_account_id
    where u.id=p_app_user_id
  ),false)
$fn$;

create or replace function b4_user_within_current_staff_limit(
  p_app_user_id uuid,p_now timestamptz default now()
) returns boolean language plpgsql stable security definer set search_path=public as $fn$
declare v_user users%rowtype; v_role text; v_account uuid; v_tier text:='free'; v_limit integer; v_ordinal integer;
begin
  select * into v_user from users
  where id=p_app_user_id and is_active and not is_deleted;
  if not found then return false; end if;
  select name into v_role from roles
  where id=v_user.role_id and shop_id=v_user.shop_id and not is_deleted;
  if not found then return false; end if;
  if v_role='owner' then return true; end if;
  select billing_account_id into v_account from shops
  where id=v_user.shop_id and not is_deleted and archived_at is null;
  -- A shop created by the existing onboarding flow may briefly precede its
  -- owner billing-account bootstrap. Preserve Free/base operation during that
  -- bounded handover; premium checks still fail closed without entitlement.
  if v_account is null then return true; end if;
  select case when status='trialing' and trial_ends_at>p_now then 'ultra'
    when status in ('active','canceled') and paid_through>p_now then tier
    when status in ('active','past_due','grace') and grace_ends_at>p_now then tier
    else 'free' end into v_tier
  from entitlement_snapshots where billing_account_id=v_account;
  select max_active_non_owner_staff_per_shop into v_limit from plan_offerings
  where tier=coalesce(v_tier,'free') and billing_cycle='monthly';
  if v_limit is null then return true; end if;
  select ordinal into v_ordinal from (
    select u.id,row_number() over(order by u.created_at,u.id) ordinal
    from users u join roles r on r.id=u.role_id
    where u.shop_id=v_user.shop_id and u.is_active and not u.is_deleted and r.name<>'owner'
  ) ranked where id=p_app_user_id;
  return coalesce(v_ordinal<=v_limit,false);
end
$fn$;

-- Existing permission/RLS helpers must fail closed for plan suspension and
-- archived shops too; Edge-only checks are not enough because PostgREST grants
-- still exist for the synced tables.
create or replace function user_has_permission(p_app_user_id uuid,p_key text)
returns boolean language sql stable security definer set search_path=public as $fn$
  select coalesce((
    select case
      when not u.is_active or u.is_deleted or u.plan_suspended_at is not null
        or s.is_deleted or s.archived_at is not null then false
      when not b4_user_within_current_staff_limit(u.id) then false
      when r.name='owner' then true
      when r.name not in ('manager','staff') then false
      else coalesce((select up.allowed from user_permissions up
        where up.user_id=u.id and up.shop_id=u.shop_id and up.key=p_key and not up.is_deleted limit 1),
        case when r.name='manager' then p_key in (
          'sales','sale_discount','sale_return','sale_history',
          'inventory_view','inventory_write','expiry_manage',
          'credit_view','credit_management','cash_management','reports'
        ) else p_key in ('sales','inventory_view') end) end
    from users u join roles r on r.id=u.role_id and r.shop_id=u.shop_id and not r.is_deleted
    join shops s on s.id=u.shop_id
    where u.id=p_app_user_id
  ),false)
$fn$;

create or replace function auth_is_live_user()
returns boolean language sql stable security definer set search_path=public as $fn$
  select exists(
    select 1 from users u join shops s on s.id=u.shop_id
    join shop_memberships m on m.actor_user_id=u.id and m.shop_id=u.shop_id and m.is_active
    where u.id=nullif(auth.jwt()->'app_metadata'->>'app_user_id','')::uuid
      and u.shop_id=nullif(auth.jwt()->'app_metadata'->>'shop_id','')::uuid
      and m.principal_user_id=coalesce(
        nullif(auth.jwt()->'app_metadata'->>'principal_user_id','')::uuid,u.id)
      and u.is_active and not u.is_deleted and u.plan_suspended_at is null
      and b4_user_within_current_staff_limit(u.id)
      and not s.is_deleted and s.archived_at is null
  )
$fn$;

create or replace function b4_staff_row_within_limit(p_row jsonb,p_now timestamptz default now())
returns boolean language plpgsql volatile security definer set search_path=public as $fn$
declare
  v_id uuid:=(p_row->>'id')::uuid;
  v_shop uuid;
  v_role text;
  v_was_active boolean;
  v_will_active boolean;
  v_account uuid;
  v_tier text:='free';
  v_limit integer;
  v_count integer;
begin
  select u.shop_id,u.is_active into v_shop,v_was_active from users u where u.id=v_id;
  v_shop:=coalesce((p_row->>'shop_id')::uuid,v_shop);
  select name into v_role from roles where id=coalesce((p_row->>'role_id')::uuid,(select role_id from users where id=v_id));
  if v_role='owner' then return true; end if;
  v_will_active:=coalesce((p_row->>'is_active')::boolean,v_was_active,true);
  if not v_will_active or coalesce(v_was_active,false) then return true; end if;
  perform 1 from shops where id=v_shop for update;
  select billing_account_id into v_account from shops where id=v_shop;
  if v_account is null then return true; end if;
  select case
    when status='trialing' and trial_ends_at>p_now then 'ultra'
    when status in ('active','canceled') and paid_through>p_now then tier
    when status in ('active','past_due','grace') and grace_ends_at>p_now then tier
    else 'free' end into v_tier
  from entitlement_snapshots where billing_account_id=v_account;
  select max_active_non_owner_staff_per_shop into v_limit
  from plan_offerings where tier=coalesce(v_tier,'free') and billing_cycle='monthly';
  if v_limit is null then return true; end if;
  select count(*) into v_count from users u join roles r on r.id=u.role_id
  where u.shop_id=v_shop and u.id<>v_id and u.is_deleted=false and u.is_active=true
    and u.plan_suspended_at is null and r.name<>'owner';
  return v_count<v_limit;
end
$fn$;

create or replace function b4_enforce_staff_limit_direct()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if current_user in ('authenticated','anon') and not b4_staff_row_within_limit(to_jsonb(new)) then
    raise exception 'staff plan limit reached' using errcode='MU034';
  end if;
  return new;
end
$fn$;
create trigger users_staff_limit
before insert or update of is_active,role_id on users
for each row execute function b4_enforce_staff_limit_direct();

create or replace function b4_shop_write_permitted(p_shop_id uuid,p_now timestamptz default now())
returns boolean language plpgsql stable security definer set search_path=public as $fn$
declare v_account uuid; v_tier text:='free'; v_limit integer; v_ordinal integer;
begin
  select billing_account_id into v_account from shops
  where id=p_shop_id and is_deleted=false and archived_at is null;
  if v_account is null then return true; end if;
  select case
    when status='trialing' and trial_ends_at>p_now then 'ultra'
    when status in ('active','canceled') and paid_through>p_now then tier
    when status in ('active','past_due','grace') and grace_ends_at>p_now then tier
    else 'free' end into v_tier from entitlement_snapshots where billing_account_id=v_account;
  select max_active_shops into v_limit from plan_offerings
    where tier=coalesce(v_tier,'free') and billing_cycle='monthly';
  if v_limit is null then return true; end if;
  select ordinal into v_ordinal from (
    select id,row_number() over(order by created_at,id) ordinal from shops
    where billing_account_id=v_account and is_deleted=false and archived_at is null
  ) ranked where id=p_shop_id;
  return coalesce(v_ordinal<=v_limit,false);
end
$fn$;

alter function sync_row_permitted(uuid,text,jsonb) rename to sync_row_permitted_pre_b4;
create or replace function sync_row_permitted(p_app_user_id uuid,p_table text,p_row jsonb)
returns boolean language sql volatile security definer set search_path=public as $fn$
  select case
    when p_table='subscriptions' then false
    when p_table in ('expenses','purchases','purchase_items','purchase_returns')
      then (b4_user_has_premium(p_app_user_id)
        or current_setting('muthoy.b4_inventory_add_purchase',true)='on')
        and sync_row_permitted_pre_b4(p_app_user_id,p_table,p_row)
    when p_table='users'
      then b4_staff_row_within_limit(p_row) and sync_row_permitted_pre_b4(p_app_user_id,p_table,p_row)
    else sync_row_permitted_pre_b4(p_app_user_id,p_table,p_row)
  end
$fn$;
revoke execute on function sync_row_permitted_pre_b4(uuid,text,jsonb),
  sync_row_permitted(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function sync_row_permitted_pre_b4(uuid,text,jsonb),
  sync_row_permitted(uuid,text,jsonb) to service_role;
revoke execute on function b4_user_has_premium(uuid,timestamptz) from public,anon,authenticated;
grant execute on function b4_user_has_premium(uuid,timestamptz) to service_role;
revoke execute on function b4_user_within_current_staff_limit(uuid,timestamptz) from public,anon,authenticated;
grant execute on function b4_user_within_current_staff_limit(uuid,timestamptz) to service_role;
revoke execute on function b4_staff_row_within_limit(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function b4_staff_row_within_limit(jsonb,timestamptz) to service_role;
revoke execute on function b4_shop_write_permitted(uuid,timestamptz) from public,anon,authenticated;
grant execute on function b4_shop_write_permitted(uuid,timestamptz) to service_role;

alter function sync_apply_row(text,text,jsonb,uuid,uuid,text) rename to sync_apply_row_pre_b4;
create or replace function sync_apply_row(
  p_table text,p_op text,p_row jsonb,p_caller_shop_id uuid,p_caller_user_id uuid,p_device_id text
) returns text language plpgsql security definer set search_path=public as $fn$
declare v_status text; v_row jsonb:=p_row; v_shop shops%rowtype;
  v_user users%rowtype;
begin
  if p_table='subscriptions' then
    raise exception 'subscriptions are server-owned' using errcode='MU030';
  end if;
  select commercial_status into v_status from shops where id=p_caller_shop_id;
  if v_status='read_only' or not b4_shop_write_permitted(p_caller_shop_id) then
    raise exception 'shop is commercially read-only' using errcode='MU035';
  end if;
  if p_table='shops' and p_op<>'delete' then
    select * into v_shop from shops where id=p_caller_shop_id;
    if found then
      v_row:=p_row || jsonb_build_object(
        'plan',v_shop.plan,'trial_ends_at',v_shop.trial_ends_at,
        'billing_account_id',v_shop.billing_account_id,'commercial_status',v_shop.commercial_status,
        'commercial_reason',v_shop.commercial_reason,'archived_at',v_shop.archived_at
      );
    else
      v_row:=p_row || jsonb_build_object(
        'plan','free','trial_ends_at',null,'billing_account_id',null,
        'commercial_status','active','commercial_reason',null,'archived_at',null
      );
    end if;
  end if;
  if p_table='users' and p_op<>'delete' then
    select * into v_user from users where id=(p_row->>'id')::uuid;
    if found then
      v_row:=v_row || jsonb_build_object(
        'plan_suspended_at',v_user.plan_suspended_at,
        'plan_suspension_reason',v_user.plan_suspension_reason
      );
    else
      v_row:=v_row || jsonb_build_object(
        'plan_suspended_at',null,'plan_suspension_reason',null
      );
    end if;
  end if;
  return sync_apply_row_pre_b4(p_table,p_op,v_row,p_caller_shop_id,p_caller_user_id,p_device_id);
end
$fn$;
revoke execute on function sync_apply_row_pre_b4(text,text,jsonb,uuid,uuid,text),
  sync_apply_row(text,text,jsonb,uuid,uuid,text) from public,anon,authenticated;
grant execute on function sync_apply_row_pre_b4(text,text,jsonb,uuid,uuid,text),
  sync_apply_row(text,text,jsonb,uuid,uuid,text) to service_role;

alter function sync_apply_operation(uuid,uuid,text,uuid,text,jsonb)
  rename to sync_apply_operation_pre_b4;
create or replace function sync_apply_operation(
  p_shop_id uuid,p_operation_id uuid,p_operation_kind text,p_actor_id uuid,p_device_id text,p_rows jsonb
) returns text language plpgsql security definer set search_path=public as $fn$
begin
  if p_operation_kind='inventory_add_purchase' then
    perform set_config('muthoy.b4_inventory_add_purchase','on',true);
  end if;
  return sync_apply_operation_pre_b4(
    p_shop_id,p_operation_id,p_operation_kind,p_actor_id,p_device_id,p_rows
  );
end
$fn$;
revoke execute on function sync_apply_operation_pre_b4(uuid,uuid,text,uuid,text,jsonb),
  sync_apply_operation(uuid,uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function sync_apply_operation_pre_b4(uuid,uuid,text,uuid,text,jsonb),
  sync_apply_operation(uuid,uuid,text,uuid,text,jsonb) to service_role;

create or replace function b4_auth_shop_write_permitted()
returns boolean language sql stable security definer set search_path=public as $fn$
  select auth_is_live_user() and exists(
    select 1 from shops s
    where s.id=nullif(auth.jwt()->'app_metadata'->>'shop_id','')::uuid
      and s.commercial_status='active' and s.archived_at is null and not s.is_deleted
      and b4_shop_write_permitted(s.id)
  )
$fn$;
revoke execute on function b4_auth_shop_write_permitted() from public,anon;
grant execute on function b4_auth_shop_write_permitted() to authenticated,service_role;

do $fn$
declare v_table text;
begin
  for v_table in select distinct tablename from pg_policies
    where schemaname='public' and policyname='muthoy_insert'
  loop
    execute format('drop policy if exists b4_commercial_insert on %I',v_table);
    execute format('drop policy if exists b4_commercial_update on %I',v_table);
    execute format('drop policy if exists b4_commercial_delete on %I',v_table);
    execute format('create policy b4_commercial_insert on %I as restrictive for insert with check (b4_auth_shop_write_permitted())',v_table);
    execute format('create policy b4_commercial_update on %I as restrictive for update using (b4_auth_shop_write_permitted()) with check (b4_auth_shop_write_permitted())',v_table);
    execute format('create policy b4_commercial_delete on %I as restrictive for delete using (b4_auth_shop_write_permitted())',v_table);
  end loop;
end
$fn$;

do $fn$
declare v_table text;
begin
  foreach v_table in array array['expenses','purchases','purchase_items','purchase_returns'] loop
    execute format('drop policy if exists b4_premium_insert on %I',v_table);
    execute format('drop policy if exists b4_premium_update on %I',v_table);
    execute format('drop policy if exists b4_premium_delete on %I',v_table);
    execute format('create policy b4_premium_insert on %I as restrictive for insert with check (b4_user_has_premium(nullif(auth.jwt()->''app_metadata''->>''app_user_id'','''')::uuid))',v_table);
    execute format('create policy b4_premium_update on %I as restrictive for update using (b4_user_has_premium(nullif(auth.jwt()->''app_metadata''->>''app_user_id'','''')::uuid)) with check (b4_user_has_premium(nullif(auth.jwt()->''app_metadata''->>''app_user_id'','''')::uuid))',v_table);
    execute format('create policy b4_premium_delete on %I as restrictive for delete using (b4_user_has_premium(nullif(auth.jwt()->''app_metadata''->>''app_user_id'','''')::uuid))',v_table);
  end loop;
end
$fn$;

create or replace function b4_reconcile_plan_limits(p_billing_account_id uuid,p_now timestamptz default now())
returns void language plpgsql security definer set search_path=public as $fn$
declare
  v_tier text:='free';
  v_shop_limit integer:=1;
  v_staff_limit integer:=1;
begin
  select case
      when status='trialing' and trial_ends_at>p_now then 'ultra'
      when status in ('active','canceled') and paid_through>p_now then tier
      when status in ('active','past_due','grace') and grace_ends_at>p_now then tier
      else 'free'
    end into v_tier
  from entitlement_snapshots where billing_account_id=p_billing_account_id;

  select max_active_shops,max_active_non_owner_staff_per_shop
    into v_shop_limit,v_staff_limit
  from plan_offerings where tier=v_tier and billing_cycle='monthly';

  update shops set commercial_status='active',commercial_reason=null,updated_at=p_now
  where billing_account_id=p_billing_account_id and archived_at is null and is_deleted=false
    and (commercial_status is distinct from 'active' or commercial_reason is not null);

  if v_shop_limit is not null then
    with ranked as (
      select id,row_number() over(order by created_at,id) as ordinal
      from shops
      where billing_account_id=p_billing_account_id and archived_at is null and is_deleted=false
    )
    update shops s set commercial_status='read_only',commercial_reason='plan_shop_limit',updated_at=p_now
    from ranked r where s.id=r.id and r.ordinal>v_shop_limit
      and (s.commercial_status is distinct from 'read_only'
        or s.commercial_reason is distinct from 'plan_shop_limit');
  end if;

  update users u set plan_suspended_at=null,plan_suspension_reason=null,updated_at=p_now
  from shops s,roles r
  where u.shop_id=s.id and s.billing_account_id=p_billing_account_id
    and r.id=u.role_id and r.name<>'owner' and u.is_deleted=false
    and (u.plan_suspended_at is not null or u.plan_suspension_reason is not null);

  if v_staff_limit is not null then
    with ranked as (
      select u.id,row_number() over(partition by u.shop_id order by u.created_at,u.id) as ordinal
      from users u join shops s on s.id=u.shop_id join roles r on r.id=u.role_id
      where s.billing_account_id=p_billing_account_id and u.is_deleted=false
        and u.is_active=true and r.name<>'owner'
    )
    update users u set plan_suspended_at=p_now,plan_suspension_reason='plan_staff_limit',updated_at=p_now
    from ranked r where u.id=r.id and r.ordinal>v_staff_limit
      and (u.plan_suspended_at is null
        or u.plan_suspension_reason is distinct from 'plan_staff_limit');
  end if;
end
$fn$;
revoke execute on function b4_reconcile_plan_limits(uuid,timestamptz) from public,anon,authenticated;
grant execute on function b4_reconcile_plan_limits(uuid,timestamptz) to service_role;

create or replace function b4_refresh_entitlement_snapshot(p_billing_account_id uuid)
returns void language plpgsql security definer set search_path=public as $fn$
begin
  update entitlement_snapshots
  set verified_at=now(),version=version+1,updated_at=now()
  where billing_account_id=p_billing_account_id;
  if not found then
    raise exception 'entitlement snapshot not found' using errcode='MU036';
  end if;
end
$fn$;
revoke execute on function b4_refresh_entitlement_snapshot(uuid) from public,anon,authenticated;
grant execute on function b4_refresh_entitlement_snapshot(uuid) to service_role;

do $fn$
declare v_id uuid;
begin
  for v_id in select id from billing_accounts loop
    perform b4_reconcile_plan_limits(v_id,now());
  end loop;
end
$fn$;

create or replace function b4_apply_verified_payment(
  p_payment_order_id uuid,
  p_provider_transaction_id text,
  p_validation_id text,
  p_event_key text,
  p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare
  v_order payment_orders%rowtype;
  v_subscription billing_subscriptions%rowtype;
  v_start timestamptz;
  v_paid_through timestamptz;
  v_event_id uuid;
  v_snapshot entitlement_snapshots%rowtype;
begin
  insert into payment_provider_events(provider,event_key,payment_order_id,validation_id,payload)
  values('sslcommerz',p_event_key,p_payment_order_id,p_validation_id,p_payload)
  on conflict(provider,validation_id) do update set
    event_key=excluded.event_key,payment_order_id=excluded.payment_order_id,payload=excluded.payload,
    processing_status='received',error_code=null,processed_at=null
  returning id into v_event_id;

  select * into v_order from payment_orders where id=p_payment_order_id for update;
  if not found then
    update payment_provider_events set processing_status='rejected',error_code='order_not_found',processed_at=now()
    where id=v_event_id;
    raise exception 'payment order not found' using errcode='MU031';
  end if;
  if v_order.status='verified' then
    update payment_provider_events set processing_status='verified',error_code=null,processed_at=now()
    where id=v_event_id;
    select * into v_snapshot from entitlement_snapshots where billing_account_id=v_order.billing_account_id;
    return to_jsonb(v_snapshot);
  end if;
  if v_order.provider_transaction_id is distinct from p_provider_transaction_id then
    update payment_provider_events set processing_status='rejected',error_code='transaction_mismatch',processed_at=now()
    where id=v_event_id;
    raise exception 'payment transaction does not match order' using errcode='MU031';
  end if;

  select * into v_subscription from billing_subscriptions
  where billing_account_id=v_order.billing_account_id
    and status in ('active','past_due','grace','canceled')
  for update;
  v_start:=case
    when found and v_subscription.paid_through>now()
      then v_subscription.paid_through
    else now()
  end;
  v_paid_through:=case when v_order.billing_cycle='annual'
    then v_start+interval '1 year' else v_start+interval '1 month' end;

  if v_subscription.id is null then
    insert into billing_subscriptions(
      billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,
      provider,provider_reference
    ) values(
      v_order.billing_account_id,v_order.tier,v_order.billing_cycle,'active',now(),v_paid_through,
      v_paid_through+interval '7 days','sslcommerz',p_provider_transaction_id
    );
  else
    update billing_subscriptions set tier=v_order.tier,billing_cycle=v_order.billing_cycle,status='active',
      starts_at=case when tier=v_order.tier then starts_at else now() end,
      paid_through=v_paid_through,grace_ends_at=v_paid_through+interval '7 days',canceled_at=null,
      provider_reference=p_provider_transaction_id,updated_at=now()
    where id=v_subscription.id;
  end if;

  insert into entitlement_snapshots(
    billing_account_id,tier,status,trial_ends_at,paid_through,grace_ends_at,verified_at,version
  ) values(
    v_order.billing_account_id,v_order.tier,'active',null,v_paid_through,v_paid_through+interval '7 days',now(),1
  ) on conflict(billing_account_id) do update set
    tier=excluded.tier,status='active',trial_ends_at=null,paid_through=excluded.paid_through,
    grace_ends_at=excluded.grace_ends_at,verified_at=now(),version=entitlement_snapshots.version+1,updated_at=now();

  update payment_orders set status='verified',provider_transaction_id=p_provider_transaction_id,
    verified_at=now(),updated_at=now() where id=v_order.id;
  update payment_orders set status='canceled',failure_code='superseded_by_verified_payment',updated_at=now()
    where billing_account_id=v_order.billing_account_id and id<>v_order.id and status in ('created','pending');
  update payment_provider_events set processing_status='verified',processed_at=now() where id=v_event_id;
  update shops set plan=v_order.tier,trial_ends_at=null,updated_at=now()
    where billing_account_id=v_order.billing_account_id;
  perform b4_reconcile_plan_limits(v_order.billing_account_id,now());
  select * into v_snapshot from entitlement_snapshots where billing_account_id=v_order.billing_account_id;
  return to_jsonb(v_snapshot);
end
$fn$;
revoke execute on function b4_apply_verified_payment(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function b4_apply_verified_payment(uuid,text,text,text,jsonb) to service_role;

-- One principal may have a different shop actor. The requested active shop is
-- accepted only when a live membership exists; otherwise the principal's own
-- original shop remains active.
create or replace function custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare
  v_claims jsonb:=coalesce(event->'claims','{}'::jsonb);
  v_metadata jsonb:=coalesce(event->'claims'->'app_metadata','{}'::jsonb);
  v_principal uuid;
  v_requested_shop uuid;
  v_user record;
  v_billing uuid;
begin
  select app_user_id into v_principal from auth_bindings
  where auth_user_id=(event->>'user_id')::uuid limit 1;
  if not found then return event; end if;

  begin v_requested_shop:=nullif(v_metadata->>'active_shop_id','')::uuid;
  exception when invalid_text_representation then v_requested_shop:=null; end;

  select u.id,u.shop_id,u.permission_version,u.is_active,r.name as role_name,m.billing_account_id
    into v_user
  from shop_memberships m join users u on u.id=m.actor_user_id and u.is_deleted=false
  join roles r on r.id=u.role_id and r.is_deleted=false
  join shops active_shop on active_shop.id=m.shop_id and active_shop.is_deleted=false and active_shop.archived_at is null
  where m.principal_user_id=v_principal and m.shop_id=v_requested_shop and m.is_active=true
    and u.is_active=true and u.plan_suspended_at is null
  limit 1;

  if not found then
    select u.id,u.shop_id,u.permission_version,u.is_active,r.name as role_name,s.billing_account_id
      into v_user
    from users u join roles r on r.id=u.role_id and r.is_deleted=false
    join shops s on s.id=u.shop_id
    where u.id=v_principal and u.is_deleted=false limit 1;
  end if;
  if not found then return event; end if;
  v_billing:=v_user.billing_account_id;

  v_metadata:=v_metadata || jsonb_build_object(
    'shop_id',v_user.shop_id,'active_shop_id',v_user.shop_id,'app_user_id',v_user.id,
    'principal_user_id',v_principal,'billing_account_id',v_billing,'role',v_user.role_name,
    'permission_version',v_user.permission_version,'is_active',v_user.is_active
  );
  return jsonb_set(event,'{claims,app_metadata}',v_metadata);
end
$fn$;
grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function custom_access_token_hook(jsonb) from public,anon,authenticated;
grant select on shop_memberships,billing_accounts to supabase_auth_admin;

create or replace function b4_ensure_owner_billing_account(p_owner_user_id uuid,p_shop_id uuid)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare
  v_account_id uuid;
  v_trial_granted_at timestamptz;
  v_now timestamptz:=now();
begin
  if not exists(
    select 1 from users u join roles r on r.id=u.role_id
    where u.id=p_owner_user_id and u.shop_id=p_shop_id and u.is_active=true
      and u.is_deleted=false and r.name='owner' and r.shop_id=p_shop_id and r.is_deleted=false
      and exists(
        select 1 from shops s where s.id=p_shop_id and s.owner_id=p_owner_user_id
          and s.is_deleted=false
      )
  ) then raise exception 'owner billing target is invalid' using errcode='MU032'; end if;

  select id,launch_trial_granted_at into v_account_id,v_trial_granted_at
  from billing_accounts where principal_owner_user_id=p_owner_user_id for update;
  if not found then
    insert into billing_accounts(principal_owner_user_id,primary_shop_id,launch_trial_granted_at)
    values(p_owner_user_id,p_shop_id,v_now)
    on conflict(principal_owner_user_id) do update
      set updated_at=billing_accounts.updated_at
    returning id,launch_trial_granted_at into v_account_id,v_trial_granted_at;
  elsif v_trial_granted_at is null then
    -- Repair a partial legacy bootstrap once. The stored grant timestamp is
    -- immutable after this write, so a later retry cannot restart the trial.
    update billing_accounts set launch_trial_granted_at=v_now,updated_at=v_now
    where id=v_account_id and launch_trial_granted_at is null
    returning launch_trial_granted_at into v_trial_granted_at;
  end if;
  update shops set billing_account_id=v_account_id where id=p_shop_id and billing_account_id is null;
  insert into entitlement_snapshots(billing_account_id,tier,status,trial_ends_at,verified_at,version)
  values(v_account_id,'free','trialing',v_trial_granted_at+interval '14 days',v_now,1)
  on conflict(billing_account_id) do nothing;
  insert into shop_memberships(
    billing_account_id,principal_user_id,shop_id,actor_user_id,role
  )
  select v_account_id,u.id,u.shop_id,u.id,r.name from users u join roles r on r.id=u.role_id
  where u.shop_id=p_shop_id and u.is_deleted=false
  on conflict(principal_user_id,shop_id) do update set is_active=true,updated_at=v_now;
  update shops s set plan=e.tier,trial_ends_at=e.trial_ends_at
  from entitlement_snapshots e where s.id=p_shop_id and e.billing_account_id=v_account_id;
  perform b4_reconcile_plan_limits(v_account_id,v_now);
  return v_account_id;
end
$fn$;
revoke execute on function b4_ensure_owner_billing_account(uuid,uuid) from public,anon,authenticated;
grant execute on function b4_ensure_owner_billing_account(uuid,uuid) to service_role;

-- The server owns the activation boundary. A newly synced primary Owner can
-- arrive after link-device and after the B4 rollout migration; creating the
-- billing account here makes that delayed visibility retryable without letting
-- a device choose either trial timestamp. Multi-shop actor Owners already have
-- a billing_account_id and therefore do not create a second account.
create or replace function b4_activate_primary_owner_trial()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare
  v_owner_user_id uuid;
  v_billing_account_id uuid;
begin
  select s.owner_id,s.billing_account_id into v_owner_user_id,v_billing_account_id
  from shops s where s.id=new.shop_id and s.is_deleted=false;
  if found and exists(
    select 1 from users u join roles r on r.id=u.role_id and r.shop_id=u.shop_id
    where u.id=v_owner_user_id and u.shop_id=new.shop_id and u.is_active=true
      and u.is_deleted=false and r.name='owner' and r.is_deleted=false
  ) and (
    v_billing_account_id is null or exists(
      select 1 from billing_accounts b
      where b.id=v_billing_account_id and b.principal_owner_user_id=v_owner_user_id
    )
  ) then
    -- Re-running for later staff rows also repairs the server-owned membership
    -- directory. The account/snapshot conflict keys keep the trial exactly once.
    perform b4_ensure_owner_billing_account(v_owner_user_id,new.shop_id);
  end if;
  return new;
end
$fn$;
create trigger users_activate_primary_owner_trial
after insert or update of is_active,is_deleted,role_id,shop_id on users
for each row execute function b4_activate_primary_owner_trial();

create or replace function b4_effective_tier(p_billing_account_id uuid,p_now timestamptz default now())
returns text language sql stable security definer set search_path=public as $fn$
  select case
    when status='trialing' and trial_ends_at>p_now then 'ultra'
    when status in ('active','canceled') and paid_through>p_now then tier
    when status in ('active','past_due','grace') and grace_ends_at>p_now then tier
    else 'free' end
  from entitlement_snapshots where billing_account_id=p_billing_account_id
$fn$;

create or replace function b4_create_owned_shop(
  p_principal_owner_user_id uuid,p_name text,p_name_en text,p_phone text
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare
  v_account billing_accounts%rowtype;
  v_source users%rowtype;
  v_tier text;
  v_limit integer;
  v_count integer;
  v_shop_id uuid:=gen_random_uuid();
  v_owner_id uuid:=gen_random_uuid();
  v_owner_role uuid:=gen_random_uuid();
  v_manager_role uuid:=gen_random_uuid();
  v_staff_role uuid:=gen_random_uuid();
  v_now timestamptz:=now();
begin
  if length(trim(p_name)) not between 1 and 120 then
    raise exception 'invalid shop name' using errcode='MU033';
  end if;
  select * into v_account from billing_accounts where principal_owner_user_id=p_principal_owner_user_id for update;
  if not found then raise exception 'billing account not found' using errcode='MU033'; end if;
  select * into v_source from users where id=p_principal_owner_user_id and is_active=true and is_deleted=false;
  if not found then raise exception 'owner not active' using errcode='MU033'; end if;
  v_tier:=coalesce(b4_effective_tier(v_account.id,v_now),'free');
  select max_active_shops into v_limit from plan_offerings where tier=v_tier and billing_cycle='monthly';
  select count(*) into v_count from shops where billing_account_id=v_account.id and archived_at is null and is_deleted=false;
  if v_limit is not null and v_count>=v_limit then
    raise exception 'shop plan limit reached' using errcode='MU034';
  end if;

  insert into shops(id,owner_id,name,name_en,phone,plan,trial_ends_at,billing_account_id,created_at,updated_at)
  select v_shop_id,v_owner_id,trim(p_name),nullif(trim(p_name_en),''),coalesce(nullif(trim(p_phone),''),s.phone),e.tier,e.trial_ends_at,v_account.id,v_now,v_now
  from shops s,entitlement_snapshots e where s.id=v_account.primary_shop_id and e.billing_account_id=v_account.id;
  insert into roles(id,shop_id,name,is_system,created_at,updated_at) values
    (v_owner_role,v_shop_id,'owner',true,v_now,v_now),
    (v_manager_role,v_shop_id,'manager',true,v_now,v_now),
    (v_staff_role,v_shop_id,'staff',true,v_now,v_now);
  insert into users(id,shop_id,name,phone,pin_hash,pin_set_at,role_id,is_active,created_at,updated_at)
  values(v_owner_id,v_shop_id,v_source.name,null,v_source.pin_hash,v_source.pin_set_at,v_owner_role,true,v_now,v_now);
  insert into shop_b2_settings(id,shop_id,created_at,updated_at)
  values(gen_random_uuid(),v_shop_id,v_now,v_now);
  insert into shop_memberships(
    billing_account_id,principal_user_id,shop_id,actor_user_id,role,created_at,updated_at
  ) values(v_account.id,p_principal_owner_user_id,v_shop_id,v_owner_id,'owner',v_now,v_now);
  return jsonb_build_object('shopId',v_shop_id,'actorUserId',v_owner_id,'billingAccountId',v_account.id);
end
$fn$;

create or replace function b4_shop_summaries(p_billing_account_id uuid,p_business_date date)
returns table(
  shop_id uuid,sales_paisa bigint,outstanding_credit_paisa bigint,
  low_stock_count bigint,expiring_count bigint,transaction_count bigint,average_sale_paisa bigint
) language sql stable security definer set search_path=public as $fn$
  with eligible_shops as (
    select s.id from shops s where s.billing_account_id=p_billing_account_id
      and not s.is_deleted and s.archived_at is null
  ), sale_totals as (
    select s.shop_id,coalesce(sum(s.total),0)::bigint gross,count(*)::bigint txns
    from sales s join eligible_shops es on es.id=s.shop_id
    where not s.is_deleted and s.business_date=p_business_date group by s.shop_id
  ), refund_totals as (
    select r.shop_id,coalesce(sum(r.total_amount),0)::bigint refunds
    from sale_refunds r join eligible_shops es on es.id=r.shop_id
    where not r.is_deleted and r.business_date=p_business_date group by r.shop_id
  ), credit_totals as (
    select c.shop_id,coalesce(sum(c.balance),0)::bigint credit
    from credits c join eligible_shops es on es.id=c.shop_id
    where not c.is_deleted and c.balance>0 group by c.shop_id
  ), medicine_stock as (
    select m.shop_id,m.id,coalesce(m.low_stock_threshold_override,st.low_stock_default,10) threshold,
      coalesce(sum(b.stock) filter(where not b.is_deleted and b.stock>0
        and (b.expiry_date is null or b.expiry_date>=p_business_date)),0) sellable
    from medicines m join eligible_shops es on es.id=m.shop_id
    left join shop_b2_settings st on st.shop_id=m.shop_id and not st.is_deleted
    left join batches b on b.medicine_id=m.id and b.shop_id=m.shop_id
    where not m.is_deleted group by m.shop_id,m.id,m.low_stock_threshold_override,st.low_stock_default
  ), low_stock as (
    select shop_id,count(*)::bigint count from medicine_stock where sellable>0 and sellable<threshold group by shop_id
  ), expiring as (
    select b.shop_id,count(*)::bigint count from batches b join eligible_shops es on es.id=b.shop_id
    left join shop_b2_settings st on st.shop_id=b.shop_id and not st.is_deleted
    where not b.is_deleted and b.stock>0 and b.expiry_date is not null
      and b.expiry_date between p_business_date and p_business_date+coalesce(st.expiry_far_days,60)
    group by b.shop_id
  )
  select es.id,
    (coalesce(sa.gross,0)-coalesce(r.refunds,0))::bigint,
    coalesce(c.credit,0)::bigint,coalesce(l.count,0)::bigint,coalesce(e.count,0)::bigint,
    coalesce(sa.txns,0)::bigint,
    case when coalesce(sa.txns,0)>0 then round((coalesce(sa.gross,0)-coalesce(r.refunds,0))::numeric/sa.txns)::bigint else 0 end
  from eligible_shops es left join sale_totals sa on sa.shop_id=es.id
  left join refund_totals r on r.shop_id=es.id left join credit_totals c on c.shop_id=es.id
  left join low_stock l on l.shop_id=es.id left join expiring e on e.shop_id=es.id
$fn$;

revoke execute on function b4_effective_tier(uuid,timestamptz),
  b4_create_owned_shop(uuid,text,text,text),b4_shop_summaries(uuid,date) from public,anon,authenticated;
grant execute on function b4_effective_tier(uuid,timestamptz),
  b4_create_owned_shop(uuid,text,text,text),b4_shop_summaries(uuid,date) to service_role;
