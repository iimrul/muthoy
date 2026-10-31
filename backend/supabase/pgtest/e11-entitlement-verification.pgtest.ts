import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createBareHarness,
  createHarness,
  migrationFiles,
  migrationSql,
  MANAGER_A,
  OWNER_A,
  ROLE_STAFF_A,
  seedShops,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  type Harness,
} from './harness';

/**
 * E11. b4_refresh_entitlement_snapshot is the function billing-status calls on
 * every poll (functions/sync/billing.ts:60), and verified_at is the device's
 * 30-day offline verification ceiling (apps/mobile/domain/entitlements.ts:143).
 * Migration 37 makes the stamp conditional on the snapshot's live premium claim
 * being backed by authoritative evidence.
 *
 * The suite is built so that reverting migration 37 -- restoring the
 * unconditional `update ... set verified_at=now()` from 20260831000000:620 --
 * makes the refusal tests fail. That is not asserted but executed: the last
 * describe rolls the function back for real inside its own harness.
 */

const B4_MIGRATION = '20260831000000_b4_commercial_platform.sql';
const E11_MIGRATION = '20261031000000_e11_entitlement_verification.sql';

interface Snapshot {
  tier: string;
  status: string;
  trial_ends_at: string | null;
  paid_through: string | null;
  grace_ends_at: string | null;
  verified_at: string;
  version: number;
}

/** The SQLSTATE of a refusal, or null when the call succeeded. */
async function refusal(
  h: Harness,
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string | null; message: string } | null> {
  try {
    await h.one(sql, params);
    return null;
  } catch (error) {
    const code =
      error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null;
    return { code, message: error instanceof Error ? error.message : String(error) };
  }
}

function readSnapshot(h: Harness, accountId: string): Promise<Snapshot> {
  return h.one<Snapshot>(
    `select tier,status,trial_ends_at::text as trial_ends_at,paid_through::text as paid_through,
       grace_ends_at::text as grace_ends_at,verified_at::text as verified_at,version::integer as version
     from entitlement_snapshots where billing_account_id=$1::uuid`,
    [accountId],
  );
}

/**
 * Puts the snapshot into a chosen state, writing the table directly -- which is
 * how a diverged snapshot would arise. The point of the guard is that it must
 * not take the row's own word for what it is entitled to.
 */
function setSnapshot(
  h: Harness,
  accountId: string,
  fields: Record<string, string>,
): Promise<unknown> {
  const assignments = Object.entries(fields).map(([column, value]) => `${column}=${value}`).join(',');
  return h.one(
    `update entitlement_snapshots set ${assignments}
     where billing_account_id=$1::uuid returning billing_account_id`,
    [accountId],
  );
}

const PAID: Record<string, string> = {
  tier: `'pro'`,
  status: `'active'`,
  trial_ends_at: 'null',
  paid_through: `now()+interval '30 days'`,
  grace_ends_at: `now()+interval '37 days'`,
};

const REFRESH = 'select b4_refresh_entitlement_snapshot($1::uuid)';

