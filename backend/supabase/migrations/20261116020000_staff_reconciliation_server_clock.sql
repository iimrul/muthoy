-- Migration 40. Server time bounds a Staff sale's reconciliation clock.
-- Founder approved 2026-11-16 ("fix all problems"), applied to DEV after 32-38.
-- PROD receives it in chain order with the rest; no separate activation.
--
-- Migration 39 lets a validated Staff sale carry credit_reconciliation_states
-- metadata. Two of its statements trusted the handset's clock:
--
--   refresh: set updated_at=greatest(updated_at,<payload updated_at>)
--   insert:  jsonb_populate_record(..., v_payload)   -- updated_at verbatim
--
-- credit_reconciliation_states is last-write-wins on updated_at. A handset whose
-- clock reads 2999 therefore stamps the row in 2999, and every later Owner
-- decision (verified -> blocked/pending) loses the comparison and is dropped.
--
-- This patch bounds both values by now(). It changes nothing else:
--   * a past device clock is stored exactly as before;
--   * a refresh without updated_at still leaves the row's clock untouched;
--   * the insert path still copies every other column verbatim.
--
-- Same mechanism and guards as 39: the current body is md5-pinned (the hash
-- 39 produces, measured on DEV and on the full chain), each replaced text must
-- occur exactly once, ownership/security-definer/search_path/ACL are checked,
-- and CREATE OR REPLACE keeps the OID, owner and ACL. A second application, or
-- any unexpected body, is refused before anything changes.
--
-- Class B. Rollback (under approval): re-apply 39's body by reversing the two
-- replacements with the same guards.
begin;
do $staff_reconciliation_clock$
declare
  v_function regprocedure := to_regprocedure('public.sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)');
  v_source text;
  v_definition text;
  v_owner text;
  v_definer boolean;
  v_config text[];
  v_refresh_old text := $old$set updated_at=greatest(updated_at,(v_payload->>'updated_at')::timestamptz)$old$;
  v_refresh_new text := $new$set updated_at=greatest(updated_at,
            case when v_payload->>'updated_at' is null then null
                 else least((v_payload->>'updated_at')::timestamptz,now()) end)$new$;
  v_insert_old text := $old$select * from jsonb_populate_record(null::public.credit_reconciliation_states,v_payload);$old$;
  v_insert_new text := $new$select * from jsonb_populate_record(null::public.credit_reconciliation_states,
            case when v_payload->>'updated_at' is null then v_payload
                 else jsonb_set(v_payload,'{updated_at}',
                   to_jsonb(least((v_payload->>'updated_at')::timestamptz,now()))) end);$new$;
begin
  select replace(p.prosrc,chr(13)||chr(10),chr(10)),pg_get_functiondef(p.oid),
    r.rolname,p.prosecdef,p.proconfig
    into v_source,v_definition,v_owner,v_definer,v_config
    from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=v_function;
  if not found or md5(v_source)<>'d4f8a9bfbeaa410244089594c7757cdc'
     or v_owner<>'postgres' or not v_definer
     or v_config is distinct from array['search_path=public']::text[]
     or has_function_privilege('anon',v_function,'EXECUTE')
     or has_function_privilege('authenticated',v_function,'EXECUTE')
     or not has_function_privilege('service_role',v_function,'EXECUTE') then
    raise exception 'Staff reconciliation clock: unexpected original function or privileges';
  end if;
  if (length(v_source)-length(replace(v_source,v_refresh_old,'')))/length(v_refresh_old)<>1
     or (length(v_source)-length(replace(v_source,v_insert_old,'')))/length(v_insert_old)<>1 then
    raise exception 'Staff reconciliation clock: expected exactly one refresh and one insert';
  end if;
  if v_definition not like 'CREATE OR REPLACE FUNCTION public.sync_apply_operation_pre_b3_withdrawal(%' then
    raise exception 'Staff reconciliation clock: unexpected replacement signature';
  end if;
  execute replace(replace(replace(v_definition,chr(13)||chr(10),chr(10)),
    v_refresh_old,v_refresh_new),v_insert_old,v_insert_new);
end
$staff_reconciliation_clock$;
commit;
