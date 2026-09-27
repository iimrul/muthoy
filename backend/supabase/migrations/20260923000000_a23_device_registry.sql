-- A2.3 — the server-side device registry.
--
-- Until this migration the word "device" meant nothing to the server. A random
-- id in plain MMKV (apps/mobile/native/deviceId.ts) tagged held sales and
-- refund claims and was never transmitted; the only thing binding a handset to
-- a shop was whichever Supabase Auth session happened to be stored on it.
--
-- Two consequences followed, and this file addresses both.
--
--   1. There was no way to revoke ONE handset. A lost phone could only be
--      answered by deactivating the people who used it, which also locks them
--      out of every other device they own.
--
--   2. Because the session IS the binding, and a session names exactly one
--      actor, an Owner and a Staff member sharing one pharmacy phone could not
--      both be logged-in identities. Handing the phone over sent the incoming
--      actor back through phone + PIN device-login every single time. A shared
--      till is the normal case in this product, so that is a daily tax.
--
-- The registry makes the DEVICE a first-class, revocable principal, and gives
-- an already-registered installation the standing to ask for a session for a
-- different actor of the same shop — which is what turns a handover back into
-- a PIN entry.
--
--
-- WHAT "DEVICE" MEANS HERE, EXACTLY
--
-- An INSTALLATION, not a physical handset. device_public_id lives in app
-- storage, so clearing app data or reinstalling produces a new one and
-- therefore a new row. Android offers no identifier that is both stable across
-- a data clear and scoped to this app (ANDROID_ID survives a data clear but
-- resets on factory reset and is keyed to the signing key; Keystore entries are
-- destroyed with app data). Hardware attestation would close it and is
-- deliberately out of scope for this batch.
--
-- This is a decision, not an oversight, and every surface says so: the product
-- copy calls these registered installations, the Owner gets a list so orphans
-- can be pruned, and nothing here claims a revoked install cannot return under
-- a new id. What it still costs an attacker is unchanged: a fresh installation
-- must present phone + PIN through device-login before it can enrol at all.
--
--
-- THE SESSION IS THE DEVICE IDENTITY
--
-- An authenticated request never says which installation it came from. It
-- cannot be trusted to: a device id in a request body is chosen by whoever
-- sends the request, so a revoked handset would simply send a different one.
--
-- Instead an auth session is BOUND to an installation at the moment it is
-- minted, by the flow that proved the credential (phone + PIN, an OTP, or the
-- device-secret actor switch). A protected request then derives its device and
-- its binding from the `session_id` claim of its own verified JWT, through
-- auth_session_devices below. Nothing a caller writes is consulted.
--
-- Two things follow, and they are the heart of this file:
--
--   REVOCATION IS IMMEDIATE, ALWAYS. Once a session is bound, revoking its
--   device or its binding refuses it on the next request — no enforcement
--   flag, no client cooperation, no waiting for a sync cycle.
--
--   ENFORCEMENT ONLY DECIDES WHAT HAPPENS TO THE UNBOUND. A session with no
--   binding is LEGACY: minted before this shipped, or by a flow that proved
--   nothing. shops.devices_enforced_at means exactly "unbound legacy sessions
--   are no longer accepted" — never "revocation starts working".
--
--
-- ADOPT ON FIRST STRONG AUTH, NOT ON FIRST CONTACT
--
-- An installation the registry has never seen is registered the first time
-- somebody completes a credential-proven sign-in on it, and never merely by
-- asking. There is no route by which an existing token can register a new
-- installation — a stolen access token must not be able to mint itself a
-- trusted device. a23_bind_auth_session is the only way in, and every caller
-- of it sits immediately after a proof.
--
-- Nothing becomes illegal by deploying this: unbound sessions keep working,
-- and a shop enforces only when an Owner or Manager decides it should.
-- Enrolment does NOT stamp devices_enforced_at — an earlier draft did, which
-- reads as harmless and is not: in a three-till pharmacy the first handset to
-- update would enforce the whole shop, and the two tills still on the previous
-- build would stop syncing mid-trading.

-- == 1. The rollout switch =================================================

alter table shops add column if not exists devices_enforced_at timestamptz;

-- == 2. The device =========================================================

create table shop_devices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  -- Client-generated, per installation. Unique only WITHIN a shop: the same
  -- handset enrolled in two shops is two rows, which is what "one physical
  -- device + one shop = one device record" means in practice.
  device_public_id text not null,
  -- SHA-256 of a 256-bit random secret, hex. NOT bcrypt: bcrypt's cost exists
  -- to slow guessing of low-entropy human input and buys nothing against a
  -- uniformly random 256-bit value, while costing ~300ms on a hot path. The
  -- comparison is constant-time in the Edge function, which is why this column
  -- is read out rather than matched on in SQL.
  device_secret_hash text not null,
  label text,
  platform text,
  model text,
  os_version text,
  enrolled_by_user_id uuid not null references users(id) on delete restrict,
  enrolled_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'revoked')),
  revoked_at timestamptz,
  revoked_by uuid references users(id) on delete restrict,
  revoke_reason text,
  last_seen_at timestamptz,
  -- Monotonic. Every change to this device OR to any of its bindings bumps it,
  -- so a client holding an older value knows its mirror is stale and a replay
  -- of an older snapshot can be recognised and discarded.
  registry_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, device_public_id)
);

create index shop_devices_shop_status_idx on shop_devices(shop_id, status);

-- == 3. The per-actor binding ==============================================
--
-- A device may carry several bindings under one shop — that is the point. Each
-- is independently revocable, and revoking one must not disturb the others.
--
-- Bindings are created EXPLICITLY, at that actor's first authenticated sign-in
-- on this installation. A shop membership does not imply a binding: auto-
-- binding every member would hand a newly enrolled till standing to mint a
-- session for every person in the shop before any of them had touched it.

create table shop_device_bindings (
  id uuid primary key default gen_random_uuid(),
  -- Never cascade a registry principal away. A session bound to a revoked
  -- installation must stay bound-and-revoked, not become legacy-unbound
  -- because somebody hard-deleted the parent row.
  device_id uuid not null references shop_devices(id) on delete restrict,
  -- Denormalised so every lookup can filter without a join back to
  -- shop_devices. Kept honest by the trigger below rather than by convention.
  shop_id uuid not null references shops(id) on delete cascade,
  actor_user_id uuid not null references users(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'revoked')),
  bound_at timestamptz not null default now(),
  bound_by_user_id uuid references users(id) on delete restrict,
  last_authenticated_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references users(id) on delete restrict,
  revoke_reason text,
  binding_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, actor_user_id)
);

create index shop_device_bindings_shop_actor_idx
  on shop_device_bindings(shop_id, actor_user_id, status);
create index shop_device_bindings_device_idx
  on shop_device_bindings(device_id, status);

-- SECURITY DEFINER like every other function here, and for the same reason.
-- It has to READ shop_devices to check the invariant, and no API role can read
-- that table at all — so a trigger running as the invoker would depend on
-- always being fired from inside another definer function. That happens to be
-- true today. Relying on it means this integrity check fails open the first
-- time it is not.
create or replace function a23_binding_shop_matches_device()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from shop_devices where id = new.device_id;
  if v_shop is null or v_shop is distinct from new.shop_id then
    raise exception 'binding shop does not match its device' using errcode = 'MU060';
  end if;
  return new;
