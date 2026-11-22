-- Migration 42 — an admin grant is not a billing cycle.
--
-- FOUNDER DECISION 2026-11-22 (CLAUDE.md rule 10). Migration 41 stored a grant
-- longer than 31 days as billing_cycle 'annual' and anything shorter as
-- 'monthly'. Neither is true: nothing was billed, and a 60-day grant read as
-- "Ultra · Annual" with a ৳4,790 plan price and a "next billing" date in the
-- admin panel, and was counted into the monthly run rate.
--
-- A grant now carries billing_cycle 'grant'. Nothing outside the admin panel
-- reads billing_subscriptions.billing_cycle: plan limits read plan_offerings'
-- monthly row for the tier, entitlement checks read tier/status/dates, the
-- device never receives this table, and a later verified payment
-- (b4_apply_verified_payment) overwrites the cycle with the order's own
-- monthly/annual — so a granted account that starts paying stops being a
-- grant by construction. plan_offerings and payment_orders keep
-- monthly/annual only: a grant is never sold.
--
-- The one existing grant row (DEV) is corrected in place. A grant that
-- extended an already-paid subscription kept that subscription's real cycle
-- and its provider_reference, so only provider 'admin_grant' rows with no
-- provider reference are rewritten.

alter table billing_subscriptions drop constraint billing_subscriptions_billing_cycle_check;
alter table billing_subscriptions
  add constraint billing_subscriptions_billing_cycle_check
  check (billing_cycle in ('monthly','annual','grant'));

update billing_subscriptions set billing_cycle='grant',updated_at=now()
where provider='admin_grant' and provider_reference is null and billing_cycle<>'grant';

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
      p_billing_account_id,p_tier,'grant','active',v_now,
      v_paid_through,v_paid_through+interval '7 days','admin_grant',null
    );
  else
    -- An existing row keeps its own cycle: a paid subscription stays
    -- monthly/annual (it IS billed), a grant row stays 'grant'.
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
