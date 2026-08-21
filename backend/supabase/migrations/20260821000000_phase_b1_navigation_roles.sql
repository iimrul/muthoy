-- Phase B1: operational Manager, exact permission defaults, and nullable Owner profile fields.
alter table users add column if not exists address text;
alter table users add column if not exists email text;

create or replace function user_has_permission(p_app_user_id uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select case
      when not u.is_active or u.is_deleted then false
      when r.name = 'owner' then true
      when r.name not in ('manager', 'staff') then false
      else coalesce(
        (select up.allowed from user_permissions up
          where up.user_id = u.id and up.shop_id = u.shop_id
            and up.key = p_key and up.is_deleted = false limit 1),
        case
          when r.name = 'manager' then p_key in (
            'sales','sale_discount','sale_return','sale_history',
            'inventory_view','inventory_write','expiry_manage',
            'credit_view','credit_management','cash_management','reports'
          )
          else p_key in ('sales','inventory_view')
        end
      )
    end
    from users u join roles r on r.id=u.role_id and r.shop_id=u.shop_id and not r.is_deleted
    where u.id=p_app_user_id
  ), false);
$fn$;

create or replace function auth_is_owner()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists(
    select 1 from users u join roles r on r.id=u.role_id and r.shop_id=u.shop_id
    where u.id=nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id','')::uuid
      and u.shop_id=nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id','')::uuid
      and u.is_active and not u.is_deleted and not r.is_deleted and r.name='owner'
  );
$fn$;

revoke execute on function auth_is_owner() from public, anon;
grant execute on function auth_is_owner() to authenticated, service_role;

-- Direct PostgREST role/permission/security writes remain Owner-only. Managers
-- create Cashiers through the hardened sync dispatcher, which preserves role,
-- PIN and revocation fields and refuses non-owner permission writes.
do $owner_security_policies$
declare table_name text;
begin
  foreach table_name in array array['roles','permissions','users','user_permissions'] loop
    execute format('drop policy if exists muthoy_insert on %I', table_name);
    execute format('drop policy if exists muthoy_update on %I', table_name);
    execute format('drop policy if exists muthoy_delete on %I', table_name);
    execute format('create policy muthoy_insert on %I as restrictive for insert with check (auth_is_owner())', table_name);
    execute format('create policy muthoy_update on %I as restrictive for update using (auth_is_owner()) with check (auth_is_owner())', table_name);
    execute format('create policy muthoy_delete on %I as restrictive for delete using (auth_is_owner())', table_name);
  end loop;
end
$owner_security_policies$;