end
$fn$;

create trigger a23_binding_shop_matches_device_trg
  before insert or update on shop_device_bindings
  for each row execute function a23_binding_shop_matches_device();

-- == 4. The audit trail ====================================================
--
-- Append-only. Device access is the kind of thing that gets argued about after
-- the fact, so every transition records who did it and why.

create table device_registry_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  device_id uuid references shop_devices(id) on delete set null,
  binding_id uuid references shop_device_bindings(id) on delete set null,
  event text not null check (event in (
    'device_enrolled', 'device_adopted', 'binding_created', 'binding_reused',
    'actor_switch', 'device_revoked', 'device_restored',
    'binding_revoked', 'binding_restored',
    'enrollment_hold_created', 'enrollment_approved',
    'enrollment_hold_consumed',
    -- Throwing the enforcement switch is the single most consequential act in
    -- this schema: it is the moment unregistered installations stop working.
    -- It is audited like a revocation because that is what it is.
    'device_enforcement_enabled', 'device_enforcement_disabled'
  )),
  actor_user_id uuid references users(id) on delete restrict,
  target_user_id uuid references users(id) on delete restrict,
  reason text,
  created_at timestamptz not null default clock_timestamp()
);

create index device_registry_events_shop_idx
  on device_registry_events(shop_id, created_at desc);

-- == 4b. The session → installation binding ================================
--
-- THE TRUST ANCHOR. Everything else in this file now depends on it.
--
-- The first cut of A2.3 had the client send its `device_public_id` on every
-- protected request and the server check that id against the registry. That is
-- not an authorization. The id is a field in a request body, so a revoked
-- handset could send a different one, send none at all, or send the id of a
-- device it had watched a colleague use. The secret helped, but it lived in
-- the same app storage the revoked device still controlled.
--
-- The question being asked was the wrong one. "Which device does this request
-- CLAIM to come from?" cannot be answered safely. "Which device was this
-- SESSION created on?" can, because the session id is a claim inside a JWT
-- that GoTrue has already verified, and no client can forge or vary it.
--
-- So an auth session is bound to an installation at the moment it is minted,
-- by the flow that proved the credential, and a protected request derives its
-- device and binding by looking that verified session id up HERE. The request
-- body no longer carries device identity at all on an authenticated route.
--
-- Consequences worth being explicit about:
--
--   - Revoking a device or a binding refuses every session bound to it on the
--     very next request, with no cooperation from the device and no
--     enforcement flag required. Revocation is immediate by construction.
--   - A session absent from this table is LEGACY: minted before this existed,
--     or by a flow that proved nothing. It keeps working until the shop
--     enforces, and is refused afterwards. That is the entire meaning of
--     devices_enforced_at — "unbound legacy sessions are no longer accepted",
--     never "revocation starts working".
create table auth_session_devices (
  -- The `session_id` claim of the verified access token. GoTrue issues one per
  -- session and every refreshed token carries the same value, so a binding
  -- survives token rotation and dies with the session itself.
  auth_session_id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  actor_user_id uuid not null references users(id) on delete restrict,
  device_id uuid not null references shop_devices(id) on delete restrict,
  binding_id uuid not null references shop_device_bindings(id) on delete restrict,
  -- The device secret digest as it stood when this session was bound.
  --
  -- Not a credential check for ordinary requests — the session id is already
  -- the proof. It exists so that one specific act can demand more: enabling
  -- enforcement. A second actor enrolling on the same installation ROTATES the
  -- secret, which leaves an older session holding a stale view of a device
  -- that is otherwise perfectly valid. Letting that session throw the switch
  -- is how an Owner would strand themselves.
  secret_hash_at_bind text not null,
  bound_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index auth_session_devices_device_idx on auth_session_devices(device_id);
create index auth_session_devices_actor_idx
  on auth_session_devices(shop_id, actor_user_id);

-- == 4c. Explicit re-enrolment holds =======================================
--
-- Revoking an installation is a statement about more than one public id.
-- Without this row, the person holding the removed phone can clear app data,
-- obtain a fresh installation id, prove the same OTP/PIN, and immediately
-- return as a brand-new device. One active row per actor+shop survives that
-- reinstall. Approval is specific to the pending installation id and is
-- consumed by enrolment; it is never a blanket "revocation forgotten" bit.
create table device_enrollment_holds (
  shop_id uuid not null references shops(id) on delete cascade,
  actor_user_id uuid not null references users(id) on delete restrict,
  source_device_id uuid not null references shop_devices(id) on delete restrict,
  held_at timestamptz not null default clock_timestamp(),
  held_by_user_id uuid not null references users(id) on delete restrict,
  reason text,
  requested_device_public_id text,
  requested_at timestamptz,
  approved_device_public_id text,
  approved_at timestamptz,
  approved_by_user_id uuid references users(id) on delete restrict,
  approved_by_device_id uuid references shop_devices(id) on delete restrict,
  consumed_at timestamptz,
  consumed_device_id uuid references shop_devices(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (shop_id, actor_user_id),
  check (
    (approved_at is null and approved_by_user_id is null and approved_by_device_id is null
      and approved_device_public_id is null)
    or
    (approved_at is not null and approved_by_user_id is not null
      and approved_by_device_id is not null and approved_device_public_id is not null)
  ),
  check (
    (consumed_at is null and consumed_device_id is null)
    or
    (consumed_at is not null and consumed_device_id is not null and approved_at is not null)
  )
);

create index device_enrollment_holds_pending_idx
  on device_enrollment_holds(shop_id, consumed_at, requested_at desc);

-- == 5. Lockdown ===========================================================
--
-- No API role touches these tables directly, in either direction. Every read
-- and every write goes through the SECURITY DEFINER functions below, which is
-- what lets each one assert its own authorization rather than hoping a policy
-- covers the case. RLS is enabled with no permissive policy, so a future
-- accidental GRANT still denies rather than opening the table.

alter table shop_devices enable row level security;
alter table shop_device_bindings enable row level security;
alter table device_registry_events enable row level security;
alter table auth_session_devices enable row level security;
alter table device_enrollment_holds enable row level security;

revoke all on table shop_devices from public, anon, authenticated, service_role;
revoke all on table shop_device_bindings from public, anon, authenticated, service_role;
revoke all on table device_registry_events from public, anon, authenticated, service_role;
revoke all on table auth_session_devices from public, anon, authenticated, service_role;
revoke all on table device_enrollment_holds from public, anon, authenticated, service_role;

-- == 6. Shared predicates ==================================================

-- A live actor of this shop, with their role name. Returns null for anything
-- not currently allowed to act: deleted, deactivated, plan-suspended, or in an
-- archived/deleted shop. Every function below starts here, so none of them can
-- accidentally admit a revoked account by forgetting a condition.
create or replace function a23_live_actor_role(p_shop_id uuid, p_user_id uuid)
returns text language sql stable security definer set search_path = public as $fn$
  select r.name
  from users u
  join roles r on r.id = u.role_id and r.shop_id = u.shop_id and not r.is_deleted
  join shops s on s.id = u.shop_id
  where u.id = p_user_id
    and u.shop_id = p_shop_id
    and u.is_active
    and not u.is_deleted
    and u.plan_suspended_at is null
    and not s.is_deleted
    and s.archived_at is null
  limit 1
$fn$;

-- Who may administer devices. Owner and Manager both, because a Manager is the
-- person actually standing in the shop when a handset goes missing; requiring
-- the Owner would mean a lost till stays live until they are reachable.
create or replace function a23_assert_device_admin(p_shop_id uuid, p_user_id uuid)
returns text language plpgsql stable security definer set search_path = public as $fn$
declare
  v_role text;
begin
  v_role := a23_live_actor_role(p_shop_id, p_user_id);
  if v_role is null or v_role not in ('owner', 'manager') then
    raise exception 'device administration requires a live Owner or Manager'
      using errcode = 'MU061';
  end if;
  return v_role;
end
$fn$;

-- The whole device picture for one installation, as the client mirrors it.
--
-- Deliberately does NOT include the secret hash: a snapshot read happens on
-- every sync cycle, and the credential has no business travelling that often.
-- a23_device_secret_hash below is the one place it is handed out.
create or replace function a23_device_authority(
  p_shop_id uuid,
  p_device_public_id text
) returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_device shop_devices%rowtype;
  v_enforced timestamptz;
  v_bindings jsonb;
begin
  select devices_enforced_at into v_enforced from shops where id = p_shop_id;

  select * into v_device from shop_devices
  where shop_id = p_shop_id and device_public_id = p_device_public_id;

  if not found then
    -- Deny by revocation, not allow by enrolment: an installation the registry
    -- has never seen is UNKNOWN, and unknown is not revoked. The client treats
    -- it as no objection and carries on exactly as it did before A2.3.
    return jsonb_build_object(
      'shopId', p_shop_id,
      'devicePublicId', p_device_public_id,
      'known', false,
      'status', 'unknown',
      'registryVersion', 0,
      'enforced', v_enforced is not null,
      'bindings', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'actorUserId', b.actor_user_id,
    'status', b.status,
    'bindingVersion', b.binding_version
  ) order by b.actor_user_id), '[]'::jsonb)
  into v_bindings
  from shop_device_bindings b
  where b.device_id = v_device.id;

  return jsonb_build_object(
    'shopId', p_shop_id,
    'devicePublicId', p_device_public_id,
    'known', true,
    'deviceId', v_device.id,
    'status', v_device.status,
    'registryVersion', v_device.registry_version,
    'enforced', v_enforced is not null,
    'bindings', v_bindings
  );
