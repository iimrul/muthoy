-- H-7 defence in depth: take TRUNCATE away from the API roles.
--
-- Additive, and privilege-only. This migration creates nothing, drops nothing,
-- and changes no policy. It touches exactly one privilege, on exactly two
-- roles.
--
-- WHAT WAS FOUND
--
-- Reading pg_default_acl on the hosted project on 2026-09-07 — rather than
-- assuming what Supabase grants — showed that tables created by `postgres` in
-- schema public carry this default:
--
--   anon=Dxtm  authenticated=Dxtm  service_role=Dxtm
--
-- where D=TRUNCATE, x=REFERENCES, t=TRIGGER, m=MAINTAIN. The familiar blanket
-- `grant all` belongs to the supabase_admin default ACL, which governs tables
-- the platform creates, never the ones these migrations create. So the API
-- roles never had SELECT/INSERT/UPDATE/DELETE here — but they were handed
-- TRUNCATE on every table this schema has ever created, and nothing had taken
-- it back. 32 tables still held it when this migration was written.
--
-- WHY IT MATTERS, AND WHY IT IS NOT A BREACH
--
-- TRUNCATE is not DELETE. It is not filtered by row level security at all:
-- policies never run, so every guarantee the rest of H-7 establishes about who
-- may see or change which shop's rows is simply bypassed. It also leaves no
-- tombstone, which is the one thing this system's delete model depends on — a
-- truncated table would empty in the cloud and survive on every device, with
-- nothing to propagate the loss and nothing to reconcile against.
--
-- It was NOT reachable when this was written, and this is defence in depth
-- rather than an incident: PostgREST exposes no TRUNCATE verb, so the privilege
-- has no route through the API surface; and no function in schema public issues
-- a TRUNCATE, so no SECURITY DEFINER or SECURITY INVOKER RPC can be persuaded
-- to issue one on a caller's behalf. The privilege was a loaded primitive with
-- no trigger attached. This removes the primitive.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- service_role keeps everything it holds. It is BYPASSRLS and is held only by
-- the Edge Functions, its TRUNCATE comes from the same platform default, and
-- withdrawing privileges from the sync path was not the finding. The table
-- owner is likewise untouched.
--
-- REFERENCES, TRIGGER and MAINTAIN also remain with anon/authenticated from the
-- same default ACL. They are recorded here as known residue rather than fixed:
-- each deserves its own reasoning about reachability, and widening this change
-- past the finding would ship privilege edits that no test in this pass covers.
--
-- No SELECT/INSERT/UPDATE/DELETE grant is touched, and no policy is touched, so
-- the RLS tests continue to exercise the policies rather than a privilege error.

-- ── 1. Every base table that exists today ─────────────────────────────────
--
-- Driven from the catalog rather than a hand-written list. A literal array
-- would silently miss any table added between authoring and applying this
-- file, and the whole point of the finding is that a table can acquire this
-- privilege without anyone writing it down. REVOKE on a privilege that was
-- never granted is a no-op, so this converges on a re-run and is safe to apply
-- to a project at any point in the ledger.
do $revoke_truncate$
declare
  v_table text;
begin
  for v_table in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute format(
      'revoke truncate on table public.%I from anon, authenticated', v_table
    );
  end loop;
end
$revoke_truncate$;

-- ── 2. Every base table created from here on ──────────────────────────────
--
-- Section 1 alone would be a one-time sweep: the platform default ACL still
-- says anon=Dxtm, so the next migration to create a table would hand the
-- privilege straight back, and the next audit would find it again.
--
-- This narrows the default itself, removing TRUNCATE and leaving the rest of
-- the entry intact. Unlike revoking a privilege PostgreSQL grants implicitly,
-- this one lands: a default ACL entry for these roles already exists, so there
-- is something to subtract from.
--
-- service_role is deliberately absent from this statement for the same reason
-- as above.
alter default privileges in schema public
  revoke truncate on tables from anon, authenticated;
