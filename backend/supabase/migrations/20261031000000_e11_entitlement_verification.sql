-- Migration 37, E11. A verification timestamp must not attest a verification
-- that never happened, and a rejected claim must not be applied.
--
-- THE DEFECT. b4_refresh_entitlement_snapshot shipped in
-- 20260831000000:620-630 as, in full:
--
--     update entitlement_snapshots
--     set verified_at=now(),version=version+1,updated_at=now()
--     where billing_account_id=p_billing_account_id;
--
-- and billing-status calls it on every poll (functions/sync/billing.ts).
-- verified_at is the device's offline verification ceiling: resolveEntitlement
-- (apps/mobile/domain/entitlements.ts:143) refuses a snapshot older than
-- MAX_OFFLINE_VERIFICATION_DAYS = 30. That ceiling is the only mechanism that
-- ever forces a cached entitlement to be re-derived, and the function reset it
-- unconditionally, having checked nothing.
--
-- WHAT THE DEFECT IS NOT. It is not a payment bypass, and the Batch 3 plan's
-- "extends paid access with no payment" overstates it. The ceiling is ANDed
-- with the business dates, never substituted for them, so advancing
-- verified_at cannot create access a snapshot does not already carry. That is
-- measured, not assumed: see apps/mobile/domain/entitlements.test.ts, "E11 --
-- what advancing verified_at can and cannot buy". The true exposure was 30
-- days of renewable trust in a snapshot nothing had checked, bounded by the
-- dates already in that snapshot.
--
-- WHY THE CALL IS NOT SIMPLY REMOVED. The refresh has a legitimate job. A
-- paying device that has been offline 31 days is stale and resolves to free;
-- contacting the server is exactly what should restore it. Deleting the call
-- would strip premium from paying customers who are online -- the "blindly
-- revoke a function still required by production code" failure. The
-- requirement is that billing-status cannot UNJUSTIFIABLY renew premium
-- verification, so the fix justifies the renewal rather than withdrawing it.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE SHAPE OF THE FIX, AND WHY IT IS THREE FUNCTIONS RATHER THAN ONE
--
-- b4_entitlement_claim_backed is the single copy of the evidence rule.
-- b4_refresh_entitlement_snapshot consults it and REFUSES to stamp.
-- b4_effective_tier answers 'free' for an unbacked claim, so every capacity
-- decision that already asks it refuses the expansion BEFORE the write.
-- b4_reconcile_plan_limits takes its tier from b4_effective_tier, so an
-- unbacked claim narrows and undoes an expansion that slipped through.
-- b4_staff_row_within_limit likewise, which is staff admission.
--
-- The second of those was the whole of review round 29. The first version of
-- this migration guarded only the stamp, and the edge function then skipped
-- reconciliation itself when the stamp was refused. That closed the instance
-- and missed the class: b4_reconcile_plan_limits has five callers, and
-- functions/sync/multiShop.ts:158 calls it on an ordinary shop rename. The
-- reviewer executed it -- a verified Pro account at 3 shops / 4 staff, its
-- snapshot diverged to Ultra, refresh refused with MU037, billing correctly
-- skipped, and then a rename widened the account to 6 shops / 7 staff and the
-- next refused poll preserved it.
--
-- Reconciliation is the WRITE that applies a snapshot: it moves
-- shops.commercial_status and suspends or unsuspends staff. Gating each caller
-- is whack-a-mole, and a sixth caller added later would reopen it. So the
-- guard lives at the boundary, where every caller present and future meets it.
--
-- WHAT IS DELIBERATELY NOT GUARDED. The snapshot remains authoritative for
-- READS -- b4_effective_tier, b4_user_has_premium, b4_shop_write_permitted,
-- b4_user_within_current_staff_limit. Making every reader re-verify would be a
-- redesign, and a wrong verification would then deny a paying customer
-- outright. Reads are already bounded by the snapshot's own dates and, on the
-- device, by the ceiling this migration protects. It is the writes that must
-- not apply an unverified claim.
--
-- ───────────────────────────────────────────────────────────────────────────
-- THE GATE IS CLOCK-INDEPENDENT, AND THAT IS THE WHOLE POINT
--
-- The first version asked `b4_effective_tier(account, now()) <> 'free'` --
-- "does this snapshot grant premium right now?" -- and stamped without
-- checking evidence when the answer was no. Reusing the existing expression of
-- the status/date rule looked like the DRY choice. It was wrong, and review
-- round 28 reproduced why:
--
--     snapshot: paid_through Oct 21, grace_ends_at Oct 28, verified Sep 1
--     server clock: Oct 31  -> effective tier 'free' -> stamped, unchecked
--     device clock: Oct 20  -> Oct 20 < paid_through -> 'paid'
--
-- Before the stamp that device was past its ceiling (Sep 1 + 30d) and resolved
-- `verification_stale`, which is free. After it, the device resolved `paid`.
-- The shortcut handed premium to a device with no payment evidence -- the exact
-- defect this migration exists to close, reintroduced by the gate.
--
-- Equivalent predicates require equivalent clocks, and a server cannot know
-- the device's. So the rule asks a structural question instead: COULD this
-- snapshot grant premium to any client, at any time? Dates are then compared
-- only against the subscription's dates, never against a clock.
--
-- WHICH SNAPSHOTS COULD GRANT. Read off resolveEntitlement's own branches:
-- `trialing` grants until trial_ends_at regardless of tier (its branch returns
-- before the tier check); `active`/`canceled` grant until paid_through;
-- `grace`/`past_due`/`active` grant until grace_ends_at; `tier = 'free'` is
-- free; `expired` carries no granting branch. A snapshot outside those shapes
-- cannot grant anything to anyone, so there is nothing to justify.
--
-- THE SUBSCRIPTION'S STATUS IS PART OF THE EVIDENCE. Round 28 also reproduced
-- a subscription marked `canceled` with a future grace window backing a
-- snapshot still marked `active`: dates and tier matched, so the claim
-- verified. Comparing dates and tier while ignoring status means a revoked
-- subscription can still vouch for a live-looking snapshot. So the statuses
-- must be equal. Today that is free -- b4_apply_verified_payment writes
-- `active` to both, on the first purchase and on renewal -- and it is what
-- forces a future revocation path to move the snapshot when it moves the
-- subscription.
--
-- THE COMPARISON IS ONE-DIRECTIONAL. The snapshot may claim LESS than the
-- subscription grants and still verify; it may never claim more. A snapshot
-- that has fallen behind is safe, and refusing it would take access from
-- someone who paid.
--
-- IT IS A NO-OP ON EVERY SNAPSHOT THE PLATFORM CAN CURRENTLY PRODUCE. Nothing
-- in the schema revokes, expires, refunds or downgrades an entitlement
-- snapshot: the only writers are the bootstrap trial (20260831000000:130,
-- :818) and b4_apply_verified_payment (:711), so status can only ever be
-- `trialing` or `active`. The reason E11 is not already exploitable is that
-- absence -- which is luck, not design. The guard exists for when a revocation
-- path arrives: B6-02 adds a real payment gateway, and a chargeback has no
-- route to this table.
--
-- THE GRANT STAYS. 20260831000000:632 grants execute to service_role and
-- nothing revokes it. That is correct and remains correct: billing-status runs
-- as the service role and needs this function. The capability was never the
-- problem -- an unconditional write behind it was.
--
-- Rollback class B. All three definitions are in git: the two predecessors at
-- 20260831000000:562-618 and :620-630, and b4_entitlement_claim_backed is new,
-- so reverting means re-applying those two and dropping this one. A deploy,
-- not a data operation. Reverting re-opens both the unconditional stamp and
-- the unconditional apply.