describe('E11 verify-then-stamp', () => {
  let h: Harness;
  let accountId: string;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    accountId = (await h.one<{ id: string }>(
      'select id::text as id from billing_accounts where principal_owner_user_id=$1::uuid',
      [OWNER_A],
    )).id;
  }, 60_000);
  afterAll(async () => h.close());

  it('stamps the live trial, whose evidence is the immutable grant timestamp', async () => {
    const before = await readSnapshot(h, accountId);
    expect(before.status).toBe('trialing');
    expect(await h.one<{ tier: string }>('select b4_effective_tier($1::uuid) as tier', [accountId]))
      .toEqual({ tier: 'ultra' });

    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
    const after = await readSnapshot(h, accountId);
    expect(after.version).toBe(before.version + 1);
    expect(Date.parse(after.verified_at)).toBeGreaterThanOrEqual(Date.parse(before.verified_at));
    // Nothing but the attestation moved: the function writes no entitlement.
    expect({ ...after, verified_at: '', version: 0 }).toEqual({ ...before, verified_at: '', version: 0 });
  });

  it('refuses a trial claiming more days than were granted', async () => {
    await setSnapshot(h, accountId, {
      trial_ends_at:
        `(select launch_trial_granted_at+interval '400 days' from billing_accounts where id=$1::uuid)`,
    });
    const denied = await refusal(h, REFRESH, [accountId]);
    expect(denied?.code).toBe('MU037');
    expect(denied?.message).toMatch(/granted trial/);

    // Back to the granted figure and it verifies again, so the refusal was
    // about the extra days rather than about trials in general.
    await setSnapshot(h, accountId, {
      trial_ends_at:
        `(select launch_trial_granted_at+interval '14 days' from billing_accounts where id=$1::uuid)`,
    });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
  });

  it('refuses a paid claim with no subscription behind it', async () => {
    // THE REGRESSION TEST. Under 20260831000000:620 this call succeeds and
    // hands the device 30 more days of premium on an unbacked snapshot.
    await setSnapshot(h, accountId, PAID);
    expect(await h.all('select 1 from billing_subscriptions where billing_account_id=$1::uuid', [accountId]))
      .toHaveLength(0);
    // The snapshot claims pro with dates a month out, and b4_effective_tier
    // answers free anyway -- because of the missing evidence, not the dates.
    // Both halves matter: the dates assertion is what stops this passing for
    // the wrong reason once the tier is free.
    expect(await h.one<{ tier: string; future: boolean }>(`
      select b4_effective_tier($1::uuid) as tier,
        (paid_through>now() and grace_ends_at>now()) as future
      from entitlement_snapshots where billing_account_id=$1::uuid
    `, [accountId])).toEqual({ tier: 'free', future: true });

    const denied = await refusal(h, REFRESH, [accountId]);
    expect(denied?.code).toBe('MU037');
    expect(denied?.message).toMatch(/verified payment/);

    // And the refusal is a refusal: verified_at did not move.
    const after = await readSnapshot(h, accountId);
    expect(await refusal(h, REFRESH, [accountId])).not.toBeNull();
    expect((await readSnapshot(h, accountId)).verified_at).toBe(after.verified_at);
  });

  it('refuses an unbacked claim whose dates are already PAST by this clock', async () => {
    // ROUND 28, FINDING 2, reproduced as a regression test.
    //
    // The first version of this gate asked b4_effective_tier(account, now())
    // and stamped without checking evidence when the answer was 'free'. These
    // dates are past by the SERVER's clock, so that version stamped here. A
    // device whose own clock sat before paid_through then read the fresh stamp
    // and moved from verification_stale (free) to paid -- premium handed over
    // with no payment evidence, by the gate meant to prevent exactly that.
    //
    // A server cannot know the device's clock, so the gate no longer consults
    // its own.
    await setSnapshot(h, accountId, {
      ...PAID,
      paid_through: `now()-interval '10 days'`,
      grace_ends_at: `now()-interval '3 days'`,
    });
    expect(await h.one<{ tier: string }>('select b4_effective_tier($1::uuid) as tier', [accountId]))
      .toEqual({ tier: 'free' });
    const denied = await refusal(h, REFRESH, [accountId]);
    expect(denied?.code).toBe('MU037');
    expect(denied?.message).toMatch(/verified payment/);
  });

  it('stamps a snapshot that cannot grant to ANY client, whatever its clock', async () => {
    // The other side of the same rule, and the control that keeps the gate
    // from being "always refuse". `expired` carries no granting branch in
    // resolveEntitlement, and tier free with no dates grants nothing either,
    // so there is no attestation to justify.
    await setSnapshot(h, accountId, {
      tier: `'free'`, status: `'expired'`, trial_ends_at: 'null',
      paid_through: 'null', grace_ends_at: 'null',
    });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();

    // Still true when the dates are in the FUTURE: `expired` cannot grant.
    await setSnapshot(h, accountId, {
      tier: `'free'`, status: `'expired'`,
      paid_through: `now()+interval '400 days'`, grace_ends_at: `now()+interval '400 days'`,
    });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
  });

  it('refuses a trial whose grant timestamp is missing entirely', async () => {
    // Round 28, LOW: no fixture drove the NULL arm of the trial guard, and
    // removing that arm turned MU037 into success.
    await setSnapshot(h, accountId, {
      tier: `'free'`, status: `'trialing'`, trial_ends_at: `now()+interval '7 days'`,
      paid_through: 'null', grace_ends_at: 'null',
    });
    await h.one(
      'update billing_accounts set launch_trial_granted_at=null where id=$1::uuid returning id',
      [accountId],
    );
    const denied = await refusal(h, REFRESH, [accountId]);
    expect(denied?.code).toBe('MU037');
    expect(denied?.message).toMatch(/granted trial/);

    // Restored, and it verifies again -- so the refusal was the NULL, not the
    // trial shape.
    await h.one(
      `update billing_accounts set launch_trial_granted_at=now()-interval '1 day'
       where id=$1::uuid returning id`,
      [accountId],
    );
    await setSnapshot(h, accountId, {
      trial_ends_at:
        `(select launch_trial_granted_at+interval '14 days' from billing_accounts where id=$1::uuid)`,
    });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
  });

  it('refuses a snapshot that is missing entirely, keeping MU036', async () => {
    const orphan = '9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e';
    expect((await refusal(h, REFRESH, [orphan]))?.code).toBe('MU036');
  });

  /**
   * Each of the next four isolates ONE clause of the gate's precondition.
   *
   * A first mutation run caught 12 of 16 and the four survivors were all this
   * shape: the gate is STRICTER than it needs to be and nothing pinned the
   * necessary looseness. Over-strictness is not harmless -- a refusal now also
   * skips b4_reconcile_plan_limits, so an account that ought to verify would
   * have its limits frozen instead. These snapshots are superficially paid but
   * grant nothing to any client, by resolveEntitlement's own branches, so each
   * must STAMP.
   */
  it('stamps tier free with a granting status and future dates', async () => {
    // resolveEntitlement short-circuits on tier 'free' for every non-trial
    // branch, so this grants nothing however favourable the dates look.
    await setSnapshot(h, accountId, {
      tier: `'free'`, status: `'active'`, trial_ends_at: 'null',
      paid_through: `now()+interval '400 days'`, grace_ends_at: `now()+interval '407 days'`,
    });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
  });

  it('stamps a paid tier whose status carries no granting branch', async () => {
    // `expired` appears in no branch of resolveEntitlement, so a pro snapshot
    // marked expired grants nothing even with dates far in the future.
    await setSnapshot(h, accountId, {
      tier: `'pro'`, status: `'expired'`, trial_ends_at: 'null',
      paid_through: `now()+interval '400 days'`, grace_ends_at: `now()+interval '407 days'`,
    });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
  });

  it('stamps a granting status that carries no dates at all', async () => {
    // Every date branch requires a non-null date, so this grants nothing.
    await setSnapshot(h, accountId, {
      tier: `'pro'`, status: `'active'`, trial_ends_at: 'null',
      paid_through: 'null', grace_ends_at: 'null',
    });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
  });

  it('lets the TABLE reject a trialing snapshot with no trial end, and pins that', async () => {
    // The gate's `trial_ends_at is null` arm survived mutation because it is
    // unreachable: entitlement_snapshots carries
    //   check ((status='trialing' and trial_ends_at is not null) or status<>'trialing')
    // so the row cannot exist. The arm stays anyway -- without it a NULL would
    // make `trial_ends_at > granted + 14 days` evaluate to NULL, which is not
    // a refusal, and the claim would be stamped. This test pins the constraint
    // that makes the arm unreachable, so dropping the constraint fails here
    // rather than silently re-arming the hole.
    const denied = await refusal(
      h,
      `update entitlement_snapshots set status='trialing',trial_ends_at=null
       where billing_account_id=$1::uuid returning billing_account_id`,
      [accountId],
    );
    expect(denied?.code).toBe('23514');

    expect(await h.one<{ present: boolean }>(`
      select exists(
        select 1 from pg_constraint
        where conrelid='public.entitlement_snapshots'::regclass and contype='c'
          and pg_get_constraintdef(oid) ilike '%trialing%trial_ends_at IS NOT NULL%'
      ) as present
    `)).toEqual({ present: true });
  });

  describe('against a real settlement', () => {
    const ORDER = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';

    beforeAll(async () => {
      await h.one(
        `insert into payment_orders(
           id,billing_account_id,requested_by_principal_user_id,client_request_id,tier,billing_cycle,
           amount_paisa,provider_transaction_id,expires_at
         ) values($1::uuid,$2::uuid,$3::uuid,gen_random_uuid(),'pro','monthly',39900,'tx-e11',
           now()+interval '1 hour') returning id`,
        [ORDER, accountId, OWNER_A],
      );
      await h.one(
        `select b4_apply_verified_payment($1::uuid,'tx-e11','val-e11','evt-e11','{}'::jsonb)`,
        [ORDER],
      );
    }, 30_000);

    it('is a no-op on what the payment path actually wrote', async () => {
      // The control that catches a wrong evidence rule: whatever
      // b4_apply_verified_payment produces must verify unchanged. If this
      // fails, the guard is rejecting legitimate paid state -- which would be
      // worse than the defect, because it takes access from someone who paid.
      const before = await readSnapshot(h, accountId);
      expect(before).toMatchObject({ tier: 'pro', status: 'active' });
      expect(before.paid_through).not.toBeNull();

      expect(await refusal(h, REFRESH, [accountId])).toBeNull();
      const after = await readSnapshot(h, accountId);
      expect({ ...after, verified_at: '', version: 0 }).toEqual({ ...before, verified_at: '', version: 0 });
      expect(after.version).toBe(before.version + 1);
    });

    it('verifies a snapshot claiming less than the subscription grants', async () => {
      // One-directional. Falling behind is safe; refusing it would take access
      // from someone who paid.
      await setSnapshot(h, accountId, {
        paid_through:
          `(select paid_through-interval '5 days' from billing_subscriptions where billing_account_id=$1::uuid)`,
        grace_ends_at:
          `(select grace_ends_at-interval '5 days' from billing_subscriptions where billing_account_id=$1::uuid)`,
      });
      expect(await refusal(h, REFRESH, [accountId])).toBeNull();
    });

    it('refuses a snapshot claiming one second more than the subscription grants', async () => {
      await setSnapshot(h, accountId, {
        paid_through:
          `(select paid_through+interval '1 second' from billing_subscriptions where billing_account_id=$1::uuid)`,
      });
      expect((await refusal(h, REFRESH, [accountId]))?.code).toBe('MU037');
    });

    it('refuses a snapshot claiming a tier the subscription does not carry', async () => {
      await setSnapshot(h, accountId, {
        tier: `'ultra'`,
        paid_through:
          `(select paid_through from billing_subscriptions where billing_account_id=$1::uuid)`,
        grace_ends_at:
          `(select grace_ends_at from billing_subscriptions where billing_account_id=$1::uuid)`,
      });
      expect(await h.one<{ tier: string }>(
        'select tier from billing_subscriptions where billing_account_id=$1::uuid', [accountId],
      )).toEqual({ tier: 'pro' });
      expect((await refusal(h, REFRESH, [accountId]))?.code).toBe('MU037');
    });

    it('refuses a snapshot whose status the subscription no longer agrees with', async () => {
      // ROUND 28, FINDING 3, reproduced. Dates and tier matched, so a
      // subscription marked `canceled` with a future grace window vouched for
      // a snapshot still marked `active`. Comparing dates and tier while
      // ignoring status lets a revoked subscription back a live-looking claim,
      // which is the revocation path this guard exists for.
      await setSnapshot(h, accountId, {
        tier: `'pro'`, status: `'active'`,
        paid_through:
          `(select paid_through from billing_subscriptions where billing_account_id=$1::uuid)`,
        grace_ends_at:
          `(select grace_ends_at from billing_subscriptions where billing_account_id=$1::uuid)`,
      });
      // Matching statuses: verifies.
      expect(await refusal(h, REFRESH, [accountId])).toBeNull();

      // Now revoke the subscription, leaving every date and the tier alone.
      await h.one(
        `update billing_subscriptions set status='canceled',canceled_at=now()
         where billing_account_id=$1::uuid returning id`,
        [accountId],
      );
      expect((await refusal(h, REFRESH, [accountId]))?.code).toBe('MU037');

      // And moving the SNAPSHOT to agree restores verification -- which is the
      // coupling: a revocation path must move both.
      await setSnapshot(h, accountId, { status: `'canceled'` });
      expect(await refusal(h, REFRESH, [accountId])).toBeNull();
      await h.one(
        `update billing_subscriptions set status='active',canceled_at=null
         where billing_account_id=$1::uuid returning id`,
        [accountId],
      );
      await setSnapshot(h, accountId, { status: `'active'` });
    });

    it('refuses a grace window the subscription does not grant', async () => {
      // The subscription moves to `grace` too, so status is NOT the
      // difference -- otherwise this would pass for the round-28 reason
      // instead of the one it is named for.
      await h.one(
        `update billing_subscriptions set status='grace' where billing_account_id=$1::uuid returning id`,
        [accountId],
      );
      await setSnapshot(h, accountId, {
        tier: `'pro'`,
        status: `'grace'`,
        paid_through: `now()-interval '1 day'`,
        grace_ends_at:
          `(select grace_ends_at from billing_subscriptions where billing_account_id=$1::uuid)`,
      });
      // Identical grace window: verifies.
      expect(await refusal(h, REFRESH, [accountId])).toBeNull();

      // Ninety days more than the subscription grants: refused, and the window
      // is the only thing that changed.
      await setSnapshot(h, accountId, {
        grace_ends_at:
          `(select grace_ends_at+interval '90 days' from billing_subscriptions where billing_account_id=$1::uuid)`,
      });
      expect((await refusal(h, REFRESH, [accountId]))?.code).toBe('MU037');
    });
  });

  it('keeps execute granted to service_role and withheld elsewhere', async () => {
    // The capability is NOT revoked, and that is the correct outcome:
    // billing-status runs as the service role and needs this call. What
    // changed is what sits behind it.
    expect(await h.one<{ service: boolean; anon: boolean; authenticated: boolean }>(`
      select
        has_function_privilege('service_role','b4_refresh_entitlement_snapshot(uuid)','execute') as service,
        has_function_privilege('anon','b4_refresh_entitlement_snapshot(uuid)','execute') as anon,
        has_function_privilege('authenticated','b4_refresh_entitlement_snapshot(uuid)','execute')
          as authenticated
    `)).toEqual({ service: true, anon: false, authenticated: false });
  });

  it('pins the hardened search_path and SECURITY DEFINER', async () => {
    const fn = await h.one<{ config: string[] | null; definer: boolean }>(`
      select p.proconfig as config,p.prosecdef as definer
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='b4_refresh_entitlement_snapshot'
    `);
    expect(fn.definer).toBe(true);
    expect(fn.config?.join('|')).toMatch(/^search_path=public,\s*pg_temp$/);
  });
});

