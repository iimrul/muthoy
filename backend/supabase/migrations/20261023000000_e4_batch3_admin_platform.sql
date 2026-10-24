-- E4 / Batch 3 — the admin platform migration. Migration 35.
--
-- This is the FIRST file added to this chain since H-9 sealed it at 34. The
-- seal and its successor mechanism are documented in
-- docs/plans/e4-migration-and-rollback.md; the short version is that
-- backend/supabase/checks/h9_postmigration_checks.sql stays BYTE-IDENTICAL and
-- keeps describing the H-9 baseline, while
-- backend/supabase/checks/e4_postmigration_checks.sql asserts the live 35-file
-- chain by exact version set. Four gates were updated to match, none weakened.
--
-- ROLLBACK CLASS: C (forward-only), DECLARED rather than inferred. Mechanically
-- this file scores B — it ships `create or replace function` and performs no
-- DML. The override is deliberate: reversing it would mean dropping
-- admin_audit_log, and an audit log you roll back by deleting is not evidence.
-- Per-component reversal is documented in the plan; the file as a whole is not
-- reversed.
--
-- WHY ONE FILE AND NOT SIX: every additional migration multiplies the four-gate
-- churn above for no benefit.
--
-- THE PRIVILEGE PATTERN, used for every new table below and for the reason the
-- Batch 2 staged SQL recorded: the hosted platform's default privileges give
-- service_role MORE than select/insert on a new public table — the profile
-- measured in this repository's H-9 work is service_role=Dxtm, i.e. TRUNCATE,
-- REFERENCES, TRIGGER and MAINTAIN. So each table is (1) revoked from every
-- role including service_role, (2) granted exactly what it needs — column-level
-- where only some columns may change, and (3) RLS-enabled with NO policy, so
-- the API roles reach nothing at all and service_role's BYPASSRLS is what the
-- panel uses. Granting without revoking first would leave TRUNCATE on an audit
-- table.
--
-- Everything here is idempotent: `if not exists`, `create or replace`, and
-- `to_regprocedure`-guarded renames.

begin;

-- ══════════════════════════════════════════════════════════════════════════
-- a. W4-04 — service_role READS sale_refunds, and only reads it
-- ══════════════════════════════════════════════════════════════════════════
--
-- 20260821010000:299's `do` block runs
--   grant select, insert, update, delete on table %I to service_role
-- over a list that INCLUDES sale_refunds, so the admin panel's key currently
-- holds full DML on a money table. The admin panel only ever reads it (the
-- refund-net figure), so the DML is revoked and SELECT re-granted.
--
-- This cannot break a write path: every sale_refunds write travels through
-- sync_apply_row, which is SECURITY DEFINER and therefore executes as its
-- OWNER, not as service_role. The pull path reads it as service_role, which is
-- why SELECT must stay. Both halves are asserted in
-- backend/supabase/pgtest/e4-admin-platform.pgtest.ts, and because
-- harness.ts's createHarness() applies every migration, every existing B2/B3/B4
-- suite is a regression test for this revoke.
revoke all on table public.sale_refunds from service_role;
grant select on table public.sale_refunds to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- b. The per-shop audit view READS audit_logs, and only reads it
-- ══════════════════════════════════════════════════════════════════════════
--
-- Volume 5 requires a read-only admin view into each shop's own audit_logs
-- ("support/debugging use only — never edit or delete from here, matching the
-- append-only DB policy"). Same treatment: revoke everything, grant SELECT.
-- backend/supabase/functions/sync/pull.ts lists audit_logs as a pullable table,
-- so SELECT is load-bearing; writes go through the sync RPCs as above.
revoke all on table public.audit_logs from service_role;
grant select on table public.audit_logs to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- c. admin_audit_log — the durable admin audit record
-- ══════════════════════════════════════════════════════════════════════════
--
-- Promoted from backend/supabase/deploy/batch2-admin-audit.sql, which was
-- staged out of chain and never executed because the chain was sealed. Every
-- column, index, revoke and grant of that file is preserved. ONE column is
-- ADDED: actor_verified. It is not a cosmetic addition —
-- apps/admin/lib/adminLogin.ts audits a FAILED LOGIN with the submitted
-- username and no verified session cookie, because a login attempt necessarily
-- precedes a session. Without this column the log cannot distinguish "this
-- admin did X" from "somebody claimed to be this admin and failed", which is
-- the difference between evidence and hearsay.
--
-- NO FOREIGN KEY, deliberately (CLAUDE.md rule 2 wants every FK to carry an
-- explicit onDelete; this table carries none and says why): an admin actor is a
-- username from the ADMIN_ROLES allowlist, not a public.users row. A key to a
-- table that holds no admins would be fiction.
--
-- WHY NOT public.audit_logs: that table is shop-scoped — every row carries
-- shop_id and belongs to one shop's history. A platform operator reading every
-- shop's accounts has no shop_id, and forcing one would either invent a shop or
-- make the column meaningless. Keeping them apart also keeps a shop's own audit
-- trail free of platform-operator rows its staff must never see.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- When the ACTION happened, as the panel recorded it.
  at timestamptz not null,
  -- The admin username. From the VERIFIED session cookie when
  -- actor_verified is true; the CLAIMED subject of a login attempt when it is
  -- false. Never a value an authenticated caller chose for itself.
  actor text not null,
  actor_verified boolean not null default false,
  -- The role ADMIN_ROLES granted at the time, or null when the action had no
  -- authenticated role (a failed login, a revoked session).
  role text,
  action text not null,
  -- What the action acted on: an account, shop, payment order, case or setting.
  -- Null for actions with no single target, such as a login.
  target text,
  outcome text not null check (outcome in ('success', 'failure', 'denied')),
  -- Allowlist-filtered metadata only. apps/admin/lib/adminAudit.ts drops every
  -- key outside ALLOWED_META_KEYS and scrubs phone-shaped and token-shaped
  -- values, so a service-role key, a session secret, a password hash, a
  -- credential or a customer phone number cannot reach this column.
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The panel reads newest-first and filters by actor; both covered without a third index.
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc, id);
create index if not exists admin_audit_log_actor_idx on public.admin_audit_log (actor, at desc);

