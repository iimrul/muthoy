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
    select jsonb_build_object(
      'relations', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from (
          select jsonb_build_array(c.oid::regclass::text, a.grantee::regrole::text, a.privilege_type, a.is_grantable) as x
            from pg_class c,
                 aclexplode(coalesce(c.relacl,
                                     acldefault(case c.relkind when 'S' then 's'::"char" else 'r'::"char" end, c.relowner))) a
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
             and a.grantee not in ('anon'::regrole::oid, 'authenticated'::regrole::oid)) s),
      'columns', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from (
          select jsonb_build_array(c.oid::regclass::text, att.attname, a.grantee::regrole::text, a.privilege_type, a.is_grantable) as x
            from pg_attribute att join pg_class c on c.oid = att.attrelid, aclexplode(att.attacl) a
           where c.relnamespace = 'public'::regnamespace) s),
      'defaults', (select coalesce(jsonb_agg(x order by x::text), '[]'::jsonb) from (
          select jsonb_build_array(d.defaclrole::regrole::text, d.defaclnamespace, d.defaclobjtype::text,
                                   a.grantee::regrole::text, a.privilege_type, a.is_grantable) as x
            from pg_default_acl d, aclexplode(d.defaclacl) a
           where a.grantee not in ('anon'::regrole::oid, 'authenticated'::regrole::oid)) s),
      'functions', (select coalesce(jsonb_object_agg(p.oid::regprocedure::text,
                                                     coalesce(p.proacl, acldefault('f', p.proowner))::text), '{}'::jsonb)
                      from pg_proc p where p.pronamespace = 'public'::regnamespace),
      'schema', (select coalesce(n.nspacl, acldefault('n', n.nspowner))::text from pg_namespace n where n.nspname = 'public'),
      'rls', (select coalesce(jsonb_object_agg(c.oid::regclass::text, array[c.relrowsecurity, c.relforcerowsecurity]), '{}'::jsonb)
                from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p'))
    )
  $snapshot$;
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
  -- Future objects: a default privilege of any role that can create in public — globally or for
  -- this schema — must not give PUBLIC a table or a sequence. Functions keep PostgreSQL's built-in
  -- PUBLIC EXECUTE, the deferred policy.
  select count(*) into v_count
    from pg_default_acl d, aclexplode(d.defaclacl) a
   where a.grantee = 0 and d.defaclobjtype in ('r', 'S')
     and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
     and has_schema_privilege(d.defaclrole, 'public'::regnamespace, 'CREATE');
  if v_count <> 0 then
    raise exception 'h9_privileges: a default privilege gives PUBLIC access to future tables or sequences in public';
  end if;

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
    union all
    select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
     where a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid) and a.is_grantable
       and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
       and has_schema_privilege(d.defaclrole, 'public'::regnamespace, 'CREATE')
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
    union all
    select 1 from reachable r, pg_default_acl d, aclexplode(d.defaclacl) a
     where a.grantee = r.role_oid
       and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
       and has_schema_privilege(d.defaclrole, 'public'::regnamespace, 'CREATE')
       and (d.defaclobjtype = 'S' or a.is_grantable
            or (d.defaclobjtype = 'r' and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')))
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
  select count(*) into v_count
    from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole::oid
     and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
     and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid)
     and (d.defaclobjtype in ('S', 'f') or a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'));
  if v_count <> 0 then
    raise exception 'h9_privileges: postgres default privileges still give anon/authenticated access in public';
  end if;
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
end
$h9_privileges$;
