-- Canonical Owner onboarding, and the missing shop-mutation path.
--
-- WHY THIS EXISTS
--
-- Registration had two different ways to get a shop and its Owner onto the
-- server, and neither worked.
--
-- The real OTP path had none at all. It created the rows in local SQLite and
-- relied on ordinary sync push to carry them up — but push refuses a caller
-- with no app_user_id claim (`hook_not_configured`), that claim comes from the
-- access-token hook, the hook needs an auth_bindings row, and link-device only
-- writes that binding after assertBindingTarget has found the users row ON THE
-- SERVER. Circular: a genuinely new shop can never complete.
--
-- The DEV Skip-OTP path papered over it with a private bootstrap that wrote
-- shops/roles/users through PostgREST as service_role. Those tables grant
-- service_role SELECT (and UPDATE on users) and nothing else, so every attempt
-- died with 42501, and the workaround was invisible to the test suite.
--
-- b4_onboard_owner is the single creator both flows now call. It is SECURITY
-- DEFINER, so it needs no table GRANT — the same reason sync_apply_row and
-- b4_create_owned_shop need none. DEV differs from production only in how the
-- session was authenticated, never in what onboarding does.
--
-- b4_mutate_owned_shop closes the same class of bug in Multi-Shop:
-- multiShop.ts renames and archives with `.from("shops").update(...)`, which is
-- the identical 42501, surfaced to the device as a misleading 404.

-- ── Owner onboarding ────────────────────────────────────────────────────────

