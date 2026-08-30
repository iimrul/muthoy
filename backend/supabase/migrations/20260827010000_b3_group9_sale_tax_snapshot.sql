-- B3 Group 9 MRP-inclusive sale tax snapshots. Local file only; not remotely executed.
alter table sales add column tax_amount bigint not null default 0 check (tax_amount >= 0);
alter table sales add column tax_rate_bp integer not null default 0 check (tax_rate_bp between 0 and 10000);
alter table sales add column tax_label text not null default 'VAT' check (length(trim(tax_label)) between 1 and 24);
alter table sales add constraint sales_inclusive_tax_check check (
  tax_amount = ((total * tax_rate_bp + ((10000 + tax_rate_bp) / 2)) / (10000 + tax_rate_bp))
);

create or replace function prevent_sale_tax_snapshot_update()
returns trigger language plpgsql set search_path=public as $fn$
begin
  if new.tax_amount is distinct from old.tax_amount
     or new.tax_rate_bp is distinct from old.tax_rate_bp
     or new.tax_label is distinct from old.tax_label then
    raise exception 'sale tax snapshot is immutable' using errcode='MU024';
  end if;
  return new;
end
$fn$;
create trigger sales_tax_snapshot_immutable
before update of tax_amount,tax_rate_bp,tax_label on sales
for each row execute function prevent_sale_tax_snapshot_update();

alter function sync_apply_row(text,text,jsonb,uuid,uuid,text) rename to sync_apply_row_pre_b3_tax;
create or replace function sync_apply_row(
  p_table text,p_op text,p_row jsonb,p_caller_shop_id uuid,p_caller_user_id uuid,p_device_id text
) returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_result text;
  v_row jsonb:=p_row;
  v_rate integer;
  v_total bigint;
  v_tax bigint;
  v_existing_tax bigint;
  v_existing_rate integer;
  v_existing_label text;
begin
  if p_table='sales' and p_op<>'delete' then
    select tax_amount,tax_rate_bp,tax_label
      into v_existing_tax,v_existing_rate,v_existing_label
      from sales where id=(p_row->>'id')::uuid and shop_id=p_caller_shop_id;
    if found then
      if (p_row ? 'tax_amount' and (p_row->>'tax_amount')::bigint is distinct from v_existing_tax)
         or (p_row ? 'tax_rate_bp' and (p_row->>'tax_rate_bp')::integer is distinct from v_existing_rate)
         or (p_row ? 'tax_label' and trim(p_row->>'tax_label') is distinct from v_existing_label) then
        raise exception 'sale tax snapshot is immutable' using errcode='MU024';
      end if;
      v_row:=p_row || jsonb_build_object(
        'tax_amount',v_existing_tax,
        'tax_rate_bp',v_existing_rate,
        'tax_label',v_existing_label
      );
    else
      v_row:=p_row || jsonb_build_object(
        'tax_amount',coalesce((p_row->>'tax_amount')::bigint,0),
        'tax_rate_bp',coalesce((p_row->>'tax_rate_bp')::integer,0),
        'tax_label',coalesce(nullif(trim(p_row->>'tax_label'),''),'VAT')
      );
    end if;
    v_rate:=(v_row->>'tax_rate_bp')::integer;
    v_total:=(v_row->>'total')::bigint;
    v_tax:=(v_row->>'tax_amount')::bigint;
    if v_rate not between 0 and 10000 or length(v_row->>'tax_label') not between 1 and 24
       or v_tax<>((v_total*v_rate+((10000+v_rate)/2))/(10000+v_rate)) then
      raise exception 'invalid inclusive tax snapshot' using errcode='MU024';
    end if;
  end if;
  v_result:=sync_apply_row_pre_b3_tax(p_table,p_op,v_row,p_caller_shop_id,p_caller_user_id,p_device_id);
  if v_result='applied' and p_table='sales' and p_op<>'delete' then
    update sales set tax_amount=(v_row->>'tax_amount')::bigint,tax_rate_bp=(v_row->>'tax_rate_bp')::integer,
      tax_label=v_row->>'tax_label'
    where id=(v_row->>'id')::uuid and shop_id=p_caller_shop_id
      and updated_at=(v_row->>'updated_at')::timestamptz;
  end if;
  return v_result;
end
$fn$;
revoke execute on function sync_apply_row_pre_b3_tax(text,text,jsonb,uuid,uuid,text),
  sync_apply_row(text,text,jsonb,uuid,uuid,text) from public,anon,authenticated;
grant execute on function sync_apply_row_pre_b3_tax(text,text,jsonb,uuid,uuid,text),
  sync_apply_row(text,text,jsonb,uuid,uuid,text) to service_role;