end
$fn$;

create or replace function a23_device_secret_hash(
  p_shop_id uuid,
  p_device_public_id text
) returns text language sql stable security definer set search_path = public as $fn$
  select device_secret_hash from shop_devices
  where shop_id = p_shop_id and device_public_id = p_device_public_id
$fn$;

-- == 6b. The request gate ==================================================
--
-- Everything one protected request needs, derived from the VERIFIED session id
-- and nothing else: whether this session is bound to an installation at all,
-- what the shop's enforcement state is, and — if bound — whether that
-- installation and this actor's binding on it are still active.
--
-- Note what it does NOT take: a device_public_id. There is no parameter here a
-- caller could supply, which is the whole point. The previous version took one
-- and was therefore asking the client to nominate its own authority.
--
-- The decision itself is made in the Edge function (deviceRegistryPolicy.ts's
-- decideDeviceGate) so it can be a pure function a test drives through every
-- combination rather than a branch buried in plpgsql. This returns facts.
create or replace function a23_session_gate(
  p_auth_session_id uuid,
  p_shop_id uuid,
  p_actor_user_id uuid
) returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_map auth_session_devices%rowtype;
  v_device shop_devices%rowtype;
  v_binding shop_device_bindings%rowtype;
  v_enforced timestamptz;
begin
  select devices_enforced_at into v_enforced from shops where id = p_shop_id;

  if p_auth_session_id is null then
    -- No session_id claim at all: an older token, or a provider that stopped
    -- minting one. Legacy, and treated exactly as an unbound session.
    return jsonb_build_object(
      'bound', false, 'enforced', v_enforced is not null,
      'deviceStatus', null, 'bindingStatus', null, 'authority', null
    );
  end if;

  select * into v_map from auth_session_devices where auth_session_id = p_auth_session_id;
  if not found then
    return jsonb_build_object(
      'bound', false, 'enforced', v_enforced is not null,
      'deviceStatus', null, 'bindingStatus', null, 'authority', null
    );
  end if;

  -- A session bound in one shop cannot speak for another, and a session bound
  -- to one actor cannot speak for a different one. Multi-shop callers go
  -- through a23_blocked_shops, which resolves the target shop's OWN
  -- registration of the same installation.
  if v_map.shop_id is distinct from p_shop_id
     or v_map.actor_user_id is distinct from p_actor_user_id then
    return jsonb_build_object(
      'bound', true, 'enforced', v_enforced is not null,
      'deviceStatus', 'mismatched', 'bindingStatus', null, 'authority', null
    );
  end if;

  select * into v_device from shop_devices where id = v_map.device_id;
  select * into v_binding from shop_device_bindings where id = v_map.binding_id;

  return jsonb_build_object(
    'bound', true,
    'enforced', v_enforced is not null,
    'deviceStatus', v_device.status,
    'bindingStatus', v_binding.status,
    'devicePublicId', v_device.device_public_id,
    'authority', a23_device_authority(p_shop_id, v_device.device_public_id)
  );
end
$fn$;

-- This session's snapshot, for the pull envelope and the explicit refresh.
--
-- Derived from the session rather than from a request field, so a device
-- cannot ask about an installation that is not its own.
create or replace function a23_session_authority(
  p_auth_session_id uuid,
  p_shop_id uuid
) returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_public_id text;
begin
  select d.device_public_id into v_public_id
  from auth_session_devices m
  join shop_devices d on d.id = m.device_id
  where m.auth_session_id = p_auth_session_id and m.shop_id = p_shop_id;

  if v_public_id is null then return null; end if;
  return a23_device_authority(p_shop_id, v_public_id);
end
$fn$;

-- == 6c. Cross-shop access =================================================
--
-- Which of these shops this session's installation may NOT act in.
--
-- Multi-shop was the hole the session model made obvious: shop-summaries hands
-- back every shop's takings, and shop-mutate renames and archives shops other
-- than the active one, so validating either against the CALLER'S CURRENT shop
-- checks the wrong thing entirely.
--
-- The installation is resolved from the session, then looked up again under
-- each target shop by its public id — one handset enrolled in two shops is two
-- rows, and each shop revokes its own independently. Nothing here is supplied
-- by the caller except the list of shops being asked about, and membership is
-- re-derived per shop rather than assumed.
create or replace function a23_blocked_shops(
  p_auth_session_id uuid,
  p_principal_user_id uuid,
  p_shop_ids uuid[]
) returns uuid[] language plpgsql stable security definer set search_path = public as $fn$
declare
  v_shop uuid;
  v_public_id text;
  v_blocked uuid[] := '{}';
  v_actor uuid;
  v_device shop_devices%rowtype;
  v_binding shop_device_bindings%rowtype;
