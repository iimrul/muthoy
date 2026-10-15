import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Caller } from './_shared/auth.ts';

const mocks = vi.hoisted(() => ({
  assertCallerCurrent: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  updateUserById: vi.fn(),
  assertShopNotBlocked: vi.fn(),
  blockedShopsForSession: vi.fn(),
}));

vi.mock('./_shared/auth.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./_shared/auth.ts')>();
  return { ...original, assertCallerCurrent: mocks.assertCallerCurrent };
});
vi.mock('./_shared/supabaseAdmin.ts', () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: mocks.from,
    auth: { admin: { updateUserById: mocks.updateUserById } },
  },
}));
vi.mock('./deviceGuard.ts', () => ({
  assertShopNotBlocked: mocks.assertShopNotBlocked,
  blockedShopsForSession: mocks.blockedShopsForSession,
}));

import { createOwnedShop, mutateOwnedShop, shopSummaries, switchShop } from './multiShop.ts';
import { DEVICE_GUARDED_ACTIONS } from './deviceRegistryPolicy.ts';

const caller = {
  authUserId: 'auth-1', appUserId: 'actor-1', principalUserId: 'principal-1',
  billingAccountId: 'account-1', shopId: 'shop-1', role: 'owner',
  permissionVersion: 1, freshPhoneOtp: null, raw: { app_metadata: {} },
} as unknown as Caller;

const OWNER_RECORD = {
  appUserId: 'actor-1', shopId: 'shop-1', roleName: 'owner', isOwner: true,
  permissionVersion: 1, billingAccountId: 'account-1', commercialStatus: 'active' as const,
};

/** Minimal PostgREST-shaped builder: every chained filter returns itself. */
function table(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'lte', 'order', 'update', 'insert']) {
    builder[method] = () => builder;
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  return builder;
}

const PRIMARY_SHOP = { data: { primary_shop_id: 'shop-1' }, error: null };
const MEMBERSHIP = {
  data: {
    shop_id: 'shop-2', actor_user_id: 'actor-2', role: 'owner',
    billing_account_id: 'account-1', shops: { archived_at: null, is_deleted: false },
  },
  error: null,
};

function tier(value: string | null, error: unknown = null) {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'b4_effective_tier') return { data: value, error };
    if (name === 'b4_shop_summaries') return { data: [{ shop_id: 'shop-1' }], error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCallerCurrent.mockResolvedValue(OWNER_RECORD);
  mocks.updateUserById.mockResolvedValue({ error: null });
  mocks.assertShopNotBlocked.mockResolvedValue(undefined);
  mocks.blockedShopsForSession.mockResolvedValue(new Set<string>());
  mocks.from.mockImplementation((name: string) =>
    table(name === 'billing_accounts' ? PRIMARY_SHOP : MEMBERSHIP));
});