/**
 * ROUNDS 29 AND 30. The guard belongs where the tier is DECIDED, and an
 * unbacked claim has to NARROW rather than freeze.
 *
 * Round 29: the round-28 fix guarded the stamp and had the edge function skip
 * reconciliation itself. That closed the instance and missed the class --
 * b4_reconcile_plan_limits has five callers, and multiShop.ts:158 calls it on
 * an ordinary shop rename, which widened a Pro account to 6 shops / 7 staff
 * through a call that had already been refused.
 *
 * Round 30: moving the guard into reconciliation was still wrong, because the
 * guard RETURNED. Three operations EXPAND capacity and then call
 * reconciliation to tidy up -- creating a shop, restoring an archived one,
 * reactivating staff -- and for those, returning without applying PRESERVES
 * the expansion. A refusal after the write is not enforcement.
 *
 * So b4_effective_tier now answers 'free' for an unbacked claim, which refuses
 * shop creation BEFORE it writes, and reconciliation derives its tier from
 * b4_effective_tier instead of a fifth copy of the CASE, which means an
 * unbacked claim now reconciles AGAINST free and undoes the expansion it used
 * to keep.
 *
 * The observation used here is staff suspension: the seeded SHOP_A has two
 * non-owner staff, so a free limit of one suspends exactly one of them and an
 * Ultra limit of null suspends none.
 */
