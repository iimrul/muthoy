-- A2.3 hardware follow-up: an approval is a one-shot capability, not a way
-- to clear the actor+shop hold. The original migration contains the corrected
-- definitions for fresh installs; this additive migration upgrades projects
-- where 20260923000000 was already applied.

do $fn$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.device_enrollment_holds'::regclass
      and conname = 'device_enrollment_holds_consumption_check'
  ) then
    alter table device_enrollment_holds
      add constraint device_enrollment_holds_consumption_check check (
        (consumed_at is null and consumed_device_id is null)
        or
        (consumed_at is not null and consumed_device_id is not null and approved_at is not null)
      );
  end if;
end
$fn$;

create or replace function a23_prepare_enrollment(
  p_shop_id uuid,
  p_actor_user_id uuid,
  p_device_public_id text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_hold device_enrollment_holds%rowtype;
  v_enforced boolean;
  v_now timestamptz := clock_timestamp();
begin
  if a23_live_actor_role(p_shop_id, p_actor_user_id) is null then
    raise exception 'a live account of this shop is required' using errcode = 'MU063';
  end if;

  select devices_enforced_at is not null into v_enforced
  from shops where id = p_shop_id;
  if not found then
    raise exception 'shop not found' using errcode = 'MU063';
  end if;

  select * into v_hold from device_enrollment_holds
  where shop_id = p_shop_id
    and actor_user_id = p_actor_user_id
  for update;

  if not found then
    if p_device_public_id is null or p_device_public_id = '' then
      return jsonb_build_object(
        'allowed', not v_enforced,
        'held', false,
        'enforced', v_enforced,
        'legacyUnbound', true
      );
    end if;
    return jsonb_build_object(
      'allowed', true, 'held', false, 'enforced', v_enforced,
      'legacyUnbound', false
    );
  end if;

  if p_device_public_id is null or p_device_public_id = '' then
    return jsonb_build_object(
      'allowed', false, 'held', true, 'approved', false,
      'enforced', v_enforced, 'legacyUnbound', true
    );
  end if;

  if v_hold.approved_device_public_id = p_device_public_id
     and v_hold.approved_at is not null
     and v_hold.consumed_at is null then
    return jsonb_build_object(
      'allowed', true, 'held', true, 'approved', true,
      'enforced', v_enforced, 'legacyUnbound', false
    );
  end if;

  update device_enrollment_holds set
    requested_device_public_id = p_device_public_id,
    requested_at = v_now,
    approved_device_public_id = null,
    approved_at = null,
    approved_by_user_id = null,
    approved_by_device_id = null,
    consumed_at = null,
    consumed_device_id = null,
    updated_at = v_now
  where shop_id = p_shop_id and actor_user_id = p_actor_user_id;

  return jsonb_build_object(
    'allowed', false, 'held', true, 'approved', false,
    'enforced', v_enforced, 'legacyUnbound', false
  );
end
$fn$;

create or replace function a23_enroll_device(
  p_shop_id uuid,
  p_actor_user_id uuid,
  p_device_public_id text,
  p_secret_hash text,
  p_label text,
  p_platform text,
  p_model text,
  p_os_version text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_device shop_devices%rowtype;
  v_binding shop_device_bindings%rowtype;
  v_hold device_enrollment_holds%rowtype;
  v_now timestamptz := clock_timestamp();
  v_device_event text;
  v_binding_event text;
  v_consumes_hold boolean := false;
begin
  if p_shop_id is null or p_actor_user_id is null
     or p_device_public_id is null or p_device_public_id = ''
     or p_secret_hash is null or p_secret_hash = '' then
    raise exception 'enrolment identifiers are required' using errcode = 'MU062';
  end if;

  if a23_live_actor_role(p_shop_id, p_actor_user_id) is null then
    raise exception 'a live account of this shop is required' using errcode = 'MU063';
  end if;

  perform 1 from shops where id = p_shop_id for update;

  select * into v_hold from device_enrollment_holds
  where shop_id = p_shop_id
    and actor_user_id = p_actor_user_id
  for update;
  if found then
    if v_hold.approved_at is null
       or v_hold.approved_device_public_id is distinct from p_device_public_id
       or v_hold.consumed_at is not null then
      raise exception 'another active administrator installation must approve enrolment'
        using errcode = 'MU070';
    end if;
    v_consumes_hold := true;
  end if;

  select * into v_device from shop_devices
  where shop_id = p_shop_id and device_public_id = p_device_public_id
  for update;

  if not found then
    insert into shop_devices(
      shop_id, device_public_id, device_secret_hash, label, platform, model,
      os_version, enrolled_by_user_id, enrolled_at, status, last_seen_at,
      created_at, updated_at
    ) values (
      p_shop_id, p_device_public_id, p_secret_hash, nullif(p_label, ''),
      nullif(p_platform, ''), nullif(p_model, ''), nullif(p_os_version, ''),
      p_actor_user_id, v_now, 'active', v_now, v_now, v_now
    ) returning * into v_device;
    v_device_event := 'device_enrolled';
  else
    if v_device.status = 'revoked' then
      raise exception 'this installation has been revoked' using errcode = 'MU064';
    end if;
    update shop_devices set
      device_secret_hash = p_secret_hash,
      platform = coalesce(nullif(p_platform, ''), platform),
      model = coalesce(nullif(p_model, ''), model),
      os_version = coalesce(nullif(p_os_version, ''), os_version),
      label = coalesce(nullif(p_label, ''), label),
      last_seen_at = v_now,
      registry_version = registry_version + 1,
      updated_at = v_now
    where id = v_device.id
    returning * into v_device;
    v_device_event := 'device_adopted';
  end if;

  select * into v_binding from shop_device_bindings
  where device_id = v_device.id and actor_user_id = p_actor_user_id
  for update;

  if not found then
    insert into shop_device_bindings(
      device_id, shop_id, actor_user_id, status, bound_at, bound_by_user_id,
      last_authenticated_at, created_at, updated_at
    ) values (
      v_device.id, p_shop_id, p_actor_user_id, 'active', v_now, p_actor_user_id,
      v_now, v_now, v_now
    ) returning * into v_binding;
    v_binding_event := 'binding_created';
  elsif v_binding.status = 'revoked' then
    raise exception 'this account has been revoked on this installation'
      using errcode = 'MU065';
  else
    update shop_device_bindings set
      last_authenticated_at = v_now,
      updated_at = v_now
    where id = v_binding.id
    returning * into v_binding;
    v_binding_event := 'binding_reused';
  end if;

  insert into device_registry_events(
    shop_id, device_id, binding_id, event, actor_user_id, target_user_id, created_at
  ) values
    (p_shop_id, v_device.id, null, v_device_event, p_actor_user_id, p_actor_user_id, v_now),
    (p_shop_id, v_device.id, v_binding.id, v_binding_event, p_actor_user_id, p_actor_user_id, v_now);

  if v_consumes_hold then
    update device_enrollment_holds set
      consumed_at = v_now,
      consumed_device_id = v_device.id,
      updated_at = v_now
    where shop_id = p_shop_id and actor_user_id = p_actor_user_id;
    insert into device_registry_events(
      shop_id, device_id, binding_id, event, actor_user_id, target_user_id, created_at
    ) values (
      p_shop_id, v_device.id, v_binding.id, 'enrollment_hold_consumed',
      v_hold.approved_by_user_id, p_actor_user_id, v_now
    );
  end if;

  return jsonb_build_object(
    'deviceId', v_device.id,
    'bindingId', v_binding.id,
    'secretHash', v_device.device_secret_hash,
    'authority', a23_device_authority(p_shop_id, p_device_public_id)
  );
end
$fn$;

-- CREATE OR REPLACE preserves ownership and ACL. Reassert the least-privilege
-- contract explicitly so a drifted DEV grant is not carried forward.
revoke all on function a23_prepare_enrollment(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function a23_prepare_enrollment(uuid, uuid, text) to service_role;
revoke all on function a23_enroll_device(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
