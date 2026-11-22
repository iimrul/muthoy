import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, OWNER_A, seedShops, SHOP_A, type Harness } from './harness';

/**
 * Migration 41 — admin_grant_plan. Founder-approved 2026-11-21 (CLAUDE.md
 * rule 10): an admin may grant or extend Pro/Ultra by N days with a reason.
 *
 * What must hold, and is executed below rather than asserted from reading:
 *  - the grant is BACKED: the device's own online check
 *    (b4_refresh_entitlement_snapshot, migration 37) accepts it;
 *  - verified_at is NOT stamped by the admin action (E11);
 *  - an extension runs from the end of what was already paid for;
 *  - bad input and unknown accounts are refused and write nothing;
 *  - only the service role can call it, and only it can read the grant log.
 *
 * Migration 42 (founder 2026-11-22): a grant is billing_cycle 'grant', never
 * a fabricated monthly/annual, while an extended PAID subscription keeps its
 * own cycle; plan_offerings still sell monthly/annual only.
 */

const GRANT = 'select admin_grant_plan($1::uuid,$2::text,$3::integer,$4::text,$5::text) as snapshot';
const REFRESH = 'select b4_refresh_entitlement_snapshot($1::uuid)';
const SIGNATURE = 'admin_grant_plan(uuid,text,integer,text,text)';

interface Snapshot {
  tier: string;
  status: string;
  trial_ends_at: string | null;
  paid_through: string | null;
  verified_at: string;
  version: number;
}

async function refusal(h: Harness, sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await h.one(sql, params);
    return null;
  } catch (error) {
    return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : 'unknown';
  }
}

function readSnapshot(h: Harness, accountId: string): Promise<Snapshot> {
  return h.one<Snapshot>(
    `select tier,status,trial_ends_at::text as trial_ends_at,paid_through::text as paid_through,
       verified_at::text as verified_at,version::integer as version
     from entitlement_snapshots where billing_account_id=$1::uuid`,
    [accountId],
  );
}

async function grantCount(h: Harness, accountId: string): Promise<number> {
  return (await h.one<{ n: number }>(
    'select count(*)::integer as n from admin_plan_grants where billing_account_id=$1::uuid',
    [accountId],
  )).n;
}

