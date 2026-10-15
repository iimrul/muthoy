-- H-9 (migration 33) — converge the B2 staging-cleanup schedule.
--
-- 20260821010000 schedules muthoy-b2-sync-staging-cleanup only if pg_cron is
-- ALREADY installed when it runs, and silently skips it otherwise. A project
-- that enables pg_cron first (the intended PROD and rehearsal order) gets the
-- job from B2 and this verifies it; one where the job is missing gets it here.
--
-- Without pg_cron this is a fixed notice and nothing else: PGlite, and DEV,
-- where enabling the scheduler could delete retained staging data and needs
-- its own founder decision. With pg_cron it requires a UTC/GMT scheduler, the
-- postgres migration role, and the cleanup function exactly as B2 shipped it —
-- SECURITY DEFINER, postgres-owned, unreachable from PUBLIC/anon/authenticated
-- — and then exactly one active job with the approved schedule (03:17 UTC,
-- 09:17 Asia/Dhaka), command, database, owner and execution target. A
-- duplicate or any mismatch aborts rather than overwriting someone's job.
--
-- The execution target is THIS server as pg_cron itself defines it: without
-- background workers a job runs by connecting to (nodename, nodeport), and
-- cron.schedule records cron.host and the server's port there. Both are
-- postmaster settings the migration role cannot change, so a job pointing
-- anywhere else (another host, another port) was not made by this server's
-- cron.schedule and is refused. No endpoint is written into this file; if
-- cron.host is unset or empty the target cannot be established and this
-- aborts. Scheduling goes through
-- cron.schedule only — never DML on cron.job — and nothing runs the cleanup
-- now. The job deletes only staging/rejected operation graphs older than 7
-- days; applied operations are never touched.
--
-- Rollback (under approval): select cron.unschedule('muthoy-b2-sync-staging-cleanup');
-- Graphs it has already deleted are not recreated by unscheduling.

do $h9_schedule$
declare
  v_function regprocedure := to_regprocedure('public.sync_cleanup_incomplete_operations()');
  v_timezone text;
  v_host text;
  v_port integer;
  v_jobs integer;
  v_job record;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'h9_schedule: pg_cron is not installed; the staging-cleanup schedule is unchanged';
    return;
  end if;

  -- The job runs as whoever schedules it: only the postgres migration role.
  if current_user <> 'postgres' then
    raise exception 'h9_schedule: must run as the postgres migration role';
  end if;

  if to_regclass('cron.job') is null or to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'h9_schedule: pg_cron is installed but cron.job or cron.schedule(text,text,text) is missing';
  end if;
  v_timezone := current_setting('cron.timezone', true);
  if v_timezone is null or v_timezone not in ('GMT', 'UTC', 'Etc/UTC', 'Etc/GMT') then
    raise exception 'h9_schedule: cron.timezone must be UTC/GMT';
  end if;
  v_host := current_setting('cron.host', true);
  v_port := current_setting('port')::integer;
  if v_host is null or v_host = '' then
    raise exception 'h9_schedule: the scheduler''s execution target (cron.host, port) cannot be established';
  end if;
  if v_function is null or not exists (
    select 1 from pg_proc p
     where p.oid = v_function
       and p.prosecdef
       and p.prorettype = 'integer'::regtype
       and pg_get_userbyid(p.proowner) = 'postgres'
  ) then
    raise exception 'h9_schedule: public.sync_cleanup_incomplete_operations() is not the expected definer function';
  end if;
  if has_function_privilege('anon', v_function, 'execute')
     or has_function_privilege('authenticated', v_function, 'execute')
     or exists (
       select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) grant_row
        where p.oid = v_function and grant_row.grantee = 0 and grant_row.privilege_type = 'EXECUTE'
     ) then
    raise exception 'h9_schedule: the cleanup function is executable by PUBLIC or an API role';
  end if;

  select count(*) into v_jobs from cron.job where jobname = 'muthoy-b2-sync-staging-cleanup';
  if v_jobs > 1 then
    raise exception 'h9_schedule: more than one muthoy-b2-sync-staging-cleanup job exists';
  end if;
  if v_jobs = 0 then
    perform cron.schedule(
      'muthoy-b2-sync-staging-cleanup',
      '17 3 * * *',
      'select public.sync_cleanup_incomplete_operations();'
    );
  end if;

  select count(*) into v_jobs from cron.job where jobname = 'muthoy-b2-sync-staging-cleanup';
  select job.schedule, job.command, job.nodename, job.nodeport, job.database, job.username, job.active into v_job
    from cron.job job where job.jobname = 'muthoy-b2-sync-staging-cleanup';
  if v_jobs <> 1
     or v_job.schedule is distinct from '17 3 * * *'
     or v_job.command is distinct from 'select public.sync_cleanup_incomplete_operations();'
     or v_job.nodename is distinct from v_host
     or v_job.nodeport is distinct from v_port
     or v_job.database is distinct from current_database()
     or v_job.username is distinct from 'postgres'
     or v_job.active is not true then
    raise exception 'h9_schedule: muthoy-b2-sync-staging-cleanup does not match the approved job';
  end if;
end
$h9_schedule$;
