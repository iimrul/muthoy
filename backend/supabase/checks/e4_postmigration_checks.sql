-- E4 post-migration checks — READ ONLY. The SUCCESSOR to
-- h9_postmigration_checks.sql, not a replacement for it.
--
-- WHY A SECOND FILE. h9_postmigration_checks.sql is founder-signed-off
-- evidence: its SHA-256 is recorded, its line endings are pinned in
-- .gitattributes, and its `history_post_h9` section asserts
-- `count(*) = 34` with nothing after 20261015000000. That file describes the
-- H-9 BASELINE — the chain as it stood at sign-off, and the state an A2/A3
-- rehearsal reproduces — and it stays byte-identical. Editing it to accommodate
-- a later migration would destroy the evidence it exists to be.
--
-- So this file governs the LIVE chain, and it is deliberately STRONGER than the
-- check it succeeds. h9's section bounded the tail with a COUNT plus a
-- "nothing after" predicate. A count plus bounds accepts a same-count
-- SUBSTITUTION: swap one pre-H-9 version for an unknown one and the count still
-- matches, the bound still holds, and the check still passes. This file asserts
-- the EXACT EXPECTED SET instead, in both directions — nothing missing and
-- nothing extra — and names the offenders in `detail`.
--
-- Same contract as its predecessor, so the same tooling reads both:
-- each section is ONE select returning rows of (check_name, pass, detail);
-- sections are delimited by "-- section: <name>" lines; run a section inside a
-- read-only transaction; any row with pass = false is a stop condition.
-- detail carries counts, version strings and object names only: never keys,
-- tokens, phones or rows.
--
-- Executed by backend/supabase/pgtest/e4-chain-succession.pgtest.ts and
-- e4-admin-platform.pgtest.ts against fresh, historical and adverse states.

-- section: history_e4
-- The live chain: exactly these 35 versions, the H-9 trio intact and
-- contiguous, and E4 the only thing after it.
with expected(version) as (values
    ('20260813000000'),
    ('20260817000000'),
    ('20260817000100'),
    ('20260818000000'),
    ('20260818000100'),
    ('20260819000000'),
    ('20260821000000'),
    ('20260821010000'),
    ('20260822000000'),
    ('20260822010000'),
    ('20260823000000'),
    ('20260823010000'),
    ('20260823020000'),
    ('20260823030000'),
    ('20260823040000'),
    ('20260823050000'),
    ('20260824000000'),
    ('20260825000000'),
    ('20260827000000'),
    ('20260827010000'),
    ('20260831000000'),
    ('20260905000000'),
    ('20260907000000'),
    ('20260907010000'),
    ('20260907020000'),
    ('20260909000000'),
    ('20260923000000'),
    ('20260926000000'),
    ('20261001000000'),
    ('20261004000000'),
    ('20261005000000'),
    ('20261008000000'),
    ('20261008000100'),
    ('20261015000000'),
    ('20261023000000')
)
select 'history_has_no_missing_version' as check_name,
       not exists (
         select 1 from expected e
          where not exists (select 1 from supabase_migrations.schema_migrations m
                             where m.version = e.version)
       ) as pass,
       coalesce((select string_agg(e.version, ',' order by e.version) from expected e
                  where not exists (select 1 from supabase_migrations.schema_migrations m
                                     where m.version = e.version)), '') as detail
union all
select 'history_has_no_extra_version',
       not exists (
         select 1 from supabase_migrations.schema_migrations m
          where not exists (select 1 from expected e where e.version = m.version)
       ),
       coalesce((select string_agg(m.version, ',' order by m.version)
                   from supabase_migrations.schema_migrations m
                  where not exists (select 1 from expected e where e.version = m.version)), '')
union all
select 'history_has_all_h9_versions',
       (select count(*) = 3 from supabase_migrations.schema_migrations
         where version in ('20261008000000', '20261008000100', '20261015000000')),
       ''
