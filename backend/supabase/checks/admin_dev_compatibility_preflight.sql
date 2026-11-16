-- SELECT-only review input. No writes, migration activation or backup claim.
-- Expected DEV history is first 31 + the later Staff-sale repair, not a prefix.
select now() inspected_at, current_setting('server_version') server_version,
  (select array_agg(version::text order by version) from supabase_migrations.schema_migrations)
    = array['20260813000000','20260817000000','20260817000100','20260818000000','20260818000100','20260819000000','20260821000000','20260821010000','20260822000000','20260822010000','20260823000000','20260823010000','20260823020000','20260823030000','20260823040000','20260823050000','20260824000000','20260825000000','20260827000000','20260827010000','20260831000000','20260905000000','20260907000000','20260907010000','20260907020000','20260909000000','20260923000000','20260926000000','20261001000000','20261004000000','20261005000000','20261115172840'] history_matches_reviewed_dev,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('admin_role_assignments','admin_audit_log',
      'admin_support_cases','admin_support_notes','admin_platform_settings','financial_publications'))
    = 0 all_six_stores_absent,
  exists (select 1 from pg_proc p where p.oid=to_regprocedure(
    'public.sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)')
    and md5(p.prosrc)='d4f8a9bfbeaa410244089594c7757cdc'
    and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
    and p.proconfig=array['search_path=public']) reviewed_staff_repair_present;

-- Capture before/after and compare outside the database. All existing function
-- definitions, owners, configuration and ACLs must be unchanged. Only the two
-- new publication functions are excluded; neither may replace any other function.
select p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,
  p.prosecdef,p.proconfig,p.proacl::text,md5(p.prosrc) body_md5
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname not in ('publish_financial_snapshot','financial_publications_immutable')
 order by 1;
