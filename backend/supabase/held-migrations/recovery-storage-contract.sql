-- HELD LOCAL CANDIDATE ONLY. No hosted execution or active migration promotion.
-- Requires actual private Storage service verification before live activation.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('muthoy-recovery-dev','muthoy-recovery-dev',false,67108864,array['application/octet-stream'])
on conflict(id) do nothing;
do $private_bucket$
begin
 if not exists(select 1 from storage.buckets where id='muthoy-recovery-dev' and public=false
   and file_size_limit=67108864 and allowed_mime_types=array['application/octet-stream']) then
   raise exception 'recovery bucket configuration mismatch';
 end if;
end
$private_bucket$;

-- The code decrypts an archive; it NEVER substitutes for current account/device
-- authority. A revoked or unenrolled replacement installation cannot use this
-- helper to satisfy A23 holds or obtain data with only a recovery code.
create or replace function public.muthoy_recovery_path_allowed(p_name text,p_for_upload boolean)
returns boolean language plpgsql stable security definer set search_path=public as $recovery_path$
declare
 v_shop uuid; v_actor uuid; v_session uuid; v_gate jsonb;
begin
 if p_name !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}\.[a-f0-9]{64}\.mr1$' then return false; end if;
 v_shop:=nullif(auth.jwt()->'app_metadata'->>'shop_id','')::uuid;
 v_actor:=nullif(auth.jwt()->'app_metadata'->>'app_user_id','')::uuid;
 v_session:=nullif(auth.jwt()->>'session_id','')::uuid;
 if v_shop is null or v_actor is null or v_session is null
   or split_part(p_name,'/',1)<>v_shop::text
   or not public.auth_is_live_user() or not public.auth_is_owner()
   or not exists(select 1 from public.shops where id=v_shop and owner_id=v_actor) then return false; end if;
 v_gate:=public.a23_session_gate(v_session,v_shop,v_actor);
 return coalesce((v_gate->>'bound')::boolean,false)
   and v_gate->>'deviceStatus'='active' and v_gate->>'bindingStatus'='active'
   and (not p_for_upload or split_part(p_name,'/',2)=v_gate->>'devicePublicId');
exception when invalid_text_representation then return false;
end
$recovery_path$;
alter function public.muthoy_recovery_path_allowed(text,boolean) owner to postgres;
revoke all on function public.muthoy_recovery_path_allowed(text,boolean) from public,anon,service_role;
grant execute on function public.muthoy_recovery_path_allowed(text,boolean) to authenticated;

-- Only insert and authenticated read. There is deliberately no update/delete
-- policy, no public URL, no overwrite and no direct grant on financial tables.
create policy muthoy_recovery_dev_insert on storage.objects for insert to authenticated
 with check(bucket_id='muthoy-recovery-dev' and public.muthoy_recovery_path_allowed(name,true));
create policy muthoy_recovery_dev_select on storage.objects for select to authenticated
 using(bucket_id='muthoy-recovery-dev' and public.muthoy_recovery_path_allowed(name,false));
commit;