begin
  select d.device_public_id into v_public_id
  from auth_session_devices m
  join shop_devices d on d.id = m.device_id
  where m.auth_session_id = p_auth_session_id;

  foreach v_shop in array coalesce(p_shop_ids, '{}'::uuid[]) loop
    if v_public_id is null then
      -- No installation can be resolved from this session. This is the ONLY
      -- case controlled solely by rollout enforcement: legacy while OFF,
      -- blocked while ON.
      if (select devices_enforced_at from shops where id = v_shop) is not null then
        v_blocked := v_blocked || v_shop;
      end if;
      continue;
    end if;

    -- Resolve the target shop's own registration BEFORE consulting its
    -- rollout flag. A known revocation is authority and bites while OFF;
    -- enforcement controls only the unknown/unbound fallback below.
    select * into v_device from shop_devices
    where shop_id = v_shop and device_public_id = v_public_id;
    if found and v_device.status = 'revoked' then
      v_blocked := v_blocked || v_shop;
      continue;
    end if;

    if not found then
      if (select devices_enforced_at from shops where id = v_shop) is not null then
        v_blocked := v_blocked || v_shop;
      end if;
      continue;
    end if;

    select actor_user_id into v_actor from shop_memberships
    where principal_user_id = p_principal_user_id and shop_id = v_shop and is_active;
    if v_actor is null then
      if (select devices_enforced_at from shops where id = v_shop) is not null then
        v_blocked := v_blocked || v_shop;
      end if;
      continue;
    end if;

    select * into v_binding from shop_device_bindings
    where device_id = v_device.id and actor_user_id = v_actor;
    if found and v_binding.status = 'revoked' then
      v_blocked := v_blocked || v_shop;
    elsif not found
      and (select devices_enforced_at from shops where id = v_shop) is not null then
      v_blocked := v_blocked || v_shop;
    end if;
  end loop;

  return v_blocked;
end
$fn$;

