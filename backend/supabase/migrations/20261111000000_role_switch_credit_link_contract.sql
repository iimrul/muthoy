-- Local promotion of independently accepted role-switch/credit-link contract.
-- Hosted activation and device hydration remain separately Founder-gated.
begin;

-- Fail closed before any rename or replacement. A later wrapper may depend on
-- the existing HELD wrapper being INNER; reapplying must not overwrite it.
-- Fingerprints normalize CRLF only; no semantic/ACL change is accepted by guess.
do $role_credit_order_guard$
declare
  v_existing integer;
  v_expected record;
  v_actual record;
begin
  select count(*) into v_existing from pg_proc where oid in (
    to_regprocedure('public.sync_apply_row_pre_role_credit(text,text,jsonb,uuid,uuid,text)'),
    to_regprocedure('public.sync_pull_changes_b2_pre_role_credit(uuid,uuid,timestamptz,text,uuid,integer)'),
    to_regprocedure('public.sync_table_readable_pre_role_credit(uuid,text)')
  );
  if v_existing not in (0,3) then raise exception 'role-credit wrapper order mismatch: partial installation'; end if;
  for v_expected in select * from (values
      ('sync_apply_row(text,text,jsonb,uuid,uuid,text)','d2f2741d6659f87d3213fadb4b33bc9e','aa413fa645a48e8ee06897b695346220','2921ee0d8bc67787fdbb973ab6ab9c81'),
      ('sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)','3f45500b15eddafea01de62e63cf2ed6','3f45500b15eddafea01de62e63cf2ed6','812996662f612454b2ccdf57c5503efa'),
      ('sync_table_readable(uuid,text)','0f4e1050a7ee7eae989d510998d72302','0f4e1050a7ee7eae989d510998d72302','dc0103dd2929e4e71651e5062cf2c73e')
    ) expected(signature,dev31_md5,repo37_md5,reapply_md5)
  loop
    select md5(replace(p.prosrc,chr(13)||chr(10),chr(10))) source_md5,
      r.rolname owner,p.prosecdef,p.proconfig
      into v_actual from pg_proc p join pg_roles r on r.oid=p.proowner
      where p.oid=to_regprocedure('public.'||v_expected.signature);
    if not found or v_actual.owner<>'postgres' or not v_actual.prosecdef
      or v_actual.proconfig is distinct from array['search_path=public']::text[] then
      raise exception 'role-credit wrapper order mismatch: owner or security settings';
    end if;
    if (v_existing=0 and v_actual.source_md5 not in (v_expected.dev31_md5,v_expected.repo37_md5))
      or (v_existing=3 and v_actual.source_md5<>v_expected.reapply_md5) then
      raise exception 'role-credit wrapper order mismatch: later or unknown wrapper';
    end if;
  end loop;
  if v_existing=3 and exists (
    select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid in (
      to_regprocedure('public.sync_apply_row_pre_role_credit(text,text,jsonb,uuid,uuid,text)'),
      to_regprocedure('public.sync_pull_changes_b2_pre_role_credit(uuid,uuid,timestamptz,text,uuid,integer)'),
      to_regprocedure('public.sync_table_readable_pre_role_credit(uuid,text)')
    ) and (r.rolname<>'postgres' or not p.prosecdef)
  ) then raise exception 'role-credit wrapper order mismatch: original ownership'; end if;
end
$role_credit_order_guard$;

do $rename_role_credit$
begin
  if to_regprocedure('public.sync_apply_row_pre_role_credit(text,text,jsonb,uuid,uuid,text)') is null then
    alter function public.sync_apply_row(text,text,jsonb,uuid,uuid,text)
      rename to sync_apply_row_pre_role_credit;
  end if;
  if to_regprocedure('public.sync_pull_changes_b2_pre_role_credit(uuid,uuid,timestamptz,text,uuid,integer)') is null then
    alter function public.sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)
      rename to sync_pull_changes_b2_pre_role_credit;
  end if;
  if to_regprocedure('public.sync_table_readable_pre_role_credit(uuid,text)') is null then
    alter function public.sync_table_readable(uuid,text)
      rename to sync_table_readable_pre_role_credit;
  end if;
end
$rename_role_credit$;

