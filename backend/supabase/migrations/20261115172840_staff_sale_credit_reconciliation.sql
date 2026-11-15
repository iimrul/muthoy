-- R2 candidate. Local approval only; hosted activation requires exact approval.
-- Patch only the original B2 dispatcher. Keep standalone credit-management
-- permission and every later operation/row wrapper intact.
begin;
do $staff_sale_patch$
declare
  v_function regprocedure := to_regprocedure('public.sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)');
  v_source text;
  v_definition text;
  v_owner text;
  v_definer boolean;
  v_config text[];
  v_needle text := '    if not sync_row_permitted(p_actor_id,v_table,v_payload)';
  v_branch text := $branch$
    -- Staff may carry credit metadata only inside this fully validated sale.
    -- Never turn the sales permission into general reconciliation authority.
    if p_operation_kind in ('sale','draft_complete')
       and v_table='credit_reconciliation_states'
       and not sync_row_permitted(p_actor_id,v_table,v_payload) then
      if v_op not in ('insert','update')
         or v_payload->>'shop_id' is distinct from p_shop_id::text
         or v_payload->>'id' is null
         or (v_sale->>'credit_amount')::bigint is null
         or (v_sale->>'credit_amount')::bigint<=0
         or (v_sale->>'staff_id')::uuid is distinct from p_actor_id
         or v_payload->>'status' is distinct from 'verified'
         or coalesce((v_payload->>'is_deleted')::boolean,true)
         or v_payload->>'deleted_at' is not null
         or v_payload->>'deleted_by' is not null
         or (v_payload->>'customer_id')::uuid is distinct from (v_sale->>'customer_id')::uuid then
        raise exception 'invalid Staff sale reconciliation metadata' using errcode='MU024';
      end if;
      -- Serialize customer metadata creation and preserve the same-shop FK gate.
      perform 1 from public.customers c
        where c.id=(v_payload->>'customer_id')::uuid and c.shop_id=p_shop_id and not c.is_deleted
        for update;
      if not found or not public.assert_fk_same_shop('users',(v_payload->>'verified_by')::uuid,p_shop_id) then
        raise exception 'cross-shop Staff sale reconciliation' using errcode='MU003';
      end if;
      if exists(select 1 from public.credit_reconciliation_states r
        where r.id=(v_payload->>'id')::uuid or (r.shop_id=p_shop_id and r.customer_id=(v_payload->>'customer_id')::uuid)) then
        -- Existing verified metadata is a refresh only. Keep its proof/verifier;
        -- a stale handset cannot clear a server quarantine or reassign identity.
        if not exists(select 1 from public.credit_reconciliation_states r
          where r.id=(v_payload->>'id')::uuid and r.shop_id=p_shop_id
            and r.customer_id=(v_payload->>'customer_id')::uuid
            and r.status='verified' and not r.is_deleted
            and r.verified_by is not distinct from (v_payload->>'verified_by')::uuid
            and r.verified_at is not distinct from (v_payload->>'verified_at')::timestamptz
            and r.canonical_hash is not distinct from v_payload->>'canonical_hash'
          for update) then
          raise exception 'Staff sale cannot reconcile or reassign existing credit state' using errcode='MU024';
        end if;
        update public.credit_reconciliation_states
          set updated_at=greatest(updated_at,(v_payload->>'updated_at')::timestamptz)
          where id=(v_payload->>'id')::uuid and shop_id=p_shop_id;
      else
        if (v_payload->>'verified_by')::uuid is distinct from p_actor_id then
          raise exception 'new Staff sale verifier must be its actor' using errcode='MU011';
        end if;
        if v_op<>'insert' or v_payload->>'canonical_hash' is not null
           or v_payload->>'verified_at' is null
           or exists(select 1 from public.credits c where c.shop_id=p_shop_id
             and c.customer_id=(v_payload->>'customer_id')::uuid and not c.is_deleted)
           or exists(select 1 from public.payments p where p.shop_id=p_shop_id
             and p.party_id=(v_payload->>'customer_id')::uuid and p.type='customer_payment') then
          raise exception 'Staff sale requires clean or previously verified credit history' using errcode='MU024';
        end if;
        insert into public.credit_reconciliation_states
          select * from jsonb_populate_record(null::public.credit_reconciliation_states,v_payload);
      end if;
      continue;
    end if;
$branch$;
begin
  select replace(p.prosrc,chr(13)||chr(10),chr(10)),pg_get_functiondef(p.oid),
    r.rolname,p.prosecdef,p.proconfig
    into v_source,v_definition,v_owner,v_definer,v_config
    from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=v_function;
  if not found or md5(v_source)<>'44deab457ce77f97d3a40f241d7b46c5'
     or v_owner<>'postgres' or not v_definer
     or v_config is distinct from array['search_path=public']::text[]
     or has_function_privilege('anon',v_function,'EXECUTE')
     or has_function_privilege('authenticated',v_function,'EXECUTE')
     or not has_function_privilege('service_role',v_function,'EXECUTE') then
    raise exception 'Staff sale patch: unexpected original function or privileges';
  end if;
  if (length(v_source)-length(replace(v_source,v_needle,'')))/length(v_needle)<>1 then
    raise exception 'Staff sale patch: expected exactly one dispatch boundary';
  end if;
  if v_definition not like 'CREATE OR REPLACE FUNCTION public.sync_apply_operation_pre_b3_withdrawal(%' then
    raise exception 'Staff sale patch: unexpected replacement signature';
  end if;
  -- CREATE OR REPLACE preserves the function OID, owner and existing ACL.
  execute replace(replace(v_definition,chr(13)||chr(10),chr(10)),v_needle,v_branch||v_needle);
end
$staff_sale_patch$;
commit;