describe('admin_grant_plan (migrations 41 + 42)', () => {
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

  it('grants Pro for 30 days to a trialing account, backed so the device accepts it online', async () => {
    const before = await readSnapshot(h, accountId);
    expect(before.status).toBe('trialing');

    await h.one(GRANT, [accountId, 'pro', 30, 'Beta pilot pharmacy', 'admin@muthoy']);

    const after = await readSnapshot(h, accountId);
    expect(after.tier).toBe('pro');
    expect(after.status).toBe('active');
    expect(after.trial_ends_at).toBeNull();
    // E11: the admin action is not a verification; only the device's online
    // check may stamp verified_at.
    expect(after.verified_at).toBe(before.verified_at);
    expect(after.version).toBe(before.version + 1);
    expect(await h.one<{ days: number }>(
      `select round(extract(epoch from paid_through-now())/86400)::integer as days
       from entitlement_snapshots where billing_account_id=$1::uuid`,
      [accountId],
    )).toEqual({ days: 30 });

    expect(await h.one(`
      select s.provider,s.tier,s.status,s.billing_cycle,(s.paid_through=e.paid_through) as same_paid_through
      from billing_subscriptions s join entitlement_snapshots e using (billing_account_id)
      where s.billing_account_id=$1::uuid`, [accountId]))
      .toEqual({ provider: 'admin_grant', tier: 'pro', status: 'active', billing_cycle: 'grant', same_paid_through: true });
    expect(await h.one('select plan from shops where id=$1::uuid', [SHOP_A])).toEqual({ plan: 'pro' });
    expect(await h.one('select b4_effective_tier($1::uuid) as tier', [accountId])).toEqual({ tier: 'pro' });

    // The device's own online billing check accepts the grant as backed.
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();

    expect(await h.one(`
      select tier,days,reason,granted_by,previous_tier
      from admin_plan_grants where billing_account_id=$1::uuid`, [accountId]))
      .toEqual({ tier: 'pro', days: 30, reason: 'Beta pilot pharmacy', granted_by: 'admin@muthoy', previous_tier: null });
  });

  it('extends from the end of the current paid period, never shortening it, and can upgrade', async () => {
    const { paid_through: previous } = await h.one<{ paid_through: string }>(
      'select paid_through::text as paid_through from billing_subscriptions where billing_account_id=$1::uuid',
      [accountId],
    );

    await h.one(GRANT, [accountId, 'ultra', 10, 'Upgraded for the pilot', 'admin@muthoy']);

    expect(await h.one(`
      select tier,(paid_through=$2::timestamptz+interval '10 days') as extended_from_previous
      from billing_subscriptions where billing_account_id=$1::uuid`, [accountId, previous]))
      .toEqual({ tier: 'ultra', extended_from_previous: true });
    expect((await readSnapshot(h, accountId)).tier).toBe('ultra');
    expect(await h.one(`
      select previous_tier,(previous_paid_through=$2::timestamptz) as recorded_previous
      from admin_plan_grants where billing_account_id=$1::uuid order by created_at desc limit 1`,
    [accountId, previous])).toEqual({ previous_tier: 'pro', recorded_previous: true });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
  });

  it.each([
    ['a free tier', 'free', 30, 'Valid reason', 'admin'],
    ['zero days', 'pro', 0, 'Valid reason', 'admin'],
    ['more than a year', 'pro', 367, 'Valid reason', 'admin'],
    ['a missing reason', 'pro', 30, '  ab  ', 'admin'],
    ['no granting admin', 'pro', 30, 'Valid reason', '   '],
  ])('refuses %s and writes nothing', async (_label, tier, days, reason, grantedBy) => {
    const before = await readSnapshot(h, accountId);
    const grants = await grantCount(h, accountId);
    expect(await refusal(h, GRANT, [accountId, tier, days, reason, grantedBy])).toBe('22023');
    expect(await readSnapshot(h, accountId)).toEqual(before);
    expect(await grantCount(h, accountId)).toBe(grants);
  });

  it('refuses an account that does not exist', async () => {
    expect(await refusal(h, GRANT, ['00000000-0000-4000-8000-00000000dead', 'pro', 30, 'Valid reason', 'admin']))
      .toBe('P0002');
  });

  it('is callable by the service role only, which alone can read the grant log', async () => {
    const privilege = (role: string) => h.one<{ ok: boolean }>(
      `select has_function_privilege($1,$2,'execute') as ok`,
      [role, SIGNATURE],
    );
    expect(await privilege('service_role')).toEqual({ ok: true });
    expect(await privilege('authenticated')).toEqual({ ok: false });
    expect(await privilege('anon')).toEqual({ ok: false });
    for (const role of ['anon', 'authenticated']) {
      expect(await h.one<{ ok: boolean }>(
        `select has_table_privilege($1,'admin_plan_grants','select') as ok`,
        [role],
      )).toEqual({ ok: false });
    }
  });

  it('keeps a paid subscription on its own cycle and provider when a grant extends it', async () => {
    // The shape b4_apply_verified_payment leaves behind once the account pays.
    await h.one(`
      update billing_subscriptions set provider='sslcommerz',provider_reference='txn-42',billing_cycle='monthly'
      where billing_account_id=$1::uuid returning id`, [accountId]);

    await h.one(GRANT, [accountId, 'ultra', 15, 'Goodwill extension', 'admin@muthoy']);

    expect(await h.one(`
      select billing_cycle,provider,provider_reference from billing_subscriptions
      where billing_account_id=$1::uuid`, [accountId]))
      .toEqual({ billing_cycle: 'monthly', provider: 'sslcommerz', provider_reference: 'txn-42' });
    expect(await refusal(h, REFRESH, [accountId])).toBeNull();
  });

  it('allows grant as a subscription cycle only, and nothing else new', async () => {
    expect(await refusal(
      h,
      `update billing_subscriptions set billing_cycle='weekly' where billing_account_id=$1::uuid returning id`,
      [accountId],
    )).toBe('23514');
    // A grant is never sold: offerings and orders keep monthly/annual only.
    expect(await refusal(
      h,
      `update plan_offerings set billing_cycle='grant' where tier='pro' and billing_cycle='monthly' returning tier`,
    )).toBe('23514');
    expect(await h.one(`
      select pg_get_constraintdef(oid) as def from pg_constraint where conname='payment_orders_billing_cycle_check'`))
      .toEqual({ def: "CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'annual'::text])))" });
  });

  it('accepts admin_grant as a subscription provider and still refuses any other', async () => {
    expect(await refusal(
      h,
      `update billing_subscriptions set provider='stripe'
       where billing_account_id=$1::uuid returning id`,
      [accountId],
    )).toBe('23514');
  });
});
