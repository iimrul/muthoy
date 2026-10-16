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

-- section: api_role_privileges
-- R4 end state: exact X2, all-creator defaults, conservative membership and role attributes.
with recursive reachable(role_oid) as (
  select roleid from pg_auth_members where member in ('anon'::regrole, 'authenticated'::regrole)
  union select m.roleid from pg_auth_members m join reachable r on m.member = r.role_oid
), principals(role_oid) as (
  select 'anon'::regrole::oid union select 'authenticated'::regrole::oid union select role_oid from reachable
), platform_approved(creator, schema_name, kind, grantor, grantee, privilege, grantable) as (
  select 'supabase_admin', 'public', t.kind, 'supabase_admin', g.name, p.privilege, false
    from (values ('r', array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']),
                 ('S', array['SELECT','UPDATE','USAGE']), ('f', array['EXECUTE'])) t(kind, privileges)
   cross join unnest(array['anon','authenticated','postgres','service_role']) g(name)
   cross join lateral unnest(t.privileges) p(privilege)
), platform_held as (
  select d.defaclrole::regrole::text, coalesce(n.nspname::text, '*'), d.defaclobjtype::text,
         a.grantor::regrole::text, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
         a.privilege_type, a.is_grantable
    from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace, aclexplode(d.defaclacl) a
   where d.defaclrole = to_regrole('supabase_admin')::oid
     and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
), platform_missing as (
  select * from platform_approved except all select * from platform_held
), platform_extra as (
  select * from platform_held except all select * from platform_approved
), default_acls as (
  -- Creation uses only the current creator's defaults; schema entries add to the global default.
  select r.oid creator, t.kind, a.source, x.grantee, x.privilege_type privilege, x.is_grantable grantable
    from pg_roles r cross join (values ('r'::"char"), ('S'::"char"), ('f'::"char")) t(kind)
   cross join lateral (
     select 'global'::text source, d.defaclacl acl from pg_default_acl d
      where d.defaclrole = r.oid and d.defaclobjtype = t.kind and d.defaclnamespace = 0
     union all
     select 'built-in', acldefault(case when t.kind = 'S' then 's'::"char" else t.kind end, r.oid)
      where not exists (select 1 from pg_default_acl d
                         where d.defaclrole = r.oid and d.defaclobjtype = t.kind and d.defaclnamespace = 0)
     union all
     select 'public', d.defaclacl from pg_default_acl d
      where d.defaclrole = r.oid and d.defaclobjtype = t.kind and d.defaclnamespace = 'public'::regnamespace
   ) a cross join lateral aclexplode(a.acl) x
  union all
  select d.defaclrole, d.defaclobjtype, case when d.defaclnamespace = 0 then 'global' else 'public' end,
         a.grantee, a.privilege_type, a.is_grantable
    from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclobjtype not in ('r','S','f')
     and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
), forbidden_defaults as (
  select d.* from default_acls d
   where d.creator is distinct from to_regrole('supabase_admin')::oid
     and d.grantee <> d.creator
     and (d.grantee = 0 or d.grantee in (select role_oid from principals))
     and (
       (d.creator = 'postgres'::regrole and d.source = 'global' and d.kind in ('r','S','f')
        and (d.grantee <> 0 or d.kind in ('r','S') or d.grantable))
       or
       (not (d.kind = 'f' and d.grantee = 0 and d.privilege = 'EXECUTE' and not d.grantable)
        and (d.grantable or d.kind in ('S','f')
             or (d.kind = 'r' and (d.grantee = 0 or d.privilege in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')))))
     )
     and not (/* allow-x1 */ false and d.creator = 'postgres'::regrole and d.source = 'public'
       and d.grantee in ('anon'::regrole, 'authenticated'::regrole) and not d.grantable
       and (d.kind in ('S','f') or (d.kind = 'r' and d.privilege in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE'))))
), create_findings as (
  select p.role_oid::regrole::text principal from principals p
   where has_schema_privilege(p.role_oid, 'public', 'CREATE')
      or p.role_oid = (select nspowner from pg_namespace where nspname = 'public')
      or p.role_oid = (select datdba from pg_database where datname = current_database())
  union all
  select 'PUBLIC' from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
   where n.nspname = 'public' and a.grantee = 0 and a.privilege_type = 'CREATE'
), unsafe_attributes as (
  select r.rolname, a.attribute from principals p join pg_roles r on r.oid = p.role_oid
   cross join lateral (values ('superuser',r.rolsuper), ('bypassrls',r.rolbypassrls),
     ('replication',r.rolreplication), ('createrole',r.rolcreaterole),
     ('createdb',r.rolcreatedb), ('login',r.rolcanlogin)) a(attribute, held)
   where a.held
), approved (rel, col, role_name, privilege) as (
  select 'users', unnest(array['id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by',
                               'shop_id', 'name', 'phone', 'pin_hash', 'pin_set_at', 'role_id', 'is_active']),
         'authenticated', 'INSERT'
  union all
  select 'users', unnest(array['created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by',
                               'shop_id', 'name', 'phone', 'pin_hash', 'pin_set_at', 'role_id', 'is_active']),
         'authenticated', 'UPDATE'
), held as (
  select c.relname::text, att.attname::text, a.grantee::regrole::text, a.privilege_type, a.is_grantable
    from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
   where c.relnamespace = 'public'::regnamespace and att.attnum > 0 and not att.attisdropped
     and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)
), effective as (
  select c.relname::text, att.attname::text, r.role_name, p.privilege
    from pg_class c
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
   cross join unnest(array['anon', 'authenticated']) r(role_name)
   cross join unnest(array['SELECT', 'INSERT', 'UPDATE']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_column_privilege(r.role_name, c.oid, att.attnum, p.privilege)
), held_missing as (
  select rel, col, role_name, privilege, false from approved
  except all
  select * from held
), held_extra as (
  select * from held
  except all
  select rel, col, role_name, privilege, false from approved
), effective_missing as (
  select * from approved except all select * from effective
), effective_extra as (
  select * from effective except all select * from approved
), public_grants as (
  select c.oid from pg_class c, aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and a.grantee = 0
  union all
  select c.oid from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
   where c.relnamespace = 'public'::regnamespace and att.attnum > 0 and not att.attisdropped and a.grantee = 0
), public_defaults as (
  select * from forbidden_defaults where grantee = 0
), grant_options as (
  select 1 from pg_class c,
                unnest(array['anon', 'authenticated']) r(role_name),
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege(r.role_name, c.oid, p.privilege || ' WITH GRANT OPTION')
  union all
  select 1 from pg_class c
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped,
         unnest(array['anon', 'authenticated']) r(role_name),
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_column_privilege(r.role_name, c.oid, att.attnum, p.privilege || ' WITH GRANT OPTION')
  union all
  select 1 from pg_class c,
                unnest(array['anon', 'authenticated']) r(role_name),
                unnest(array['USAGE', 'SELECT', 'UPDATE']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
     and has_sequence_privilege(r.role_name, c.oid, p.privilege || ' WITH GRANT OPTION')
  union all
  select 1 from forbidden_defaults where grantable and grantee in ('anon'::regrole,'authenticated'::regrole)
), reachable_findings as (
  select 1 from reachable r, pg_class c,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege(r.role_oid, c.oid, p.privilege)
  union all
  select 1 from reachable r, pg_class c,
                unnest(array['REFERENCES', 'TRIGGER', 'MAINTAIN']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege(r.role_oid, c.oid, p.privilege || ' WITH GRANT OPTION')
  union all
  select 1 from reachable r, pg_class c
    join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped,
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES WITH GRANT OPTION']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_column_privilege(r.role_oid, c.oid, att.attnum, p.privilege)
  union all
  select 1 from reachable r, pg_class c,
                unnest(array['USAGE', 'SELECT', 'UPDATE']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
     and has_sequence_privilege(r.role_oid, c.oid, p.privilege)
  union all
  select 1 from forbidden_defaults where grantee in (select role_oid from reachable)
)
select 'api_roles_no_table_wide_dml' as check_name,
       (select count(*) = 0
          from pg_class c,
               unnest(array['anon', 'authenticated']) r(role_name),
               unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(privilege)
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
           and has_table_privilege(r.role_name, c.oid, p.privilege)) as pass,
       (select count(*)::text
          from pg_class c,
               unnest(array['anon', 'authenticated']) r(role_name),
               unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(privilege)
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
           and has_table_privilege(r.role_name, c.oid, p.privilege)) as detail
union all
select 'api_roles_no_sequence_rights',
       (select count(*) = 0
          from pg_class c,
               unnest(array['anon', 'authenticated']) r(role_name),
               unnest(array['USAGE', 'SELECT', 'UPDATE']) p(privilege)
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
           and has_sequence_privilege(r.role_name, c.oid, p.privilege)),
       (select count(*)::text
          from pg_class c,
               unnest(array['anon', 'authenticated']) r(role_name),
               unnest(array['USAGE', 'SELECT', 'UPDATE']) p(privilege)
         where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
           and has_sequence_privilege(r.role_name, c.oid, p.privilege))
union all
select 'api_roles_no_default_privileges',
       not exists(select 1 from forbidden_defaults where grantee in ('anon'::regrole,'authenticated'::regrole)),
       (select count(*)::text from forbidden_defaults where grantee in ('anon'::regrole,'authenticated'::regrole))
union all
select 'api_roles_keep_schema_usage',
       has_schema_privilege('anon', 'public', 'USAGE') and has_schema_privilege('authenticated', 'public', 'USAGE'),
       ''
union all
select 'every_public_table_has_rls',
       (select count(*) = 0 from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
       (select count(*)::text from pg_class c
         where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity)
union all
select 'no_public_grants',
       not exists (select 1 from public_grants),
       (select count(*)::text from public_grants)
union all
select 'api_role_column_grants_exact',
       not exists (select 1 from held_missing) and not exists (select 1 from held_extra),
       'missing=' || (select count(*) from held_missing) || ',extra=' || (select count(*) from held_extra)
union all
select 'api_roles_effective_column_access_exact',
       not exists (select 1 from effective_missing) and not exists (select 1 from effective_extra),
       'missing=' || (select count(*) from effective_missing) || ',extra=' || (select count(*) from effective_extra)
union all
select 'no_public_default_privileges',
       not exists (select 1 from public_defaults),
       (select count(*)::text from public_defaults)
union all
select 'api_roles_no_grant_options',
       not exists (select 1 from grant_options),
       (select count(*)::text from grant_options)
union all
select 'memberships_reach_no_privileges',
       not exists (select 1 from reachable_findings),
       'roles=' || (select count(*) from reachable) || ',findings=' || (select count(*) from reachable_findings)
union all
select 'supabase_admin_public_defaults_exact',
       to_regrole('supabase_admin') is null or
         (not exists(select 1 from platform_missing) and not exists(select 1 from platform_extra)),
       case when to_regrole('supabase_admin') is null then 'role=absent'
            else 'missing=' || (select count(*) from platform_missing) || ',extra=' || (select count(*) from platform_extra) end
union all
select 'api_roles_cannot_create_in_public', not exists(select 1 from create_findings),
       coalesce((select string_agg(principal,',' order by principal) from create_findings),'')
union all
select 'public_relations_owned_by_postgres',
       not exists(select 1 from pg_class where relnamespace='public'::regnamespace
                   and relkind in ('r','p','v','m','f','S') and relowner <> 'postgres'::regrole),
       (select count(*)::text from pg_class where relnamespace='public'::regnamespace
                   and relkind in ('r','p','v','m','f','S') and relowner <> 'postgres'::regrole)
union all
select 'api_roles_have_no_unsafe_attributes', not exists(select 1 from unsafe_attributes),
       coalesce((select string_agg(rolname || ':' || attribute,',' order by rolname,attribute) from unsafe_attributes),'');

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
-- Any project after H-9's migrations: 34 versions, all three H-9 versions, nothing later.
select 'history_has_34_versions' as check_name,
       (select count(*) = 34 from supabase_migrations.schema_migrations) as pass,
       (select count(*)::text from supabase_migrations.schema_migrations) as detail
union all
select 'history_has_all_h9_versions',
       (select count(*) = 3 from supabase_migrations.schema_migrations
         where version in ('20261008000000', '20261008000100', '20261015000000')),
       ''
union all
select 'history_has_nothing_after_h9',
       not exists (select 1 from supabase_migrations.schema_migrations where version > '20261015000000'),
       coalesce((select string_agg(version, ',' order by version)
                   from supabase_migrations.schema_migrations where version > '20261015000000'), '');
