-- Migration 41 — admin plan grants.
--
-- FOUNDER DECISION 2026-11-21 (CLAUDE.md rule 10, approved with an audit
-- log): an admin may give an account Pro or Ultra, or extend the plan it has,
-- by a number of days, with a written reason. Until now the only way to a paid
-- tier was a verified SSLCommerz payment (b4_apply_verified_payment).
--
-- The grant follows the verified-payment path exactly, so everything that
-- reads entitlement afterwards behaves the same way:
--   * the current billing_subscriptions row is created or extended — from the
--     later of now and its own paid_through, so an extension never shortens
--     what was already paid for;
--   * entitlement_snapshots gets the same tier / status / paid_through /
--     grace_ends_at, which is what b4_entitlement_claim_backed (migration 37)
--     checks against the subscription row — so the device's own online
--     billing check accepts the grant instead of refusing it as unbacked;
--   * shops.plan and the plan limits are re-applied.
--
-- Two deliberate differences from a payment:
--   * verified_at is NOT touched on an existing snapshot. E11: only the
--     device's online check may stamp "verified now"; an admin action is not
--     that event. The device picks the grant up the next time it is online.
--   * every grant is recorded in admin_plan_grants with who, why, and the
--     before/after dates. The admin panel ALSO writes its own audit entry.
--
-- Service role only. The admin panel checks subscriptions.write before it
-- calls this; no app user can reach it.

alter table billing_subscriptions drop constraint billing_subscriptions_provider_check;
alter table billing_subscriptions
  add constraint billing_subscriptions_provider_check
  check (provider in ('sslcommerz','admin_grant'));

create table admin_plan_grants (
  id uuid primary key default gen_random_uuid(),
  billing_account_id uuid not null references billing_accounts(id) on delete cascade,
  tier text not null check (tier in ('pro','ultra')),
  days integer not null check (days between 1 and 366),
  reason text not null check (length(btrim(reason)) >= 5),
  granted_by text not null check (length(btrim(granted_by)) >= 1),
  previous_tier text,
  previous_paid_through timestamptz,
  new_paid_through timestamptz not null,
  created_at timestamptz not null default now()
);
create index admin_plan_grants_account_idx on admin_plan_grants(billing_account_id,created_at desc);

alter table admin_plan_grants enable row level security;
revoke all on admin_plan_grants from public,anon,authenticated;
grant select,insert on admin_plan_grants to service_role;

create or replace function admin_grant_plan(
  p_billing_account_id uuid,
  p_tier text,
  p_days integer,
  p_reason text,
  p_granted_by text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
  v_subscription billing_subscriptions%rowtype;
  v_start timestamptz;
  v_paid_through timestamptz;
  v_snapshot entitlement_snapshots%rowtype;
  v_now timestamptz:=now();
begin
  if p_tier is null or p_tier not in ('pro','ultra') then
    raise exception 'tier must be pro or ultra' using errcode='22023';
  end if;
  if p_days is null or p_days<1 or p_days>366 then
    raise exception 'days must be between 1 and 366' using errcode='22023';
  end if;
  if p_reason is null or length(btrim(p_reason))<5 then
    raise exception 'a reason of at least 5 characters is required' using errcode='22023';
  end if;
  if p_granted_by is null or length(btrim(p_granted_by))<1 then
    raise exception 'the granting admin is required' using errcode='22023';
  end if;

  perform 1 from billing_accounts where id=p_billing_account_id for update;
  if not found then
    raise exception 'billing account not found' using errcode='P0002';
  end if;

  select * into v_subscription from billing_subscriptions
  where billing_account_id=p_billing_account_id
    and status in ('active','past_due','grace','canceled')
  for update;
  v_start:=case
    when v_subscription.id is not null and v_subscription.paid_through>v_now
      then v_subscription.paid_through
    else v_now
  end;
  v_paid_through:=v_start+make_interval(days=>p_days);

  if v_subscription.id is null then
    insert into billing_subscriptions(
      billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,
      provider,provider_reference
    ) values(
      p_billing_account_id,p_tier,case when p_days>31 then 'annual' else 'monthly' end,'active',v_now,
      v_paid_through,v_paid_through+interval '7 days','admin_grant',null
    );
  else
    update billing_subscriptions set tier=p_tier,status='active',
      starts_at=case when tier=p_tier then starts_at else v_now end,
      paid_through=v_paid_through,grace_ends_at=v_paid_through+interval '7 days',canceled_at=null,
      updated_at=v_now
    where id=v_subscription.id;
  end if;

  insert into entitlement_snapshots(
    billing_account_id,tier,status,trial_ends_at,paid_through,grace_ends_at,verified_at,version
  ) values(
    p_billing_account_id,p_tier,'active',null,v_paid_through,v_paid_through+interval '7 days',v_now,1
  ) on conflict(billing_account_id) do update set
    tier=excluded.tier,status='active',trial_ends_at=null,paid_through=excluded.paid_through,
    grace_ends_at=excluded.grace_ends_at,version=entitlement_snapshots.version+1,updated_at=v_now;

  insert into admin_plan_grants(
    billing_account_id,tier,days,reason,granted_by,previous_tier,previous_paid_through,new_paid_through
  ) values(
    p_billing_account_id,p_tier,p_days,btrim(p_reason),btrim(p_granted_by),
    v_subscription.tier,v_subscription.paid_through,v_paid_through
  );

  update shops set plan=p_tier,trial_ends_at=null,updated_at=v_now
  where billing_account_id=p_billing_account_id;
  perform b4_reconcile_plan_limits(p_billing_account_id,v_now);

  select * into v_snapshot from entitlement_snapshots where billing_account_id=p_billing_account_id;
  return to_jsonb(v_snapshot);
end
$fn$;
revoke execute on function admin_grant_plan(uuid,text,integer,text,text) from public,anon,authenticated;
grant execute on function admin_grant_plan(uuid,text,integer,text,text) to service_role;
