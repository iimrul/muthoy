import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from './_shared/auth.ts';

const mocks = vi.hoisted(() => ({ assertCallerCurrent: vi.fn(), rpc: vi.fn(), from: vi.fn() }));

vi.mock('./_shared/auth.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_shared/auth.ts')>();
  return { ...original, assertCallerCurrent: mocks.assertCallerCurrent };
});
vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));
// billing-status must never consult a payment provider — it reads and
// reconciles state. W4-10 moved the seam to _shared/paymentProvider.ts, and
// this double fails loudly if that ever changes.
vi.mock('./_shared/paymentProvider.ts', () => ({
  resolveProvider: vi.fn(() => {
    throw new Error('billing-status must not resolve a payment provider');
  }),
  PaymentProviderError: class extends Error {},
}));

import { billingStatus } from './billing.ts';

const ACCOUNT_ID = '86666666-6666-4666-8666-666666666666';

const caller = {
  authUserId: 'auth-1', appUserId: 'owner-1', principalUserId: 'owner-1',
  shopId: 'shop-1', role: 'owner', permissionVersion: 1,
  freshPhoneOtp: null, raw: { app_metadata: {} },
} as unknown as Caller;

const OWNER_WITHOUT_ACCOUNT = {
  appUserId: 'owner-1', shopId: 'shop-1', roleName: 'owner', isOwner: true,
  permissionVersion: 1, billingAccountId: null, commercialStatus: 'active' as const,
};

function table(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'lte', 'order', 'update']) builder[method] = () => builder;
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCallerCurrent.mockResolvedValue(OWNER_WITHOUT_ACCOUNT);
  mocks.from.mockImplementation((name: string) => table(
    name === 'billing_accounts'
      ? { data: { id: ACCOUNT_ID, launch_trial_granted_at: '2026-09-03T00:00:00.000Z' }, error: null }
      : name === 'entitlement_snapshots'
        ? { data: { billing_account_id: ACCOUNT_ID, tier: 'free', status: 'trialing', trial_ends_at: '2026-09-17T00:00:00.000Z' }, error: null }
        : { data: [], error: null },
  ));
});

