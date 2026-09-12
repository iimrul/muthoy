-- H-7 Fix Pass B: immutable null-billing bootstrap clock and legacy RPC seal.
-- Additive only. The two deployed H-7 migrations remain byte-for-byte intact.

create table if not exists h7_shop_billing_bootstrap_windows (
  shop_id uuid primary key references shops(id) on delete cascade,
  opened_at timestamptz not null default clock_timestamp()
);

alter table h7_shop_billing_bootstrap_windows enable row level security;
revoke all on table h7_shop_billing_bootstrap_windows
  from public, anon, authenticated, service_role;

-- Existing rows get a bounded server anchor. A client-written future
-- shops.created_at is clamped to migration time and can buy at most one final
-- 24-hour window; an honestly old row remains old and is denied immediately.
insert into h7_shop_billing_bootstrap_windows (shop_id, opened_at)
select id, least(created_at, transaction_timestamp())
from shops
on conflict (shop_id) do nothing;

create or replace function h7_record_shop_billing_bootstrap_window()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into h7_shop_billing_bootstrap_windows (shop_id, opened_at)
  values (new.id, clock_timestamp())
  on conflict (shop_id) do nothing;
  return new;
end
$fn$;

revoke execute on function h7_record_shop_billing_bootstrap_window()
  from public, anon, authenticated, service_role;

drop trigger if exists h7_record_shop_billing_bootstrap_window on shops;
create trigger h7_record_shop_billing_bootstrap_window
after insert on shops
for each row execute function h7_record_shop_billing_bootstrap_window();

create or replace function h7_shop_billing_bootstrap_allowed(
  p_shop_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare
  v_shop shops%rowtype;
  v_opened_at timestamptz;
begin
  select * into v_shop from shops where id = p_shop_id;
  if not found then return true; end if;
  if v_shop.is_deleted or v_shop.archived_at is not null then return false; end if;
  if v_shop.billing_account_id is not null then return true; end if;

  select opened_at into v_opened_at
  from h7_shop_billing_bootstrap_windows
  where shop_id = p_shop_id;
  if not found then return false; end if;

  return v_opened_at <= p_now
    and v_opened_at > p_now - interval '24 hours';
end
$fn$;

revoke execute on function h7_shop_billing_bootstrap_allowed(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function h7_shop_billing_bootstrap_allowed(uuid, timestamptz)
  to service_role;

-- The public wrapper is the only legitimate entry point. SECURITY DEFINER
-- ownership lets it call its renamed implementation without exposing that
-- pre-H-7 generic dispatcher to the service key.
revoke execute on function sync_apply_row_pre_h7(text,text,jsonb,uuid,uuid,text)
  from service_role;