-- Require BOTH existing parent permissions before selection/pagination.
-- No extra financial access is granted to an inconsistent narrow role.
create or replace function public.sync_table_readable(p_app_user_id uuid,p_table text)
returns boolean language sql stable security definer set search_path = public as $role_credit_readable$
  select public.sync_table_readable_pre_role_credit(p_app_user_id,p_table)
    and case p_table
      when 'credit_payment_allocations' then
        public.sync_table_readable_pre_role_credit(p_app_user_id,'credits')
        and public.sync_table_readable_pre_role_credit(p_app_user_id,'payments')
        and public.sync_table_readable_pre_role_credit(p_app_user_id,'customers')
      when 'credit_reconciliation_states' then
        public.sync_table_readable_pre_role_credit(p_app_user_id,'customers')
      else true
    end
$role_credit_readable$;

-- A projection-pruned client may legitimately queue sale_id:null. Retain the
-- server's existing identity, while every original permission/FK/LWW check and
-- grouped money calculation still executes downstream. Never repair old nulls.
create or replace function public.sync_apply_row(
  p_table text, p_op text, p_row jsonb,
  p_caller_shop_id uuid, p_caller_user_id uuid, p_device_id text
) returns text
language plpgsql security definer set search_path = public as $role_credit_apply$
declare
  v_row jsonb := p_row;
  v_sale_id uuid;
  v_incoming_sale_id uuid;
begin
  if not public.h7_row_shop_matches_caller(p_table,p_row,p_caller_shop_id) then
    raise exception 'row does not belong to the authenticated shop' using errcode='MU003';
  end if;
  if p_table='credits' and p_op in ('insert','update') then
    select c.sale_id into v_sale_id from public.credits c
      where c.id=(p_row->>'id')::uuid and c.shop_id=p_caller_shop_id;
    if found and v_sale_id is not null then
      v_incoming_sale_id := (p_row->>'sale_id')::uuid;
      if v_incoming_sale_id is not null and v_incoming_sale_id<>v_sale_id then
        raise exception 'existing credit sale identity cannot change' using errcode='MU024';
      end if;
      v_row := jsonb_set(v_row,'{sale_id}',to_jsonb(v_sale_id),true);
    end if;
  end if;
  return public.sync_apply_row_pre_role_credit(
    p_table,p_op,v_row,p_caller_shop_id,p_caller_user_id,p_device_id
  );
end
$role_credit_apply$;

-- The existing function retains all selection/tenant/permission/pagination
-- decisions. Only serialized FKs to an unreadable colleague sale are masked;
-- the server row, financial fields and ordering/cursor columns are unchanged.
create or replace function public.sync_pull_changes_b2(
  p_shop_id uuid, p_app_user_id uuid, p_since_updated_at timestamptz,
  p_since_table text, p_since_id uuid, p_limit integer
) returns table(table_name text,row_id uuid,updated_at timestamptz,row_data jsonb)
language sql security definer set search_path = public as $role_credit_pull$
  select page.table_name,page.row_id,page.updated_at,
    case
      when page.table_name='credits' and page.row_data->>'sale_id' is not null
        and not public.user_has_permission(p_app_user_id,'sale_history')
        and not exists (
          select 1 from public.sales s
          where s.id=(page.row_data->>'sale_id')::uuid
            and s.shop_id=p_shop_id and s.staff_id=p_app_user_id
        )
      then jsonb_set(page.row_data,'{sale_id}','null'::jsonb,false)
      when page.table_name='sale_drafts' and page.row_data->>'completed_sale_id' is not null
        and not public.user_has_permission(p_app_user_id,'sale_history')
        and not exists (
          select 1 from public.sales s
          where s.id=(page.row_data->>'completed_sale_id')::uuid
            and s.shop_id=p_shop_id and s.staff_id=p_app_user_id
        )
      then jsonb_set(page.row_data,'{completed_sale_id}','null'::jsonb,false)
      else page.row_data
    end
  from public.sync_pull_changes_b2_pre_role_credit(
    p_shop_id,p_app_user_id,p_since_updated_at,p_since_table,p_since_id,p_limit
  ) page
  order by page.updated_at,page.table_name,page.row_id
$role_credit_pull$;

-- The old five-argument apply wrapper keeps delegating to the new six-argument
-- public name. Renamed internals are callable only by the function owner via
-- SECURITY DEFINER, including denial to service_role (E4 no-bypass rule).
revoke all on function public.sync_apply_row_pre_role_credit(text,text,jsonb,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sync_pull_changes_b2_pre_role_credit(uuid,uuid,timestamptz,text,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.sync_apply_row(text,text,jsonb,uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)
  from public,anon,authenticated;
revoke all on function public.sync_table_readable_pre_role_credit(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.sync_table_readable(uuid,text)
  from public,anon,authenticated;

grant execute on function public.sync_table_readable(uuid,text),
  public.sync_apply_row(text,text,jsonb,uuid,uuid,text),
  public.sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)
  to service_role;

commit;
