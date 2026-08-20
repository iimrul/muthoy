-- Separate-device Owner/Staff login, per-staff permissions, and server-side
-- permission enforcement.
--
-- Three things change here, and they are related:
--
-- 1. PHONE BECOMES A CREDENTIAL. A fresh device holds no SQLite rows, so it
--    cannot match a PIN locally the way an enrolled device does. Phone is what
--    names the account before hydration, for staff as well as owners, so it has
--    to resolve to exactly one live user — in exactly one written form.
--
-- 2. PERMISSIONS BECOME PER-USER. `permissions` is role-scoped and shared by
--    everyone holding that role. `user_permissions` is the per-user override
--    layer an owner edits when adding or editing a staff member.
--
-- 3. THE SERVER STARTS ENFORCING THEM. Until now RLS and the sync function
--    asked only WHICH SHOP a row belongs to. A staff device that pushed a
--    hand-crafted payload passed, because the only permission check in the
--    system lived in the client (db/auth.ts's requirePermission), and a
--    compromised client simply does not call it.
--
-- EVERY STATEMENT HERE IS RE-RUNNABLE. Migrations are applied once in the happy
-- path, but a partial failure must leave a database that can be repaired by
-- running this again. The function renames near the bottom are the dangerous
-- part and are guarded individually — see the note there.

-- ── 1. users: phone as a credential, and a revocation counter ─────────────

-- Canonicalise BEFORE the unique index, because canonicalising is what makes
-- the duplicates visible. `01712345678`, `8801712345678` and `+8801712345678`
-- were three different strings for one subscriber, which let one person hold
-- several accounts and handed an attacker three separate lockout budgets.
-- Mirrors packages/validation/src/phone.ts and functions/sync/_shared/phone.ts.
update users set phone = '+880' || substring(regexp_replace(phone, '\D', '', 'g') from 2)
  where phone is not null and regexp_replace(phone, '\D', '', 'g') ~ '^01[3-9][0-9]{8}$';
update users set phone = '+' || regexp_replace(phone, '\D', '', 'g')
  where phone is not null and regexp_replace(phone, '\D', '', 'g') ~ '^8801[3-9][0-9]{8}$'
    and phone !~ '^\+880';

update shops set phone = '+880' || substring(regexp_replace(phone, '\D', '', 'g') from 2)
  where phone is not null and regexp_replace(phone, '\D', '', 'g') ~ '^01[3-9][0-9]{8}$';
update shops set phone = '+' || regexp_replace(phone, '\D', '', 'g')
  where phone is not null and regexp_replace(phone, '\D', '', 'g') ~ '^8801[3-9][0-9]{8}$'
    and phone !~ '^\+880';

-- Fail loudly rather than half-applying. A surviving duplicate is a data
-- problem a human has to resolve (decide which account keeps the number); it
-- must not be settled by whichever row the index happens to reject.
do $dupes$
declare v_duplicate text;
begin
  select phone into v_duplicate
  from users
  where phone is not null and is_deleted = false
  group by phone having count(*) > 1
  limit 1;
  if v_duplicate is not null then
    raise exception
      'Cannot enforce users_phone_unique: phone % belongs to more than one live user. Resolve the duplicate first.',
      v_duplicate;
  end if;
end
$dupes$;

-- Partial, matching SQLite migration 0007 exactly. Soft-deleted rows keep their
-- phone so history stays readable but release it for reuse.
create unique index if not exists users_phone_unique on users(phone)
  where phone is not null and is_deleted = false;

-- Rides in the JWT as a claim; every sync request compares its claim to this
-- column. SERVER-AUTHORITATIVE: the triggers below are the only writer, and
-- sync_apply_row overwrites whatever a client sends — on INSERT as well as on
-- UPDATE — so a device cannot plant a value that makes a revoked token
-- acceptable again, or one so large the next bump overflows.
alter table users add column if not exists permission_version integer not null default 0;

-- Postgres is the only writer. Authenticated clients retain the ordinary user
-- columns RLS allows, but cannot name permission_version on either write path.
revoke insert, update on table users from anon, authenticated;
grant insert (id, created_at, updated_at, is_deleted, deleted_at, deleted_by,
              shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active)
  on table users to authenticated;
grant update (created_at, updated_at, is_deleted, deleted_at, deleted_by,
              shop_id, name, phone, pin_hash, pin_set_at, role_id, is_active)
  on table users to authenticated;

-- ── 2. user_permissions ───────────────────────────────────────────────────

-- No `is_dirty` column, deliberately, even though the SQLite table has one.
-- It is a LOCAL outbox flag: no other cloud table carries it, and
-- sync_apply_row populates the row through jsonb_populate_record, which sets
-- every column the payload does not name to NULL. A not-null `is_dirty` here
-- would therefore reject every real push with a constraint violation — which is
-- exactly what pgtest/migration.pgtest.ts caught.
create table if not exists user_permissions (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  deleted_by uuid,
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  allowed boolean not null default false
);
create index if not exists user_permissions_user_idx on user_permissions(user_id);
create index if not exists user_permissions_shop_idx on user_permissions(shop_id);
-- One verdict per key per user: a second row would make the effective
-- permission depend on read order.
create unique index if not exists user_permissions_user_key_unique on user_permissions(user_id, key);

alter table user_permissions enable row level security;
drop policy if exists shop_isolation on user_permissions;
create policy shop_isolation on user_permissions for all
  using (shop_id = (auth.jwt() -> 'app_metadata' ->> 'shop_id')::uuid)
  with check (shop_id = (auth.jwt() -> 'app_metadata' ->> 'shop_id')::uuid);

-- ── 3. auth_bindings — app user <-> Supabase Auth user ────────────────────
--
-- Server-only; never synced, never reaches a device.
--
-- Supabase Auth has no API for minting a session for a PHONE identity without
-- sending an SMS, so device-login mints through a synthetic, non-routable email
-- identity instead (see functions/sync/deviceLogin.ts). This table is what
-- keeps that ONE auth identity attached to ONE app user across both entry
-- points — first-time OTP registration, and later phone+PIN device logins — so
-- an owner logging in on a second device does not acquire a second auth account
-- that shop_claims would then refuse to link.
--
-- No foreign key to users on purpose: registration binds the owner BEFORE their
-- users row has synced up, so the binding must be able to exist first and be
-- joined to later. That absence is exactly why linkDevice must prove a
-- client-supplied ownerUserId against the users table itself before binding it
-- — see _shared/identity.ts's assertBindingTarget.
create table if not exists auth_bindings (
  app_user_id uuid primary key,
  auth_user_id uuid not null unique,
  created_at timestamptz not null default now()
);
alter table auth_bindings enable row level security;
-- No policy at all: service_role bypasses RLS, everyone else is denied by
-- default. This table maps identities and is never client-readable.

-- BYPASSRLS is not a substitute for a table GRANT. deviceLogin.ts and
-- identity.ts reach this table through PostgREST rather than through a SECURITY
-- DEFINER function, so those reads execute AS service_role and die with
-- SQLSTATE 42501 without this — the exact failure
-- 20260817000100_sync_roles_read_grant.sql was written to fix for public.roles,
-- and which functions/sync/grants.test.ts now guards against repeating.
grant select, insert, update on table auth_bindings to service_role;
-- Read by _shared/auth.ts's assertCallerCurrent and deviceLogin.ts's phone
-- lookup; updated by recoverPin.ts when it writes the new hash.
grant select, update on table users to service_role;

-- ── 4. login_attempts — brute-force lockout for device-login ──────────────
--
-- A 4-digit PIN is a 10,000-value keyspace. Offline that is acceptable: an
-- attacker needs the physical device, and bcrypt cost 10 per guess. Exposed at
-- a network endpoint it is not — without this table, device-login would be a
-- remote PIN oracle. It is also a CPU-DoS guard: the lockout is checked BEFORE
-- any bcrypt work happens.
--
-- KEYED, not phone-columned. Two scopes share it: 'phone:+8801712345678' is the
-- account guard, and 'ip:203.0.113.9' is the DoS guard. Without the IP scope an
-- attacker walking a LIST of numbers spends ~300ms of server bcrypt per request
-- and never trips a per-phone counter at all.

-- The pre-hardening shape keyed on a `phone` column. Dropped rather than
-- migrated: it holds only transient counters, and a cleared lockout is the safe
-- direction to fail on a schema change.
drop table if exists login_attempts;

create table login_attempts (
  key text primary key,
  failed_count integer not null default 0,
  first_failed_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index login_attempts_locked_idx on login_attempts(locked_until);
alter table login_attempts enable row level security;
-- Same as auth_bindings: no policy, service_role only.

drop function if exists login_attempt_locked_until(text);
drop function if exists register_login_failure(text);
drop function if exists clear_login_failures(text);

-- Attempt accounting lives in SQL, not in the Edge Function, so the read and
-- the increment are one atomic statement. Doing it as a select-then-upsert from
-- Deno would let parallel requests each read the same count and collectively
-- spend far more guesses than the limit allows.
create or replace function login_attempt_locked_until(p_key text)
returns timestamptz language sql stable security definer set search_path = public as $fn$
  select locked_until from login_attempts
  where key = p_key and locked_until is not null and locked_until > now();
$fn$;

-- `p_free_attempts` attempts, then 60s, doubling to a 15-minute ceiling. The
-- window resets after 15 idle minutes so an honest user who mistyped earlier in
-- the day is not still serving a sentence. The budget is a parameter because
-- the phone scope and the IP scope need different ones: one pharmacy behind one
-- NAT may legitimately hold several accounts.
create or replace function register_login_failure(p_key text, p_free_attempts integer default 5)
returns timestamptz language plpgsql security definer set search_path = public as $fn$
declare
  v_count integer;
begin
  insert into login_attempts as la (key, failed_count, first_failed_at, updated_at)
  values (p_key, 1, now(), now())
  on conflict (key) do update set
    failed_count = case when la.updated_at < now() - interval '15 minutes' then 1
                        else la.failed_count + 1 end,
    first_failed_at = case when la.updated_at < now() - interval '15 minutes' then now()
                           else la.first_failed_at end,
    updated_at = now()
  returning la.failed_count into v_count;

  if v_count > p_free_attempts then
    update login_attempts
      set locked_until = now() + least(
        make_interval(secs => 60 * power(2, v_count - p_free_attempts - 1)::double precision),
        interval '15 minutes')
      where key = p_key;
  end if;

  return (select locked_until from login_attempts where key = p_key);
end
$fn$;

create or replace function clear_login_failures(p_key text)
returns void language sql security definer set search_path = public as $fn$
  delete from login_attempts where key = p_key;
$fn$;

revoke execute on function login_attempt_locked_until(text) from public, anon, authenticated;
revoke execute on function register_login_failure(text, integer) from public, anon, authenticated;
revoke execute on function clear_login_failures(text) from public, anon, authenticated;
grant execute on function login_attempt_locked_until(text) to service_role;
grant execute on function register_login_failure(text, integer) to service_role;
grant execute on function clear_login_failures(text) to service_role;

-- ── 5. Effective-permission resolution ────────────────────────────────────
--
-- Mirrors apps/mobile/domain/permissions.ts's resolvePermission exactly: role
-- default, overridden by the per-user row where one exists. The two
-- implementations must stay in step — a divergence means the UI offers an
-- action the server then refuses, or worse, the reverse.
--
-- Owner is "everything, as a rule", and IGNORES overrides. That is
-- load-bearing: the owner is the only account that can edit permissions, so
-- honouring a stored `staff_management: false` against them would let one bad
-- write lock a shop out of its own administration with no way back in.
create or replace function user_has_permission(p_app_user_id uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select coalesce((
    select case
      when u.is_active = false or u.is_deleted = true then false
      when r.name = 'owner' then true
      -- Fail closed on the P1 'manager' role and on anything unrecognised —
      -- the same stance domain/permissions.ts's toRole takes.
      when r.name <> 'staff' then false
      else coalesce(
        (select up.allowed from user_permissions up
          where up.user_id = u.id and up.shop_id = u.shop_id
            and up.key = p_key and up.is_deleted = false
          limit 1),
        -- STAFF_DEFAULT_PERMISSIONS in domain/permissions.ts
        p_key in ('sales', 'inventory_view')
      )
    end
    from users u
    join roles r on r.id = u.role_id and r.is_deleted = false
    where u.id = p_app_user_id
  ), false);
$fn$;

-- The RLS-facing wrapper: same resolution, actor taken from the JWT.
create or replace function auth_has_permission(p_key text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select user_has_permission(
    nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id', '')::uuid,
    p_key
  );
$fn$;

-- "Is the caller a live member of the shop on their token?"
--
-- The read half of the restrictive policies below, and the whole of the
-- audit_logs one. A deactivated staff member's refresh token keeps minting
-- syntactically valid JWTs; this is what makes those tokens read nothing.
create or replace function auth_is_live_user()
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists(
    select 1 from users u
    where u.id = nullif(auth.jwt() -> 'app_metadata' ->> 'app_user_id', '')::uuid
      and u.shop_id = nullif(auth.jwt() -> 'app_metadata' ->> 'shop_id', '')::uuid
      and u.is_active = true and u.is_deleted = false
  );
$fn$;

revoke execute on function user_has_permission(uuid, text) from public, anon, authenticated;
grant execute on function user_has_permission(uuid, text) to service_role;
grant execute on function auth_has_permission(text) to authenticated, service_role;
grant execute on function auth_is_live_user() to authenticated, service_role;

-- ── 6. permission_version is server-derived ───────────────────────────────
--
-- Bumped here rather than accepted from a client payload. A device can push
-- `is_active = false`, but it cannot push a permission_version — so it cannot
-- lower one to make a previously-revoked token acceptable again.
create or replace function bump_permission_version()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if tg_table_name = 'users' then
    -- Only the transitions that actually revoke something. A name change or a
    -- routine sync must not invalidate a live session.
    if new.is_active is distinct from old.is_active
       or new.pin_hash is distinct from old.pin_hash
       or new.is_deleted is distinct from old.is_deleted
       or new.role_id is distinct from old.role_id then
      update users
        set permission_version = permission_version + 1,
            updated_at = greatest(updated_at, clock_timestamp())
        where id = new.id;
    end if;
    return new;
  end if;

  -- user_permissions: any insert, update or delete changes what its user may do.
  update users
    set permission_version = permission_version + 1,
        updated_at = greatest(updated_at, clock_timestamp())
    where id = coalesce(new.user_id, old.user_id);
  return coalesce(new, old);
end
$fn$;

-- AFTER, and guarded on the columns above, so the recursive UPDATE this issues
-- against users cannot re-enter the guard: permission_version is not one of the
-- watched columns, so the second firing changes nothing and stops.
drop trigger if exists users_bump_permission_version on users;
create trigger users_bump_permission_version
  after update on users
  for each row execute function bump_permission_version();

drop trigger if exists user_permissions_bump_permission_version on user_permissions;
create trigger user_permissions_bump_permission_version
  after insert or update or delete on user_permissions
  for each row execute function bump_permission_version();

-- ── 7. Custom access token hook — the JWT claims ──────────────────────────
--
-- Runs on every token MINT AND every REFRESH, which is the point: claims stay
-- current without anyone remembering to call updateUserById. A permission
-- change therefore reaches the token within one refresh, and the
-- permission_version claim closes the gap in between.
--
-- These claims exist ONLY inside the token. They are deliberately not mirrored
-- onto auth.users.raw_app_meta_data, so _shared/auth.ts must read them by
-- decoding the verified JWT — reading them off the user ROW (which is what
-- getUser returns) yields nothing at all.
--
-- Must be registered in Supabase under Auth > Hooks (Customize Access Token).
-- See backend/supabase/README.md.
create or replace function custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_claims jsonb;
  v_metadata jsonb;
  v_user record;
begin
  v_claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_metadata := coalesce(v_claims -> 'app_metadata', '{}'::jsonb);

  select u.id, u.shop_id, u.permission_version, u.is_active, r.name as role_name
    into v_user
  from auth_bindings b
  join users u on u.id = b.app_user_id and u.is_deleted = false
  join roles r on r.id = u.role_id and r.is_deleted = false
  where b.auth_user_id = (event ->> 'user_id')::uuid
  limit 1;

  -- No binding yet is the NORMAL state during first-time owner registration:
  -- the OTP session exists before the shop does. Leave the claims exactly as
  -- they are, so linkDevice's own app_metadata.shop_id survives untouched and
  -- every existing RLS policy keeps working through the registration flow.
  if not found then
    return event;
  end if;

  v_metadata := v_metadata || jsonb_build_object(
    'shop_id', v_user.shop_id,
    'app_user_id', v_user.id,
    'role', v_user.role_name,
    'permission_version', v_user.permission_version,
    'is_active', v_user.is_active
  );

  return jsonb_set(event, '{claims,app_metadata}', v_metadata);
end
$fn$;

grant execute on function custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function custom_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant select on table auth_bindings, users, roles to supabase_auth_admin;

-- ── 8. Which permission each synced table demands ─────────────────────────
--
-- Chosen so every flow that works today keeps working. A default staff member
-- (sales + inventory_view) must still be able to complete a checkout, and
-- checkout writes customers, credits, cash_drawer and a sale-reason movement as
-- well as the sale itself — so those cannot demand cash_management.
--
-- What this DOES close: a staff device can no longer push a medicine, a batch,
-- a purchase, an expense, a payment, a user row, or a stock adjustment.
create or replace function sync_row_permitted(p_app_user_id uuid, p_table text, p_row jsonb)
returns boolean language sql stable security definer set search_path = public as $fn$
  select case p_table
    when 'shops' then user_has_permission(p_app_user_id, 'settings_manage')
    when 'subscriptions' then user_has_permission(p_app_user_id, 'settings_manage')
    when 'roles' then user_has_permission(p_app_user_id, 'staff_management')
    when 'permissions' then user_has_permission(p_app_user_id, 'staff_management')
    when 'users' then user_has_permission(p_app_user_id, 'staff_management')
    when 'user_permissions' then user_has_permission(p_app_user_id, 'staff_management')
    when 'medicines' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'batches' then user_has_permission(p_app_user_id, 'inventory_write')
    -- A sale's deduction rides the 'sales' grant; anything else moving stock
    -- (purchase, adjustment, return) is an inventory write. The SIGN is checked
    -- separately in sync_apply_row: reason alone is client-controlled, so
    -- without that a 'sales'-only staff member could push reason='sale' with
    -- change_qty = +1000 and inflate stock through this very branch.
    when 'inventory_movements' then
      case when p_row ->> 'reason' = 'sale'
        then user_has_permission(p_app_user_id, 'sales')
        else user_has_permission(p_app_user_id, 'inventory_write')
      end
    when 'sales' then user_has_permission(p_app_user_id, 'sales')
    when 'sale_items' then user_has_permission(p_app_user_id, 'sales')
    when 'sales_returns' then user_has_permission(p_app_user_id, 'sales')
    -- Checkout creates a customer and a credit row for a credit sale, so these
    -- are reachable from either grant.
    when 'customers' then user_has_permission(p_app_user_id, 'sales')
                       or user_has_permission(p_app_user_id, 'credit_management')
    when 'credits' then user_has_permission(p_app_user_id, 'sales')
                     or user_has_permission(p_app_user_id, 'credit_management')
    -- Checkout recomputes the drawer. cash_management gates the cash SCREENS
    -- and their reads, not the drawer row a sale necessarily touches.
    when 'cash_drawer' then user_has_permission(p_app_user_id, 'sales')
                         or user_has_permission(p_app_user_id, 'cash_management')
    -- No sale writes a payment: they come from expenses, credit collections and
    -- supplier settlement, each with its own grant.
    when 'payments' then user_has_permission(p_app_user_id, 'cash_management')
                      or user_has_permission(p_app_user_id, 'credit_management')
                      or user_has_permission(p_app_user_id, 'inventory_write')
    when 'expenses' then user_has_permission(p_app_user_id, 'cash_management')
    when 'suppliers' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'purchases' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'purchase_items' then user_has_permission(p_app_user_id, 'inventory_write')
    when 'purchase_returns' then user_has_permission(p_app_user_id, 'inventory_write')
    -- Append-only trail. Any live user records their own actions; WHOSE name it
    -- is recorded under is enforced by the attribution check in sync_apply_row.
    when 'audit_logs' then true
    else false
  end;
$fn$;

revoke execute on function sync_row_permitted(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function sync_row_permitted(uuid, text, jsonb) to service_role;

-- ── 9. user_permissions joins the sync path, and the actor arrives ────────
--
-- The two dispatch functions are extended by RENAME + WRAPPER rather than by
-- retyping ~90 lines of dense SQL. The base function keeps working untouched,
-- and only the new behaviour is new code — which is also the only part worth
-- reviewing.
--
-- THE RENAME IS GUARDED. Renaming unconditionally is a live hazard: on a re-run
-- after a partial apply it would rename the WRAPPER to _base, and the wrapper
-- would then call itself — stack-depth-exceeded on every sync write, in
-- production, with no obvious cause. `to_regprocedure` returning non-null means
-- the rename already happened, so this becomes a no-op instead.
do $rename_existing$
begin
  if to_regprocedure('public.sync_existing_row_owned_or_missing_base(text,uuid,uuid)') is null then
    alter function sync_existing_row_owned_or_missing(text, uuid, uuid)
      rename to sync_existing_row_owned_or_missing_base;
  end if;
end
$rename_existing$;

create or replace function sync_existing_row_owned_or_missing(p_table text, p_id uuid, p_shop_id uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  if p_table = 'user_permissions' then
    return not exists(select 1 from user_permissions where id = p_id)
      or exists(select 1 from user_permissions where id = p_id and shop_id = p_shop_id);
  end if;
  return sync_existing_row_owned_or_missing_base(p_table, p_id, p_shop_id);
end
$fn$;

do $rename_apply$
begin
  if to_regprocedure('public.sync_apply_row_base(text,text,jsonb,uuid)') is null then
    alter function sync_apply_row(text, text, jsonb, uuid) rename to sync_apply_row_base;
  end if;
end
$rename_apply$;

-- The 4-arg entry point is gone: the wrapper below takes FIVE arguments, so a
-- caller that omits the actor fails to resolve rather than silently skipping
-- every target-aware check. Dropped explicitly so no stale copy can shadow it.
drop function if exists sync_apply_row(text, text, jsonb, uuid);

-- Which column carries the ACTOR on each table, or null where none does.
--
-- Until now these were validated only as "some user in this shop", never as
-- "the caller" — so any staff member could record a sale, an expense, a stock
-- movement or an audit entry under the OWNER's name. In a money app that is
-- both a repudiation hole and the way to hide every other attack.
create or replace function sync_actor_column(p_table text)
returns text language sql immutable as $fn$
  select case p_table
    when 'sales' then 'staff_id'
    when 'sales_returns' then 'created_by'
    when 'purchase_returns' then 'created_by'
    when 'inventory_movements' then 'created_by'
    when 'expenses' then 'created_by'
    when 'payments' then 'created_by'
    when 'audit_logs' then 'actor_id'
    else null
  end;
$fn$;

create or replace function sync_apply_row(
  p_table text,
  p_op text,
  p_row jsonb,
  p_caller_shop_id uuid,
  p_caller_user_id uuid
)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_row_id uuid := (p_row->>'id')::uuid;
  v_caller_role text;
  v_caller_is_owner boolean;
  v_actor_column text;
  v_actor uuid;
  v_target users%rowtype;
  v_target_found boolean;
  v_target_role text;
  v_affected integer;
  v_apply_result text;
begin
  -- The caller must be a live member of the shop they claim. Everything below
  -- is expressed relative to this, so it is established first.
  select r.name into v_caller_role
  from users u
  join roles r on r.id = u.role_id and r.is_deleted = false
  where u.id = p_caller_user_id and u.shop_id = p_caller_shop_id
    and u.is_active = true and u.is_deleted = false;
  if v_caller_role is null then
    raise exception 'caller is not a live user of this shop' using errcode = 'MU010';
  end if;
  v_caller_is_owner := (v_caller_role = 'owner');

  -- ATTRIBUTION. A staff caller may only write rows in their OWN name.
  --
  -- The owner is exempt, and that exemption is load-bearing rather than lazy:
  -- on a SHARED pharmacy handset the device is enrolled by the owner, so the
  -- JWT is the owner's while state/switchUser.ts moves the LOCAL session
  -- between staff. Demanding equality there would reject every sale a staff
  -- member rings up on the shop's own phone. A staff-OWNED device pushes under
  -- its own identity, which is exactly where the strict rule belongs.
  v_actor_column := sync_actor_column(p_table);
  if p_op <> 'delete' and v_actor_column is not null and not v_caller_is_owner then
    v_actor := (p_row ->> v_actor_column)::uuid;
    if v_actor is not null and v_actor <> p_caller_user_id then
      raise exception 'row is attributed to another user' using errcode = 'MU011';
    end if;
  end if;

  -- A sale REMOVES stock. `reason` is client-controlled, so without this a
  -- staff member holding only 'sales' could push reason='sale' with a positive
  -- change_qty and inflate the ledger through the very branch that exists to
  -- let them sell at all.
  if p_table = 'inventory_movements' and p_op <> 'delete'
     and p_row ->> 'reason' = 'sale'
     and coalesce((p_row ->> 'change_qty')::numeric, 0) >= 0 then
    raise exception 'a sale movement must reduce stock' using errcode = 'MU012';
  end if;

  if p_table = 'users' then
    select * into v_target from users where id = v_row_id;
    v_target_found := found;

    if v_target_found then
      select r.name into v_target_role from roles r where r.id = v_target.role_id;

      -- The owner's row is theirs alone. This is what stops a staff member who
      -- has been granted staff_management from resetting the owner's PIN and
      -- logging in as them, or simply deactivating them.
      if v_target_role = 'owner' and v_row_id <> p_caller_user_id then
        raise exception 'only the owner may modify the owner account'
          using errcode = 'MU013';
      end if;

      if not v_caller_is_owner then
        -- Privilege columns are preserved from the server's own row rather than
        -- taken from the payload. Without this, staff_management WAS a
        -- promotion to owner: push your own users row with role_id = the shop's
        -- owner role, and user_has_permission starts answering true to
        -- everything.
        p_row := p_row || jsonb_build_object(
          'role_id', to_jsonb(v_target.role_id),
          'is_active', to_jsonb(v_target.is_active),
          'is_deleted', to_jsonb(v_target.is_deleted)
        );
        -- A user may change their OWN PIN; nobody else's.
        if v_row_id <> p_caller_user_id then
          p_row := p_row || jsonb_build_object(
            'pin_hash', to_jsonb(v_target.pin_hash),
            'pin_set_at', to_jsonb(v_target.pin_set_at)
          );
        end if;
      end if;

      -- Revocation flags are monotonic. A newer profile edit from an offline
      -- device may win ordinary LWW fields, but can never reactivate or
      -- resurrect an account the server has already revoked.
      p_row := p_row || jsonb_build_object(
        'is_active', v_target.is_active
          and coalesce((p_row ->> 'is_active')::boolean, true),
        'is_deleted', v_target.is_deleted
          or p_op = 'delete'
          or coalesce((p_row ->> 'is_deleted')::boolean, false)
      );

      -- Server-authoritative, always. The UPDATE column list already omitted
      -- it, but jsonb_populate_record fills EVERY column on the INSERT arm, so
      -- without this a client still chose the value for any row the server had
      -- not seen — including one large enough to overflow the next bump and
      -- leave the user unrevokable.
      p_row := p_row || jsonb_build_object('permission_version', to_jsonb(v_target.permission_version));
    else
      if not v_caller_is_owner
         and not exists(
           select 1 from roles
           where id = (p_row ->> 'role_id')::uuid
             and shop_id = p_caller_shop_id and name = 'staff'
         ) then
        raise exception 'only an owner may create a non-staff account'
          using errcode = 'MU014';
      end if;
      p_row := p_row || jsonb_build_object('permission_version', 0);
    end if;

    -- Soft-deleting a user is a revocation, and the delete branch of the base
    -- function writes is_deleted directly rather than from the payload, so the
    -- column preservation above cannot cover it.
    if p_op = 'delete' and not v_caller_is_owner then
      raise exception 'only an owner may remove an account' using errcode = 'MU014';
    end if;

  end if;

  if p_table <> 'user_permissions' then
    v_apply_result := sync_apply_row_base(p_table, p_op, p_row, p_caller_shop_id);

    -- Force only revocation flags after the base dispatcher has proved row
    -- ownership and applied ordinary fields under its unchanged LWW rule.
    -- Doing this before that check could mutate another shop's user even when
    -- the base dispatcher subsequently returned rejected_not_owned.
    if p_table = 'users' and v_target_found and v_apply_result = 'applied' then
      if not coalesce((p_row ->> 'is_active')::boolean, true) then
        update users set is_active = false
          where id = v_row_id and shop_id = p_caller_shop_id and is_active = true;
      end if;
      if coalesce((p_row ->> 'is_deleted')::boolean, false) then
        update users set
          is_deleted = true,
          deleted_at = coalesce((p_row ->> 'deleted_at')::timestamptz, deleted_at, now()),
          deleted_by = coalesce((p_row ->> 'deleted_by')::uuid, deleted_by)
        where id = v_row_id and shop_id = p_caller_shop_id and is_deleted = false;
      end if;
    end if;
    return v_apply_result;
  end if;

  -- Granting permissions is an OWNER action, not a staff_management one.
  -- Otherwise a staff member holding staff_management could write themselves
  -- every other key and become an owner in all but name.
  if not v_caller_is_owner then
    raise exception 'only an owner may change permissions' using errcode = 'MU015';
  end if;

  if p_op not in ('insert','update','delete') then
    raise exception 'unsupported sync operation: %', p_op using errcode='MU002';
  end if;
  if not sync_existing_row_owned_or_missing(p_table, v_row_id, p_caller_shop_id) then
    return 'rejected_not_owned';
  end if;
  -- The override must belong to a user of the CALLER's shop, or a payload could
  -- grant permissions inside someone else's pharmacy.
  if not assert_fk_same_shop('users', (p_row->>'user_id')::uuid, p_caller_shop_id) then
    raise exception 'cross-shop user_permissions.user_id' using errcode='MU003';
  end if;

  if p_op = 'delete' then
    update user_permissions set
      is_deleted = true,
      deleted_at = (p_row->>'deleted_at')::timestamptz,
      deleted_by = (p_row->>'deleted_by')::uuid,
      updated_at = (p_row->>'updated_at')::timestamptz
    where id = v_row_id and shop_id = p_caller_shop_id
      and updated_at < (p_row->>'updated_at')::timestamptz;
  else
    insert into user_permissions
    select * from jsonb_populate_record(null::user_permissions, p_row)
    on conflict(id) do update set
      (created_at, updated_at, is_deleted, deleted_at, deleted_by, shop_id, user_id, key, allowed) =
      (excluded.created_at, excluded.updated_at, excluded.is_deleted, excluded.deleted_at,
       excluded.deleted_by, excluded.shop_id, excluded.user_id, excluded.key, excluded.allowed)
    where user_permissions.shop_id = p_caller_shop_id
      and user_permissions.updated_at < excluded.updated_at;
  end if;

  get diagnostics v_affected = row_count;
  if v_affected = 0 and not sync_existing_row_owned_or_missing(p_table, v_row_id, p_caller_shop_id) then
    return 'rejected_not_owned';
  end if;
  return 'applied';
end
$fn$;

revoke execute on function sync_existing_row_owned_or_missing_base(text,uuid,uuid) from public,anon,authenticated;
revoke execute on function sync_existing_row_owned_or_missing(text,uuid,uuid) from public,anon,authenticated;
revoke execute on function sync_apply_row_base(text,text,jsonb,uuid) from public,anon,authenticated;
revoke execute on function sync_apply_row(text,text,jsonb,uuid,uuid) from public,anon,authenticated;
revoke execute on function sync_actor_column(text) from public,anon,authenticated;
grant execute on function sync_existing_row_owned_or_missing_base(text,uuid,uuid) to service_role;
grant execute on function sync_existing_row_owned_or_missing(text,uuid,uuid) to service_role;
grant execute on function sync_apply_row_base(text,text,jsonb,uuid) to service_role;
grant execute on function sync_apply_row(text,text,jsonb,uuid,uuid) to service_role;
grant execute on function sync_actor_column(text) to service_role;

-- Pull is one flat SQL union with its own ordering and LIMIT, so a wrapper
-- cannot extend it without breaking pagination. Replaced in full; the only
-- change from the original is the user_permissions line.
create or replace function sync_pull_changes(p_shop_id uuid,p_since_updated_at timestamptz,p_since_table text,p_since_id uuid,p_limit int)
returns table(table_name text,row_id uuid,updated_at timestamptz,row_data jsonb)
language sql security definer set search_path=public as $fn$
  with all_changes as (
    select 'shops'::text table_name,id row_id,updated_at,to_jsonb(t.*) row_data from shops t where id=p_shop_id
    union all select 'subscriptions',id,updated_at,to_jsonb(t.*) from subscriptions t where shop_id=p_shop_id
    union all select 'roles',id,updated_at,to_jsonb(t.*) from roles t where shop_id=p_shop_id
    union all select 'permissions',id,updated_at,to_jsonb(t.*) from permissions t where role_id in(select id from roles where shop_id=p_shop_id)
    union all select 'users',id,updated_at,to_jsonb(t.*) from users t where shop_id=p_shop_id
    union all select 'user_permissions',id,updated_at,to_jsonb(t.*) from user_permissions t where shop_id=p_shop_id
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

-- ── 10. Permission-aware RLS, on EVERY synced table ───────────────────────
--
-- The mobile app reaches Postgres only through the sync Edge Function, which
-- runs as service_role and therefore bypasses RLS entirely — the enforcement
-- that matters for it is sync_apply_row and sync_row_permitted above.
--
-- These policies are for the caller the app does not make but an attacker does:
-- a real staff JWT pointed straight at PostgREST, where none of the sync
-- function's checks run. The first pass covered 11 of 22 tables and, fatally,
-- left `permissions` out while covering `roles` and `user_permissions` — so a
-- staff token could rewrite the role DEFAULTS for the entire shop.
--
-- READ and WRITE are separated because the permission model separates them:
-- staff hold inventory_view but not inventory_write, so a single `for all`
-- policy keyed on the write permission would deny them reads they are entitled
-- to. RESTRICTIVE, so these AND with the existing shop_isolation policies and
-- can only narrow, never widen.

-- The first pass named its policies after the permission. Removed FIRST so a
-- re-run cannot leave two generations of restrictive policies ANDed together,
-- which would deny far more than either generation intended.
do $drop_legacy_rls$
declare
  legacy record;
begin
  for legacy in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public' and policyname like 'require\_%'
  loop
    execute format('drop policy if exists %I on %I', legacy.policyname, legacy.tablename);
  end loop;
end
$drop_legacy_rls$;

do $perm_rls$
declare
  entry text[];
begin
  foreach entry slice 1 in array array[
    -- table, read predicate, write predicate
    ['shops',               'auth_is_live_user()',                                              'auth_has_permission(''settings_manage'')'],
    ['subscriptions',       'auth_is_live_user()',                                              'auth_has_permission(''settings_manage'')'],
    ['roles',               'auth_is_live_user()',                                              'auth_has_permission(''staff_management'')'],
    ['permissions',         'auth_is_live_user()',                                              'auth_has_permission(''staff_management'')'],
    ['users',               'auth_is_live_user()',                                              'auth_has_permission(''staff_management'')'],
    ['user_permissions',    'auth_is_live_user()',                                              'auth_has_permission(''staff_management'')'],
    ['medicines',           'auth_has_permission(''inventory_view'') or auth_has_permission(''inventory_write'')', 'auth_has_permission(''inventory_write'')'],
    ['batches',             'auth_has_permission(''inventory_view'') or auth_has_permission(''inventory_write'')', 'auth_has_permission(''inventory_write'')'],
    ['suppliers',           'auth_has_permission(''inventory_view'') or auth_has_permission(''inventory_write'')', 'auth_has_permission(''inventory_write'')'],
    ['purchases',           'auth_has_permission(''inventory_view'') or auth_has_permission(''inventory_write'')', 'auth_has_permission(''inventory_write'')'],
    ['purchase_items',      'auth_has_permission(''inventory_view'') or auth_has_permission(''inventory_write'')', 'auth_has_permission(''inventory_write'')'],
    ['purchase_returns',    'auth_has_permission(''inventory_view'') or auth_has_permission(''inventory_write'')', 'auth_has_permission(''inventory_write'')'],
    -- The reason split again, this time as a row predicate: a sale movement
    -- rides 'sales' and must reduce stock; anything else is an inventory write.
    ['inventory_movements', 'auth_has_permission(''inventory_view'') or auth_has_permission(''sales'')',
                            '(reason = ''sale'' and change_qty < 0 and auth_has_permission(''sales'')) or (reason <> ''sale'' and auth_has_permission(''inventory_write''))'],
    ['customers',           'auth_has_permission(''sales'') or auth_has_permission(''credit_management'')', 'auth_has_permission(''sales'') or auth_has_permission(''credit_management'')'],
    ['credits',             'auth_has_permission(''sales'') or auth_has_permission(''credit_management'')', 'auth_has_permission(''sales'') or auth_has_permission(''credit_management'')'],
    ['sales',               'auth_has_permission(''sales'')',                                     'auth_has_permission(''sales'')'],
    ['sale_items',          'auth_has_permission(''sales'')',                                     'auth_has_permission(''sales'')'],
    ['sales_returns',       'auth_has_permission(''sales'')',                                     'auth_has_permission(''sales'')'],
    ['cash_drawer',         'auth_has_permission(''sales'') or auth_has_permission(''cash_management'')', 'auth_has_permission(''sales'') or auth_has_permission(''cash_management'')'],
    ['expenses',            'auth_has_permission(''cash_management'')',                           'auth_has_permission(''cash_management'')'],
    ['payments',            'auth_has_permission(''cash_management'') or auth_has_permission(''credit_management'') or auth_has_permission(''inventory_write'')',
                            'auth_has_permission(''cash_management'') or auth_has_permission(''credit_management'') or auth_has_permission(''inventory_write'')'],
    -- Append-only and readable by anyone still employed; the value of the trail
    -- is that a deactivated account can no longer add to it.
    ['audit_logs',          'auth_is_live_user()',                                                'auth_is_live_user()']
  ] loop
    execute format('drop policy if exists muthoy_read on %I', entry[1]);
    execute format('drop policy if exists muthoy_insert on %I', entry[1]);
    execute format('drop policy if exists muthoy_update on %I', entry[1]);
    execute format('drop policy if exists muthoy_delete on %I', entry[1]);

    execute format('create policy muthoy_read on %I as restrictive for select using (%s)', entry[1], entry[2]);
    execute format('create policy muthoy_insert on %I as restrictive for insert with check (%s)', entry[1], entry[3]);
    execute format('create policy muthoy_update on %I as restrictive for update using (%s) with check (%s)', entry[1], entry[3], entry[3]);
    execute format('create policy muthoy_delete on %I as restrictive for delete using (%s)', entry[1], entry[3]);
  end loop;
end
$perm_rls$;
