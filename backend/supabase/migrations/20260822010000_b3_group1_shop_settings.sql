-- Phase B3 Group 1 foundations — PostgreSQL mirror of
-- apps/mobile/db/migrations/0015_b3_shop_settings.sql.
--
-- Three additive columns on the already-synced shop settings row:
--   closing_hour  — the hour the shop closes (W-5, D-11), default 20, read by
--                    the daily-summary notification's OS-scheduled trigger.
--   tax_rate_bp   — laid down now so Group 9's tax feature is additive; Group
--                    1 only mirrors the stored value and checkout never reads it.
--   tax_label     — same, paired snapshot label for tax_rate_bp.
--
-- NOT PUSHED. Local file only until remote migration execution is approved
-- separately, same safety gate as 20260822000000_owner_dashboard_credit_period.sql.
--
-- No grant, policy, or sync-allowlist change is required: shop_b2_settings is
-- already allowlisted table-wide in functions/sync/_shared/tables.ts and its
-- RLS and grants are unaffected by adding a column.

alter table shop_b2_settings
  add column closing_hour integer not null default 20
  check (closing_hour between 0 and 23);

alter table shop_b2_settings
  add column tax_rate_bp integer not null default 0
  check (tax_rate_bp between 0 and 10000);

alter table shop_b2_settings
  add column tax_label text not null default 'VAT';

-- The B2 dispatcher predates credit_max_days and the three columns above.
-- Keep its complete implementation for every other B2 table, and wrap only
-- the settings branch so older columns and all existing guards remain intact.
alter function sync_apply_b2_row(text,text,jsonb,uuid,uuid,text)
  rename to sync_apply_b2_row_pre_group1;

create or replace function sync_apply_b2_row(
  p_table text, p_op text, p_row jsonb, p_shop_id uuid,
  p_actor_id uuid, p_device_id text default null
)
returns text language plpgsql security definer set search_path=public as $fn$
declare
  v_id uuid := (p_row->>'id')::uuid;
  v_existing jsonb;
  v_row jsonb := p_row;
begin
  if p_table <> 'shop_b2_settings' then
    return sync_apply_b2_row_pre_group1(
      p_table,p_op,p_row,p_shop_id,p_actor_id,p_device_id
    );
  end if;

  if p_op not in ('insert','update','delete') then
    raise exception 'unsupported sync operation: %',p_op using errcode='MU002';
  end if;
  if p_row->>'shop_id' is distinct from p_shop_id::text then
    raise exception 'row does not belong to authenticated shop' using errcode='MU003';
  end if;
  if not sync_row_permitted(p_actor_id,p_table,p_row) then
    raise exception 'caller lacks permission for B2 row' using errcode='MU010';
  end if;
  if not b2_user_is_owner(p_actor_id) or p_op='delete' then
    raise exception 'B2 settings are Owner-managed' using errcode='MU015';
  end if;

  select to_jsonb(s) into v_existing
    from shop_b2_settings s
   where s.id=v_id and s.shop_id=p_shop_id;

  -- Old clients omit fields they did not know about. Preserve the remote
  -- value when present, otherwise use the column default; an explicit JSON
  -- null is intentionally not repaired and still fails the NOT NULL guard.
  v_row := v_row || jsonb_build_object(
    'credit_max_days', coalesce(v_row->'credit_max_days',v_existing->'credit_max_days','7'::jsonb),
    'closing_hour', coalesce(v_row->'closing_hour',v_existing->'closing_hour','20'::jsonb),
    'tax_rate_bp', coalesce(v_row->'tax_rate_bp',v_existing->'tax_rate_bp','0'::jsonb),
    'tax_label', coalesce(v_row->'tax_label',v_existing->'tax_label','"VAT"'::jsonb)
  );

  insert into shop_b2_settings
    select * from jsonb_populate_record(null::shop_b2_settings,v_row)
  on conflict(id) do update set
    updated_at=excluded.updated_at,is_deleted=excluded.is_deleted,
    deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,
    low_stock_default=excluded.low_stock_default,
    expiry_near_days=excluded.expiry_near_days,
    expiry_far_days=excluded.expiry_far_days,
    max_refund_days=excluded.max_refund_days,
    credit_max_days=excluded.credit_max_days,
    closing_hour=excluded.closing_hour,
    tax_rate_bp=excluded.tax_rate_bp,
    tax_label=excluded.tax_label
  where shop_b2_settings.shop_id=p_shop_id
    and shop_b2_settings.updated_at<excluded.updated_at;

  return 'applied';
end
$fn$;

revoke execute on function sync_apply_b2_row(text,text,jsonb,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function sync_apply_b2_row(text,text,jsonb,uuid,uuid,text)
  to service_role;
