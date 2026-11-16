-- HELD: local preparation approved 2026-11-16; hosted activation NOT approved.
-- CLI-generated filename. Keep outside migrations/ until separate history/order,
-- exact catalog, backup/restore and activation approval. No unrestricted db push.
-- Reuses E4 sections a-f and E4-B; historical SQL remains immutable.
-- No sync, entitlement, role-switch or Staff-sale function/ACL change.
-- No seed rows, business-row DML or new RLS policies.
-- Class C: durable Admin audit store; recover forward or by verified restore.
-- Never drop audit evidence as rollback. Publication is its serving copy.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = public, pg_temp;
do $preflight$
declare v_count integer; v_shape text;
  v_tables text[] := array['admin_audit_log','admin_role_assignments','admin_support_cases',
    'admin_support_notes','admin_platform_settings','financial_publications'];
begin
  if current_user <> 'postgres' then
    raise exception 'Admin compatibility refused: reviewed postgres owner required' using errcode='55000';
  end if;
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure(
      'public.sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)')
      and md5(p.prosrc)='d4f8a9bfbeaa410244089594c7757cdc'
      and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
      and p.proconfig=array['search_path=public']) then
    raise exception 'Admin compatibility refused: reviewed Staff-sale repair is absent or changed' using errcode='55000';
  end if;
  select count(*) into v_count from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname = any(array[
    'admin_audit_log','admin_role_assignments','admin_support_cases',
    'admin_support_notes','admin_platform_settings','financial_publications']);
  if v_count not in (0,6) then
    raise exception 'Admin compatibility refused: partial or unknown store installation' using errcode='55000';
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname = any(array[
       'admin_audit_log','admin_role_assignments','admin_support_cases',
       'admin_support_notes','admin_platform_settings','financial_publications'])
       and (c.relkind <> 'r' or pg_get_userbyid(c.relowner) <> current_user or not c.relrowsecurity)) then
    raise exception 'Admin compatibility refused: unexpected owner, relation kind or RLS' using errcode='55000';
  end if;
  if v_count=0 and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('publish_financial_snapshot','financial_publications_immutable')) then
    raise exception 'Admin compatibility refused: orphan publication function' using errcode='55000';
  end if;
  if v_count=6 then
select md5(string_agg(shape, E'\n' order by shape collate "C")) into v_shape from (
  select c.relname || ':column:' || a.attnum || ':' || a.attname || ':' || format_type(a.atttypid,a.atttypmod)
    || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin,d.adrelid),'')
    || ':' || coalesce(a.attacl::text,'') shape
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relname=any(v_tables) and a.attnum>0 and not a.attisdropped
  union all select c.relname || ':constraint:' || k.conname || ':' || pg_get_constraintdef(k.oid)
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(v_tables)
  union all select c.relname || ':index:' || pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any(v_tables)
) shapes;
    if v_shape is distinct from 'fb0af5fc6b0b2f63ae3f891239ee3297'
       or exists (select 1 from pg_policies where schemaname='public' and tablename=any(v_tables)) then
      raise exception 'Admin compatibility refused: unknown store schema, column ACL or policy' using errcode='55000';
    end if;
    if not exists (select 1 from pg_proc p where p.oid=to_regprocedure(
        'public.publish_financial_snapshot(text,text,date,date,bigint,bigint,bigint,integer,integer,text,integer,integer,integer,integer,text)')
        and md5(replace(p.prosrc,E'\r\n',E'\n')) in ('b6162c7a933c786b532cb8d3a0ce7cda','926ddf6aba2d2db36a065568ece49c23')
        and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
        and p.proconfig=array['search_path=public, pg_temp']) then
      raise exception 'Admin compatibility refused: unknown publication implementation' using errcode='55000';
    end if;
    if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.financial_publications_immutable()')
        and md5(replace(p.prosrc,E'\r\n',E'\n'))='3138cda3020c25645a236f3f74e46387'
        and pg_get_userbyid(p.proowner)='postgres' and not p.prosecdef
        and (p.proconfig is null or p.proconfig=array['search_path=public, pg_temp']))
       or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname in ('publish_financial_snapshot','financial_publications_immutable')) <> 2
       or exists (select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
           where c.relnamespace='public'::regnamespace and c.relname=any(v_tables) and not t.tgisinternal
           and not(c.relname='financial_publications' and t.tgname in ('financial_publications_no_revision','financial_publications_no_truncate'))) then
      raise exception 'Admin compatibility refused: unknown publication helper or trigger' using errcode='55000';
    end if;
  end if;

