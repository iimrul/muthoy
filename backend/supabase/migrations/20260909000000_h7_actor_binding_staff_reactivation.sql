-- H-7 physical-fix follow-up: reactivation is deliberately NOT a generic
-- users-row sync update. Revocation flags remain monotonic in sync_apply_row;
-- only this narrow, audited Owner operation may move false -> true.

create table h7_staff_reactivation_operations (
  operation_id uuid primary key,
  shop_id uuid not null references shops(id) on delete restrict,
  owner_user_id uuid not null references users(id) on delete restrict,
  staff_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);

alter table h7_staff_reactivation_operations enable row level security;
revoke all on table h7_staff_reactivation_operations from public, anon, authenticated, service_role;

create or replace function h7_reactivate_staff(
  p_owner_user_id uuid,
  p_shop_id uuid,
  p_staff_user_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_owner_role text;
  v_staff users%rowtype;
  v_staff_role text;
  v_existing h7_staff_reactivation_operations%rowtype;
  v_permission_version integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_owner_user_id is null or p_shop_id is null
     or p_staff_user_id is null or p_operation_id is null then
    raise exception 'reactivation identifiers are required' using errcode = 'MU050';
  end if;

  -- Serializes capacity checks and reactivations within one shop.
  perform 1 from shops where id = p_shop_id for update;

  select r.name into v_owner_role
  from users u
  join roles r on r.id = u.role_id and r.shop_id = u.shop_id and not r.is_deleted
  join shops s on s.id = u.shop_id
  where u.id = p_owner_user_id and u.shop_id = p_shop_id
    and u.is_active and not u.is_deleted and u.plan_suspended_at is null
    and not s.is_deleted and s.archived_at is null
    and s.commercial_status = 'active'
    and b4_shop_write_permitted(s.id);
  if v_owner_role is distinct from 'owner' then
    raise exception 'live Owner access required' using errcode = 'MU051';
  end if;

  select * into v_existing from h7_staff_reactivation_operations
  where operation_id = p_operation_id;
  if found then
    if v_existing.shop_id is distinct from p_shop_id
       or v_existing.owner_user_id is distinct from p_owner_user_id
       or v_existing.staff_user_id is distinct from p_staff_user_id then
      raise exception 'operation id belongs to another request' using errcode = 'MU052';
    end if;
    select permission_version into v_permission_version from users
    where id = p_staff_user_id and shop_id = p_shop_id;
    return jsonb_build_object(
      'staffUserId', p_staff_user_id,
      'shopId', p_shop_id,
      'permissionVersion', v_permission_version,
      'replayed', true
    );
  end if;

  select u.* into v_staff
  from users u
  where u.id = p_staff_user_id and u.shop_id = p_shop_id
  for update;
  if not found then
    raise exception 'staff account not found in Owner shop' using errcode = 'MU053';
  end if;
  if v_staff.is_deleted then
    raise exception 'deleted staff cannot be reactivated' using errcode = 'MU054';
  end if;
  select name into v_staff_role from roles
  where id = v_staff.role_id and shop_id = p_shop_id and not is_deleted;
  if v_staff_role not in ('staff', 'manager') then
    raise exception 'only Staff or Manager accounts can be reactivated' using errcode = 'MU055';
  end if;
  if v_staff.is_active and v_staff.plan_suspended_at is null then
    insert into h7_staff_reactivation_operations(
      operation_id, shop_id, owner_user_id, staff_user_id, created_at
    ) values (
      p_operation_id, p_shop_id, p_owner_user_id, p_staff_user_id, v_now
    );
    -- Make the authoritative active row newer than any stale local false row,
    -- so the required full hydration can repair an interrupted prior attempt.
    update users set updated_at = greatest(updated_at, v_now)
    where id = p_staff_user_id and shop_id = p_shop_id;
    return jsonb_build_object(
      'staffUserId', p_staff_user_id,
      'shopId', p_shop_id,
      'permissionVersion', v_staff.permission_version,
      'alreadyActive', true,
      'replayed', false
    );
  elsif v_staff.is_active then
    raise exception 'plan-suspended staff cannot be reactivated' using errcode = 'MU057';
  end if;
  if not b4_staff_row_within_limit(
    jsonb_build_object(
      'id', v_staff.id,
      'shop_id', v_staff.shop_id,
      'role_id', v_staff.role_id,
      'is_active', true
    ),
    v_now
  ) then
    raise exception 'staff plan limit reached' using errcode = 'MU057';
  end if;

  insert into h7_staff_reactivation_operations(
    operation_id, shop_id, owner_user_id, staff_user_id, created_at
  ) values (
    p_operation_id, p_shop_id, p_owner_user_id, p_staff_user_id, v_now
  );

  update users
  set is_active = true,
      plan_suspended_at = null,
      plan_suspension_reason = null,
      updated_at = greatest(updated_at, v_now)
  where id = p_staff_user_id and shop_id = p_shop_id and not is_deleted;

  -- The existing users_bump_permission_version trigger increments exactly once
  -- for the false -> true transition. This audit row and the operation ledger
  -- commit atomically with it.
  insert into audit_logs(
    id, shop_id, actor_id, action, target, meta, created_at, updated_at
  ) values (
    p_operation_id,
    p_shop_id,
    p_owner_user_id,
    'staff_activated',
    p_staff_user_id::text,
    jsonb_build_object('source', 'owner_server_reactivation', 'operation_id', p_operation_id)::text,
    v_now,
    v_now
  );

  select permission_version into v_permission_version from users
  where id = p_staff_user_id and shop_id = p_shop_id;
  return jsonb_build_object(
    'staffUserId', p_staff_user_id,
    'shopId', p_shop_id,
    'permissionVersion', v_permission_version,
    'replayed', false
  );
end
$fn$;

alter function h7_reactivate_staff(uuid, uuid, uuid, uuid) owner to postgres;
revoke execute on function h7_reactivate_staff(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function h7_reactivate_staff(uuid, uuid, uuid, uuid)
  to service_role;
