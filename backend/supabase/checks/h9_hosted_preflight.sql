-- F12 mandatory hosted preflight: catalogs only, no shop rows, no writes.
-- Capture on the same approved project as its independently obtained project identity.
-- Repairable table/sequence DML and effective column access are post-migration checks.
-- rolconfig, ownership, memberships and publications are inventory, not new F12 policy.
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
     and not (/* allow-x1 */ true and d.creator = 'postgres'::regrole and d.source = 'public'
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
), result_checks as (select 'api_roles_no_table_wide_dml' as check_name,
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
       coalesce((select string_agg(rolname || ':' || attribute,',' order by rolname,attribute) from unsafe_attributes),'')
)

select jsonb_build_object(
  'version', 1,
  'database', jsonb_build_object('name',current_database(),
    'owner',(select pg_get_userbyid(datdba) from pg_database where datname=current_database()),
    'publicSchemaOwner',(select pg_get_userbyid(nspowner) from pg_namespace where nspname='public')),
  'platformRolePresent',to_regrole('supabase_admin') is not null,
  'checks',(select jsonb_agg(to_jsonb(c) order by check_name) from result_checks c),
  'roles',(select jsonb_agg(jsonb_build_object(
    'name',r.rolname,'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,
    'replication',r.rolreplication,'createrole',r.rolcreaterole,'createdb',r.rolcreatedb,
    'login',r.rolcanlogin,'rolconfig',r.rolconfig) order by r.rolname)
    from principals p join pg_roles r on r.oid=p.role_oid),
  'memberships',(select coalesce(jsonb_agg(jsonb_build_object(
    'member',m.member::regrole::text,'role',m.roleid::regrole::text,
    'grantor',m.grantor::regrole::text,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option)
    order by m.member,m.roleid,m.grantor),'[]'::jsonb)
    from pg_auth_members m where m.member in(select role_oid from principals)),
  'publications',(select coalesce(jsonb_agg(jsonb_build_object(
    'name',p.pubname,'allTables',p.puballtables,
    'schemas',(select coalesce(jsonb_agg(n.nspname order by n.nspname),'[]'::jsonb)
      from pg_publication_namespace pn join pg_namespace n on n.oid=pn.pnnspid where pn.pnpubid=p.oid),
    'tables',(select coalesce(jsonb_agg(jsonb_build_object('schema',t.schemaname,'table',t.tablename)
      order by t.schemaname,t.tablename),'[]'::jsonb) from pg_publication_tables t where t.pubname=p.pubname)
    ) order by p.pubname),'[]'::jsonb) from pg_publication p)
) as snapshot;
