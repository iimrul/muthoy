-- ABORTS on any prerequisite mismatch, in a read-only transaction.
begin read only;
select 1/(case when current_user='postgres' then 1 else 0 end) executor_is_postgres;
select 1/(case when count(*)=31 and max(version)='20261005000000'
 and bool_and(version in ('20260813000000','20260817000000','20260817000100','20260818000000','20260818000100','20260819000000','20260821000000','20260821010000','20260822000000','20260822010000','20260823000000','20260823010000','20260823020000','20260823030000','20260823040000','20260823050000','20260824000000','20260825000000','20260827000000','20260827010000','20260831000000','20260905000000','20260907000000','20260907010000','20260907020000','20260909000000','20260923000000','20260926000000','20261001000000','20261004000000','20261005000000')) then 1 else 0 end) exact_dev31
from supabase_migrations.schema_migrations;
select 1/(case when count(*)=0 then 1 else 0 end) no_partial_or_existing_held_install
from pg_proc where pronamespace='public'::regnamespace and proname in
 ('sync_apply_row_pre_role_credit','sync_pull_changes_b2_pre_role_credit','sync_table_readable_pre_role_credit');
select 1/(case when md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))='d2f2741d6659f87d3213fadb4b33bc9e' and r.rolname='postgres' and p.prosecdef and p.proconfig=array['search_path=public']::text[] then 1 else 0 end) expected_original from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='sync_apply_row(text,text,jsonb,uuid,uuid,text)'::regprocedure;
select 1/(case when md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))='3f45500b15eddafea01de62e63cf2ed6' and r.rolname='postgres' and p.prosecdef and p.proconfig=array['search_path=public']::text[] then 1 else 0 end) expected_original from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)'::regprocedure;
select 1/(case when md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))='0f4e1050a7ee7eae989d510998d72302' and r.rolname='postgres' and p.prosecdef and p.proconfig=array['search_path=public']::text[] then 1 else 0 end) expected_original from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid='sync_table_readable(uuid,text)'::regprocedure;
-- SELECT-only evidence. No phone suffix, key, credential or full row payload.
-- Tool caller must first verify DEV project ref btfprhticjgeihcngpif.
select current_database() database_name,current_user executor,current_setting('server_version') server_version;
select p.oid::text stable_oid,p.oid::regprocedure::text signature,r.rolname owner,
 p.prosecdef,p.proconfig,md5(replace(p.prosrc,chr(13)||chr(10),chr(10))) source_md5,
 md5(pg_get_functiondef(p.oid)) definition_md5,p.proacl::text acl,
 has_function_privilege('anon',p.oid,'execute') anon,
 has_function_privilege('authenticated',p.oid,'execute') authenticated,
 has_function_privilege('service_role',p.oid,'execute') service_role
from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
where n.nspname='public' and (p.proname like 'sync_apply_row%'
 or p.proname like 'sync_pull_changes_b2%' or p.proname like 'sync_table_readable%'
 or p.proname in ('h7_row_shop_matches_caller','sync_stage_operation_chunk','sync_readable_tables')) order by stable_oid;
select id,name,owner_id,owner_id='6ce8cbaa-e175-4e73-9f9c-ed10bae1a9a6'::uuid authorized_owner
from public.shops where id='7e95674d-894b-4df7-ad91-45eb8821c373';
with fingerprints as (
select 'shops' table_name,t.id::text row_id,t.id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.shops t
union all
select 'subscriptions' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.subscriptions t
union all
select 'roles' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.roles t
union all
select 'users' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.users t
union all
select 'user_permissions' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.user_permissions t
union all
select 'shop_b2_settings' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.shop_b2_settings t
union all
select 'medicines' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.medicines t
union all
select 'suppliers' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.suppliers t
union all
select 'customers' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.customers t
union all
select 'batches' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.batches t
union all
select 'batch_promotions' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.batch_promotions t
union all
select 'purchases' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.purchases t
union all
select 'purchase_items' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.purchase_items t
union all
select 'sales' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.sales t
union all
select 'sale_drafts' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.sale_drafts t
union all
select 'sale_draft_items' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.sale_draft_items t
union all
select 'sale_items' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.sale_items t
union all
select 'sale_attachments' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.sale_attachments t
union all
select 'sale_refunds' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.sale_refunds t
union all
select 'sales_returns' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.sales_returns t
union all
select 'refund_tenders' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.refund_tenders t
union all
select 'purchase_returns' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.purchase_returns t
union all
select 'inventory_movements' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.inventory_movements t
union all
select 'credits' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.credits t
union all
select 'payments' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.payments t
union all
select 'credit_payment_allocations' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.credit_payment_allocations t
union all
select 'credit_reconciliation_states' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.credit_reconciliation_states t
union all
select 'expenses' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.expenses t
union all
select 'cash_drawer' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.cash_drawer t
union all
select 'inventory_imports' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.inventory_imports t
union all
select 'audit_logs' table_name,t.id::text row_id,t.shop_id::text shop_id,md5(to_jsonb(t.*)::text) row_md5 from public.audit_logs t
union all
select 'permissions',t.id::text,r.shop_id::text,md5(to_jsonb(t.*)::text) from public.permissions t join public.roles r on r.id=t.role_id
) select table_name,shop_id,row_id,row_md5 from fingerprints order by table_name,shop_id,row_id;
-- Every DEV shop: detect already-lost links without modifying or guessing them.
select id,shop_id,customer_id from public.credits where sale_id is null and not is_deleted order by shop_id,id;
-- Actors whose child history narrows; no extra access is granted.
select u.id,u.shop_id,r.name role,
 public.sync_table_readable(u.id,'credits') credits,
 public.sync_table_readable(u.id,'payments') payments,
 public.sync_table_readable(u.id,'customers') customers,
 public.sync_table_readable(u.id,'credit_payment_allocations') allocations,
 public.sync_table_readable(u.id,'credit_reconciliation_states') reconciliations
from public.users u join public.roles r on r.id=u.role_id and r.shop_id=u.shop_id
where u.is_active and not u.is_deleted and r.name<>'owner' order by u.shop_id,u.id;
-- Device outbox is not hosted. Separately preserve its full identities and
-- pending/failed dependency graphs before any later approved phone hydration.
-- Pause all DEV sync clients before activation; no queued/staging deletion.
select 1/(case when count(*)=0 then 1 else 0 end) no_inflight_grouped_operations
from public.sync_operation_staging where status in ('staging','applying');
select operation_id,shop_id,status,md5(to_jsonb(t.*)::text) row_md5
from public.sync_operation_staging t order by operation_id;
select operation_id,sequence,md5(to_jsonb(t.*)::text) row_md5
from public.sync_operation_chunks t order by operation_id,sequence;
commit;