describe('an unbacked claim is worth nothing', () => {
  let h: Harness;
  let accountId: string;

  const suspended = () => h.one<{ n: number }>(
    `select count(*)::integer as n from users u join shops s on s.id=u.shop_id
       join roles r on r.id=u.role_id
     where s.billing_account_id=$1::uuid and r.name<>'owner' and u.is_deleted=false
       and u.plan_suspension_reason='plan_staff_limit'`,
    [accountId],
  );
  const reconcile = () => h.one('select b4_reconcile_plan_limits($1::uuid)', [accountId]);
  const tier = async () => (await h.one<{ tier: string }>(
    'select b4_effective_tier($1::uuid) as tier', [accountId],
  )).tier;
  const backed = async () => (await h.one<{ backed: boolean }>(
    'select b4_entitlement_claim_backed($1::uuid) as backed', [accountId],
  )).backed;
  const divergeToUltra = () => h.one(
    `update entitlement_snapshots set tier='ultra',status='active',trial_ends_at=null,
       paid_through=now()+interval '30 days',grace_ends_at=now()+interval '37 days'
     where billing_account_id=$1::uuid returning billing_account_id`,
    [accountId],
  );

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    accountId = (await h.one<{ id: string }>(
      'select id::text as id from billing_accounts where principal_owner_user_id=$1::uuid',
      [OWNER_A],
    )).id;
  }, 60_000);
  afterAll(async () => h?.close());

  it('reports the real tier for a BACKED claim, and suspends nobody', async () => {
    // The control, and the thing that would fail if the guard were simply
    // "always free": the seeded account's live trial is backed by the grant
    // timestamp, and a trial is Ultra-equivalent.
    expect(await backed()).toBe(true);
    expect(await tier()).toBe('ultra');
    await reconcile();
    expect(await suspended()).toEqual({ n: 0 });
  });

  it('reports free for an UNBACKED claim, whatever the snapshot says', async () => {
    await divergeToUltra();
    expect(await backed()).toBe(false);
    // The snapshot says ultra with dates a month out. The tier says free,
    // because nothing backs it.
    expect(await tier()).toBe('free');
  });

  it('NARROWS an unbacked claim rather than preserving the expansion', async () => {
    // Round 30's point. The previous version returned here and the two staff
    // both stayed unsuspended -- which is what let a restored shop and a
    // reactivated staff member keep capacity they were refused.
    expect(await suspended()).toEqual({ n: 0 });
    await reconcile();
    expect(await suspended()).toEqual({ n: 1 });
  });

  it('refuses to CREATE a shop on an unbacked claim, before the write', async () => {
    // b4_create_owned_shop derives its allowance from b4_effective_tier
    // (20260831000000:903), so failing closed there refuses the expansion
    // rather than undoing it. Free allows one shop and the account has one.
    const denied = await refusal(
      h,
      `select b4_create_owned_shop($1::uuid,'Second Shop','Second Shop','+8801700000009')`,
      [OWNER_A],
    );
    expect(denied).not.toBeNull();
    expect(await h.one<{ n: number }>(
      `select count(*)::integer as n from shops
       where billing_account_id=$1::uuid and is_deleted=false`,
      [accountId],
    )).toEqual({ n: 1 });
  });

  it('refuses staff ADMISSION on an unbacked claim, on any shop', async () => {
    // ROUND 31, reproduced at the boundary rather than through one route.
    //
    // The reviewer executed the real staff-reactivate handler on a SECONDARY
    // shop: two staff enabled, none suspended, within_limit true, and it
    // stayed that way -- because the reconciliation trigger
    // (20260831000000:849-857) only fires when the shop's owner_id equals the
    // billing account's principal_owner_user_id, and a secondary shop has its
    // own Owner user. So nothing undid it, and the request itself needed no
    // service-role key.
    //
    // b4_staff_row_within_limit is the capacity check that reactivation
    // (20260909000000:107) and ordinary new-staff sync
    // (20260831000000:434) both consult. Asking it directly tests every route
    // at once and does not depend on a trigger firing.
    const admits = async () => (await h.one<{ ok: boolean }>(`
      select b4_staff_row_within_limit(jsonb_build_object(
        'id',$1::text,'shop_id',$2::text,'role_id',$3::text,'is_active',true)) as ok
    `, [MANAGER_A, SHOP_A, ROLE_STAFF_A])).ok;

    // One active non-owner staff member, one inactive candidate -- the
    // reviewer's shape.
    await h.one(
      `update users set is_active=false where id=$1::uuid returning id`, [MANAGER_A],
    );
    await h.one(
      `update users set is_active=true,plan_suspended_at=null,plan_suspension_reason=null
       where id=$1::uuid returning id`, [STAFF_A],
    );

    // Unbacked: free allows one, and one is already active, so admission is
    // refused BEFORE any write.
    expect(await backed()).toBe(false);
    expect(await admits()).toBe(false);

    // And the refusal is about the evidence, not about the shape: give the
    // claim its subscription and the same call admits.
    await h.one(
      `insert into billing_subscriptions(
         billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,provider
       ) select $1::uuid,'ultra','monthly','active',now(),paid_through,grace_ends_at,'sslcommerz'
       from entitlement_snapshots where billing_account_id=$1::uuid returning id`,
      [accountId],
    );
    expect(await backed()).toBe(true);
    expect(await admits()).toBe(true);

    // Leave the fixture as the next test expects it.
    await h.one('delete from billing_subscriptions where billing_account_id=$1::uuid returning id',
      [accountId]);
    await h.one(`update users set is_active=true where id=$1::uuid returning id`, [MANAGER_A]);
  });

  it('refuses the two H-7 WRITE gates on an unbacked claim', async () => {
    // ROUND 32. I had argued these two answer "may this existing user write?"
    // rather than "may this capacity be granted?", so consolidating them was
    // tidiness. The reviewer executed it: with the snapshot diverged to Ultra
    // and the effective tier therefore free, both gates still answered TRUE
    // and the second staff member synced a customer. A gate that decides
    // whether a write lands IS a capacity decision, because the capacity is
    // the write.
    //
    // SHOP_A has two non-owner staff, so a free limit of one admits the first
    // by creation order and refuses the second.
    expect(await backed()).toBe(false);
    expect(await tier()).toBe('free');

    const staffGate = async (id: string) => (await h.one<{ ok: boolean }>(
      'select b4_user_within_current_staff_limit($1::uuid) as ok', [id],
    )).ok;
    const ordered = await h.all<{ id: string }>(
      `select u.id::text as id from users u join roles r on r.id=u.role_id
       where u.shop_id=$1::uuid and u.is_active and not u.is_deleted and r.name<>'owner'
       order by u.created_at,u.id`,
      [SHOP_A],
    );
    expect(ordered.length).toBeGreaterThanOrEqual(2);
    expect(await staffGate(ordered[0]!.id)).toBe(true);
    expect(await staffGate(ordered[1]!.id)).toBe(false);

    // The owner is never gated by plan capacity.
    expect(await staffGate(OWNER_A)).toBe(true);

    // The shop gate needs TWO shops to say anything: with one, free and ultra
    // both answer true and the assertion would not distinguish the fix from
    // the defect. So add a second shop directly -- creation itself is now
    // gated, which is the point of the earlier test.
    const SHOP_SECOND = '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c';
    await h.one(
      `insert into shops(id,name,phone,owner_id,billing_account_id,created_at,updated_at)
       select $1::uuid,'Second','+8801700000777',owner_id,billing_account_id,now(),now()
       from shops where id=$2::uuid returning id`,
      [SHOP_SECOND, SHOP_A],
    );

    const shopGate = async (id: string) => (await h.one<{ ok: boolean }>(
      'select b4_shop_write_permitted($1::uuid) as ok', [id],
    )).ok;
    // Free allows one shop, by creation order: the first still writes, the
    // second does not. Under the old inline CASE the snapshot said ultra, the
    // limit was null, and BOTH answered true.
    expect(await shopGate(SHOP_A)).toBe(true);
    expect(await shopGate(SHOP_SECOND)).toBe(false);

    // Give the claim its evidence and the second shop writes again, so the
    // refusal tracked the evidence and not the shop count.
    await h.one(
      `insert into billing_subscriptions(
         billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,provider
       ) select $1::uuid,'ultra','monthly','active',now(),paid_through,grace_ends_at,'sslcommerz'
       from entitlement_snapshots where billing_account_id=$1::uuid returning id`,
      [accountId],
    );
    expect(await shopGate(SHOP_SECOND)).toBe(true);

    // Leave the fixture as the next test expects it.
    await h.one('delete from billing_subscriptions where billing_account_id=$1::uuid returning id',
      [accountId]);
    await h.one('delete from shops where id=$1::uuid returning id', [SHOP_SECOND]);
  });

  it('refuses the premium FEATURE gate on an unbacked claim', async () => {
    // ROUND 33. b4_user_has_premium carried a sixth copy of the rule, and
    // sync_row_permitted (20260831000000:430) plus the three b4_premium_* RLS
    // policies (:555-557) all admit premium writes through it. The reviewer
    // pushed a 100-paisa rent expense through the real Edge path on a snapshot
    // whose effective tier was already 'free', and it persisted.
    expect(await backed()).toBe(false);
    expect(await tier()).toBe('free');

    const hasPremium = async (id: string) => (await h.one<{ ok: boolean }>(
      'select b4_user_has_premium($1::uuid) as ok', [id],
    )).ok;
    expect(await hasPremium(OWNER_A)).toBe(false);
    expect(await hasPremium(STAFF_A)).toBe(false);

    // The control: supply the evidence and premium comes back. Without this
    // the assertion above would also pass if the gate simply always refused.
    await h.one(
      `insert into billing_subscriptions(
         billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,provider
       ) select $1::uuid,'ultra','monthly','active',now(),paid_through,grace_ends_at,'sslcommerz'
       from entitlement_snapshots where billing_account_id=$1::uuid returning id`,
      [accountId],
    );
    expect(await hasPremium(OWNER_A)).toBe(true);
    expect(await hasPremium(STAFF_A)).toBe(true);

    // And a user whose shop has no billing account still answers false
    // through the same coalesce, not through a new branch.
    //
    // ROUND 34, LOW: my first version of this passed an unseeded UUID, so it
    // tested "a nonexistent user answers false" while claiming to test "a user
    // whose shop has no billing account". Those are different rows and
    // different branches. The account is detached from SHOP_B's row here, so
    // the user exists and the shop exists and only the account is absent.
    const detached = await h.one<{ id: string; shop: string }>(
      `select u.id::text as id,u.shop_id::text as shop from users u
       join shops s on s.id=u.shop_id
       where s.id=$1::uuid and u.is_active and not u.is_deleted limit 1`,
      [SHOP_B],
    );
    const before = await h.one<{ account: string | null }>(
      'select billing_account_id::text as account from shops where id=$1::uuid', [detached.shop],
    );
    await h.one(
      'update shops set billing_account_id=null where id=$1::uuid returning id', [detached.shop],
    );
    expect(await h.one<{ ok: boolean; exists: boolean }>(`
      select b4_user_has_premium($1::uuid) as ok,
        exists(select 1 from users where id=$1::uuid) as exists
    `, [detached.id])).toEqual({ ok: false, exists: true });
    await h.one(
      'update shops set billing_account_id=$2::uuid where id=$1::uuid returning id',
      [detached.shop, before.account],
    );

    await h.one('delete from billing_subscriptions where billing_account_id=$1::uuid returning id',
      [accountId]);
  });

  it('restores the real tier and releases the staff once evidence exists', async () => {
    // Supply the missing subscription and nothing else. The guard tracks the
    // evidence rather than latching, and the suspension is lifted.
    await h.one(
      `insert into billing_subscriptions(
         billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,provider
       ) select $1::uuid,'ultra','monthly','active',now(),paid_through,grace_ends_at,'sslcommerz'
       from entitlement_snapshots where billing_account_id=$1::uuid returning id`,
      [accountId],
    );
    expect(await backed()).toBe(true);
    expect(await tier()).toBe('ultra');
    await reconcile();
    expect(await suspended()).toEqual({ n: 0 });
  });
});