end
$preflight$;
revoke all on table public.sale_refunds from service_role;
grant select on table public.sale_refunds to service_role;
revoke all on table public.audit_logs from service_role;
grant select on table public.audit_logs to service_role;
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null,
  actor text not null,
  actor_verified boolean not null default false,
  role text,
  action text not null,
  target text,
  outcome text not null check (outcome in ('success', 'failure', 'denied')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_at_idx on public.admin_audit_log (at desc, id);
create index if not exists admin_audit_log_actor_idx on public.admin_audit_log (actor, at desc);
alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from public, anon, authenticated, service_role;
grant insert, select on table public.admin_audit_log to service_role;
create table if not exists public.admin_role_assignments (
  username text primary key,
  role text not null check (role in ('super_admin', 'billing', 'support', 'read_only')),
  is_active boolean not null default true,
  sessions_revoked_at timestamptz,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admin_role_assignments enable row level security;
revoke all on table public.admin_role_assignments from public, anon, authenticated, service_role;
grant select, insert on table public.admin_role_assignments to service_role;
grant update (role, is_active, sessions_revoked_at, updated_at)
  on table public.admin_role_assignments to service_role;
create table if not exists public.admin_support_cases (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete restrict,
  category text not null check (
    category in ('onboarding', 'sync', 'payment', 'data', 'device', 'account', 'other')
  ),
  status text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee text,
  summary text not null check (length(summary) between 1 and 2000),
  opened_by text not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_support_cases_status_idx
  on public.admin_support_cases (status, updated_at desc);
create index if not exists admin_support_cases_shop_idx
  on public.admin_support_cases (shop_id, opened_at desc);
alter table public.admin_support_cases enable row level security;
revoke all on table public.admin_support_cases from public, anon, authenticated, service_role;
grant select, insert on table public.admin_support_cases to service_role;
grant update (status, priority, assignee, summary, updated_at)
  on table public.admin_support_cases to service_role;
create table if not exists public.admin_support_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.admin_support_cases(id) on delete restrict,
  body text not null check (length(body) between 1 and 8000),
  author text not null,
  created_at timestamptz not null default now()
);
create index if not exists admin_support_notes_case_idx
  on public.admin_support_notes (case_id, created_at);
alter table public.admin_support_notes enable row level security;
revoke all on table public.admin_support_notes from public, anon, authenticated, service_role;
grant select, insert on table public.admin_support_notes to service_role;
create table if not exists public.admin_platform_settings (
  key text primary key check (key in (
    'flag.analytics_enabled',
    'flag.maps_enabled',
    'flag.reports_pdf_enabled',
    'notification.template.trial_ending',
    'notification.template.payment_failed',
    'notification.template.subscription_expired'
  )),
  value jsonb not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
alter table public.admin_platform_settings enable row level security;
revoke all on table public.admin_platform_settings from public, anon, authenticated, service_role;
grant select, insert on table public.admin_platform_settings to service_role;
grant update (value, updated_by, updated_at)
  on table public.admin_platform_settings to service_role;

create table if not exists public.financial_publications (
  id uuid primary key default gen_random_uuid(),
  metric_family text not null
    check (metric_family in ('refund_net_pharmacy_sales')),
  cohort_key text not null check (cohort_key = 'platform_all'),
  period_grain text not null check (period_grain = 'month'),
  period_start date not null,
  period_end date not null,
  gross_paisa bigint not null
    check (gross_paisa >= 0 and gross_paisa <= 9007199254740991),
  refunds_paisa bigint not null
    check (refunds_paisa >= 0 and refunds_paisa <= 9007199254740991),
  value_paisa bigint not null
    check (value_paisa >= -9007199254740991 and value_paisa <= 9007199254740991),
  source_sale_rows integer not null check (source_sale_rows >= 0),
  source_refund_rows integer not null check (source_refund_rows >= 0),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  k_floor integer not null check (k_floor >= 5),
  contributor_count integer not null check (contributor_count >= 0),
  days_requiring_floor integer not null check (days_requiring_floor >= 0),
  days_clearing_floor integer not null check (days_clearing_floor >= 0),
  published_at timestamptz not null default now(),
  published_by text not null check (length(published_by) between 1 and 200),
  constraint financial_publications_identity
    unique (metric_family, cohort_key, period_grain, period_start),
  constraint financial_publications_finite_period check (
    isfinite(period_start) and isfinite(period_end)
  ),
  constraint financial_publications_whole_month check (
    extract(day from period_start) = 1
    and period_end = (period_start + interval '1 month' - interval '1 day')::date
  ),
  constraint financial_publications_net
    check (value_paisa = gross_paisa - refunds_paisa),
  constraint financial_publications_days_eligible
    check (days_clearing_floor = days_requiring_floor),
  constraint financial_publications_cohort_eligible check (
    days_requiring_floor > 0 and contributor_count >= k_floor
  )
);
create index if not exists financial_publications_published_idx
  on public.financial_publications (metric_family, period_start desc);
alter table public.financial_publications enable row level security;
revoke all on table public.financial_publications
  from public, anon, authenticated, service_role;
grant select on table public.financial_publications to service_role;
create or replace function public.financial_publications_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception
    'financial_publications is append-only: % is not permitted. A published figure is never revised; publish the next period instead.',
    tg_op
    using errcode = 'restrict_violation';
end;
$$;
drop trigger if exists financial_publications_no_revision on public.financial_publications;
create trigger financial_publications_no_revision
  before update or delete on public.financial_publications
  for each row execute function public.financial_publications_immutable();
drop trigger if exists financial_publications_no_truncate on public.financial_publications;
create trigger financial_publications_no_truncate
  before truncate on public.financial_publications
  for each statement execute function public.financial_publications_immutable();
create or replace function publish_financial_snapshot(
  p_metric_family text,
  p_cohort_key text,
  p_period_start date,
  p_period_end date,
  p_gross_paisa bigint,
  p_refunds_paisa bigint,
  p_value_paisa bigint,
  p_source_sale_rows integer,
  p_source_refund_rows integer,
  p_source_digest text,
  p_k_floor integer,
  p_contributor_count integer,
  p_days_requiring_floor integer,
  p_days_clearing_floor integer,
  p_published_by text
)
returns table (publication_id uuid, published_now boolean, published_value_paisa bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_new boolean := false;
  v_value bigint;
begin
  if not isfinite(p_period_start) or not isfinite(p_period_end) then
    raise exception
      'refused: the reporting period must be two finite dates (got % to %). A nonfinite date makes every check below evaluate to NULL, which a constraint accepts.',
      p_period_start, p_period_end
      using errcode = 'restrict_violation';
  end if;
  if p_days_clearing_floor <> p_days_requiring_floor then
    raise exception
      'refused: % of % trading days inside % did not clear the k=% floor. The period is not publishable.',
      p_days_requiring_floor - p_days_clearing_floor, p_days_requiring_floor,
      to_char(p_period_start, 'YYYY-MM'), p_k_floor
      using errcode = 'restrict_violation';
  end if;
  if p_days_requiring_floor > 0 and p_contributor_count < p_k_floor then
    raise exception
      'refused: % contributing pharmacies is below the k=% floor for %.',
      p_contributor_count, p_k_floor, to_char(p_period_start, 'YYYY-MM')
      using errcode = 'restrict_violation';
  end if;
  if p_days_requiring_floor = 0 then
    raise exception
      'refused: % records no trading activity. There is no figure to fix, and a period can look empty simply because no device has synced yet.',
      to_char(p_period_start, 'YYYY-MM')
      using errcode = 'restrict_violation';
  end if;
  if p_period_end >= (now() at time zone 'Asia/Dhaka')::date then
    raise exception
      'refused: % has not ended in Dhaka (period_end %, Dhaka today %). A period still in progress is certain to change, and a published figure is never revised.',
      to_char(p_period_start, 'YYYY-MM'), p_period_end,
      (now() at time zone 'Asia/Dhaka')::date
      using errcode = 'restrict_violation';
  end if;
  if not exists (
        select 1 from public.financial_publications fp
         where fp.metric_family = p_metric_family
           and fp.cohort_key = p_cohort_key
           and fp.period_grain = 'month'
           and fp.period_start = p_period_start)
     and exists (
        select 1 from public.admin_audit_log al
         where al.action = 'publication.published'
           and al.target = p_metric_family || ':' || p_cohort_key || ':'
                           || to_char(p_period_start, 'YYYY-MM')) then
    raise exception
      'refused: % was published before and its serving row is absent. Restore it rather than publishing a new value -- republishing would create a second value for one period, which is the difference this table exists to prevent.',
      to_char(p_period_start, 'YYYY-MM')
      using errcode = 'restrict_violation';
  end if;
  insert into public.financial_publications as fp (
    metric_family, cohort_key, period_grain, period_start, period_end,
    gross_paisa, refunds_paisa, value_paisa,
    source_sale_rows, source_refund_rows, source_digest,
    k_floor, contributor_count, days_requiring_floor, days_clearing_floor,
    published_by
  ) values (
    p_metric_family, p_cohort_key, 'month', p_period_start, p_period_end,
    p_gross_paisa, p_refunds_paisa, p_value_paisa,
    p_source_sale_rows, p_source_refund_rows, p_source_digest,
    p_k_floor, p_contributor_count, p_days_requiring_floor, p_days_clearing_floor,
    p_published_by
  )
  on conflict on constraint financial_publications_identity do nothing
  returning fp.id, fp.value_paisa into v_id, v_value;
  if v_id is not null then
    v_new := true;
  else
    select fp2.id, fp2.value_paisa into v_id, v_value
      from public.financial_publications fp2
     where fp2.metric_family = p_metric_family
       and fp2.cohort_key = p_cohort_key
       and fp2.period_grain = 'month'
       and fp2.period_start = p_period_start;
  end if;
  insert into public.admin_audit_log (at, actor, actor_verified, role, action, target, outcome, meta)
  values (
    now(), p_published_by, true, 'super_admin',
    case when v_new then 'publication.published' else 'publication.already_published' end,
    p_metric_family || ':' || p_cohort_key || ':' || to_char(p_period_start, 'YYYY-MM'),
    'success',
    case when v_new then
      jsonb_build_object(
        'value_paisa', v_value,
        'gross_paisa', p_gross_paisa,
        'refunds_paisa', p_refunds_paisa,
        'contributor_count', p_contributor_count,
        'k_floor', p_k_floor,
        'days_requiring_floor', p_days_requiring_floor,
        'source_digest', p_source_digest
      )
    else
      jsonb_build_object(
        'value_paisa', v_value,
        'already_published', true
      )
    end
  );
  return query select v_id, v_new, v_value;
end;
$$;
revoke all on function publish_financial_snapshot(text,text,date,date,bigint,bigint,bigint,integer,integer,text,integer,integer,integer,integer,text) from public, anon, authenticated, service_role;
grant execute on function publish_financial_snapshot(text,text,date,date,bigint,bigint,bigint,integer,integer,text,integer,integer,integer,integer,text) to service_role;
comment on table public.financial_publications is
  'Immutable published pharmacy money figures. Append-only; the only writer is publish_financial_snapshot(). A published figure is read, never recomputed, because a recomputation that changes discloses the difference.';

-- Internal trigger helper; no API/service-role direct execution.
revoke all on function public.financial_publications_immutable() from public, anon, authenticated, service_role;
commit;