union all
-- The H-9 block is three consecutive versions. Anything that appeared BETWEEN
-- them would mean the signed-off block was reopened rather than extended.
select 'history_h9_block_is_contiguous',
       not exists (select 1 from supabase_migrations.schema_migrations
                    where version > '20261008000000' and version < '20261015000000'
                      and version <> '20261008000100'),
       coalesce((select string_agg(version, ',' order by version)
                   from supabase_migrations.schema_migrations
                  where version > '20261008000000' and version < '20261015000000'
                    and version <> '20261008000100'), '')
union all
select 'history_e4_immediately_follows_h9',
       (select count(*) = 1 from supabase_migrations.schema_migrations
         where version > '20261015000000')
       and exists (select 1 from supabase_migrations.schema_migrations
                    where version = '20261023000000'),
       coalesce((select string_agg(version, ',' order by version)
                   from supabase_migrations.schema_migrations
                  where version > '20261015000000'), '');

-- section: e4_objects
-- The five new tables exist, carry RLS, and carry NO policy — so the API roles
-- reach nothing through them at all and service_role's BYPASSRLS is the only
-- way in.
with t(name) as (values
  ('admin_audit_log'), ('admin_role_assignments'), ('admin_support_cases'),
  ('admin_support_notes'), ('admin_platform_settings')
)
select 'e4_tables_exist' as check_name,
       (select count(*) = 5 from t
          join pg_class c on c.relname = t.name
          join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public') as pass,
       coalesce((select string_agg(t.name, ',' order by t.name) from t
                  where not exists (select 1 from pg_class c
                                      join pg_namespace n on n.oid = c.relnamespace
                                     where c.relname = t.name and n.nspname = 'public')), '') as detail
union all
select 'e4_tables_have_rls_enabled',
       coalesce((select bool_and(c.relrowsecurity) from t
                   join pg_class c on c.relname = t.name
                   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'), false),
       coalesce((select string_agg(c.relname, ',' order by c.relname) from t
                   join pg_class c on c.relname = t.name
                   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
                  where not c.relrowsecurity), '')
union all
select 'e4_tables_have_no_policy',
       not exists (select 1 from pg_policies p join t on t.name = p.tablename
                    where p.schemaname = 'public'),
       coalesce((select string_agg(p.tablename || ':' || p.policyname, ',' order by p.policyname)
                   from pg_policies p join t on t.name = p.tablename
                  where p.schemaname = 'public'), '')
union all
-- Both foreign keys carry an explicit onDelete (CLAUDE.md rule 2), and both are
-- RESTRICT: a support case must outlive a shop row, and a note must outlive its
-- case. A CASCADE here would make append-only depend on `delete` staying absent
-- from every role forever.
select 'e4_support_foreign_keys_are_restrict',
       (select count(*) = 2 from pg_constraint
         where contype = 'f' and confdeltype = 'r'
           and conrelid in ('public.admin_support_cases'::regclass,
                            'public.admin_support_notes'::regclass)),
       -- confdeltype is "char", so it needs an explicit cast: `text || "char"`
       -- is an ambiguous operator and fails to resolve.
       coalesce((select string_agg(conname || ':' || confdeltype::text, ',' order by conname)
                   from pg_constraint
                  where contype = 'f'
                    and conrelid in ('public.admin_support_cases'::regclass,
                                     'public.admin_support_notes'::regclass)), '');

-- section: e4_privileges
-- Exact table-level privileges for every new table. The negatives carry as much
-- weight as the positives: a privilege the panel must not hold, proven absent
-- rather than assumed absent, because the hosted default for a new public table
-- is service_role=Dxtm and granting without revoking first would leave TRUNCATE
-- on an audit table.
--
-- has_table_privilege vs has_any_column_privilege matters here: the former sees
-- only TABLE-level grants, the latter also sees column-level ones. So a
-- "no update" claim on a column-granted table has to use the column form, or it
-- would pass while three columns were writable.
select 'admin_audit_log_select' as check_name,
       has_table_privilege('service_role', 'public.admin_audit_log', 'select') as pass, '' as detail
union all select 'admin_audit_log_insert',
       has_table_privilege('service_role', 'public.admin_audit_log', 'insert'), ''
union all select 'admin_audit_log_no_update',
       not has_any_column_privilege('service_role', 'public.admin_audit_log', 'update'), ''
union all select 'admin_audit_log_no_delete',
       not has_table_privilege('service_role', 'public.admin_audit_log', 'delete'), ''
union all select 'admin_audit_log_no_truncate',
       not has_table_privilege('service_role', 'public.admin_audit_log', 'truncate'), ''
union all select 'admin_audit_log_no_references',
       not has_table_privilege('service_role', 'public.admin_audit_log', 'references'), ''
union all select 'admin_audit_log_no_trigger',
       not has_table_privilege('service_role', 'public.admin_audit_log', 'trigger'), ''

union all select 'admin_role_assignments_select',
       has_table_privilege('service_role', 'public.admin_role_assignments', 'select'), ''
union all select 'admin_role_assignments_insert',
       has_table_privilege('service_role', 'public.admin_role_assignments', 'insert'), ''
-- No TABLE-level update: only the four mutable columns were granted.
union all select 'admin_role_assignments_no_table_update',
       not has_table_privilege('service_role', 'public.admin_role_assignments', 'update'), ''
union all select 'admin_role_assignments_update_role',
       has_column_privilege('service_role', 'public.admin_role_assignments', 'role', 'update'), ''
union all select 'admin_role_assignments_update_is_active',
       has_column_privilege('service_role', 'public.admin_role_assignments', 'is_active', 'update'), ''
union all select 'admin_role_assignments_update_sessions_revoked_at',
       has_column_privilege('service_role', 'public.admin_role_assignments', 'sessions_revoked_at', 'update'), ''
-- Attribution is immutable BY PRIVILEGE. Attribution the panel can rewrite is
-- not attribution.
union all select 'admin_role_assignments_username_immutable',
       not has_column_privilege('service_role', 'public.admin_role_assignments', 'username', 'update'), ''
union all select 'admin_role_assignments_assigned_by_immutable',
       not has_column_privilege('service_role', 'public.admin_role_assignments', 'assigned_by', 'update'), ''
union all select 'admin_role_assignments_assigned_at_immutable',
       not has_column_privilege('service_role', 'public.admin_role_assignments', 'assigned_at', 'update'), ''
union all select 'admin_role_assignments_no_delete',
       not has_table_privilege('service_role', 'public.admin_role_assignments', 'delete'), ''

union all select 'admin_support_cases_select',
       has_table_privilege('service_role', 'public.admin_support_cases', 'select'), ''
union all select 'admin_support_cases_insert',
       has_table_privilege('service_role', 'public.admin_support_cases', 'insert'), ''
union all select 'admin_support_cases_no_table_update',
       not has_table_privilege('service_role', 'public.admin_support_cases', 'update'), ''
union all select 'admin_support_cases_update_status',
       has_column_privilege('service_role', 'public.admin_support_cases', 'status', 'update'), ''
union all select 'admin_support_cases_shop_id_immutable',
       not has_column_privilege('service_role', 'public.admin_support_cases', 'shop_id', 'update'), ''
union all select 'admin_support_cases_opened_by_immutable',
       not has_column_privilege('service_role', 'public.admin_support_cases', 'opened_by', 'update'), ''
union all select 'admin_support_cases_no_delete',
       not has_table_privilege('service_role', 'public.admin_support_cases', 'delete'), ''

-- Notes are append-only by PRIVILEGE, not by UI: no update on any column.
union all select 'admin_support_notes_select',
       has_table_privilege('service_role', 'public.admin_support_notes', 'select'), ''
union all select 'admin_support_notes_insert',
       has_table_privilege('service_role', 'public.admin_support_notes', 'insert'), ''
union all select 'admin_support_notes_no_update',
       not has_any_column_privilege('service_role', 'public.admin_support_notes', 'update'), ''
union all select 'admin_support_notes_no_delete',
       not has_table_privilege('service_role', 'public.admin_support_notes', 'delete'), ''
union all select 'admin_support_notes_no_truncate',
       not has_table_privilege('service_role', 'public.admin_support_notes', 'truncate'), ''

union all select 'admin_platform_settings_select',
       has_table_privilege('service_role', 'public.admin_platform_settings', 'select'), ''
union all select 'admin_platform_settings_insert',
       has_table_privilege('service_role', 'public.admin_platform_settings', 'insert'), ''
union all select 'admin_platform_settings_no_table_update',
       not has_table_privilege('service_role', 'public.admin_platform_settings', 'update'), ''
union all select 'admin_platform_settings_update_value',
       has_column_privilege('service_role', 'public.admin_platform_settings', 'value', 'update'), ''
union all select 'admin_platform_settings_key_immutable',
       not has_column_privilege('service_role', 'public.admin_platform_settings', 'key', 'update'), ''
union all select 'admin_platform_settings_no_delete',
       not has_table_privilege('service_role', 'public.admin_platform_settings', 'delete'), ''

-- The API roles reach NONE of the five, by privilege as well as by RLS.
union all select 'e4_tables_unreachable_by_anon',
       not exists (
         select 1 from (values ('admin_audit_log'), ('admin_role_assignments'),
                               ('admin_support_cases'), ('admin_support_notes'),
                               ('admin_platform_settings')) as t(name)
          where has_any_column_privilege('anon', ('public.' || t.name)::regclass, 'select')
             or has_any_column_privilege('anon', ('public.' || t.name)::regclass, 'insert')
             or has_any_column_privilege('anon', ('public.' || t.name)::regclass, 'update')
             or has_table_privilege('anon', ('public.' || t.name)::regclass, 'delete')
       ), ''
union all select 'e4_tables_unreachable_by_authenticated',
       not exists (
         select 1 from (values ('admin_audit_log'), ('admin_role_assignments'),
                               ('admin_support_cases'), ('admin_support_notes'),
                               ('admin_platform_settings')) as t(name)
          where has_any_column_privilege('authenticated', ('public.' || t.name)::regclass, 'select')
             or has_any_column_privilege('authenticated', ('public.' || t.name)::regclass, 'insert')
             or has_any_column_privilege('authenticated', ('public.' || t.name)::regclass, 'update')
             or has_table_privilege('authenticated', ('public.' || t.name)::regclass, 'delete')
       ), '';

-- section: e4_legacy_privileges
-- The two EXISTING tables E4 re-granted. 20260821010000:299 had given
-- service_role select+insert+update+delete on sale_refunds, so the panel's key
-- held DML on a money table; audit_logs carried the hosted default. Both are
-- now SELECT-only for service_role, and the writes that matter still travel
-- through SECURITY DEFINER RPCs rather than through these privileges.
select 'sale_refunds_select' as check_name,
       has_table_privilege('service_role', 'public.sale_refunds', 'select') as pass, '' as detail
union all select 'sale_refunds_no_insert',
       not has_any_column_privilege('service_role', 'public.sale_refunds', 'insert'), ''
union all select 'sale_refunds_no_update',
       not has_any_column_privilege('service_role', 'public.sale_refunds', 'update'), ''
union all select 'sale_refunds_no_delete',
       not has_table_privilege('service_role', 'public.sale_refunds', 'delete'), ''
union all select 'sale_refunds_no_truncate',
       not has_table_privilege('service_role', 'public.sale_refunds', 'truncate'), ''
union all select 'audit_logs_select',
       has_table_privilege('service_role', 'public.audit_logs', 'select'), ''
union all select 'audit_logs_no_insert',
       not has_any_column_privilege('service_role', 'public.audit_logs', 'insert'), ''
union all select 'audit_logs_no_update',
       not has_any_column_privilege('service_role', 'public.audit_logs', 'update'), ''
union all select 'audit_logs_no_delete',
       not has_table_privilege('service_role', 'public.audit_logs', 'delete'), ''
union all select 'audit_logs_no_truncate',
       not has_table_privilege('service_role', 'public.audit_logs', 'truncate'), '';

-- section: e4_functions
-- W4-05's six signatures and their final privileges. The renamed
-- implementations are reachable by NOTHING — revoked from the API roles AND
-- from service_role — because each wrapper calls its implementation as its
-- SECURITY DEFINER owner, which retains EXECUTE. "The wrapper still works" is
-- exactly the claim that would fail silently, so the pgtest calls through it
-- as well as asserting these privileges.
select 'w405_owner_predicate_exists' as check_name,
       to_regprocedure('public.w405_actor_is_shop_owner(uuid)') is not null as pass, '' as detail
union all select 'w405_owner_predicate_service_role_execute',
       has_function_privilege('service_role', 'public.w405_actor_is_shop_owner(uuid)', 'execute'), ''
union all select 'w405_owner_predicate_not_anon',
       not has_function_privilege('anon', 'public.w405_actor_is_shop_owner(uuid)', 'execute'), ''

union all select 'sync_row_permitted_wrapper_exists',
       to_regprocedure('public.sync_row_permitted(uuid,text,jsonb)') is not null, ''
union all select 'sync_row_permitted_pre_w405_exists',
       to_regprocedure('public.sync_row_permitted_pre_w405(uuid,text,jsonb)') is not null, ''
union all select 'sync_row_permitted_service_role_execute',
       has_function_privilege('service_role', 'public.sync_row_permitted(uuid,text,jsonb)', 'execute'), ''
union all select 'sync_row_permitted_pre_w405_unreachable',
       not has_function_privilege('service_role', 'public.sync_row_permitted_pre_w405(uuid,text,jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.sync_row_permitted_pre_w405(uuid,text,jsonb)', 'execute')
       and not has_function_privilege('authenticated', 'public.sync_row_permitted_pre_w405(uuid,text,jsonb)', 'execute'), ''

union all select 'sync_apply_row_wrapper_exists',
       to_regprocedure('public.sync_apply_row(text,text,jsonb,uuid,uuid,text)') is not null, ''
union all select 'sync_apply_row_pre_w405_exists',
       to_regprocedure('public.sync_apply_row_pre_w405(text,text,jsonb,uuid,uuid,text)') is not null, ''
union all select 'sync_apply_row_service_role_execute',
       has_function_privilege('service_role', 'public.sync_apply_row(text,text,jsonb,uuid,uuid,text)', 'execute'), ''
-- The 5-argument overload keeps its name and its grant; it re-resolves to the
-- new 6-argument wrapper by name.
union all select 'sync_apply_row_five_arg_service_role_execute',
       has_function_privilege('service_role', 'public.sync_apply_row(text,text,jsonb,uuid,uuid)', 'execute'), ''
union all select 'sync_apply_row_pre_w405_unreachable',
       not has_function_privilege('service_role', 'public.sync_apply_row_pre_w405(text,text,jsonb,uuid,uuid,text)', 'execute')
       and not has_function_privilege('anon', 'public.sync_apply_row_pre_w405(text,text,jsonb,uuid,uuid,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.sync_apply_row_pre_w405(text,text,jsonb,uuid,uuid,text)', 'execute'), ''
-- H-7's own renamed implementation was ALREADY revoked from service_role by
-- 20260907020000:70-71. E4 does not change it, and this row records that rather
-- than letting a later reader assume E4 granted it.
union all select 'sync_apply_row_pre_h7_still_unreachable',
       not has_function_privilege('service_role', 'public.sync_apply_row_pre_h7(text,text,jsonb,uuid,uuid,text)', 'execute'), ''
union all select 'api_roles_have_no_sync_apply_row_execute',
       not has_function_privilege('anon', 'public.sync_apply_row(text,text,jsonb,uuid,uuid,text)', 'execute')
       and not has_function_privilege('authenticated', 'public.sync_apply_row(text,text,jsonb,uuid,uuid,text)', 'execute'), '';
