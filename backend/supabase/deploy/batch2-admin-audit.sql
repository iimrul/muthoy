-- Batch 2 / W4-06 — the durable admin audit table.
--
-- STAGED, NOT APPLIED. **BLOCKED on gate E4.**
--
-- This file is deliberately NOT in backend/supabase/migrations/. The migration
-- chain is sealed: it holds 34 files ending at
-- 20261015000000_h9_api_role_table_privileges.sql, and three H-9 gates are
-- pinned to that state, one of them by the SHA-256 of
-- backend/supabase/checks/h9_postmigration_checks.sql. Adding a 35th migration
-- breaks all three, so the SQL below is staged here for review and applied as a
-- Batch 3 migration once E4 clears. Nothing in this file has been executed
-- against any database, local or hosted.
--
-- WHY A NEW TABLE, rather than reusing public.audit_logs: that table is
-- shop-scoped (every row carries shop_id and belongs to a shop's own history),
-- and an admin action is not a shop's action. A platform operator reading every
-- shop's accounts has no shop_id, and forcing one would either invent a shop or
-- make the column meaningless. Keeping them apart also keeps a shop's audit
-- trail free of platform-operator rows it must never show its staff.
--
-- WHAT SHIPS TODAY WITHOUT THIS TABLE (apps/admin/lib/adminAudit.ts): one
-- structured JSON line per event on stderr, which the host platform's log
-- retention keeps and which is the RECORD OF ACCOUNT, plus an in-process ring
-- buffer of the most recent 200 entries that /audit renders. The sink is an
-- interface precisely so that adding a Postgres sink here changes NO call site:
-- recordAdminAction keeps its signature and every caller keeps its line.
--
-- HONEST LIMIT the ring buffer has and this table removes: the in-app view is
-- per-instance and non-durable. A restart clears it, and a second instance has
-- its own. Until this lands, /audit says so in the UI.

begin;

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- When the ACTION happened, as the panel recorded it (ISO-8601 UTC in the
  -- stderr line; a timestamptz here).
  at timestamptz not null,
  -- The admin username from the VERIFIED session cookie. Never a value taken
  -- from a request body: an actor a caller can choose is not an actor.
  actor text not null,
  -- The role ADMIN_ROLES granted at the time of the action, or null when the
  -- action had no authenticated role (a failed login, a revoked session).
  role text,
  action text not null,
  -- What the action acted on: an account id, a shop id, a payment order id.
  -- Null for actions with no single target, such as a login.
  target text,
  outcome text not null check (outcome in ('success', 'failure', 'denied')),
  -- Allowlist-filtered metadata only. apps/admin/lib/adminAudit.ts drops every
  -- key outside ALLOWED_META_KEYS and scrubs phone-shaped and token-shaped
  -- values, so a service-role key, a session secret, a password hash, a bKash
  -- credential or a customer phone number cannot reach this column.
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The panel reads newest-first and filters by actor; both are covered without a
-- third index.
create index if not exists admin_audit_log_at_idx
  on public.admin_audit_log (at desc, id);
create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor, at desc);

-- RLS on, with NO policy: nothing reaches this table through the API roles at
-- all. service_role's BYPASSRLS is what the panel uses, and the explicit
-- revokes below are what make the API roles' lack of access a fact rather than
-- an assumption (BYPASSRLS skips policies but NOT table privileges).
alter table public.admin_audit_log enable row level security;

-- service_role IS INCLUDED in the revoke, deliberately. The hosted platform's
-- default privileges give service_role more than SELECT and INSERT on a new
-- public table — the measured profile recorded in this repository's H-9 work is
-- service_role=Dxtm, i.e. TRUNCATE, REFERENCES, TRIGGER and MAINTAIN — so
-- granting without revoking first would leave TRUNCATE in place on an AUDIT
-- table. A panel that can truncate its own audit log has no audit log. Revoking
-- everything and then granting exactly two privileges is what makes the comment
-- below true rather than aspirational. (Delta review finding 4.)
revoke all on table public.admin_audit_log from public, anon, authenticated, service_role;

-- INSERT and SELECT only. No UPDATE, no DELETE and no TRUNCATE: an audit row
-- the panel can edit or erase is not evidence. Retention is an operator
-- decision taken outside the application, not an application privilege.
grant insert, select on table public.admin_audit_log to service_role;

commit;

-- VERIFICATION to run after this is applied, as a Batch 3 migration:
--
--   select has_table_privilege('service_role', 'public.admin_audit_log', 'insert');  -- t
--   select has_table_privilege('service_role', 'public.admin_audit_log', 'select');  -- t
--   select has_table_privilege('service_role', 'public.admin_audit_log', 'update');     -- f
--   select has_table_privilege('service_role', 'public.admin_audit_log', 'delete');     -- f
--   select has_table_privilege('service_role', 'public.admin_audit_log', 'truncate');   -- f
--   select has_table_privilege('service_role', 'public.admin_audit_log', 'references'); -- f
--   select has_table_privilege('service_role', 'public.admin_audit_log', 'trigger');    -- f
--   select has_table_privilege('anon', 'public.admin_audit_log', 'select');          -- f
--   select has_table_privilege('authenticated', 'public.admin_audit_log', 'select'); -- f
--   select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass; -- t
--
-- backend/supabase/pgtest/batch2-admin-acl.pgtest.ts is where those assertions
-- belong once the table exists; it already proves the same shape for every
-- table the panel reads today.