create or replace function b4_onboard_owner(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare
  v_shop        jsonb := p_payload->'shop';
  v_owner       jsonb := p_payload->'owner';
  v_roles       jsonb := p_payload->'roles';
  v_settings    jsonb := p_payload->'settings';
  v_shop_id     uuid;
  v_owner_id    uuid;
  v_owner_role  uuid;
  v_phone       text;
  v_created     timestamptz;
  v_updated     timestamptz;
  v_role        jsonb;
  v_names       text[];
  v_existing_shop  shops%rowtype;
  v_existing_owner users%rowtype;
  v_conflict    uuid;
begin
  if v_shop is null or v_owner is null or v_roles is null then
    raise exception 'onboarding payload is incomplete' using errcode='MU041';
  end if;

  v_shop_id    := (v_shop->>'id')::uuid;
  v_owner_id   := (v_owner->>'id')::uuid;
  v_owner_role := (v_owner->>'roleId')::uuid;
  v_phone      := nullif(trim(coalesce(v_owner->>'phone','')),'');
  v_created    := (v_shop->>'createdAt')::timestamptz;
  v_updated    := (v_shop->>'updatedAt')::timestamptz;

  if v_shop_id is null or v_owner_id is null or v_owner_role is null then
    raise exception 'onboarding payload is missing an identifier' using errcode='MU041';
  end if;
  if length(trim(coalesce(v_shop->>'name',''))) not between 1 and 120 then
    raise exception 'invalid shop name' using errcode='MU041';
  end if;
  -- The shop must name this owner and the owner must name this shop. Without
  -- both directions a caller could attach an Owner row to somebody else's shop.
  if (v_shop->>'ownerId')::uuid <> v_owner_id or (v_owner->>'shopId')::uuid <> v_shop_id then
    raise exception 'onboarding payload is inconsistent' using errcode='MU041';
  end if;

  -- The Owner role must be one of the roles being created, and belong here.
  if not exists (
    select 1 from jsonb_array_elements(v_roles) r
    where (r->>'id')::uuid = v_owner_role
      and r->>'name' = 'owner'
      and (r->>'shopId')::uuid = v_shop_id
  ) then
    raise exception 'onboarding payload has no owner role' using errcode='MU041';
  end if;

  -- ── Idempotency and ownership ────────────────────────────────────────────
  -- Re-running must converge on the same rows, never rewrite or fork them.
  select * into v_existing_shop from shops where id = v_shop_id;
  if found then
    if v_existing_shop.owner_id <> v_owner_id or v_existing_shop.is_deleted then
      raise exception 'shop already belongs to another owner' using errcode='MU042';
    end if;
  end if;

  select * into v_existing_owner from users where id = v_owner_id;
  if found and (v_existing_owner.shop_id <> v_shop_id or v_existing_owner.is_deleted) then
    raise exception 'owner already belongs to another shop' using errcode='MU042';
  end if;

  -- users_phone_unique is GLOBAL across shops (partial: phone not null and
  -- is_deleted = false). A collision here is a real product condition — that
  -- number already has a shop — so it gets its own code instead of surfacing
  -- as an opaque 23505 the caller cannot interpret.
  if v_phone is not null then
    select id into v_conflict from users
    where phone = v_phone and is_deleted = false and id <> v_owner_id
    limit 1;
    if v_conflict is not null then
      raise exception 'phone already registered to another owner' using errcode='MU043';
    end if;
  end if;

  -- ── Create, in dependency order, only what is missing ────────────────────
  insert into shops(
    id, owner_id, name, name_en, phone, created_at, updated_at,
    is_deleted, plan, trial_ends_at, commercial_status
  ) values (
    v_shop_id, v_owner_id, trim(v_shop->>'name'), nullif(trim(coalesce(v_shop->>'nameEn','')),''),
    v_shop->>'phone', v_created, v_updated, false, 'free', null, 'active'
  ) on conflict (id) do nothing;

  for v_role in select * from jsonb_array_elements(v_roles) loop
    if (v_role->>'shopId')::uuid <> v_shop_id then
      raise exception 'onboarding payload has a cross-shop role' using errcode='MU041';
    end if;
    insert into roles(id, shop_id, name, is_system, created_at, updated_at, is_deleted)
    values (
      (v_role->>'id')::uuid, v_shop_id, v_role->>'name', true,
      (v_role->>'createdAt')::timestamptz, (v_role->>'updatedAt')::timestamptz, false
    ) on conflict (id) do nothing;
  end loop;

  insert into users(
    id, shop_id, name, phone, pin_hash, pin_set_at, role_id,
    is_active, is_deleted, permission_version, created_at, updated_at
  ) values (
    v_owner_id, v_shop_id, v_owner->>'name', v_phone, v_owner->>'pinHash',
    (v_owner->>'pinSetAt')::timestamptz, v_owner_role,
    true, false, 0,
    (v_owner->>'createdAt')::timestamptz, (v_owner->>'updatedAt')::timestamptz
  ) on conflict (id) do nothing;

  if v_settings is not null then
    insert into shop_b2_settings(id, shop_id, created_at, updated_at)
    values ((v_settings->>'id')::uuid, v_shop_id, v_created, v_updated)
    on conflict (id) do nothing;
  end if;

  -- ── Confirm the settled state rather than trusting the writes ────────────
  select * into v_existing_shop from shops where id = v_shop_id;
  select * into v_existing_owner from users where id = v_owner_id;
  if v_existing_shop.id is null or v_existing_owner.id is null then
    raise exception 'onboarding did not settle' using errcode='MU042';
  end if;
  if not exists (
    select 1 from roles where id = v_owner_role and shop_id = v_shop_id
      and name = 'owner' and is_deleted = false
  ) then
    raise exception 'onboarding did not settle an owner role' using errcode='MU042';
  end if;

  select array_agg(name order by name) into v_names from roles
  where shop_id = v_shop_id and is_deleted = false;

  return jsonb_build_object(
    'shopId', v_shop_id,
    'ownerUserId', v_owner_id,
    'ownerRoleId', v_owner_role,
    'roles', to_jsonb(v_names),
    'created', v_existing_shop.created_at
  );
end
$fn$;

revoke execute on function b4_onboard_owner(jsonb) from public, anon, authenticated;
grant execute on function b4_onboard_owner(jsonb) to service_role;

-- ── Multi-Shop rename / archive / restore ───────────────────────────────────

create or replace function b4_mutate_owned_shop(
  p_billing_account_id uuid,
  p_shop_id uuid,
  p_operation text,
  p_name text,
  p_name_en text
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare
  v_shop shops%rowtype;
  v_now timestamptz := now();
begin
  if p_operation not in ('rename','archive','restore') then
    raise exception 'unsupported shop operation' using errcode='MU044';
  end if;

  -- Scoped by billing account, exactly as the PostgREST filter was: a shop that
  -- is not on this account is simply not found.
  select * into v_shop from shops
  where id = p_shop_id and billing_account_id = p_billing_account_id and is_deleted = false
  for update;
  if not found then
    raise exception 'shop not found' using errcode='MU045';
  end if;

  if p_operation = 'rename' then
    if length(trim(coalesce(p_name,''))) not between 1 and 120 then
      raise exception 'invalid shop name' using errcode='MU044';
    end if;
    update shops set name = trim(p_name),
      name_en = case when p_name_en is null then name_en else nullif(trim(p_name_en),'') end,
      updated_at = v_now
    where id = p_shop_id;
  else
    -- The account's primary shop is the billing anchor; archiving it would
    -- strip the entitlement from every other shop on the account.
    if p_operation = 'archive' and exists (
      select 1 from billing_accounts where id = p_billing_account_id and primary_shop_id = p_shop_id
    ) then
      raise exception 'the primary shop cannot be archived' using errcode='MU046';
    end if;
    update shops
      set archived_at = case when p_operation = 'archive' then v_now else null end,
          updated_at = v_now
    where id = p_shop_id;
  end if;

  select * into v_shop from shops where id = p_shop_id;
  return jsonb_build_object(
    'id', v_shop.id, 'name', v_shop.name, 'name_en', v_shop.name_en,
    'commercial_status', v_shop.commercial_status, 'commercial_reason', v_shop.commercial_reason,
    'archived_at', v_shop.archived_at, 'created_at', v_shop.created_at, 'updated_at', v_shop.updated_at
  );
end
$fn$;

revoke execute on function b4_mutate_owned_shop(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function b4_mutate_owned_shop(uuid,uuid,text,text,text) to service_role;
