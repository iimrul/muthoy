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
vi.mock('./_shared/sslcommerz.ts', () => ({
  createSslCommerzSession: vi.fn(),
  sslCommerzConfig: vi.fn(),
  PaymentProviderError: class extends Error {},
}));

import { billingStatus } from './billing.ts';

const ACCOUNT_ID = '86666666-6666-4666-8666-666666666666';

const caller = {
  authUserId: 'auth-1', appUserId: 'owner-1', principalUserId: 'owner-1',
  shopId: 'shop-1', role: 'owner', permissionVersion: 1,
  verifiedPhone: null, raw: { app_metadata: {} },
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