/**
 * The property the round-28 fix actually introduced, tested directly rather
 * than inferred from the absence of now() in the source.
 *
 * A server cannot know the device's clock. So for a FIXED snapshot and a FIXED
 * subscription, this gate must give the same answer whatever the database
 * clock says -- otherwise the stamp it grants depends on a clock the consumer
 * does not share, which is how the first version handed premium to a device
 * sitting three weeks in the past.
 *
 * pg_catalog.now() can be replaced, which fixes the clock; the technique is
 * the one e4b-publication.pgtest.ts uses.
 */
describe('the gate gives the same answer under any clock', () => {
  let h: Harness;
  let accountId: string;
  const ORDER = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';

  const setClock = (iso: string) => h.exec(`
    create or replace function pg_catalog.now() returns timestamptz
      language sql stable as $$ select '${iso}'::timestamptz $$;`);

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    accountId = (await h.one<{ id: string }>(
      'select id::text as id from billing_accounts where principal_owner_user_id=$1::uuid',
      [OWNER_A],
    )).id;
    // Settle a real payment FIRST, on the real clock, so the subscription
    // carries dates that were not computed under an override.
    await h.one(
      `insert into payment_orders(
         id,billing_account_id,requested_by_principal_user_id,client_request_id,tier,billing_cycle,
         amount_paisa,provider_transaction_id,expires_at
       ) values($1::uuid,$2::uuid,$3::uuid,gen_random_uuid(),'pro','monthly',39900,'tx-clock',
         now()+interval '1 hour') returning id`,
      [ORDER, accountId, OWNER_A],
    );
    await h.one(
      `select b4_apply_verified_payment($1::uuid,'tx-clock','val-clock','evt-clock','{}'::jsonb)`,
      [ORDER],
    );
  }, 120_000);
  afterAll(async () => h?.close());

  // One clock long before the subscription starts, one long after it ends. At
  // the first, the snapshot's dates are in the future; at the second they are
  // all in the past, which is where the old b4_effective_tier gate said 'free'
  // and stamped without checking anything.
  const CLOCKS = ['2020-01-01T00:00:00+00:00', '2099-01-01T00:00:00+00:00'] as const;

  it('agrees the override takes effect, so the rest is not about today', async () => {
    for (const clock of CLOCKS) {
      await setClock(clock);
      expect((await h.one<{ year: number }>(
        'select extract(year from now())::integer as year',
      )).year).toBe(Number(clock.slice(0, 4)));
    }
  });

  it('verifies a BACKED claim at both clocks', async () => {
    for (const clock of CLOCKS) {
      await setClock(clock);
      expect(await refusal(h, REFRESH, [accountId]), `backed claim at ${clock}`).toBeNull();
    }
  });

  it('refuses an UNBACKED claim at both clocks, including the one that calls it free', async () => {
    // Remove the evidence and leave the claim standing.
    await h.one('delete from billing_subscriptions where billing_account_id=$1::uuid returning id',
      [accountId]);
    for (const clock of CLOCKS) {
      await setClock(clock);
      expect((await refusal(h, REFRESH, [accountId]))?.code, `unbacked claim at ${clock}`)
        .toBe('MU037');
    }

    // And the two clocks really did straddle the snapshot's dates, so the loop
    // above spanned both sides of the old gate rather than one.
    //
    // The witness is the OLD gate's expression, written out here rather than
    // taken from b4_effective_tier -- which now folds in the backing check and
    // would answer 'free' at both clocks, making this control vacuous. The
    // question it has to answer is what the pre-E11 rule WOULD have said.
    const oldGate = async (clock: string) => {
      await setClock(clock);
      return (await h.one<{ tier: string }>(`
        select case
          when status='trialing' and trial_ends_at>now() then 'ultra'
          when status in ('active','canceled') and paid_through>now() then tier
          when status in ('active','past_due','grace') and grace_ends_at>now() then tier
          else 'free' end as tier
        from entitlement_snapshots where billing_account_id=$1::uuid
      `, [accountId])).tier;
    };
    expect([await oldGate(CLOCKS[0]), await oldGate(CLOCKS[1])]).toEqual(['pro', 'free']);
  });
});