-- ── The evidence rule, in one place ────────────────────────────────────────
--
-- True when the snapshot's premium claim is backed, or when it makes no claim
-- that any client could honour. Consulted by the stamp and by the apply, so
-- the two cannot drift apart.
create or replace function b4_entitlement_claim_backed(p_billing_account_id uuid)
returns boolean language plpgsql stable security definer
set search_path=public,pg_temp as $fn$
declare
  v_snapshot entitlement_snapshots%rowtype;
  v_granted timestamptz;
begin
  select * into v_snapshot from entitlement_snapshots
  where billing_account_id=p_billing_account_id;
  -- No snapshot is not a backed claim; the callers distinguish the two cases.
  if not found then return false; end if;

  if v_snapshot.status='trialing' then
    -- The trial's evidence is the immutable grant timestamp. A snapshot may
    -- not claim more trial than was granted; 14 days is the figure that
    -- 20260831000000:130 and :818 both write. No clock is consulted: a trial
    -- snapshot can grant to a device whose clock is behind ours.
    select launch_trial_granted_at into v_granted
    from billing_accounts where id=p_billing_account_id;
    return v_granted is not null
      and v_snapshot.trial_ends_at is not null
      and v_snapshot.trial_ends_at<=v_granted+interval '14 days';
  end if;

  -- Could this snapshot grant premium to any client, at any time? If not,
  -- there is no attestation to justify.
  if v_snapshot.tier='free'
    or v_snapshot.status not in ('active','canceled','grace','past_due')
    or (v_snapshot.paid_through is null and v_snapshot.grace_ends_at is null) then
    return true;
  end if;

  -- The paid claim's evidence is a subscription row. billing_subscriptions is
  -- written only by b4_apply_verified_payment, which requires a verified
  -- provider event, so the row IS the payment evidence; joining payment_orders
  -- again would add coupling, not assurance.
  --
  -- s.paid_through is NOT NULL by the table's own constraint, so it is not
  -- tested here: a predicate that cannot fail is a predicate nothing tests.
  return exists (
    select 1 from billing_subscriptions s
    where s.billing_account_id=p_billing_account_id
      and s.tier=v_snapshot.tier
      and s.status=v_snapshot.status
      and coalesce(v_snapshot.paid_through,'-infinity'::timestamptz)<=s.paid_through
      and coalesce(v_snapshot.grace_ends_at,'-infinity'::timestamptz)
          <=coalesce(s.grace_ends_at,'-infinity'::timestamptz)
  );