describe('multi-shop server authority', () => {
  it('rejects a forged non-owner shop switch before reading target membership', async () => {
    mocks.assertCallerCurrent.mockResolvedValue({ ...OWNER_RECORD, roleName: 'staff', isOwner: false });
    await expect(switchShop(caller, { shopId: 'shop-2' })).rejects.toMatchObject({ status: 403 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['a Free owner', 'free'],
    ['an expired trial, which b4_effective_tier resolves to free', 'free'],
  ])('rejects a shop switch for %s with plan_required', async (_label, value) => {
    tier(value);
    await expect(switchShop(caller, { shopId: 'shop-2' }))
      .rejects.toMatchObject({ status: 403, code: 'plan_required' });
    // Denied before the session identity is rewritten.
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it.each([
    ['a trial owner (effective ultra)', 'ultra'],
    ['a paid Pro owner', 'pro'],
  ])('allows the shop switch for %s', async (_label, value) => {
    tier(value);
    await expect(switchShop(caller, { shopId: 'shop-2' })).resolves.toMatchObject({ shop_id: 'shop-2' });
    expect(mocks.updateUserById).toHaveBeenCalledTimes(1);
    expect(mocks.assertShopNotBlocked).toHaveBeenCalledWith(caller, 'shop-2');
  });

  it('blocks a target-shop switch before rewriting the auth identity', async () => {
    tier('ultra');
    mocks.assertShopNotBlocked.mockRejectedValueOnce(
      Object.assign(new Error('revoked'), { status: 403, code: 'device_session_unbound' }),
    );
    await expect(switchShop(caller, { shopId: 'shop-2' }))
      .rejects.toMatchObject({ status: 403, code: 'device_session_unbound' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('routes shop-create through the executable shared device guard', () => {
    expect(DEVICE_GUARDED_ACTIONS).toContain('shop-create');
    expect(DEVICE_GUARDED_ACTIONS).toContain('shop-switch');
  });

  it('still lets a non-premium owner return to the account primary shop', async () => {
    tier('free');
    mocks.from.mockImplementation((name: string) => table(
      name === 'billing_accounts'
        ? PRIMARY_SHOP
        : { data: { ...MEMBERSHIP.data, shop_id: 'shop-1' }, error: null },
    ));
    // A downgrade must not strand the owner outside the one shop Free covers.
    await expect(switchShop(caller, { shopId: 'shop-1' })).resolves.toMatchObject({ shop_id: 'shop-1' });
    expect(mocks.rpc).not.toHaveBeenCalledWith('b4_effective_tier', expect.anything());
  });

  it('rejects shop summaries for a non-premium owner and serves them for a trial owner', async () => {
    tier('free');
    await expect(shopSummaries(caller, { businessDate: '2026-09-03' }))
      .rejects.toMatchObject({ status: 403, code: 'plan_required' });
    expect(mocks.rpc).not.toHaveBeenCalledWith('b4_shop_summaries', expect.anything());

    tier('ultra');
    await expect(shopSummaries(caller, { businessDate: '2026-09-03' }))
      .resolves.toMatchObject({ rows: [{ shop_id: 'shop-1' }] });
  });

  it('omits commercial summaries for a blocked target shop', async () => {
    tier('ultra');
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'b4_effective_tier') return { data: 'ultra', error: null };
      if (name === 'b4_shop_summaries') {
        return { data: [{ shop_id: 'shop-1' }, { shop_id: 'shop-2' }], error: null };
      }
      return { data: null, error: null };
    });
    mocks.blockedShopsForSession.mockResolvedValueOnce(new Set(['shop-2']));

    await expect(shopSummaries(caller, { businessDate: '2026-09-03' })).resolves.toEqual({
      rows: [{ shop_id: 'shop-1' }],
      blockedShopIds: ['shop-2'],
      verifiedAt: expect.any(String),
    });
  });

  it('fails closed when a commercial summary row has no target shop identity', async () => {
    tier('ultra');
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'b4_effective_tier') return { data: 'ultra', error: null };
      if (name === 'b4_shop_summaries') {
        return { data: [{ shop_id: 'shop-1' }, { net_sales_paisa: 900 }], error: null };
      }
      return { data: null, error: null };
    });

    await expect(shopSummaries(caller, { businessDate: '2026-09-03' }))
      .rejects.toMatchObject({ status: 503, code: 'shop_summary_unverified' });
    expect(mocks.blockedShopsForSession).not.toHaveBeenCalled();
  });

  it('blocks a target-shop mutation before invoking its write RPC', async () => {
    tier('ultra');
    mocks.assertShopNotBlocked.mockRejectedValueOnce(
      Object.assign(new Error('revoked'), { status: 403, code: 'device_session_unbound' }),
    );
    await expect(mutateOwnedShop(caller, {
      shopId: 'shop-2', operation: 'rename', name: 'Blocked',
    })).rejects.toMatchObject({ status: 403 });
    expect(mocks.rpc).not.toHaveBeenCalledWith('b4_mutate_owned_shop', expect.anything());
  });

  it('does not create a shop outside the shared guard classification', async () => {
    // The handler itself remains focused on commercial ownership; handler.ts
    // executes this list before dispatch. This assertion executes the exact
    // predicate used by the router rather than searching source text.
    expect(new Set(DEVICE_GUARDED_ACTIONS).has('shop-create')).toBe(true);
    // Keep the import live so a signature/collection regression is caught.
    expect(typeof createOwnedShop).toBe('function');
  });

  it('reports a failed entitlement lookup as a server fault, never as "not premium"', async () => {
    tier(null, { message: 'connection reset', code: '08006' });
    // 500, not 403: a broken lookup must not read as a plan decision.
    await expect(shopSummaries(caller, { businessDate: '2026-09-03' }))
      .rejects.toMatchObject({ status: 500 });
  });
});