/**
 * What migration 37 actually depends on, measured, because the E4-H hosted
 * package has to state the apply order and "it is 37th in the directory" is not
 * a dependency. Migration 36 depends on `admin_audit_log`, which 35 creates, so
 * 36 before 35 fails at RUNTIME rather than at apply time.
 *
 * 37 IS NOT "B4 ONLY", WHICH IS A CORRECTION. I wrote that into the closure
 * report's dependency table, and the test below was what I pointed at as the
 * measurement. It does not measure it: 37's two H-7 gates call
 * `h7_shop_billing_bootstrap_allowed`, created by `20260907000000` (migration
 * 23) and amended by `20260907020000` (migration 25), and a PL/pgSQL body is
 * not resolved at CREATE time — so applying 37 onto a B4-only chain SUCCEEDS
 * and only fails when one of those gates is called. The test below never called
 * them, so a missing dependency looked like independence.
 *
 * The real dependency set is B4 (21) for the entitlement objects plus 23/25 for
 * the bootstrap helper, and the two tests after it measure both halves: 37 on
 * the actual DEV chain (1-34) answers, and 37 on B4 alone raises
 * `undefined_function` from exactly that helper.
 *
 * None of this changes the hosted answer for DEV, whose ledger tail is
 * migration 34 — 21, 23 and 25 are all long applied there. What it changes is
 * the CLAIM: 37 is independent of 35 and 36 specifically, not of the chain.
 */
describe('migration 37 dependency, for the hosted apply order', () => {
  const B4 = '20260831000000_b4_commercial_platform.sql';
  const H7 = '20260907000000_h7_security_hardening.sql';
  /** The DEV project's recorded ledger tail: migration 34. */
  const M34 = '20261015000000_h9_api_role_table_privileges.sql';

  it('applies and works on the B4-era chain alone, with 36 absent', async () => {
    // Everything up to and including B4 -- so neither migration 35 (which
    // creates admin_audit_log) nor 36 (the publication snapshot) exists.
    const h = await createBareHarness();
    try {
      for (const name of migrationFiles().filter((name) => name <= B4)) {
        await h.exec(migrationSql(name));
      }
      expect(await h.one<{ present: boolean }>(
        `select to_regclass('public.admin_audit_log') is not null as present`,
      )).toEqual({ present: false });
      expect(await h.one<{ present: boolean }>(
        `select to_regclass('public.financial_publications') is not null as present`,
      )).toEqual({ present: false });

      await h.exec(migrationSql(E11_MIGRATION));

      // And it is functional, not merely installed: seed a trialing account
      // and drive both answers.
      await seedShops(h);
      const accountId = (await h.one<{ id: string }>(
        'select id::text as id from billing_accounts where principal_owner_user_id=$1::uuid',
        [OWNER_A],
      )).id;
      expect(await refusal(h, REFRESH, [accountId])).toBeNull();
      await h.one(
        `update entitlement_snapshots set tier='pro',status='active',trial_ends_at=null,
           paid_through=now()+interval '30 days',grace_ends_at=now()+interval '37 days'
         where billing_account_id=$1::uuid returning billing_account_id`,
        [accountId],
      );
      expect((await refusal(h, REFRESH, [accountId]))?.code).toBe('MU037');
    } finally {
      await h.close();
    }
  }, 90_000);

  // ── The two halves of the real dependency ───────────────────────────────

  it('applies on the ACTUAL DEV chain (1-34) and all five redefined gates answer', async () => {
    // This is the apply Decision 1 is about: DEV's ledger tail is migration 34,
    // and 35/36 are pending. The B4-only test above is a weaker chain, and in
    // one respect a misleading one -- it leaves out the H-7 migration whose
    // helper 37's gates call.
    const h = await createBareHarness();
    try {
      for (const name of migrationFiles().filter((name) => name <= M34)) {
        await h.exec(migrationSql(name));
      }
      // 35 and 36 really are absent, which is the state being tested.
      expect(await h.one<{ audit: boolean; publications: boolean }>(
        `select to_regclass('public.admin_audit_log') is not null as audit,
                to_regclass('public.financial_publications') is not null as publications`,
      )).toEqual({ audit: false, publications: false });

      await h.exec(migrationSql(E11_MIGRATION));
      await seedShops(h);
      const accountId = (await h.one<{ id: string }>(
        'select id::text as id from billing_accounts where principal_owner_user_id=$1::uuid',
        [OWNER_A],
      )).id;

      // The stamp works, and refuses an unbacked claim.
      expect(await refusal(h, REFRESH, [accountId])).toBeNull();
      await h.one(
        `update entitlement_snapshots set tier='pro',status='active',trial_ends_at=null,
           paid_through=now()+interval '30 days',grace_ends_at=now()+interval '37 days'
         where billing_account_id=$1::uuid returning billing_account_id`,
        [accountId],
      );
      expect((await refusal(h, REFRESH, [accountId]))?.code).toBe('MU037');

      // AND the two H-7 write gates answer, including on the branch that
      // reaches h7_shop_billing_bootstrap_allowed -- a shop with no billing
      // account. Merely installing them proves nothing; the next test shows
      // why.
      await h.one(
        `update shops set billing_account_id=null where id=$1::uuid returning id`, [SHOP_B],
      );
      expect(await refusal(h, 'select b4_shop_write_permitted($1::uuid) as ok', [SHOP_B]))
        .toBeNull();
      expect(await refusal(h, 'select b4_user_within_current_staff_limit($1::uuid) as ok', [STAFF_A]))
        .toBeNull();
      expect(await refusal(h, 'select b4_user_has_premium($1::uuid) as ok', [OWNER_A])).toBeNull();

      // STAFF ADMISSION and RECONCILIATION -- the two gates the first version
      // of this test did not call, while its name claimed "every gate". The
      // reviewer proved the omission by replacing b4_staff_row_within_limit
      // with a body calling a nonexistent function and watching every
      // assertion here still pass. They are called now, and with an expected
      // VALUE rather than an absence of error, so the tier lookup inside them
      // is what the assertion depends on.
      await h.one('update users set is_active=false where id=$1::uuid returning id', [STAFF_A]);
      const admits = () => h.one<{ ok: boolean | null }>(
        `select b4_staff_row_within_limit(jsonb_build_object('id',$1::text,'is_active',true)) as ok`,
        [STAFF_A],
      );
      // The snapshot is still the UNBACKED pro/active set above, so the
      // effective tier is 'free' -- one non-owner staff per shop, and Manager
      // A already holds it.
      expect(await admits()).toEqual({ ok: false });

      // Restore the backed trial and the same call is admitted, because ultra
      // carries no staff limit at all. The tier lookup is the only difference.
      await h.one(
        `update entitlement_snapshots set status='trialing',tier='free',paid_through=null,
           grace_ends_at=null,
           trial_ends_at=(select launch_trial_granted_at+interval '14 days'
                          from billing_accounts where id=$1::uuid)
         where billing_account_id=$1::uuid returning billing_account_id`,
        [accountId],
      );
      expect(await admits()).toEqual({ ok: true });

      // And reconciliation, the WRITE that applies a snapshot, runs here too.
      expect(await refusal(h, 'select b4_reconcile_plan_limits($1::uuid) as ok', [accountId]))
        .toBeNull();
    } finally {
      await h.close();
    }
  }, 120_000);

  it('the H-7 helper is a REAL dependency: on a B4-only chain the gate cannot answer', async () => {
    // The measurement that was missing, and the reason "B4 only" was wrong.
    // Applying 37 onto a B4-only chain SUCCEEDS -- PL/pgSQL bodies are not
    // resolved at CREATE -- so apply-time success is not evidence of a
    // satisfied dependency. The failure appears at the first call that reaches
    // the helper.
    const h = await createBareHarness();
    try {
      for (const name of migrationFiles().filter((name) => name <= B4)) {
        await h.exec(migrationSql(name));
      }
      expect(await h.one<{ present: boolean }>(
        `select exists (select 1 from pg_proc where proname='h7_shop_billing_bootstrap_allowed') as present`,
      )).toEqual({ present: false });

      // Applies without complaint, which is the trap.
      await h.exec(migrationSql(E11_MIGRATION));
      await seedShops(h);
      await h.one(
        `update shops set billing_account_id=null where id=$1::uuid returning id`, [SHOP_B],
      );

      const denied = await refusal(h, 'select b4_shop_write_permitted($1::uuid) as ok', [SHOP_B]);
      // 42883 is undefined_function.
      expect(denied?.code).toBe('42883');
      expect(denied?.message).toMatch(/h7_shop_billing_bootstrap_allowed/);
    } finally {
      await h.close();
    }
  }, 120_000);

  it('reads objects from B4 and from H-7, and from neither 35 nor 36', () => {
    const sql = migrationSql(E11_MIGRATION);
    // The entitlement objects, each created by B4 (20260831000000).
    for (const object of [
      'entitlement_snapshots', 'billing_accounts', 'billing_subscriptions', 'b4_effective_tier',
    ]) {
      expect(sql).toContain(object);
      expect(migrationSql(B4)).toContain(object);
    }
    // And the H-7 helper, which is the dependency the previous version of this
    // test was named as excluding.
    expect(sql).toContain('h7_shop_billing_bootstrap_allowed');
    expect(migrationSql(H7)).toContain('h7_shop_billing_bootstrap_allowed');
    // And nothing from 35 or 36, whose objects would force an order.
    for (const later of ['admin_audit_log', 'financial_publications', 'publish_financial_snapshot']) {
      expect(sql).not.toContain(later);
    }
  });
});

