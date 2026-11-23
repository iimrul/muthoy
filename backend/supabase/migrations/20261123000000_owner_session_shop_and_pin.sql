-- 43 · One owner, many shops: the active shop belongs to the SESSION, and the
-- owner's PIN is one PIN in every shop. Founder-approved plan, 2026-11-23.
--
-- 1. custom_access_token_hook — the shop a token names.
--
--    Until now the hook read `app_metadata.active_shop_id`, which lives on the
--    AUTH USER: one value shared by every session that user has. An owner
--    switching shop on one phone (or logging in on another) rewrote it, and the
--    next refresh on every OTHER phone minted claims for a shop that phone was
--    not in; its H-10 gate saw the actor change and signed the owner out
--    (measured on DEV 2026-11-23, the founder's phone).
--
--    A session that a credential-proving flow has bound to an installation
--    (auth_session_devices, A2.3) already records WHICH shop and actor it acts
--    as, and shop-switch re-points exactly that row. The hook now prefers it:
--    the bound shop, when the bound actor really is this principal's member
--    there. Everything else — the membership, liveness, archive and role
--    checks, and the claims produced — is the H-7 definition unchanged. An
--    unbound (legacy) session, or a binding that no longer belongs to the
--    principal, falls back to app_metadata exactly as before.
--
-- 2. owner_set_pin_all_shops — one owner PIN, written to every owner actor.
--
--    A multi-shop owner has one actor row per shop. A PIN change or recovery
--    used to write only one of them, so the others kept the old PIN and the
--    phone-first PIN pad could no longer sign the owner in from those shops.
--    This writes the same hash to every live owner actor of the principal —
--    and to the principal's own row — in ONE statement, with an audit row per
--    shop. The actor set is derived here, from shop_memberships, never taken
--    from the caller. service_role only; the sync function calls it after it
--    has verified the credential and checked the new PIN collides with nobody.

create or replace function custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_claims jsonb := coalesce(event->'claims','{}'::jsonb);
  v_metadata jsonb := coalesce(event->'claims'->'app_metadata','{}'::jsonb);
  v_principal uuid;
  v_session uuid;
  v_bound_shop uuid;
  v_requested_shop uuid;
  v_user record;
  v_billing uuid;
begin
  select app_user_id into v_principal from auth_bindings
  where auth_user_id = (event->>'user_id')::uuid limit 1;
  if not found then return event; end if;

  -- 43: the session's own shop, when a credential-proving flow bound it and
  -- the bound actor is this principal's member of that shop.
  begin v_session := nullif(v_claims->>'session_id','')::uuid;
  exception when invalid_text_representation then v_session := null; end;
  if v_session is not null then
    select asd.shop_id into v_bound_shop
    from auth_session_devices asd
    join shop_memberships bm on bm.shop_id = asd.shop_id
      and bm.actor_user_id = asd.actor_user_id
      and bm.principal_user_id = v_principal
    where asd.auth_session_id = v_session;
  end if;

  if v_bound_shop is not null then
    v_requested_shop := v_bound_shop;
  else
    begin v_requested_shop := nullif(v_metadata->>'active_shop_id','')::uuid;
    exception when invalid_text_representation then v_requested_shop := null; end;
  end if;

  select u.id,u.shop_id,u.permission_version,u.is_active,r.name as role_name,m.billing_account_id
    into v_user
  from shop_memberships m join users u on u.id=m.actor_user_id and u.is_deleted=false
  join roles r on r.id=u.role_id and r.is_deleted=false
  join shops active_shop on active_shop.id=m.shop_id and active_shop.is_deleted=false and active_shop.archived_at is null
  where m.principal_user_id=v_principal and m.shop_id=v_requested_shop and m.is_active=true
    and u.is_active=true and u.plan_suspended_at is null
  limit 1;

  if not found then
    -- Deliberately WITHOUT the primary branch's liveness conditions. A revoked
    -- principal must still be identifiable, or the server cannot tell them
    -- apart from an unconfigured hook. (H-7; unchanged.)
    select u.id,u.shop_id,u.permission_version,u.is_active,r.name as role_name,s.billing_account_id
      into v_user
    from users u join roles r on r.id=u.role_id and r.is_deleted=false
    join shops s on s.id=u.shop_id
    where u.id=v_principal and u.is_deleted=false limit 1;
  end if;
  if not found then return event; end if;
  v_billing := v_user.billing_account_id;

  v_metadata := v_metadata || jsonb_build_object(
    'shop_id',v_user.shop_id,'active_shop_id',v_user.shop_id,'app_user_id',v_user.id,
    'principal_user_id',v_principal,'billing_account_id',v_billing,'role',v_user.role_name,
    'permission_version',v_user.permission_version,'is_active',v_user.is_active
  );
  return jsonb_set(event,'{claims,app_metadata}',v_metadata);
end
$fn$;

grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function custom_access_token_hook(jsonb) from public, anon, authenticated;

create or replace function owner_set_pin_all_shops(
  p_principal_user_id uuid,
  p_pin_hash text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_now timestamptz := clock_timestamp();
  v_actor_ids uuid[];
begin
  -- A bcrypt hash and nothing else. The raw PIN never reaches the database.
  if p_principal_user_id is null or p_pin_hash is null
     or p_pin_hash !~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$' then
    raise exception 'owner PIN request is invalid' using errcode = 'MU080';
  end if;

  -- Every live owner actor of this principal (one per shop, archived shops
  -- included so a restored shop opens with the same PIN), plus the principal's
  -- own row, which a legacy single-shop owner may hold without a membership.
  select coalesce(array_agg(distinct u.id), '{}'::uuid[]) into v_actor_ids
  from users u
  join roles r on r.id = u.role_id and r.is_deleted = false and r.name = 'owner'
  join shops s on s.id = u.shop_id and s.is_deleted = false
  where u.is_deleted = false
    and u.is_active = true
    and (
      u.id = p_principal_user_id
      or u.id in (
        select m.actor_user_id from shop_memberships m
        where m.principal_user_id = p_principal_user_id
          and m.role = 'owner'
          and m.is_active = true
      )
    );
  if cardinality(v_actor_ids) = 0 then
    raise exception 'no live owner account for this principal' using errcode = 'MU081';
  end if;

  -- ONE statement: every owner actor changes, or none does. pin_hash changing
  -- also trips users_bump_permission_version, so tokens minted under the old
  -- PIN go stale exactly as they do for a single-row change.
  update users
     set pin_hash = p_pin_hash, pin_set_at = v_now, updated_at = v_now
   where id = any(v_actor_ids);

  insert into audit_logs(id, shop_id, actor_id, action, meta, created_at, updated_at)
  select gen_random_uuid(), u.shop_id, u.id, 'pin_changed', 'all_owner_shops', v_now, v_now
  from users u where u.id = any(v_actor_ids);

  return jsonb_build_object('pinSetAt', v_now, 'actorUserIds', to_jsonb(v_actor_ids));
end
$fn$;

revoke all on function owner_set_pin_all_shops(uuid, text) from public, anon, authenticated;
grant execute on function owner_set_pin_all_shops(uuid, text) to service_role;
