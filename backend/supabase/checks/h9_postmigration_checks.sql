-- H-9 post-migration checks — READ ONLY. Used by the Phase 3 rehearsal and the
-- Phase 4 production runbook (backend/supabase/deploy/README.md).
--
-- Each section is ONE select returning rows of (check_name, pass, detail).
-- Run a section inside a read-only transaction, for example:
--
--   begin transaction read only;
--   <paste one section>
--   rollback;
--
-- Any row with pass = false is a stop condition for the step that ran it.
-- detail carries counts or names only: never keys, tokens, phones or rows.
-- Sections are delimited by "-- section: <name>" lines; the pgtests execute
-- each one against fresh, historical and adverse states (h9-*.pgtest.ts).

-- section: constraints
-- Migration 32's end state. Valid on any project that has run it.
with holds as (
  select to_regclass('public.device_enrollment_holds') as rel
), canonical as (
  select c.conbin::text as conbin, c.convalidated
    from pg_constraint c, holds
   where c.conrelid = holds.rel and c.contype = 'c'
     and c.conname = 'device_enrollment_holds_consumption_check'
)
select 'holds_table_present' as check_name,
       (select rel is not null from holds) as pass,
       '' as detail
union all
select 'canonical_consumption_check_validated',
       coalesce((select convalidated from canonical), false),
       ''
union all
select 'single_consumption_rule',
       (select count(*) = 1 from pg_constraint c, holds, canonical k
         where c.conrelid = holds.rel and c.contype = 'c' and c.conbin::text = k.conbin),
       (select count(*)::text from pg_constraint c, holds, canonical k
         where c.conrelid = holds.rel and c.contype = 'c' and c.conbin::text = k.conbin)
union all
select 'no_check1_duplicate',
       not exists (select 1 from pg_constraint c, holds
                    where c.conrelid = holds.rel and c.conname = 'device_enrollment_holds_check1'),
       ''
union all
select 'no_h9_probe_left',
       not exists (select 1 from pg_constraint c, holds
                    where c.conrelid = holds.rel
                      and c.conname in ('h9_device_enrollment_holds_consumption_probe',
                                        'h9_device_enrollment_holds_approval_probe')),
       ''
union all
select 'two_check_constraints_total',
       (select count(*) = 2 from pg_constraint c, holds where c.conrelid = holds.rel and c.contype = 'c'),
       (select count(*)::text from pg_constraint c, holds where c.conrelid = holds.rel and c.contype = 'c');

-- section: cron
-- Migration 33's end state where pg_cron is installed (rehearsal, PROD). Run
-- only after `select exists(select 1 from pg_extension where extname='pg_cron')`
-- returns true: on a project without pg_cron, cron.job does not exist.
select 'pg_cron_installed' as check_name,
       exists (select 1 from pg_extension where extname = 'pg_cron') as pass,
       '' as detail
union all
select 'cron_timezone_utc',
       coalesce(current_setting('cron.timezone', true), '') in ('GMT', 'UTC', 'Etc/UTC', 'Etc/GMT'),
       coalesce(current_setting('cron.timezone', true), '')
union all
select 'staging_cleanup_job_unique',
       (select count(*) = 1 from cron.job where jobname = 'muthoy-b2-sync-staging-cleanup'),
       (select count(*)::text from cron.job where jobname = 'muthoy-b2-sync-staging-cleanup')
union all
select 'staging_cleanup_job_exact',
       (select count(*) = 1 from cron.job
         where jobname = 'muthoy-b2-sync-staging-cleanup'
           and schedule = '17 3 * * *'
           and command = 'select public.sync_cleanup_incomplete_operations();'
           and database = current_database()
           and username = 'postgres'
           and active),
       ''
union all
-- The job runs on THIS server: the target pg_cron's own cron.schedule records
-- (cron.host and the server's port), never another host or port.
select 'staging_cleanup_job_targets_this_server',
       coalesce((select count(*) = 1 from cron.job
                  where jobname = 'muthoy-b2-sync-staging-cleanup'
                    and nullif(current_setting('cron.host', true), '') is not null
                    and nodename = current_setting('cron.host', true)
                    and nodeport = current_setting('port')::integer), false),
       '';

-- section: cron_runs
-- Rehearsal only (Phase 3, A4): after 03:17 UTC, the job's latest run.
select 'staging_cleanup_latest_run_succeeded' as check_name,
       coalesce((
         select d.status = 'succeeded'
           from cron.job_run_details d
           join cron.job j on j.jobid = d.jobid
          where j.jobname = 'muthoy-b2-sync-staging-cleanup'
          order by d.start_time desc nulls last
          limit 1
       ), false) as pass,
       coalesce((
         select d.status
           from cron.job_run_details d
           join cron.job j on j.jobid = d.jobid
          where j.jobname = 'muthoy-b2-sync-staging-cleanup'
          order by d.start_time desc nulls last
          limit 1
       ), 'no run recorded') as detail;

-- section: history_pre_h9
-- DEV before H-9's migrations: exactly the 31 recorded historical versions.
select 'history_has_31_versions' as check_name,
       (select count(*) = 31 from supabase_migrations.schema_migrations) as pass,
       (select count(*)::text from supabase_migrations.schema_migrations) as detail
union all
select 'history_has_no_h9_or_later_version',
       not exists (select 1 from supabase_migrations.schema_migrations where version >= '20261008000000'),
       coalesce((select string_agg(version, ',' order by version)
                   from supabase_migrations.schema_migrations where version >= '20261008000000'), '');

-- section: history_post_h9
-- Any project after H-9's migrations: 33 versions, both H-9 versions, nothing later.
select 'history_has_33_versions' as check_name,
       (select count(*) = 33 from supabase_migrations.schema_migrations) as pass,
       (select count(*)::text from supabase_migrations.schema_migrations) as detail
union all
select 'history_has_both_h9_versions',
       (select count(*) = 2 from supabase_migrations.schema_migrations
         where version in ('20261008000000', '20261008000100')),
       ''
union all
select 'history_has_nothing_after_h9',
       not exists (select 1 from supabase_migrations.schema_migrations where version > '20261008000100'),
       coalesce((select string_agg(version, ',' order by version)
                   from supabase_migrations.schema_migrations where version > '20261008000100'), '');