/**
 * The non-vacuity control for the suite as a whole. The refusal tests above
 * only mean something if the OLD function body would fail them, so this reverts
 * migration 37 for real -- re-applying the predecessor definition out of
 * 20260831000000 -- and asserts the unconditional stamp comes back.
 */
describe('E11 reverted, to prove the refusals are not free', () => {
  let h: Harness;
  let accountId: string;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    accountId = (await h.one<{ id: string }>(
      'select id::text as id from billing_accounts where principal_owner_user_id=$1::uuid',
      [OWNER_A],
    )).id;
  }, 60_000);
  afterAll(async () => h.close());

  it('reproduces the defect once migration 37 is rolled back', async () => {
    await h.one(
      `update entitlement_snapshots set tier='pro',status='active',trial_ends_at=null,
         paid_through=now()+interval '30 days',grace_ends_at=now()+interval '37 days'
       where billing_account_id=$1::uuid returning billing_account_id`,
      [accountId],
    );
    // Guarded: with 37 applied the unbacked claim is refused.
    expect((await refusal(h, REFRESH, [accountId]))?.code).toBe('MU037');

    // Roll 37 back by re-applying the predecessor definition from B4. This is
    // the class-B reversal the migration header describes, executed rather
    // than described.
    const b4 = migrationSql(B4_MIGRATION);
    const start = b4.indexOf('create or replace function b4_refresh_entitlement_snapshot');
    expect(start).toBeGreaterThan(-1);
    const end = b4.indexOf('$fn$;', b4.indexOf('$fn$', start + 60)) + '$fn$;'.length;
    const previous = b4.slice(start, end);
    expect(previous).toContain('set verified_at=now()');
    expect(previous).not.toContain('b4_effective_tier');
    await h.exec(previous);

    // And the defect is back: the unbacked claim is stamped.
    const before = await readSnapshot(h, accountId);
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
    const after = await readSnapshot(h, accountId);
    expect(Date.parse(after.verified_at)).toBeGreaterThanOrEqual(Date.parse(before.verified_at));
    expect(after.version).toBe(before.version + 1);

    // Re-apply 37 and the hole closes again, in the same session.
    await h.exec(migrationSql(E11_MIGRATION));
    expect((await refusal(h, REFRESH, [accountId]))?.code).toBe('MU037');
  }, 30_000);
});

/**
 * DECISION 5 — the tier the Dashboard now reads.
 *
 * `apps/admin` used to decide entitlement itself, with a TypeScript
 * transcription of the status/date rule and three exported predicates
 * (`isTrialingNow`, `isPaidEntitlementNow`, `isEntitledNow`). Those are gone:
 * `entitlementCounts` now consumes `b4_effective_tier`'s answer, fetched per
 * account. So this function IS the panel's definition of entitlement, and the
 * matrix that used to live in `apps/admin/lib/adminMetrics.test.ts` lives here
 * instead — tested against the function the server actually runs, rather than
 * against a copy of it that had already drifted by two cases once before.
 *
 * The describes above assert the REFUSAL (MU037). These assert the TIER, which
 * is a different observable and the one the Dashboard reads: a refused stamp
 * stops the device's ceiling advancing, while the tier is what every capacity
 * decision and now every reported figure is derived from.
 *
 * Its own harness: the suites above mutate a shared fixture in sequence, and a
 * matrix that rewrites every snapshot column would not survive being inserted
 * among them.
 */