describe('billing-status self-heal', () => {
  it('attaches the missing billing account and returns the hydrated trial', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'b4_ensure_owner_billing_account' ? { data: ACCOUNT_ID, error: null } : { data: null, error: null });

    const result = await billingStatus(caller, {});

    expect(mocks.rpc).toHaveBeenCalledWith('b4_ensure_owner_billing_account', {
      p_owner_user_id: 'owner-1', p_shop_id: 'shop-1',
    });
    expect(result.entitlement).toMatchObject({ status: 'trialing' });
  });

  it('answers 404 only for MU032 — the caller genuinely is not an eligible owner', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'MU032', message: 'owner billing target is invalid' },
    });
    await expect(billingStatus(caller, {}))
      .rejects.toMatchObject({ status: 404, message: 'Billing account not found' });
  });

  it.each([
    ['a permission failure', { code: '42501', message: 'permission denied for function' }],
    ['a dropped connection', { code: '08006', message: 'connection reset' }],
    ['a missing function after a bad migration', { code: '42883', message: 'function does not exist' }],
  ])('surfaces %s as a 500, never as "Billing account not found"', async (_label, error) => {
    mocks.rpc.mockResolvedValue({ data: null, error });

    // Rewriting infrastructure faults as "not found" is what taught the device
    // to render a real trial owner as Free.
    await expect(billingStatus(caller, {}))
      .rejects.toMatchObject({ status: 500, code: 'billing_bootstrap_failed' });
  });

  it('never bootstraps an account for a non-owner caller', async () => {
    mocks.assertCallerCurrent.mockResolvedValue({ ...OWNER_WITHOUT_ACCOUNT, roleName: 'staff', isOwner: false });
    await expect(billingStatus(caller, {})).rejects.toMatchObject({ status: 404 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

/**
 * E11. Migration 37 made b4_refresh_entitlement_snapshot refuse to stamp a
 * premium claim no payment evidence backs, raising MU037. billing-status has
 * to tell that apart from an outage, or the fix turns a data defect into a
 * dead screen for the owner.
 */
describe('billing-status on a refused verification', () => {
  const OWNER_WITH_ACCOUNT = { ...OWNER_WITHOUT_ACCOUNT, billingAccountId: ACCOUNT_ID };
  /** The stamp the device already holds. A refusal must return exactly this. */
  const STALE_VERIFIED_AT = '2026-09-01T00:00:00.000Z';

  /** Every RPC succeeds, except the refresh, which answers `error`. */
  function rpcFailing(error: { code: string; message: string }) {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'b4_refresh_entitlement_snapshot' ? { data: null, error } : { data: null, error: null });
  }

  beforeEach(() => {
    mocks.assertCallerCurrent.mockResolvedValue(OWNER_WITH_ACCOUNT);
    // The snapshot carries a verified_at, so an answer that invented a fresh
    // one would be visible. Without it the assertions below could not tell a
    // preserved stamp from an absent field.
    mocks.from.mockImplementation((name: string) => table(
      name === 'billing_accounts'
        ? { data: { id: ACCOUNT_ID, launch_trial_granted_at: '2026-09-03T00:00:00.000Z' }, error: null }
        : name === 'entitlement_snapshots'
          ? {
            data: {
              billing_account_id: ACCOUNT_ID, tier: 'pro', status: 'active',
              paid_through: '2026-10-21T00:00:00.000Z', grace_ends_at: '2026-10-28T00:00:00.000Z',
              verified_at: STALE_VERIFIED_AT, version: 4,
            },
            error: null,
          }
          : { data: [], error: null },
    ));
  });

  it('still answers, and returns the stamp unchanged rather than a fresh one', async () => {
    rpcFailing({ code: 'MU037', message: 'entitlement claim is not backed by a verified payment' });

    const result = await billingStatus(caller, {});

    // The snapshot comes back unrefreshed. Its verified_at did not advance, so
    // the device's 30-day ceiling runs down and premium lapses on its own --
    // the fail-closed outcome, reached without blanking the screen.
    expect(result.entitlement).toMatchObject({
      billing_account_id: ACCOUNT_ID, verified_at: STALE_VERIFIED_AT,
    });
    expect(result.account).toMatchObject({ id: ACCOUNT_ID });
    // And the refusal was a refused verification, not a skipped one.
    expect(mocks.rpc).toHaveBeenCalledWith('b4_refresh_entitlement_snapshot', {
      p_billing_account_id: ACCOUNT_ID,
    });
  });

  it('recognises the refusal by message even if the code is stripped in transport', async () => {
    rpcFailing({ code: '', message: 'entitlement claim is not backed by a granted trial' });
    await expect(billingStatus(caller, {})).resolves.toBeDefined();
  });

  it('recognises the refusal by SQLSTATE alone, with a message that says nothing', async () => {
    // The two recognisers must work independently. Every other fixture here
    // satisfies both at once, so neither branch was ever isolated.
    rpcFailing({ code: 'MU037', message: '' });
    await expect(billingStatus(caller, {})).resolves.toBeDefined();
  });

  /**
   * This assertion has flipped twice under review, which is worth recording
   * rather than hiding, because the right answer depended on what
   * b4_reconcile_plan_limits DOES and that changed underneath it.
   *
   * Originally I asserted reconciliation still ran after MU037, captioned "so
   * shops are not left over-provisioned" -- and round 28 showed that was
   * asserting a defect as intended behaviour, because reconciliation then
   * applied the rejected snapshot and WIDENED limits.
   *
   * So I inverted it: reconciliation must not run. Correct while the guard
   * inside reconciliation merely returned.
   *
   * Round 30 then moved the guard into the tier, so reconciliation derives
   * 'free' for an unbacked claim and NARROWS. Skipping it now withholds the
   * correction, which round 32 found preserving active flags. So it runs
   * again -- for the opposite reason to the original.
   */
  it('reconciles even after a refusal, because reconciliation now NARROWS', async () => {
    rpcFailing({ code: 'MU037', message: 'entitlement claim is not backed by a verified payment' });

    await billingStatus(caller, {});

    expect(mocks.rpc).toHaveBeenCalledWith('b4_reconcile_plan_limits', {
      p_billing_account_id: ACCOUNT_ID,
    });
  });

  it('reconciles when verification succeeds too, so the call is unconditional', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await billingStatus(caller, {});
    expect(mocks.rpc).toHaveBeenCalledWith('b4_reconcile_plan_limits', {
      p_billing_account_id: ACCOUNT_ID,
    });
  });

  it.each([
    ['a permission failure', { code: '42501', message: 'permission denied for function' }],
    ['a dropped connection', { code: '08006', message: 'connection reset' }],
    ['the snapshot missing entirely', { code: 'MU036', message: 'entitlement snapshot not found' }],
  ])('still fails closed on %s rather than answering with a stale snapshot', async (_label, error) => {
    // The non-vacuity control for the branch above: MU037 is the ONLY code
    // that may continue. MU036 in particular must not -- a missing snapshot is
    // not a refused claim, and swallowing it would hide a broken account.
    rpcFailing(error);
    await expect(billingStatus(caller, {}))
      .rejects.toMatchObject({ status: 500, message: 'Could not verify billing status' });
  });
});