-- == 6d2. The enforcement switch ===========================================
--
-- The only writer of shops.devices_enforced_at.
--
-- Guarded by the CALLER'S OWN SESSION, which must be bound to an active
-- installation with an active binding, AND whose recorded secret digest must
-- still match the device's current one. Without that last condition an Owner
-- whose installation had been re-enrolled by a colleague — rotating the secret
-- and leaving this session's view stale — could throw the switch and be the
-- first person it locked out.
create or replace function a23_set_device_enforcement(
  p_shop_id uuid,
  p_caller_user_id uuid,
  p_auth_session_id uuid,
  p_enabled boolean
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_map auth_session_devices%rowtype;
  v_device shop_devices%rowtype;
  v_binding shop_device_bindings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_enforced timestamptz;
  v_device_id uuid;
begin
  perform a23_assert_device_admin(p_shop_id, p_caller_user_id);

  if p_enabled then
    if p_auth_session_id is null then
      raise exception 'enforcement can only be enabled from a bound session'
        using errcode = 'MU068';
    end if;
    select * into v_map from auth_session_devices
    where auth_session_id = p_auth_session_id for update;
    if not found or v_map.shop_id <> p_shop_id or v_map.actor_user_id <> p_caller_user_id then
      raise exception 'enforcement can only be enabled from a bound session'
        using errcode = 'MU068';
    end if;

    select * into v_device from shop_devices where id = v_map.device_id for update;
    if not found or v_device.shop_id <> p_shop_id then
      raise exception 'installation not found in this shop' using errcode = 'MU066';
    end if;
    if v_device.status <> 'active' then
      raise exception 'this installation has been revoked' using errcode = 'MU064';
    end if;
    -- The staleness check. Same device, but this session was bound against a
    -- secret that has since been rotated out from under it.
    if v_device.device_secret_hash is distinct from v_map.secret_hash_at_bind then
      raise exception 'this session holds a stale view of the installation'
        using errcode = 'MU069';
    end if;

    select * into v_binding from shop_device_bindings where id = v_map.binding_id;
    if not found or v_binding.status <> 'active' then
      raise exception 'this account has been revoked on this installation'
        using errcode = 'MU065';
    end if;
    v_device_id := v_device.id;
  end if;

  select devices_enforced_at into v_enforced from shops where id = p_shop_id for update;

  -- Idempotent in both directions: re-enabling does not move the timestamp, so
  -- the record of WHEN a shop started enforcing survives a double tap.
  if p_enabled and v_enforced is null then
    update shops set devices_enforced_at = v_now where id = p_shop_id;
    insert into device_registry_events(
      shop_id, device_id, event, actor_user_id, created_at
    ) values (
      p_shop_id, v_device_id, 'device_enforcement_enabled', p_caller_user_id, v_now
    );
  elsif not p_enabled and v_enforced is not null then
    update shops set devices_enforced_at = null where id = p_shop_id;
    insert into device_registry_events(
      shop_id, device_id, event, actor_user_id, created_at
    ) values (
      -- No device: turning enforcement OFF is a shop-wide act and is allowed
      -- from any admin session, including an unbound one — which is exactly
      -- the state somebody would be in while undoing a mistake.
      p_shop_id, null, 'device_enforcement_disabled', p_caller_user_id, v_now
    );
  end if;

  return jsonb_build_object(
    'shopId', p_shop_id,
    'enforced', (select devices_enforced_at is not null from shops where id = p_shop_id)
  );
end
$fn$;

-- == 6d. Attempt reservation ===============================================
--
-- The concurrency-safe replacement for "ask whether it is locked, do the
-- expensive work, then record the failure".
--
-- That sequence has three faults, and the unauthenticated actor switch sits on
-- all of them. The check and the increment are separate statements, so N
-- parallel requests all read the same count and all pass. The lock only landed
-- once the count EXCEEDED the budget, so a budget of 5 bought 6 guesses. And
-- nothing counted attempts that rotated the device or actor id, which are both
-- request-controlled, so an attacker could spend unlimited server bcrypt by
-- never reusing a key.
--
-- This reserves first and partially refunds on success. The attempt is charged BEFORE
-- the work, inside one transaction that holds a row lock per key, so passing
-- the gate without having already incremented is not a state that exists. The
-- caller clears the device/actor keys when the credentials verify, while the
-- shared abuse key stays charged so one valid PIN cannot buy unlimited bcrypt.
--
-- Keys are processed in sorted order so two requests sharing two keys can
-- never take them in opposite orders and deadlock.
create or replace function a23_reserve_attempts(
  p_keys text[],
  p_limits integer[]
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_index integer;
  v_key text;
  v_limit integer;
  v_count integer;
  v_locked timestamptz;
  v_order integer[];
begin
  if p_keys is null or p_limits is null
     or array_length(p_keys, 1) is distinct from array_length(p_limits, 1) then
    raise exception 'attempt keys and limits must correspond' using errcode = 'MU062';
  end if;

  select array_agg(ordinality order by key) into v_order
  from unnest(p_keys) with ordinality as t(key, ordinality);

  foreach v_index in array v_order loop
    v_key := p_keys[v_index];
    v_limit := greatest(p_limits[v_index], 1);

    -- One statement: insert-or-increment, taking the row lock as it goes. A
    -- concurrent caller blocks here and then reads the value this one wrote,
    -- which is the whole point — there is no window in which both see the
    -- pre-increment count.
    insert into login_attempts as la (key, failed_count, first_failed_at, updated_at)
    values (v_key, 1, now(), now())
    on conflict (key) do update set
      failed_count = case
        when la.locked_until is not null and la.locked_until > now() then la.failed_count
        when la.updated_at < now() - interval '15 minutes' then 1
        else la.failed_count + 1 end,
      first_failed_at = case
        when la.updated_at < now() - interval '15 minutes' then now()
        else la.first_failed_at end,
      updated_at = now()
    returning la.failed_count, la.locked_until into v_count, v_locked;

    if v_locked is not null and v_locked > now() then
      return jsonb_build_object('allowed', false, 'scope', v_key);
    end if;

    -- `>=`, not `>`. At the limit-th failure the budget is spent: this attempt
    -- is the last one allowed and the lock is armed for everything after it.
    if v_count >= v_limit then
      update login_attempts
        set locked_until = now() + least(
          make_interval(secs => 60 * power(2, v_count - v_limit)::double precision),
          interval '15 minutes')
        where key = v_key;
    end if;
  end loop;

  return jsonb_build_object('allowed', true, 'scope', null);
end
$fn$;

-- == 6e. Enrolment preflight ==============================================
--
-- Runs inside the credential-proven flow, before a session is minted or a PIN
-- recovery changes anything. It records the exact replacement installation an
-- administrator may approve. Returning a decision rather than raising keeps
-- that request durable; an exception would roll the pending id back with it.
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
    -- Missing id is the explicitly legacy case. It survives only while rollout
    -- enforcement is OFF; an A2.3-capable caller is refused by the Edge boundary
    -- before it reaches here. This branch deliberately follows the hold lookup:
    -- a revoked actor cannot claim to be a legacy client to obtain an unbound
    -- session while enforcement is still off.
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
    -- A different request invalidates an earlier approval. Approval is for one
    -- exact installation, never a reusable ticket.
    approved_device_public_id = null,
    approved_at = null,
    approved_by_user_id = null,
    approved_by_device_id = null,
    -- The hold row is permanent. These fields describe only the current
    -- one-shot approval request, so a consumed capability transitions back to
    -- pending without removing the actor+shop hold itself.
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

-- == 7. Enrolment ==========================================================
--
-- INTERNAL. Deliberately not granted to service_role: the only way to reach it
-- is a23_bind_auth_session below, which exists so that registering an
-- installation is inseparable from binding the session that just proved a
-- credential. An enrolment entry point reachable on its own is an enrolment
-- entry point any current access token can call, and that is precisely the
-- bypass this batch removed.
--
-- It decides whether the proven actor may register this installation, and
-- creates the binding for exactly them — nobody else.
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

  -- Serialises concurrent enrolments of the same installation, which two
  -- simultaneous logins on one handset genuinely produce.
  perform 1 from shops where id = p_shop_id for update;

  -- Defence in depth: preflight gives the user an actionable refusal before a
  -- session is minted, but enrolment itself owns the policy. No caller of this
  -- internal function may bypass the actor+shop hold, and approval is valid
  -- only for the exact pending installation id.
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
    -- A revoked installation does NOT come back by logging in again. Letting
    -- credential proof re-enrol it would make device revocation meaningless:
    -- the person holding the lost phone is usually the person who also knows a
    -- PIN. Restoring it is an explicit, audited Owner/Manager act.
    if v_device.status = 'revoked' then
      raise exception 'this installation has been revoked' using errcode = 'MU064';
    end if;
    -- Adoption: an installation already known to the registry, now being used
    -- by an actor who has not signed in on it before. The secret is ROTATED,
    -- so the credential a device holds is always the one from its most recent
    -- authoritative proof.
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
    -- Same rule as the device. A binding an Owner deliberately cut must not
    -- heal itself the next time that person types their PIN.
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

  -- devices_enforced_at is deliberately NOT touched here. Enrolling a handset
  -- adds a registration; it does not decide that unregistered handsets have
  -- stopped being allowed to trade. See the header, and
  -- a23_set_device_enforcement below, which is the only writer of that column.

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

  -- The ids travel back so a23_bind_auth_session can record the session
  -- mapping in the SAME transaction. Splitting them would allow a device to
  -- exist with no session bound to it, or a binding to be created for a
  -- session that then failed to record — the halves have to land together.
  return jsonb_build_object(
    'deviceId', v_device.id,
    'bindingId', v_binding.id,
    'secretHash', v_device.device_secret_hash,
    'authority', a23_device_authority(p_shop_id, p_device_public_id)
  );
end
$fn$;

-- == 7b. Binding a proven session to an installation =======================
--
-- THE ONLY WAY AN INSTALLATION IS EVER REGISTERED, and the only way a session
-- becomes trusted.
--
-- Called immediately after a flow has proved a credential and minted a
-- session: phone + PIN device-login, OTP registration, OTP-verified PIN
-- recovery, or the device-secret actor switch. The caller passes the
-- `session_id` of the token it is about to hand back.
--
-- The previous shape had a separate, authenticated `device-enroll` route. Any
-- current access token could call it and register a brand-new installation —
-- so a stolen token did not merely inherit a device, it could mint itself a
-- trusted one. There is no such route now: enrolment happens here, inside the
-- same transaction that records which session it belongs to, or not at all.
create or replace function a23_bind_auth_session(
  p_auth_session_id uuid,
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
  v_enrolled jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_auth_session_id is null then
    raise exception 'a session id is required to bind an installation'
      using errcode = 'MU062';
  end if;

  v_enrolled := a23_enroll_device(
    p_shop_id, p_actor_user_id, p_device_public_id, p_secret_hash,
    p_label, p_platform, p_model, p_os_version
  );

  insert into auth_session_devices(
    auth_session_id, shop_id, actor_user_id, device_id, binding_id,
    secret_hash_at_bind, bound_at, created_at, updated_at
  ) values (
    p_auth_session_id, p_shop_id, p_actor_user_id,
    (v_enrolled->>'deviceId')::uuid, (v_enrolled->>'bindingId')::uuid,
    v_enrolled->>'secretHash', v_now, v_now, v_now
  )
  -- Re-binding the same session is ordinary: a repeated login re-runs the
  -- flow, and an actor switch on an already-bound session replaces the row.
  on conflict (auth_session_id) do update set
    shop_id = excluded.shop_id,
    actor_user_id = excluded.actor_user_id,
    device_id = excluded.device_id,
    binding_id = excluded.binding_id,
    secret_hash_at_bind = excluded.secret_hash_at_bind,
    bound_at = excluded.bound_at,
    updated_at = excluded.updated_at;

  return v_enrolled->'authority';
end
$fn$;

-- == 8. Actor switch =======================================================
--
-- The authorization half of a PIN-only handover. The Edge function has already
-- verified the device secret (constant-time) and the target actor's PIN; this
-- decides whether the REGISTRY permits that actor to take this installation.
--
-- Note what it does not do: it never creates a binding. A handover can only
-- reach an actor who has already enrolled here through phone + PIN.
create or replace function a23_authorize_actor_switch(
  p_shop_id uuid,
  p_device_public_id text,
  p_actor_user_id uuid,
  p_auth_session_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_device shop_devices%rowtype;
  v_binding shop_device_bindings%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_device from shop_devices
  where shop_id = p_shop_id and device_public_id = p_device_public_id
  for update;
  if not found then
    raise exception 'this installation is not registered' using errcode = 'MU066';
  end if;
  if v_device.status = 'revoked' then
    raise exception 'this installation has been revoked' using errcode = 'MU064';
  end if;

  select * into v_binding from shop_device_bindings
  where device_id = v_device.id and actor_user_id = p_actor_user_id
  for update;
  if not found then
    raise exception 'this account is not registered on this installation'
      using errcode = 'MU067';
  end if;
  if v_binding.status = 'revoked' then
    raise exception 'this account has been revoked on this installation'
      using errcode = 'MU065';
  end if;

  -- Re-read liveness AFTER the registry checks, so a deactivated staff member
  -- cannot be switched to even on a perfectly healthy device.
  if a23_live_actor_role(p_shop_id, p_actor_user_id) is null then
    raise exception 'a live account of this shop is required' using errcode = 'MU063';
  end if;

  update shop_devices set last_seen_at = v_now, updated_at = v_now
  where id = v_device.id;
  update shop_device_bindings set last_authenticated_at = v_now, updated_at = v_now
  where id = v_binding.id;

  insert into device_registry_events(
    shop_id, device_id, binding_id, event, actor_user_id, target_user_id, created_at
  ) values (
    p_shop_id, v_device.id, v_binding.id, 'actor_switch',
    p_actor_user_id, p_actor_user_id, v_now
  );

  -- The incoming session is bound here, in the same transaction that
  -- authorised the switch. A handover that authorised but did not bind would
  -- hand back a session the gate then treats as legacy: working today, and
  -- refused the moment the shop enforces.
  if p_auth_session_id is not null then
    insert into auth_session_devices(
      auth_session_id, shop_id, actor_user_id, device_id, binding_id,
      secret_hash_at_bind, bound_at, created_at, updated_at
    ) values (
      p_auth_session_id, p_shop_id, p_actor_user_id, v_device.id, v_binding.id,
      v_device.device_secret_hash, v_now, v_now, v_now
    )
    on conflict (auth_session_id) do update set
      shop_id = excluded.shop_id,
      actor_user_id = excluded.actor_user_id,
      device_id = excluded.device_id,
      binding_id = excluded.binding_id,
      secret_hash_at_bind = excluded.secret_hash_at_bind,
      bound_at = excluded.bound_at,
      updated_at = excluded.updated_at;
  end if;

  return a23_device_authority(p_shop_id, p_device_public_id);
end
$fn$;

-- == 9. Revocation and restoration =========================================
--
-- Four narrow operations rather than one parameterised one. They share a
-- predicate but not a meaning, and each writes its own audit event; collapsing
-- them is how a restore ends up reachable by whatever could reach a revoke.

create or replace function a23_revoke_binding(
  p_shop_id uuid,
  p_caller_user_id uuid,
  p_device_id uuid,
  p_target_actor_user_id uuid,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_device shop_devices%rowtype;
  v_binding shop_device_bindings%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform a23_assert_device_admin(p_shop_id, p_caller_user_id);

  select * into v_device from shop_devices
  where id = p_device_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'installation not found in this shop' using errcode = 'MU066';
  end if;

  select * into v_binding from shop_device_bindings
  where device_id = v_device.id and actor_user_id = p_target_actor_user_id
  for update;
  if not found then
    raise exception 'this account is not registered on this installation'
      using errcode = 'MU067';
  end if;

  if v_binding.status = 'active' then
    update shop_device_bindings set
      status = 'revoked',
      revoked_at = v_now,
      revoked_by = p_caller_user_id,
      revoke_reason = nullif(p_reason, ''),
      binding_version = binding_version + 1,
      updated_at = v_now
    where id = v_binding.id;
    -- The device version moves too. A client mirrors the whole snapshot, so
    -- one monotonic number has to cover every change it could care about.
    update shop_devices set registry_version = registry_version + 1, updated_at = v_now
    where id = v_device.id;

    insert into device_enrollment_holds(
      shop_id, actor_user_id, source_device_id, held_at, held_by_user_id,
      reason, requested_device_public_id, requested_at,
      approved_device_public_id, approved_at, approved_by_user_id,
      approved_by_device_id, consumed_at, consumed_device_id, updated_at
    ) values (
      p_shop_id, p_target_actor_user_id, v_device.id, v_now, p_caller_user_id,
      nullif(p_reason, ''), null, null, null, null, null, null, null, null, v_now
    )
    on conflict (shop_id, actor_user_id) do update set
      source_device_id = excluded.source_device_id,
      held_at = excluded.held_at,
      held_by_user_id = excluded.held_by_user_id,
      reason = excluded.reason,
      requested_device_public_id = null,
      requested_at = null,
      approved_device_public_id = null,
      approved_at = null,
      approved_by_user_id = null,
      approved_by_device_id = null,
      consumed_at = null,
      consumed_device_id = null,
      updated_at = excluded.updated_at;
    insert into device_registry_events(
      shop_id, device_id, binding_id, event, actor_user_id, target_user_id, reason, created_at
    ) values
      (p_shop_id, v_device.id, v_binding.id, 'binding_revoked',
       p_caller_user_id, p_target_actor_user_id, nullif(p_reason, ''), v_now),
      (p_shop_id, v_device.id, v_binding.id, 'enrollment_hold_created',
       p_caller_user_id, p_target_actor_user_id, nullif(p_reason, ''), v_now);
  end if;

  return a23_device_authority(p_shop_id, v_device.device_public_id);
end
$fn$;

create or replace function a23_restore_binding(
  p_shop_id uuid,
  p_caller_user_id uuid,
  p_device_id uuid,
  p_target_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_device shop_devices%rowtype;
  v_binding shop_device_bindings%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform a23_assert_device_admin(p_shop_id, p_caller_user_id);

  select * into v_device from shop_devices
  where id = p_device_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'installation not found in this shop' using errcode = 'MU066';
  end if;
  -- Restoring one person on a dead installation would read as access that does
  -- not exist. The device comes back first, or nothing does.
  if v_device.status = 'revoked' then
    raise exception 'restore the installation before restoring an account on it'
      using errcode = 'MU064';
  end if;

  select * into v_binding from shop_device_bindings
  where device_id = v_device.id and actor_user_id = p_target_actor_user_id
  for update;
  if not found then
    raise exception 'this account is not registered on this installation'
      using errcode = 'MU067';
  end if;

  if v_binding.status = 'revoked' then
    update shop_device_bindings set
      status = 'active',
      revoked_at = null,
      revoked_by = null,
      revoke_reason = null,
      binding_version = binding_version + 1,
      updated_at = v_now
    where id = v_binding.id;
    update shop_devices set registry_version = registry_version + 1, updated_at = v_now
    where id = v_device.id;
    insert into device_registry_events(
      shop_id, device_id, binding_id, event, actor_user_id, target_user_id, created_at
    ) values (
      p_shop_id, v_device.id, v_binding.id, 'binding_restored',
      p_caller_user_id, p_target_actor_user_id, v_now
    );
  end if;

  return a23_device_authority(p_shop_id, v_device.device_public_id);
end
$fn$;

create or replace function a23_revoke_device(
  p_shop_id uuid,
  p_caller_user_id uuid,
  p_device_id uuid,
  p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_device shop_devices%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform a23_assert_device_admin(p_shop_id, p_caller_user_id);

  select * into v_device from shop_devices
  where id = p_device_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'installation not found in this shop' using errcode = 'MU066';
  end if;

  if v_device.status = 'active' then
    update shop_devices set
      status = 'revoked',
      revoked_at = v_now,
      revoked_by = p_caller_user_id,
      revoke_reason = nullif(p_reason, ''),
      registry_version = registry_version + 1,
      updated_at = v_now
    where id = v_device.id;

    -- Every binding on it goes too. Quarantining all local users of the shop
    -- is the client-side consequence, but the server states it explicitly
    -- rather than leaving the device row as the only evidence: a restore must
    -- then be a deliberate act per account, not an accidental mass re-open.
    update shop_device_bindings set
      status = 'revoked',
      revoked_at = v_now,
      revoked_by = p_caller_user_id,
      revoke_reason = nullif(p_reason, ''),
      binding_version = binding_version + 1,
      updated_at = v_now
    where device_id = v_device.id and status = 'active';

    -- Every actor explicitly cut off with this installation receives an
    -- actor+shop hold. Clearing app data and presenting a fresh public id must
    -- not turn a whole-device revoke into self-service re-enrolment.
    insert into device_enrollment_holds(
      shop_id, actor_user_id, source_device_id, held_at, held_by_user_id,
      reason, updated_at
    )
    select p_shop_id, b.actor_user_id, v_device.id, v_now, p_caller_user_id,
      nullif(p_reason, ''), v_now
    from shop_device_bindings b
    where b.device_id = v_device.id
    on conflict (shop_id, actor_user_id) do update set
      source_device_id = excluded.source_device_id,
      held_at = excluded.held_at,
      held_by_user_id = excluded.held_by_user_id,
      reason = excluded.reason,
      requested_device_public_id = null,
      requested_at = null,
      approved_device_public_id = null,
      approved_at = null,
      approved_by_user_id = null,
      approved_by_device_id = null,
      consumed_at = null,
      consumed_device_id = null,
      updated_at = excluded.updated_at;

    insert into device_registry_events(
      shop_id, device_id, binding_id, event, actor_user_id, reason, created_at
    ) values (
      p_shop_id, v_device.id, null, 'device_revoked',
      p_caller_user_id, nullif(p_reason, ''), v_now
    );
    insert into device_registry_events(
      shop_id, device_id, binding_id, event,
      actor_user_id, target_user_id, reason, created_at
    )
    select p_shop_id, v_device.id, b.id, 'enrollment_hold_created',
      p_caller_user_id, b.actor_user_id, nullif(p_reason, ''), v_now
    from shop_device_bindings b
    where b.device_id = v_device.id;
  end if;

  return a23_device_authority(p_shop_id, v_device.device_public_id);
end
$fn$;

create or replace function a23_restore_device(
  p_shop_id uuid,
  p_caller_user_id uuid,
  p_device_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_device shop_devices%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  perform a23_assert_device_admin(p_shop_id, p_caller_user_id);

  select * into v_device from shop_devices
  where id = p_device_id and shop_id = p_shop_id for update;
  if not found then
    raise exception 'installation not found in this shop' using errcode = 'MU066';
  end if;

  if v_device.status = 'revoked' then
    update shop_devices set
      status = 'active',
      revoked_at = null,
      revoked_by = null,
      revoke_reason = null,
      registry_version = registry_version + 1,
      updated_at = v_now
    where id = v_device.id;
    -- Bindings stay revoked. Restoring the installation says the hardware is
    -- trusted again; it does not re-grant every person who was cut off with
    -- it. Each account is restored, or re-enrols through phone + PIN, on its
    -- own evidence.
    insert into device_registry_events(
      shop_id, device_id, binding_id, event, actor_user_id, created_at
    ) values (
      p_shop_id, v_device.id, null, 'device_restored', p_caller_user_id, v_now
    );
  end if;

  return a23_device_authority(p_shop_id, v_device.device_public_id);
end
$fn$;

-- Approves one pending replacement installation. The approving session must
-- itself be bound to a different, active installation and active binding;
-- role alone is not enough. This is the only A2.3 path that can satisfy an
-- enrolment hold. Manual account recovery remains deliberately out of scope.
create or replace function a23_approve_enrollment(
  p_shop_id uuid,
  p_caller_user_id uuid,
  p_auth_session_id uuid,
  p_target_actor_user_id uuid,
  p_device_public_id text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_hold device_enrollment_holds%rowtype;
  v_approver_device_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  perform a23_assert_device_admin(p_shop_id, p_caller_user_id);
  if p_auth_session_id is null or p_device_public_id is null or p_device_public_id = '' then
    raise exception 'a bound administrator session and pending installation are required'
      using errcode = 'MU071';
  end if;

  select m.device_id into v_approver_device_id
  from auth_session_devices m
  join shop_devices d on d.id = m.device_id
  join shop_device_bindings b on b.id = m.binding_id
  where m.auth_session_id = p_auth_session_id
    and m.shop_id = p_shop_id
    and m.actor_user_id = p_caller_user_id
    and d.shop_id = p_shop_id and d.status = 'active'
    and b.shop_id = p_shop_id and b.actor_user_id = p_caller_user_id
    and b.status = 'active';
  if v_approver_device_id is null then
    raise exception 'approval requires an active bound administrator installation'
      using errcode = 'MU071';
  end if;

  if a23_live_actor_role(p_shop_id, p_target_actor_user_id) is null then
    raise exception 'a live account of this shop is required' using errcode = 'MU063';
  end if;

  select * into v_hold from device_enrollment_holds
  where shop_id = p_shop_id
    and actor_user_id = p_target_actor_user_id
    and consumed_at is null
  for update;
  if not found
     or v_hold.requested_device_public_id is distinct from p_device_public_id
     or v_hold.source_device_id = v_approver_device_id then
    raise exception 'a different active administrator installation must approve the pending request'
      using errcode = 'MU071';
  end if;

  update device_enrollment_holds set
    approved_device_public_id = p_device_public_id,
    approved_at = v_now,
    approved_by_user_id = p_caller_user_id,
    approved_by_device_id = v_approver_device_id,
    updated_at = v_now
  where shop_id = p_shop_id and actor_user_id = p_target_actor_user_id;

  insert into device_registry_events(
    shop_id, device_id, binding_id, event, actor_user_id, target_user_id, created_at
  ) values (
    p_shop_id, v_approver_device_id, null, 'enrollment_approved',
    p_caller_user_id, p_target_actor_user_id, v_now
  );

  return jsonb_build_object(
    'approved', true,
    'actorUserId', p_target_actor_user_id,
    'devicePublicId', p_device_public_id
  );
end
$fn$;

-- == 10. The administration listing ========================================

create or replace function a23_list_devices(p_shop_id uuid, p_caller_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_devices jsonb;
  v_holds jsonb;
begin
  perform a23_assert_device_admin(p_shop_id, p_caller_user_id);

  select coalesce(jsonb_agg(entry order by entry->>'enrolledAt' desc), '[]'::jsonb)
  into v_devices
  from (
    select jsonb_build_object(
      'deviceId', d.id,
      'devicePublicId', d.device_public_id,
      'label', d.label,
      'platform', d.platform,
      'model', d.model,
      'osVersion', d.os_version,
      'status', d.status,
      'enrolledAt', d.enrolled_at,
      'lastSeenAt', d.last_seen_at,
      'revokedAt', d.revoked_at,
      'registryVersion', d.registry_version,
      'bindings', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'actorUserId', b.actor_user_id,
          'actorName', u.name,
          'role', r.name,
          'status', b.status,
          'bindingVersion', b.binding_version,
          'lastAuthenticatedAt', b.last_authenticated_at
        ) order by u.name), '[]'::jsonb)
        from shop_device_bindings b
        join users u on u.id = b.actor_user_id
        left join roles r on r.id = u.role_id
        where b.device_id = d.id
      )
    ) as entry
    from shop_devices d
    where d.shop_id = p_shop_id
  ) listed;

  select coalesce(jsonb_agg(jsonb_build_object(
    'actorUserId', h.actor_user_id,
    'actorName', u.name,
    'role', r.name,
    'sourceDeviceId', h.source_device_id,
    'heldAt', h.held_at,
    'requestedDevicePublicId', h.requested_device_public_id,
    'requestedAt', h.requested_at,
    'approved', h.approved_at is not null,
    'approvedAt', h.approved_at
  ) order by h.requested_at desc nulls last), '[]'::jsonb)
  into v_holds
  from device_enrollment_holds h
  join users u on u.id = h.actor_user_id
  left join roles r on r.id = u.role_id
  where h.shop_id = p_shop_id and h.consumed_at is null;

  -- The enforcement state travels with the list because that is the screen
  -- where it is decided. Bound-session revocation is unconditional; this flag
  -- controls only whether legacy unbound sessions remain accepted.
  return jsonb_build_object(
    'devices', v_devices,
    'enrollmentHolds', v_holds,
    'enforced', (select devices_enforced_at is not null from shops where id = p_shop_id)
  );
end
$fn$;

-- == 11. Grants ============================================================
--
-- Explicit, per function, to service_role only. H-7 established that only an
-- explicit GRANT counts on a hosted project, and that a missing one fails as a
-- 42501 the Edge function then reports as something else entirely.

alter function a23_binding_shop_matches_device() owner to postgres;
alter function a23_live_actor_role(uuid, uuid) owner to postgres;
alter function a23_assert_device_admin(uuid, uuid) owner to postgres;
alter function a23_device_authority(uuid, text) owner to postgres;
alter function a23_device_secret_hash(uuid, text) owner to postgres;
alter function a23_session_gate(uuid, uuid, uuid) owner to postgres;
alter function a23_session_authority(uuid, uuid) owner to postgres;
alter function a23_blocked_shops(uuid, uuid, uuid[]) owner to postgres;
alter function a23_set_device_enforcement(uuid, uuid, uuid, boolean) owner to postgres;
alter function a23_reserve_attempts(text[], integer[]) owner to postgres;
alter function a23_prepare_enrollment(uuid, uuid, text) owner to postgres;
alter function a23_enroll_device(uuid, uuid, text, text, text, text, text, text) owner to postgres;
alter function a23_bind_auth_session(uuid, uuid, uuid, text, text, text, text, text, text) owner to postgres;
alter function a23_authorize_actor_switch(uuid, text, uuid, uuid) owner to postgres;
alter function a23_revoke_binding(uuid, uuid, uuid, uuid, text) owner to postgres;
alter function a23_restore_binding(uuid, uuid, uuid, uuid) owner to postgres;
alter function a23_revoke_device(uuid, uuid, uuid, text) owner to postgres;
alter function a23_restore_device(uuid, uuid, uuid) owner to postgres;
alter function a23_approve_enrollment(uuid, uuid, uuid, uuid, text) owner to postgres;
alter function a23_list_devices(uuid, uuid) owner to postgres;

revoke execute on function
  a23_binding_shop_matches_device(),
  a23_live_actor_role(uuid, uuid),
  a23_assert_device_admin(uuid, uuid),
  a23_device_authority(uuid, text),
  a23_device_secret_hash(uuid, text),
  a23_session_gate(uuid, uuid, uuid),
  a23_session_authority(uuid, uuid),
  a23_blocked_shops(uuid, uuid, uuid[]),
  a23_set_device_enforcement(uuid, uuid, uuid, boolean),
  a23_reserve_attempts(text[], integer[]),
  a23_prepare_enrollment(uuid, uuid, text),
  a23_enroll_device(uuid, uuid, text, text, text, text, text, text),
  a23_bind_auth_session(uuid, uuid, uuid, text, text, text, text, text, text),
  a23_authorize_actor_switch(uuid, text, uuid, uuid),
  a23_revoke_binding(uuid, uuid, uuid, uuid, text),
  a23_restore_binding(uuid, uuid, uuid, uuid),
  a23_revoke_device(uuid, uuid, uuid, text),
  a23_restore_device(uuid, uuid, uuid),
  a23_approve_enrollment(uuid, uuid, uuid, uuid, text),
  a23_list_devices(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  a23_device_authority(uuid, text),
  a23_device_secret_hash(uuid, text),
  a23_session_gate(uuid, uuid, uuid),
  a23_session_authority(uuid, uuid),
  a23_blocked_shops(uuid, uuid, uuid[]),
  a23_set_device_enforcement(uuid, uuid, uuid, boolean),
  a23_reserve_attempts(text[], integer[]),
  a23_prepare_enrollment(uuid, uuid, text),
  a23_bind_auth_session(uuid, uuid, uuid, text, text, text, text, text, text),
  a23_authorize_actor_switch(uuid, text, uuid, uuid),
  a23_revoke_binding(uuid, uuid, uuid, uuid, text),
  a23_restore_binding(uuid, uuid, uuid, uuid),
  a23_revoke_device(uuid, uuid, uuid, text),
  a23_restore_device(uuid, uuid, uuid),
  a23_approve_enrollment(uuid, uuid, uuid, uuid, text),
  a23_list_devices(uuid, uuid)
to service_role;

-- FOUR internal functions, reachable by NOBODY but the ones above them:
--
--   a23_binding_shop_matches_device is trigger-only; a23_live_actor_role and
--   a23_assert_device_admin are shared predicates.
--
--   a23_enroll_device is internal for a security reason rather than a tidiness
--   one. Granting it would restore exactly the bypass this batch removed: a
--   route on which any current access token registers a brand-new trusted
--   installation. Registration is only ever reachable through
--   a23_bind_auth_session, which cannot run without binding the session that
--   just proved a credential.