describe('Decision 5 — the tier the Dashboard now reads', () => {
  let h: Harness;
  let accountId: string;

  beforeAll(async () => {
    h = await createHarness();
    await seedShops(h);
    accountId = (await h.one<{ id: string }>(
      'select id::text as id from billing_accounts where principal_owner_user_id=$1::uuid',
      [OWNER_A],
    )).id;
    // One generously dated subscription backs the whole matrix. Every case
    // below keeps the snapshot's own dates inside these, so the matrix tests
    // the status/date arms rather than the backing rule — which the describes
    // above already test on its own.
    await h.one(
      `insert into billing_subscriptions(
         billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,provider
       ) values ($1::uuid,'pro','monthly','active',now(),
         now()+interval '400 days',now()+interval '430 days','sslcommerz') returning id`,
      [accountId],
    );
  }, 60_000);
  afterAll(async () => h.close());

  const tierNow = async (): Promise<string | null> =>
    (await h.one<{ tier: string | null }>(
      'select b4_effective_tier($1::uuid) as tier', [accountId],
    )).tier;

  /** The four statuses whose evidence is the subscription row. */
  const SUBSCRIPTION_BACKED = ['active', 'canceled', 'grace', 'past_due'];

  const GRANTED = `(select launch_trial_granted_at from billing_accounts where id=$1::uuid)`;

  interface Case {
    label: string;
    status: string;
    tier?: string;
    trial?: string;
    paid?: string;
    grace?: string;
    expected: string;
  }

  const CASES: readonly Case[] = [
    // The trial arm returns before the tier is consulted, which is why a
    // `free`-tier snapshot answers `ultra` while its trial runs.
    { label: 'trialing, in trial', status: 'trialing', tier: `'free'`,
      trial: `${GRANTED}+interval '14 days'`, expected: 'ultra' },
    { label: 'trialing, trial over', status: 'trialing', tier: `'free'`,
      trial: `${GRANTED}-interval '1 day'`, expected: 'free' },
    { label: 'active, paid', status: 'active',
      paid: `now()+interval '30 days'`, expected: 'pro' },
    { label: 'active, lapsed with no grace', status: 'active',
      paid: `now()-interval '1 day'`, expected: 'free' },
    { label: 'active, in grace', status: 'active',
      paid: `now()-interval '1 day'`, grace: `now()+interval '5 days'`, expected: 'pro' },
    { label: 'past_due, in grace', status: 'past_due',
      paid: `now()-interval '1 day'`, grace: `now()+interval '5 days'`, expected: 'pro' },
    { label: 'past_due, grace over', status: 'past_due',
      paid: `now()-interval '9 days'`, grace: `now()-interval '1 day'`, expected: 'free' },
    { label: 'grace, in grace', status: 'grace',
      paid: `now()-interval '1 day'`, grace: `now()+interval '5 days'`, expected: 'pro' },
    { label: 'canceled, still paid', status: 'canceled',
      paid: `now()+interval '30 days'`, expected: 'pro' },
    { label: 'canceled, past paid_through', status: 'canceled',
      paid: `now()-interval '1 day'`, expected: 'free' },
    // A canceled row does NOT get the grace arm, so a live grace window
    // cannot rescue it. This is the case a hand-written predicate is most
    // likely to get wrong, and revision 2 of the admin plan did.
    { label: 'canceled, in grace only', status: 'canceled',
      paid: `now()-interval '1 day'`, grace: `now()+interval '5 days'`, expected: 'free' },
    { label: 'expired', status: 'expired',
      paid: `now()-interval '1 day'`, expected: 'free' },
    { label: 'free tier with paid dates', status: 'active', tier: `'free'`,
      paid: `now()+interval '30 days'`, expected: 'free' },
  ];

  // label, expected, case -- in that order so the two %s in the title are the
  // two readable fields and not the whole object.
  it.each(CASES.map((item) => [item.label, item.expected, item] as const))(
    '%s -> %s',
    async (_label, _expected, item) => {
      if (SUBSCRIPTION_BACKED.includes(item.status)) {
        // Status equality is part of the evidence, so the subscription moves
        // with the snapshot. Otherwise every non-active row below would answer
        // 'free' for the round-28 reason instead of the one it is named for.
        await h.one(
          `update billing_subscriptions set status=$2,
             canceled_at=case when $2='canceled' then now() else null end
           where billing_account_id=$1::uuid returning id`,
          [accountId, item.status],
        );
      }
      await setSnapshot(h, accountId, {
        tier: item.tier ?? `'pro'`,
        status: `'${item.status}'`,
        trial_ends_at: item.trial ?? 'null',
        paid_through: item.paid ?? 'null',
        grace_ends_at: item.grace ?? 'null',
      });

      expect(await tierNow()).toBe(item.expected);
    },
  );

  it('the date boundary is STRICTLY after, as the SQL `>` is', async () => {
    await h.one(
      `update billing_subscriptions set status='active',canceled_at=null
       where billing_account_id=$1::uuid returning id`,
      [accountId],
    );
    await setSnapshot(h, accountId, {
      tier: `'pro'`, status: `'active'`, trial_ends_at: 'null',
      paid_through: `now()+interval '10 days'`, grace_ends_at: 'null',
    });
    const at = (offset: string) => h.one<{ tier: string | null }>(
      `select b4_effective_tier($1::uuid,
         (select paid_through${offset} from entitlement_snapshots where billing_account_id=$1::uuid)
       ) as tier`,
      [accountId],
    );

    // p_now exactly at paid_through: not after it, so not entitled.
    expect(await at('')).toEqual({ tier: 'free' });
    // One microsecond earlier: entitled. Postgres timestamps are microsecond
    // precision, so this is the smallest step that exists.
    expect(await at(`-interval '1 microsecond'`)).toEqual({ tier: 'pro' });
  });

  // ── The three reproductions, answered as a TIER ─────────────────────────
  //
  // Each ends by restoring the evidence and asserting the tier comes back, so
  // none of them can pass because the fixture was broken.

  it('REPRODUCTION 1: a paid claim with no subscription reads free', async () => {
    await h.one(
      `update billing_subscriptions set status='active',canceled_at=null
       where billing_account_id=$1::uuid returning id`,
      [accountId],
    );
    await setSnapshot(h, accountId, {
      tier: `'pro'`, status: `'active'`, trial_ends_at: 'null',
      paid_through: `now()+interval '30 days'`, grace_ends_at: `now()+interval '37 days'`,
    });
    expect(await tierNow()).toBe('pro');

    const removed = await h.all<{ id: string }>(
      `delete from billing_subscriptions where billing_account_id=$1::uuid returning id::text as id`,
      [accountId],
    );
    expect(removed).toHaveLength(1);

    // The snapshot is UNCHANGED: pro, active, both dates in the future. This
    // is the row the Dashboard used to count as a paying customer.
    expect(await tierNow()).toBe('free');

    await h.one(
      `insert into billing_subscriptions(
         billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,provider
       ) values ($1::uuid,'pro','monthly','active',now(),
         now()+interval '400 days',now()+interval '430 days','sslcommerz') returning id`,
      [accountId],
    );
    expect(await tierNow()).toBe('pro');
  });

  it('REPRODUCTION 2: a trial longer than the grant reads free', async () => {
    await setSnapshot(h, accountId, {
      tier: `'free'`, status: `'trialing'`,
      trial_ends_at: `${GRANTED}+interval '14 days'`,
      paid_through: 'null', grace_ends_at: 'null',
    });
    expect(await tierNow()).toBe('ultra');

    await setSnapshot(h, accountId, { trial_ends_at: `${GRANTED}+interval '400 days'` });
    expect(await tierNow()).toBe('free');

    await setSnapshot(h, accountId, { trial_ends_at: `${GRANTED}+interval '14 days'` });
    expect(await tierNow()).toBe('ultra');
  });

  it('REPRODUCTION 3: an active claim a canceled subscription backs reads free', async () => {
    await h.one(
      `update billing_subscriptions set status='active',canceled_at=null
       where billing_account_id=$1::uuid returning id`,
      [accountId],
    );
    await setSnapshot(h, accountId, {
      tier: `'pro'`, status: `'active'`, trial_ends_at: 'null',
      paid_through: `now()+interval '30 days'`, grace_ends_at: `now()+interval '37 days'`,
    });
    expect(await tierNow()).toBe('pro');

    // Only the subscription's status moves. Tier and both dates still match.
    await h.one(
      `update billing_subscriptions set status='canceled',canceled_at=now()
       where billing_account_id=$1::uuid returning id`,
      [accountId],
    );
    expect(await tierNow()).toBe('free');

    // And a snapshot that agrees is entitled again, on the canceled arm —
    // which is the coupling: a revocation must move both rows.
    await setSnapshot(h, accountId, { status: `'canceled'` });
    expect(await tierNow()).toBe('pro');
  });

  it('an account with no snapshot at all answers NULL, which the callers coalesce', async () => {
    // The panel reads this as 'free', matching migration 37's own callers.
    // Asserted rather than assumed, because the admin fetch depends on it.
    await h.one(
      'delete from entitlement_snapshots where billing_account_id=$1::uuid returning billing_account_id',
      [accountId],
    );
    expect(await tierNow()).toBeNull();
    expect(await h.one<{ tier: string }>(
      `select coalesce(b4_effective_tier($1::uuid),'free') as tier`, [accountId],
    )).toEqual({ tier: 'free' });
  });
});