end
$fn$;
revoke execute on function b4_entitlement_claim_backed(uuid) from public,anon,authenticated;

-- ── The stamp ──────────────────────────────────────────────────────────────

create or replace function b4_refresh_entitlement_snapshot(p_billing_account_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
  v_snapshot entitlement_snapshots%rowtype;
  v_now timestamptz:=now();
begin
  -- for update: b4_apply_verified_payment writes this row, so a concurrent
  -- settlement must not land between the check and the stamp.
  select * into v_snapshot from entitlement_snapshots
  where billing_account_id=p_billing_account_id for update;
  if not found then
    raise exception 'entitlement snapshot not found' using errcode='MU036';
  end if;

  if not b4_entitlement_claim_backed(p_billing_account_id) then
    if v_snapshot.status='trialing' then
      raise exception 'entitlement claim is not backed by a granted trial'
        using errcode='MU037';
    end if;
    raise exception 'entitlement claim is not backed by a verified payment'
      using errcode='MU037';
  end if;

  update entitlement_snapshots
  set verified_at=v_now,version=version+1,updated_at=v_now
  where billing_account_id=p_billing_account_id;
end
$fn$;

-- ── What the tier IS ───────────────────────────────────────────────────────
--
-- An unbacked claim is worth nothing, so the effective tier of an account
-- whose entitlement has no evidence is 'free'. One sentence, in the one place
-- every capacity decision already asks.
--
-- ROUND 30 is why this exists. The guard had been placed in
-- b4_reconcile_plan_limits, which NARROWS, and the reviewer pointed out that
-- three operations EXPAND and then call reconciliation to tidy up: creating a
-- shop (20260831000000:903), restoring an archived one
-- (20260905000000:217), and reactivating staff
-- (20260909000000:108). For those, "return without applying" PRESERVES the
-- expansion -- a refusal after the write is not enforcement. Its words:
-- "those expanding operations need enforcement before their writes".
--
-- Shop creation reads b4_effective_tier directly, from
-- functions/sync/multiShop.ts:35 and from b4_create_owned_shop at
-- 20260831000000:903 -- and those are its only two callers. So failing closed
-- here refuses the expansion BEFORE it happens, which is the shape the
-- reviewer asked for, and it does it once rather than at each site.
--
-- THEY WERE NOT REGRESSIONS FROM THIS MIGRATION. It redefines five functions
-- and no others: b4_entitlement_claim_backed, b4_effective_tier,
-- b4_refresh_entitlement_snapshot, b4_reconcile_plan_limits and
-- b4_staff_row_within_limit. b4_create_owned_shop, b4_mutate_owned_shop,
-- b4_ensure_owner_billing_account and h7_reactivate_suspended_staff are
-- untouched, so each behaved identically before this migration existed.
--
-- NOR, I ARGUED, WERE THEY A PRIVILEGE ESCALATION -- and round 31 showed that
-- argument was half wrong, which is recorded at the staff-admission function
-- below. Writing the diverged snapshot does need service_role. Acting on it
-- afterwards does not, and on a secondary shop nothing undid the result. What
-- this class is: every capacity decision trusts the snapshot, and E11 was the
-- first instance of it. Worth closing before B6-02 brings a revocation path.
--
-- WHAT IS STILL OPEN, stated rather than implied. b4_staff_row_within_limit
-- (20260831000000:350), b4_user_within_current_staff_limit (:275, replaced at
-- 20260907000000:140) and b4_shop_write_permitted (:401, replaced at
-- 20260907000000:177) each carry their own copy of the status/date CASE and
-- do not consult b4_effective_tier. A diverged snapshot therefore still
-- ADMITS a staff reactivation; reconciliation then re-suspends it, because of
-- the change below. Folding those three onto b4_effective_tier is the
-- remaining work, and it is a separate authorisation because narrowing is the
-- direction that can take access from someone who paid.

create or replace function b4_effective_tier(
  p_billing_account_id uuid,p_now timestamptz default now()
) returns text language sql stable security definer set search_path=public,pg_temp as $fn$
  select case
    when not b4_entitlement_claim_backed(p_billing_account_id) then 'free'
    when status='trialing' and trial_ends_at>p_now then 'ultra'
    when status in ('active','canceled') and paid_through>p_now then tier
    when status in ('active','past_due','grace') and grace_ends_at>p_now then tier
    else 'free' end
  from entitlement_snapshots where billing_account_id=p_billing_account_id
$fn$;

-- ── The apply ──────────────────────────────────────────────────────────────
--
-- Identical to 20260831000000:562-616 except that the tier now comes from
-- b4_effective_tier instead of a fifth copy of the same CASE. The body is
-- reproduced rather than wrapped because a wrapper would leave the unguarded
-- original reachable by name.
--
-- The earlier version of this function returned early on an unbacked claim,
-- leaving limits untouched. That was wrong in the one direction that matters:
-- an operation which has just EXPANDED capacity gets to keep the expansion.
-- Deriving the tier from b4_effective_tier instead means an unbacked claim
-- reconciles against 'free', so the restored shop goes back to read_only and
-- the reactivated staff member is re-suspended -- the expansion is undone by
-- the same pass that used to preserve it.
--
-- That is the narrowing I previously refused to do, and the reason for the
-- change of mind is evidence rather than preference: the reviewer executed 72
-- snapshot combinations plus first-purchase and renewal paths and found the
-- backing rule true for every state the platform can produce, because
-- b4_apply_verified_payment writes the subscription and the snapshot in one
-- transaction with the same tier and status. A false negative therefore needs
-- a row no code path writes.

create or replace function b4_reconcile_plan_limits(
  p_billing_account_id uuid,p_now timestamptz default now()
) returns void language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
  v_tier text:='free';
  v_shop_limit integer:=1;
  v_staff_limit integer:=1;
begin
  v_tier:=coalesce(b4_effective_tier(p_billing_account_id,p_now),'free');

  select max_active_shops,max_active_non_owner_staff_per_shop
    into v_shop_limit,v_staff_limit
  from plan_offerings where tier=v_tier and billing_cycle='monthly';

  update shops set commercial_status='active',commercial_reason=null,updated_at=p_now
  where billing_account_id=p_billing_account_id and archived_at is null and is_deleted=false
    and (commercial_status is distinct from 'active' or commercial_reason is not null);

  if v_shop_limit is not null then
    with ranked as (
      select id,row_number() over(order by created_at,id) as ordinal
      from shops
      where billing_account_id=p_billing_account_id and archived_at is null and is_deleted=false
    )
    update shops s set commercial_status='read_only',commercial_reason='plan_shop_limit',updated_at=p_now
    from ranked r where s.id=r.id and r.ordinal>v_shop_limit
      and (s.commercial_status is distinct from 'read_only'
        or s.commercial_reason is distinct from 'plan_shop_limit');
  end if;

  update users u set plan_suspended_at=null,plan_suspension_reason=null,updated_at=p_now
  from shops s,roles r
  where u.shop_id=s.id and s.billing_account_id=p_billing_account_id
    and r.id=u.role_id and r.name<>'owner' and u.is_deleted=false
    and (u.plan_suspended_at is not null or u.plan_suspension_reason is not null);

  if v_staff_limit is not null then
    with ranked as (
      select u.id,row_number() over(partition by u.shop_id order by u.created_at,u.id) as ordinal
      from users u join shops s on s.id=u.shop_id join roles r on r.id=u.role_id
      where s.billing_account_id=p_billing_account_id and u.is_deleted=false
        and u.is_active=true and r.name<>'owner'
    )
    update users u set plan_suspended_at=p_now,plan_suspension_reason='plan_staff_limit',updated_at=p_now
    from ranked r where u.id=r.id and r.ordinal>v_staff_limit
      and (u.plan_suspended_at is null
        or u.plan_suspension_reason is distinct from 'plan_staff_limit');
  end if;
end
$fn$;

-- ── Staff admission ───────────────────────────────────────────────────────
--
-- ROUND 31, and the finding that changed what I thought the severity was.
--
-- I had argued that the remaining paths needed the service-role key and that
-- reconciliation undid them anyway. Both halves were wrong for a SECONDARY
-- shop. The reviewer executed the real Edge handler: create a secondary shop
-- under a backed trial, diverge the snapshot to Ultra, then call
-- `staff-reactivate` as that shop's own Owner. Result: two staff enabled, none
-- suspended, `within_limit = true`, sales permission granted -- and it STAYS
-- granted, because the reconciliation trigger
-- (20260831000000:849-857) only fires when the shop's `owner_id` equals the
-- billing account's `principal_owner_user_id`, and a secondary shop has its
-- own Owner user. No reconciliation runs, so nothing undoes it. Its words:
-- "divergence remains a trusted-data prerequisite; the subsequent request
-- requires no service-role key."
--
-- So "reconciliation undoes it" was true only for the primary shop, and
-- "requires privilege" was true only of the setup. I had written both into the
-- closure report as general statements. They are corrected there.
--
-- THE FIX is the one the reviewer offered as an alternative to adding
-- reconciliation inside the reactivation transaction: backed admission
-- enforcement. b4_staff_row_within_limit is the capacity check that
-- h7_reactivate_suspended_staff consults (20260909000000:107) and that
-- ordinary new-staff sync consults through b4_enforce_staff_limit_direct
-- (20260831000000:434). Deriving its tier from b4_effective_tier means an
-- unbacked claim is refused BEFORE the write, on every path that reads it,
-- rather than undone afterwards on the one path where a trigger happens to
-- fire.
--
-- Identical to 20260831000000:350-384 except that `v_tier` comes from
-- b4_effective_tier instead of a fourth copy of the status/date CASE.
--
-- The two H-7 write gates follow, for the reason recorded above them.

create or replace function b4_staff_row_within_limit(
  p_row jsonb,p_now timestamptz default now()
) returns boolean language plpgsql volatile security definer
set search_path=public,pg_temp as $fn$
declare
  v_id uuid:=(p_row->>'id')::uuid;
  v_shop uuid;
  v_role text;
  v_was_active boolean;
  v_will_active boolean;
  v_account uuid;
  v_tier text:='free';
  v_limit integer;
  v_count integer;
begin
  select u.shop_id,u.is_active into v_shop,v_was_active from users u where u.id=v_id;
  v_shop:=coalesce((p_row->>'shop_id')::uuid,v_shop);
  select name into v_role from roles where id=coalesce((p_row->>'role_id')::uuid,(select role_id from users where id=v_id));
  if v_role='owner' then return true; end if;
  v_will_active:=coalesce((p_row->>'is_active')::boolean,v_was_active,true);
  if not v_will_active or coalesce(v_was_active,false) then return true; end if;
  perform 1 from shops where id=v_shop for update;
  select billing_account_id into v_account from shops where id=v_shop;
  if v_account is null then return true; end if;
  v_tier:=coalesce(b4_effective_tier(v_account,p_now),'free');
  select max_active_non_owner_staff_per_shop into v_limit
  from plan_offerings where tier=coalesce(v_tier,'free') and billing_cycle='monthly';
  if v_limit is null then return true; end if;
  select count(*) into v_count from users u join roles r on r.id=u.role_id
  where u.shop_id=v_shop and u.id<>v_id and u.is_deleted=false and u.is_active=true
    and u.plan_suspended_at is null and r.name<>'owner';
  return v_count<v_limit;
end
$fn$;

-- ── The two H-7 write gates ────────────────────────────────────────────────
--
-- ROUND 32. I had left these two out, arguing they answer "may this existing
-- user write?" rather than "may this capacity be granted?", so consolidating
-- them would be tidiness rather than correctness. I wrote that argument down
-- as a claim under review rather than a conclusion, because I had made a
-- structurally identical argument about staff reactivation one round earlier
-- and it had been wrong.
--
-- It was wrong again. The reviewer executed it: under a backed trial, create a
-- secondary shop with two active staff; diverge its snapshot to active Ultra
-- with future dates and no subscription; refresh raises MU037 and the
-- effective tier becomes 'free'; and both of these gates still answer TRUE, so
-- the second staff member successfully syncs a customer. Deactivate both and
-- reactivation succeeds too, on a shop that is itself beyond the free limit.
-- Its verdict: "these gates participate in granting capacity, including
-- reactivation. Consolidating both is a correctness fix."
--
-- So the distinction I drew twice does not exist. A gate that decides whether
-- a write lands IS a capacity decision, because the capacity is the write.
-- With these two, the status/date rule that existed in FIVE copies has one
-- definition.
--
-- Both are reproduced from 20260907000000:140-174 and :177-203 with one line
-- changed each: v_tier comes from b4_effective_tier. H-7's own M-4 bounds are
-- untouched -- a shop with no billing account still answers through
-- h7_shop_billing_bootstrap_allowed, and an archived shop still answers false
-- there rather than falling through to a bare `return true`.

create or replace function b4_user_within_current_staff_limit(
  p_app_user_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql stable security definer
set search_path = public, pg_temp as $fn$
declare v_user users%rowtype; v_role text; v_account uuid; v_tier text := 'free';
  v_limit integer; v_ordinal integer;
begin
  select * into v_user from users
  where id = p_app_user_id and is_active and not is_deleted;
  if not found then return false; end if;
  select name into v_role from roles
  where id = v_user.role_id and shop_id = v_user.shop_id and not is_deleted;
  if not found then return false; end if;
  if v_role = 'owner' then return true; end if;
  select billing_account_id into v_account from shops
  where id = v_user.shop_id and not is_deleted and archived_at is null;
  -- H-7 M-4: bounded, not unconditional.
  if v_account is null then
    return h7_shop_billing_bootstrap_allowed(v_user.shop_id, p_now);
  end if;
  v_tier := coalesce(b4_effective_tier(v_account, p_now), 'free');
  select max_active_non_owner_staff_per_shop into v_limit from plan_offerings
  where tier = coalesce(v_tier,'free') and billing_cycle = 'monthly';
  if v_limit is null then return true; end if;
  select ordinal into v_ordinal from (
    select u.id, row_number() over (order by u.created_at, u.id) ordinal
    from users u join roles r on r.id = u.role_id
    where u.shop_id = v_user.shop_id and u.is_active and not u.is_deleted and r.name <> 'owner'
  ) ranked where id = p_app_user_id;
  return coalesce(v_ordinal <= v_limit, false);
end
$fn$;

create or replace function b4_shop_write_permitted(
  p_shop_id uuid, p_now timestamptz default now()
) returns boolean language plpgsql stable security definer
set search_path = public, pg_temp as $fn$
declare v_account uuid; v_tier text := 'free'; v_limit integer; v_ordinal integer;
begin
  select billing_account_id into v_account from shops
  where id = p_shop_id and is_deleted = false and archived_at is null;
  -- H-7 M-4: bounded, and an archived shop answers false here instead of
  -- falling through the same `return true` a bootstrapping shop used.
  if v_account is null then
    return h7_shop_billing_bootstrap_allowed(p_shop_id, p_now);
  end if;
  v_tier := coalesce(b4_effective_tier(v_account, p_now), 'free');
  select max_active_shops into v_limit from plan_offerings
    where tier = coalesce(v_tier,'free') and billing_cycle = 'monthly';
  if v_limit is null then return true; end if;
  select ordinal into v_ordinal from (
    select id, row_number() over (order by created_at, id) ordinal from shops
    where billing_account_id = v_account and is_deleted = false and archived_at is null
  ) ranked where id = p_shop_id;
  return coalesce(v_ordinal <= v_limit, false);
end
$fn$;

-- ── The premium feature gate ──────────────────────────────────────────────
--
-- ROUND 33, and the sixth place. One message before this review landed I
-- wrote that "every capacity decision Codex and I have been able to enumerate
-- now passes through one rule". That was wrong again:
-- b4_user_has_premium carried a sixth copy of the status/date logic, and
-- sync_row_permitted (20260831000000:430) and the three b4_premium_* RLS
-- policies (:555-557) all admit premium writes through it. The reviewer
-- reproduced a 100-paisa rent expense being applied and persisted through the
-- real Edge push, on a snapshot whose effective tier was already 'free', with
-- a Free/expired control rejecting the identical expense.
--
-- It is an existing omission rather than something the earlier replacements
-- introduced -- the reviewer said so explicitly -- but it is the same defect
-- class, so it goes in the same migration.
--
-- Reproduced from 20260831000000:261-273 with the CASE replaced by the one
-- rule. The shape is preserved exactly: a trial grants premium whatever the
-- tier, a paid plan grants it while its dates hold, and a user whose shop has
-- no billing account or no snapshot still answers false through the same
-- coalesce rather than through a new branch.
--
-- b4_effective_tier answers 'ultra' for a live trial and the snapshot's tier
-- for a live paid plan, so `<> 'free'` is the same predicate the CASE spelled
-- out -- and it is now the only predicate.

create or replace function b4_user_has_premium(p_app_user_id uuid,p_now timestamptz default now())
returns boolean language sql stable security definer set search_path=public,pg_temp as $fn$
  select coalesce((
    select b4_effective_tier(s.billing_account_id,p_now)<>'free'
    from users u join shops s on s.id=u.shop_id
    where u.id=p_app_user_id and s.billing_account_id is not null
  ),false)
$fn$;