alter table public.admin_audit_log enable row level security;

revoke all on table public.admin_audit_log from public, anon, authenticated, service_role;
-- INSERT and SELECT only. No UPDATE, no DELETE, no TRUNCATE, and no
-- column-level update either: an audit row the panel can edit or erase is not
-- evidence. Retention is an operator decision taken outside the application,
-- not an application privilege.
grant insert, select on table public.admin_audit_log to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- d. admin_role_assignments — per-user role narrowing and session revocation
-- ══════════════════════════════════════════════════════════════════════════
--
-- apps/admin/lib/adminSession.ts records the limit this closes: revocation is
-- ADMIN_SESSION_EPOCH, which is all-or-nothing and only takes effect once a new
-- environment is live. Per-user revocation needed a table.
--
-- THE AUTHORITY MODEL, which the application enforces and this table only
-- stores: ADMIN_ROLES stays the bootstrap allowlist — a username absent from it
-- has no authority at all, and the Edge middleware keeps that cheap check with
-- no database round-trip. A row here can only NARROW: the effective permission
-- set is the INTERSECTION of the environment role's permissions and this
-- row's role's permissions. So a write here can never grant a permission the
-- environment role lacks. An is_active=false row DENIES outright and never
-- falls back to ADMIN_ROLES.
--
-- NO FOREIGN KEY: same reason as admin_audit_log — the username space is
-- ADMIN_ROLES, not a table.
create table if not exists public.admin_role_assignments (
  username text primary key,
  role text not null check (role in ('super_admin', 'billing', 'support', 'read_only')),
  is_active boolean not null default true,
  -- A session whose iat is at or before this instant is rejected. This is the
  -- per-user half of revocation; ADMIN_SESSION_EPOCH remains the break-glass.
  sessions_revoked_at timestamptz,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_role_assignments enable row level security;

revoke all on table public.admin_role_assignments from public, anon, authenticated, service_role;
grant select, insert on table public.admin_role_assignments to service_role;
-- COLUMN-LEVEL update: username, assigned_by and assigned_at are the
-- attribution, and attribution the panel can rewrite is not attribution. They
-- are immutable by PRIVILEGE, not by convention.
grant update (role, is_active, sessions_revoked_at, updated_at)
  on table public.admin_role_assignments to service_role;
-- No DELETE: an account is DISABLED, never deleted, so its history survives.

-- ══════════════════════════════════════════════════════════════════════════
-- e. admin_support_cases / admin_support_notes — support persistence
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists public.admin_support_cases (
  id uuid primary key default gen_random_uuid(),
  -- ON DELETE RESTRICT: a support case is PLATFORM history and must not vanish
  -- because a shop row went. Shops are soft-deleted (is_deleted) and never
  -- hard-deleted, so this blocks nothing that happens today — it is here so the
  -- policy is explicit rather than defaulted (CLAUDE.md rule 2).
  shop_id uuid not null references public.shops(id) on delete restrict,
  category text not null check (
    category in ('onboarding', 'sync', 'payment', 'data', 'device', 'account', 'other')
  ),
  status text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee text,
  summary text not null check (length(summary) between 1 and 2000),
  opened_by text not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_support_cases_status_idx
  on public.admin_support_cases (status, updated_at desc);
create index if not exists admin_support_cases_shop_idx
  on public.admin_support_cases (shop_id, opened_at desc);

alter table public.admin_support_cases enable row level security;

revoke all on table public.admin_support_cases from public, anon, authenticated, service_role;
grant select, insert on table public.admin_support_cases to service_role;
-- id, shop_id, opened_by and opened_at are immutable by privilege: a case
-- cannot be silently reassigned to a different shop or a different opener.
grant update (status, priority, assignee, summary, updated_at)
  on table public.admin_support_cases to service_role;

create table if not exists public.admin_support_notes (
  id uuid primary key default gen_random_uuid(),
  -- ON DELETE RESTRICT, not CASCADE. A cascade would make this append-only
  -- guarantee depend on `delete` staying absent from every role forever — and a
  -- later migration or the table owner can delete a case. RESTRICT makes the
  -- note history protect the case, which is what append-only means.
  case_id uuid not null references public.admin_support_cases(id) on delete restrict,
  body text not null check (length(body) between 1 and 8000),
  author text not null,
  created_at timestamptz not null default now()
);

create index if not exists admin_support_notes_case_idx
  on public.admin_support_notes (case_id, created_at);

alter table public.admin_support_notes enable row level security;

revoke all on table public.admin_support_notes from public, anon, authenticated, service_role;
-- Append-only by PRIVILEGE: no update, no delete, no truncate, and no
-- column-level update. A note is a record of what somebody said at a time.
grant select, insert on table public.admin_support_notes to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- f. admin_platform_settings — settings persistence with a key allowlist
-- ══════════════════════════════════════════════════════════════════════════
--
-- The CHECK is the allowlist, so an arbitrary configuration key cannot be
-- written even by a caller holding the table privilege. The same six keys are
-- enumerated in apps/admin/lib/adminSettings.ts and a test asserts the two
-- lists are identical, so they cannot drift.
--
-- Only the three flag.* keys are EDITABLE in the panel: isFeatureEnabled is
-- read by the analytics, maps and reports-PDF routes themselves, which is a
-- real server-side consumer. The three notification.template.* keys are stored
-- but rendered READ-ONLY, because no admin notification dispatcher exists
-- anywhere in the product and a save that nothing reads is a placeholder
-- pretending to be a feature.
create table if not exists public.admin_platform_settings (
  key text primary key check (key in (
    'flag.analytics_enabled',
    'flag.maps_enabled',
    'flag.reports_pdf_enabled',
    'notification.template.trial_ending',
    'notification.template.payment_failed',
    'notification.template.subscription_expired'
  )),
  value jsonb not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_platform_settings enable row level security;

revoke all on table public.admin_platform_settings from public, anon, authenticated, service_role;
grant select, insert on table public.admin_platform_settings to service_role;
-- `key` is immutable by privilege as well as by being the primary key.
grant update (value, updated_by, updated_at)
  on table public.admin_platform_settings to service_role;

-- ══════════════════════════════════════════════════════════════════════════
-- g. W4-05 — shop sync security
-- ══════════════════════════════════════════════════════════════════════════
--
-- THE THREAT, as Batch 1's plan corrected it: a non-owner cannot write
-- user_permissions at all — 20260819000000 raises MU015, "only an owner may
-- change permissions". What remains is OWNER-INITIATED: an Owner *can* grant
-- settings_manage, the server *does* honour it (user_has_permission), and
-- whole-row LWW on `shops` would then hand a Manager the entire shop identity
-- row. So this is preventive hardening of a latent divergence, not the closure
-- of a live hole, and it is not described as one.
--
-- TWO INDEPENDENT BARRIERS, and the redundancy is the point: a defect in either
-- one alone is not an exposure.
--   (a) the permission gate — the `shops` arm requires an active Owner;
--   (b) the field-level pin — a non-owner's identity fields are overwritten
--       from the stored row before the write is applied.

-- The owner predicate, used by both barriers. STABLE, so it can be called from
-- a SQL function body.
create or replace function w405_actor_is_shop_owner(p_app_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1
      from users u
      join roles r on r.id = u.role_id and r.shop_id = u.shop_id
     where u.id = p_app_user_id
       and u.is_active
       and not u.is_deleted
       and not r.is_deleted
       and r.name = 'owner'
  )
$fn$;

revoke execute on function w405_actor_is_shop_owner(uuid) from public, anon, authenticated;
grant execute on function w405_actor_is_shop_owner(uuid) to service_role;

-- ── (a) the permission gate ───────────────────────────────────────────────
--
-- The EFFECTIVE definition today is B4's wrapper (20260831000000:425), whose
-- `else` arm delegates to sync_row_permitted_pre_b4, where the `shops` arm is
-- `user_has_permission(p_app_user_id, 'settings_manage')`. This wrapper
-- replaces that one arm with an Owner requirement — matching what
-- apps/mobile/domain/permissions.ts has always told the product — and delegates
-- everything else unchanged.
--
-- The `subscriptions` arm is LEFT ALONE on purpose. B4's wrapper already has
-- `when p_table='subscriptions' then false` as its FIRST branch, for everyone,
-- Owners included. Three revisions of Batch 1's plan each proposed changing it
-- and each was wrong: the `when 'subscriptions' then true` they cited belongs
-- to sync_table_readable (20260907000000:228), the pull-side READ acl, which
-- has nothing to do with push permission. Recorded so it is not repeated.
do $w405_rename_row_permitted$
begin
  if to_regprocedure('public.sync_row_permitted(uuid,text,jsonb)') is not null
     and to_regprocedure('public.sync_row_permitted_pre_w405(uuid,text,jsonb)') is null then
    alter function public.sync_row_permitted(uuid, text, jsonb)
      rename to sync_row_permitted_pre_w405;
  end if;
end
$w405_rename_row_permitted$;

create or replace function sync_row_permitted(p_app_user_id uuid, p_table text, p_row jsonb)
returns boolean language sql volatile security definer set search_path = public as $fn$
  select case
    when p_table = 'shops' then w405_actor_is_shop_owner(p_app_user_id)
    else sync_row_permitted_pre_w405(p_app_user_id, p_table, p_row)
  end
$fn$;

-- ── (b) the field-level pin ───────────────────────────────────────────────
--
-- The same `v_row := p_row || jsonb_build_object(...)` mechanism
-- 20260831000000 already uses for the six commercial fields.
--
-- A NULL p_caller_user_id pins, because w405_actor_is_shop_owner(null) is
-- false. That is the safe direction: an unknown actor is not an owner.
-- A shop row that does not exist yet is NOT pinned (`if found`), so owner
-- registration — which inserts the row — passes through untouched.
do $w405_rename_apply_row$
begin
  if to_regprocedure('public.sync_apply_row(text,text,jsonb,uuid,uuid,text)') is not null
     and to_regprocedure('public.sync_apply_row_pre_w405(text,text,jsonb,uuid,uuid,text)') is null then
    alter function public.sync_apply_row(text, text, jsonb, uuid, uuid, text)
      rename to sync_apply_row_pre_w405;
  end if;
end
$w405_rename_apply_row$;

-- The 5-argument overload needs no change: PostgreSQL re-resolves a SQL
-- function body's callees BY NAME after a rename, so
-- sync_apply_row(t,o,r,shop,user) -> sync_apply_row(...,null) lands on this
-- wrapper automatically. The same property H-7 relied on for its own rename,
-- and the pgtest drives BOTH arities rather than assuming it.
create or replace function sync_apply_row(
  p_table text, p_op text, p_row jsonb,
  p_caller_shop_id uuid, p_caller_user_id uuid, p_device_id text
) returns text language plpgsql security definer set search_path = public as $fn$
declare v_row jsonb := p_row; v_shop shops%rowtype;
begin
  if p_table = 'shops' and p_op <> 'delete'
     and not w405_actor_is_shop_owner(p_caller_user_id) then
    select * into v_shop from shops where id = p_caller_shop_id;
    if found then
      v_row := p_row || jsonb_build_object(
        'name', v_shop.name,
        'name_en', v_shop.name_en,
        'phone', v_shop.phone,
        'latitude', v_shop.latitude,
        'longitude', v_shop.longitude,
        'thana', v_shop.thana,
        'district', v_shop.district,
        'location_captured_at', v_shop.location_captured_at
      );
    end if;
  end if;
  return sync_apply_row_pre_w405(
    p_table, p_op, v_row, p_caller_shop_id, p_caller_user_id, p_device_id
  );
end
$fn$;

-- ── W4-05's five ACL statements ───────────────────────────────────────────
--
-- The renamed implementations are reachable by NOTHING: revoked from the API
-- roles AND from service_role. Each wrapper calls its implementation as its
-- SECURITY DEFINER owner, which retains EXECUTE, so revoking service_role does
-- not break the path — and the pgtest asserts both halves rather than assuming
-- it, because "the wrapper still works" is exactly the claim that would fail
-- silently.
revoke execute on function sync_row_permitted_pre_w405(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function sync_row_permitted(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function sync_row_permitted(uuid, text, jsonb) to service_role;

revoke execute on function sync_apply_row_pre_w405(text, text, jsonb, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function sync_apply_row(text, text, jsonb, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function sync_apply_row(text, text, jsonb, uuid, uuid, text) to service_role;

commit;
