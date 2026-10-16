-- H-9 (migration 34) — the API roles get nothing in public that DEV does not give them (F12).
--
-- The Phase 3 rehearsal (2026-10-15) ran the reviewed chain on a project created with the
-- platform's current default privileges: anon and authenticated ended with SELECT on 32
-- public tables and INSERT/UPDATE on 9. DEV, whose default privileges give the API roles
-- only REFERENCES, TRIGGER and MAINTAIN on tables postgres creates here and nothing on its
-- sequences or functions, holds none, and every RPC, Edge function and storage policy works
-- there. RLS refused every row in the rehearsal; this removes only the layer under RLS that
-- DEV already lacks.
--
-- R4: all creators' effective global + public defaults are judged, including dormant roles.
-- D1 accepts exactly 48 supabase_admin public default items, including grantor. None change.
-- E3 defers only nongrantable PUBLIC EXECUTE. Synthetic fixtures may lack the platform role;
-- mandatory hosted preflight must prove its presence and exact profile before application.
-- API roots and conservative Reach must hold none of the six unsafe attributes. Other
-- schemas, memberships and role flags are preserved. Only catalog reads use pg_roles.
--
-- The model, in schema public. An API session can act as PUBLIC, as anon or authenticated, and
-- as any role those two reach by membership — directly or through other roles, by inheritance
-- or by SET ROLE. None of them may hold a data privilege, a grant option, or a default privilege
-- that would hand a future table or sequence over. The one exception is 20260819000000's
-- reviewed column grants to authenticated on users: INSERT on every column but
-- permission_version, UPDATE on the same columns less id, never with grant option.
--
-- What 34 changes, for anon and authenticated only:
--   * tables: each table-wide SELECT, INSERT, UPDATE, DELETE or TRUNCATE a role actually holds is
--     revoked on its own (a table-wide REVOKE of INSERT or UPDATE would also strip the reviewed
--     column grants). REFERENCES, TRIGGER and MAINTAIN stay, exactly DEV's `xtm`;
--   * sequences: every privilege a role actually holds is revoked, so an owner-only sequence is
--     left exactly as it is;
--   * postgres's default privileges: the same for future tables and sequences, and no EXECUTE
--     entry for future functions, which is DEV's `postgres=X` model. An entry that already gives
--     the API roles none of this is not touched.
-- Anything else the model forbids is not repaired here: it aborts for review, with nothing
-- changed — a relation not owned by postgres (a REVOKE by a non-owner silently does nothing), a
-- table without RLS, a relation, column or default privilege granted to PUBLIC, column grants
-- that are not exactly the reviewed ones (or that the table-wide revoke would strip), a grant
-- option held by the API roles, and any role they reach that holds privileges in public. No role
-- membership, other role's privilege or other creator's default is ever changed.
-- Untouched: every service_role, supabase_auth_admin and postgres privilege and default, every
-- function ACL (the routines the API roles call are explicit grants on SECURITY DEFINER
-- functions), schema USAGE, RLS, policies and every row. PostgreSQL's built-in PUBLIC EXECUTE
-- on new functions is unchanged, as on DEV — a deliberately deferred policy.
--
-- One DO block, so it is atomic under any runner. Guards first; then the revokes; then it
-- verifies the end state — effective privileges, not ACL text — and that nothing else changed,
-- reading a NULL ACL as the built-in default it stands for, and aborts otherwise. A second run
-- is a no-op.
--
-- Rollback: forward-only by choice; the inverse statements would reopen F12 (see ROLLBACK.md).

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $h9_privileges$
declare
  -- The only column-level privileges the API roles may hold in public: 20260819000000's, to
  -- authenticated on users, never with grant option.
  v_users_insert_columns constant text[] := array[
    'id', 'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by',
    'shop_id', 'name', 'phone', 'pin_hash', 'pin_set_at', 'role_id', 'is_active'];
  v_users_update_columns constant text[] := array[
    'created_at', 'updated_at', 'is_deleted', 'deleted_at', 'deleted_by',
    'shop_id', 'name', 'phone', 'pin_hash', 'pin_set_at', 'role_id', 'is_active'];
  -- Everything this migration must not change: ACL and default-ACL entries of every grantee
  -- other than the two API roles, every column-level grant (theirs included), every function
  -- ACL, the schema ACL and the RLS flags. A NULL ACL is read as the built-in default it stands
  -- for, so an ACL that PostgreSQL merely writes out compares as the same privileges.
  v_snapshot constant text := $snapshot$
    with namespaces as (
      select * from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'
    )
    select jsonb_build_object(
      'relations', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from (
        select jsonb_build_array(n.nspname,c.relname,c.relowner::regrole::text,
                 a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type,a.is_grantable) x
          from pg_class c join namespaces n on n.oid=c.relnamespace,
               aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a
         where c.relkind in ('r','p','v','m','f','S')
           and (n.nspname <> 'public' or a.grantee not in ('anon'::regrole,'authenticated'::regrole))) s),
      'columns', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from (
        select jsonb_build_array(n.nspname,c.relname,att.attname,a.grantor::regrole::text,
                                a.grantee::regrole::text,a.privilege_type,a.is_grantable) x
          from pg_attribute att join pg_class c on c.oid=att.attrelid
          join namespaces n on n.oid=c.relnamespace, aclexplode(att.attacl) a) s),
      'defaults', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from (
        select jsonb_build_array(d.defaclrole::regrole::text,d.defaclnamespace,d.defaclobjtype::text,
                    a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type,a.is_grantable) x
          from pg_default_acl d, aclexplode(d.defaclacl) a
         where not (d.defaclrole='postgres'::regrole and d.defaclnamespace='public'::regnamespace
           and a.grantee in ('anon'::regrole,'authenticated'::regrole) and not a.is_grantable
           and (d.defaclobjtype in ('S','f') or (d.defaclobjtype='r'
                and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE'))))) s),
      'functions', (select coalesce(jsonb_object_agg(p.oid::text,
        jsonb_build_array(n.nspname,p.oid::regprocedure::text,p.proowner::regrole::text,
                          coalesce(p.proacl,acldefault('f',p.proowner))::text)), '{}'::jsonb)
        from pg_proc p join namespaces n on n.oid=p.pronamespace),
      'schemas', (select coalesce(jsonb_object_agg(n.nspname,
           jsonb_build_array(n.nspowner::regrole::text,coalesce(n.nspacl,acldefault('n',n.nspowner))::text)), '{}'::jsonb) from namespaces n),
      'rls', (select coalesce(jsonb_object_agg(c.oid::text,array[c.relrowsecurity,c.relforcerowsecurity]), '{}'::jsonb)
        from pg_class c join namespaces n on n.oid=c.relnamespace where c.relkind in ('r','p')),
      'memberships', (select coalesce(jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor),'[]'::jsonb) from pg_auth_members m),
      'roles', (select coalesce(jsonb_agg(jsonb_build_array(rolname,rolsuper,rolbypassrls,rolreplication,
           rolcreaterole,rolcreatedb,rolcanlogin,rolinherit) order by rolname),'[]'::jsonb) from pg_roles)
    )
  $snapshot$;
  v_policy constant text := $policy$
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
     and not (/* allow-x1 */ $1 and d.creator = 'postgres'::regrole and d.source = 'public'
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
)
select (to_regrole('supabase_admin') is null or
        (not exists(select 1 from platform_missing) and not exists(select 1 from platform_extra))) x2_ok,
       (select count(*)::int from create_findings) create_count,
       (select string_agg(rolname || ':' || attribute, ', ' order by rolname, attribute) from unsafe_attributes) unsafe_roles,
       (select count(*)::int from forbidden_defaults where grantee = 0) public_defaults,
       (select count(*)::int from forbidden_defaults where grantee in ('anon'::regrole,'authenticated'::regrole)) root_defaults,
       (select count(*)::int from forbidden_defaults where grantee in (select role_oid from reachable)) reach_defaults,
       (select count(*)::int from forbidden_defaults where grantable and grantee in ('anon'::regrole,'authenticated'::regrole)) grant_options

  $policy$;
  v_phase integer;
  v_policy_state record;
  v_before jsonb;
  v_after jsonb;
  v_count integer;
  v_revoked integer := 0;
  v_entry record;
begin
  -- Bounds the lock waits below even where a runner gives SET LOCAL no transaction.
  perform set_config('lock_timeout', '5s', true);

  if current_user <> 'postgres' then
    raise exception 'h9_privileges: must run as the postgres migration role';
  end if;
  if to_regrole('anon') is null or to_regrole('authenticated') is null or to_regrole('service_role') is null then
    raise exception 'h9_privileges: the anon, authenticated and service_role roles must exist';
  end if;

  select count(*) into v_count from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
     and pg_get_userbyid(c.relowner) <> 'postgres';
  if v_count <> 0 then
    raise exception 'h9_privileges: every relation in public must be owned by postgres';
  end if;
  select count(*) into v_count from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_count <> 0 then
    raise exception 'h9_privileges: every table in public must have row level security enabled';
  end if;
  select count(*) into v_count from pg_class c, aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and a.grantee = 0;
  if v_count <> 0 then
    raise exception 'h9_privileges: a relation in public grants a privilege to PUBLIC';
  end if;
  select count(*) into v_count
    from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
   where c.relnamespace = 'public'::regnamespace and att.attnum > 0 and not att.attisdropped and a.grantee = 0;
  if v_count <> 0 then
    raise exception 'h9_privileges: a column in public grants a privilege to PUBLIC';
  end if;
  for v_phase in 1..2 loop
    execute v_policy into v_policy_state using v_phase = 1;
    -- X2 pre/post guard. Mutation witnesses may skip phase 1 only.
    if not v_policy_state.x2_ok then
      raise exception 'h9_privileges: supabase_admin''s default privileges are not exactly the measured platform profile';
    end if;
    if v_policy_state.create_count <> 0 then
      raise exception 'h9_privileges: an API role can create objects in public';
    end if;
    -- Attribute pre/post guard: no name exemptions for conservative Reach.
    if v_policy_state.unsafe_roles is not null then
      raise exception 'h9_privileges: an API role (or a role it reaches) holds an unsafe role attribute: %', v_policy_state.unsafe_roles;
    end if;
    if v_policy_state.public_defaults <> 0 then
      raise exception 'h9_privileges: a default privilege gives PUBLIC access to future tables or sequences in public';
    end if;
    if v_policy_state.grant_options <> 0 then
      raise exception 'h9_privileges: anon/authenticated hold a grant option in public, directly or through a role';
    end if;
    if v_policy_state.reach_defaults <> 0 then
      raise exception 'h9_privileges: a role anon/authenticated reach by membership (SET ROLE or inheritance) holds privileges in public';
    end if;
    if v_policy_state.root_defaults <> 0 then
      raise exception 'h9_privileges: a default privilege gives anon/authenticated access to future objects in public';
    end if;
    exit when v_phase = 2;

  -- The API roles' column-level grants are exactly the reviewed ones — table, column, role,
  -- privilege and grant option — compared as a multiset, so an extra, missing, swapped,
  -- duplicated or grantable entry differs.
  with approved as (
    select 'users'::text as rel, unnest(v_users_insert_columns) as col, 'authenticated'::text as role_name,
           'INSERT'::text as privilege, false as with_option
    union all
    select 'users', unnest(v_users_update_columns), 'authenticated', 'UPDATE', false
  ), held as (
    select c.relname::text, att.attname::text, a.grantee::regrole::text, a.privilege_type, a.is_grantable
      from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
     where c.relnamespace = 'public'::regnamespace and att.attnum > 0 and not att.attisdropped
       and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)
  )
  select count(*) into v_count
    from ((select * from held except all select * from approved)
          union all
          (select * from approved except all select * from held)) d;
  if v_count <> 0 then
    raise exception 'h9_privileges: the anon/authenticated column-level privileges in public are not exactly 20260819000000''s reviewed set';
  end if;
  select count(*) into v_count
    from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) col, aclexplode(c.relacl) tab
   where c.relnamespace = 'public'::regnamespace
     and col.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)
     and tab.grantee = col.grantee and tab.privilege_type = col.privilege_type
     and col.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if v_count <> 0 then
    raise exception 'h9_privileges: a column-level anon/authenticated privilege would be stripped by the table-wide revoke; review before normalizing';
  end if;

  -- No grant option for the API roles — held directly, passed on by a role they inherit from,
  -- or set up for future objects — so nothing in public can be handed on from an API session.
  select count(*) into v_count from (
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
  ) g;
  if v_count <> 0 then
    raise exception 'h9_privileges: anon/authenticated hold a grant option in public, directly or through a role';
  end if;

  -- Every role anon/authenticated reach by membership, directly or through other roles. A session
  -- can take up their privileges by inheritance or by SET ROLE, so none of them may hold a data
  -- privilege or a grant option in public, or a default privilege handing them future tables or
  -- sequences there. Memberships themselves are never changed.
  with recursive reachable (role_oid) as (
    select m.roleid from pg_auth_members m
     where m.member in ('anon'::regrole::oid, 'authenticated'::regrole::oid)
    union
    select m.roleid from pg_auth_members m join reachable r on m.member = r.role_oid
  )
  select count(*) into v_count from (
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

  ) x;
  if v_count <> 0 then
    raise exception 'h9_privileges: a role anon/authenticated reach by membership (SET ROLE or inheritance) holds privileges in public';
  end if;

  execute v_snapshot into v_before;

  -- Exactly the privileges each API role holds — table-wide data privileges on tables, any
  -- privilege on sequences — one at a time. Nothing they do not hold is touched.
  for v_entry in
    select c.oid::regclass as relation, case c.relkind when 'S' then 'sequence' else 'table' end as kind,
           r.rolname as role_name, a.privilege_type
      from pg_class c, aclexplode(c.relacl) a, pg_roles r
     where c.relnamespace = 'public'::regnamespace
       and r.oid = a.grantee and r.rolname in ('anon', 'authenticated')
       and (c.relkind = 'S'
            or (c.relkind in ('r', 'p', 'v', 'm', 'f')
                and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')))
     order by 1, 3, 4
  loop
    execute format('revoke %s on %s %s from %I', v_entry.privilege_type, v_entry.kind, v_entry.relation, v_entry.role_name);
    v_revoked := v_revoked + 1;
  end loop;

  -- postgres's default privileges in public, only where they still give the API roles something.
  if exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
              where d.defaclrole = 'postgres'::regrole::oid and d.defaclnamespace = 'public'::regnamespace::oid
                and d.defaclobjtype = 'r' and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)
                and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')) then
    alter default privileges in schema public
      revoke select, insert, update, delete, truncate on tables from anon, authenticated;
  end if;
  if exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
              where d.defaclrole = 'postgres'::regrole::oid and d.defaclnamespace = 'public'::regnamespace::oid
                and d.defaclobjtype = 'S' and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)) then
    alter default privileges in schema public revoke all on sequences from anon, authenticated;
  end if;
  if exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
              where d.defaclrole = 'postgres'::regrole::oid and d.defaclnamespace = 'public'::regnamespace::oid
                and d.defaclobjtype = 'f' and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)) then
    alter default privileges in schema public revoke execute on functions from anon, authenticated;
  end if;

  -- End state: effective privileges (PUBLIC and memberships included), not just ACL text.
  select count(*) into v_count
    from pg_class c,
         unnest(array['anon', 'authenticated']) r(role_name),
         unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege(r.role_name, c.oid, p.privilege);
  if v_count <> 0 then
    raise exception 'h9_privileges: anon/authenticated still hold a table privilege in public';
  end if;
  select count(*) into v_count
    from pg_class c,
         unnest(array['anon', 'authenticated']) r(role_name),
         unnest(array['USAGE', 'SELECT', 'UPDATE']) p(privilege)
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'S'
     and has_sequence_privilege(r.role_name, c.oid, p.privilege);
  if v_count <> 0 then
    raise exception 'h9_privileges: anon/authenticated still hold a sequence privilege in public';
  end if;
  -- Column by column, what the API roles can actually do is exactly the reviewed set: no SELECT
  -- on any column, nothing at all for anon.
  with approved as (
    select 'users'::text as rel, unnest(v_users_insert_columns) as col, 'authenticated'::text as role_name,
           'INSERT'::text as privilege
    union all
    select 'users', unnest(v_users_update_columns), 'authenticated', 'UPDATE'
  ), effective as (
    select c.relname::text, att.attname::text, r.role_name, p.privilege
      from pg_class c
      join pg_attribute att on att.attrelid = c.oid and att.attnum > 0 and not att.attisdropped
     cross join unnest(array['anon', 'authenticated']) r(role_name)
     cross join unnest(array['SELECT', 'INSERT', 'UPDATE']) p(privilege)
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_column_privilege(r.role_name, c.oid, att.attnum, p.privilege)
  )
  select count(*) into v_count
    from ((select * from effective except all select * from approved)
          union all
          (select * from approved except all select * from effective)) d;
  if v_count <> 0 then
    raise exception 'h9_privileges: anon/authenticated effective column privileges in public are not exactly the reviewed set';
  end if;
  end loop;
  if not has_schema_privilege('anon', 'public', 'USAGE') or not has_schema_privilege('authenticated', 'public', 'USAGE') then
    raise exception 'h9_privileges: anon/authenticated lost USAGE on schema public';
  end if;

  execute v_snapshot into v_after;
  if v_after is distinct from v_before then
    raise exception 'h9_privileges: a privilege outside anon/authenticated changed';
  end if;

  select count(*) into v_count from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');
  raise notice 'h9_privileges: % API-role table and sequence privileges revoked; anon/authenticated hold no SELECT, INSERT, UPDATE, DELETE or TRUNCATE table-wide on any of % tables in public, and exactly the reviewed column privileges',
    v_revoked, v_count;
  raise notice 'h9_privileges: platform profile %', case when to_regrole('supabase_admin') is null then 'absent' else 'exact (48)' end;
end
$h9_privileges$;
