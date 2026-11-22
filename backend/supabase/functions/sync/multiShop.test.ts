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

/** A legacy session: no row in auth_session_devices. */
const UNBOUND_GATE = {
  bound: false, enforced: false, deviceStatus: null, bindingStatus: null, authority: null,
};

function tier(value: string | null, error: unknown = null) {
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'b4_effective_tier') return { data: value, error };
    if (name === 'b4_shop_summaries') return { data: [{ shop_id: 'shop-1' }], error: null };
    if (name === 'a23_session_gate') return { data: UNBOUND_GATE, error: null };
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

// ── A2.3: the session's device binding travels with the shop switch ────────
//
// The 2026-11-22 loop: shop-switch moved active_shop_id but left the session
// bound to the SOURCE shop, so a23_session_gate read every later request as
// "mismatched" and refused it — the rollback included.

const boundCaller = { ...caller, authSessionId: 'session-1' } as unknown as Caller;

const SOURCE_AUTHORITY = {
  shopId: 'shop-1', devicePublicId: 'install-1', known: true, status: 'active',
  registryVersion: 3, enforced: false,
  bindings: [{ actorUserId: 'actor-1', status: 'active', bindingVersion: 1 }],
};
const TARGET_AUTHORITY = {
  shopId: 'shop-2', devicePublicId: 'install-1', known: true, status: 'active',
  registryVersion: 1, enforced: false,
  bindings: [{ actorUserId: 'actor-2', status: 'active', bindingVersion: 1 }],
};
const BOUND_GATE = {
  bound: true, enforced: false, deviceStatus: 'active', bindingStatus: 'active',
  devicePublicId: 'install-1', authority: SOURCE_AUTHORITY,
};
const ENROLMENT_ALLOWED = { allowed: true, held: false, enforced: false, legacyUnbound: false };

type RpcAnswer = { data: unknown; error: unknown };
function registry(overrides: Record<string, (args: Record<string, unknown>) => RpcAnswer> = {}) {
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    const override = overrides[name];
    if (override) return override(args);
    if (name === 'b4_effective_tier') return { data: 'ultra', error: null };
    if (name === 'a23_session_gate') return { data: BOUND_GATE, error: null };
    if (name === 'a23_authorize_actor_switch') return { data: TARGET_AUTHORITY, error: null };
    if (name === 'a23_prepare_enrollment') return { data: ENROLMENT_ALLOWED, error: null };
    if (name === 'a23_bind_auth_session') return { data: TARGET_AUTHORITY, error: null };
    return { data: null, error: null };
  });
}

function rpcCalls(name: string): Record<string, unknown>[] {
  return mocks.rpc.mock.calls
    .filter(([called]) => called === name)
    .map(([, args]) => args as Record<string, unknown>);
}

describe('shop-switch carries the session device binding into the target shop', () => {
  it('leaves a legacy unbound session exactly as before', async () => {
    tier('ultra');
    await expect(switchShop(caller, { shopId: 'shop-2' })).resolves.not.toHaveProperty('device');
    expect(rpcCalls('a23_authorize_actor_switch')).toHaveLength(0);
    expect(rpcCalls('a23_bind_auth_session')).toHaveLength(0);
    expect(mocks.updateUserById).toHaveBeenCalledTimes(1);
  });

  it('re-points the session at an existing target registration without rotating its secret', async () => {
    registry();
    const result = await switchShop(boundCaller, { shopId: 'shop-2' });

    expect(rpcCalls('a23_session_gate')[0]).toEqual({
      p_auth_session_id: 'session-1', p_shop_id: 'shop-1', p_actor_user_id: 'actor-1',
    });
    expect(rpcCalls('a23_authorize_actor_switch')).toEqual([{
      p_shop_id: 'shop-2', p_device_public_id: 'install-1',
      p_actor_user_id: 'actor-2', p_auth_session_id: 'session-1',
    }]);
    expect(rpcCalls('a23_bind_auth_session')).toHaveLength(0);
    expect(result).toMatchObject({ shop_id: 'shop-2', device: { deviceAuthority: TARGET_AUTHORITY } });
    expect((result as { device: Record<string, unknown> }).device).not.toHaveProperty('deviceSecret');
  });

  it('binds BEFORE the auth identity moves, so a refused target changes nothing', async () => {
    registry();
    await switchShop(boundCaller, { shopId: 'shop-2' });
    const bindOrder = mocks.rpc.mock.invocationCallOrder[
      mocks.rpc.mock.calls.findIndex(([name]) => name === 'a23_authorize_actor_switch')
    ];
    expect(bindOrder).toBeLessThan(mocks.updateUserById.mock.invocationCallOrder[0]);
  });

  it('registers the installation on its first visit and hands its new secret back once', async () => {
    registry({
      a23_authorize_actor_switch: () => ({ data: null, error: { code: 'MU066' } }),
    });
    const result = await switchShop(boundCaller, { shopId: 'shop-2', label: 'Counter', model: 'SM-A047F' });

    expect(rpcCalls('a23_prepare_enrollment')).toEqual([{
      p_shop_id: 'shop-2', p_actor_user_id: 'actor-2', p_device_public_id: 'install-1',
    }]);
    const [bind] = rpcCalls('a23_bind_auth_session');
    expect(bind).toMatchObject({
      p_auth_session_id: 'session-1', p_shop_id: 'shop-2', p_actor_user_id: 'actor-2',
      p_device_public_id: 'install-1', p_label: 'Counter', p_model: 'SM-A047F',
    });
    expect(bind.p_secret_hash).toMatch(/^[0-9a-f]{64}$/);
    const device = (result as { device: { deviceSecret: string; deviceAuthority: unknown } }).device;
    expect(device.deviceSecret).toMatch(/^[0-9a-f]{64}$/);
    // Only the digest is stored; the plaintext is never the value written.
    expect(device.deviceSecret).not.toBe(bind.p_secret_hash);
    expect(device.deviceAuthority).toEqual(TARGET_AUTHORITY);
  });

  it('also registers when the installation is known there but this owner has no binding yet', async () => {
    registry({
      a23_authorize_actor_switch: () => ({ data: null, error: { code: 'MU067' } }),
    });
    await switchShop(boundCaller, { shopId: 'shop-2' });
    expect(rpcCalls('a23_bind_auth_session')).toHaveLength(1);
  });

  it('carries the SESSION installation, never one named in the request body', async () => {
    registry({
      a23_authorize_actor_switch: () => ({ data: null, error: { code: 'MU066' } }),
    });
    await switchShop(boundCaller, { shopId: 'shop-2', devicePublicId: 'another-phone' });
    expect(rpcCalls('a23_prepare_enrollment')[0].p_device_public_id).toBe('install-1');
    expect(rpcCalls('a23_bind_auth_session')[0].p_device_public_id).toBe('install-1');
  });

  it('re-keys on request when the device holds no secret for the target', async () => {
    registry();
    const result = await switchShop(boundCaller, { shopId: 'shop-2', deviceSecretMissing: true });
    expect(rpcCalls('a23_authorize_actor_switch')).toHaveLength(0);
    expect(rpcCalls('a23_bind_auth_session')).toHaveLength(1);
    expect((result as { device: { deviceSecret?: string } }).device.deviceSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['the installation was revoked there', 'MU064', 'shop_switch_device_removed'],
    ['this owner was removed from the phone there', 'MU065', 'shop_switch_device_removed'],
  ])('refuses when %s, with a code that cannot quarantine the CURRENT shop', async (_label, sqlstate, code) => {
    registry({
      a23_authorize_actor_switch: () => ({ data: null, error: { code: sqlstate } }),
    });
    await expect(switchShop(boundCaller, { shopId: 'shop-2' }))
      .rejects.toMatchObject({ status: 403, code });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('refuses an enrolment the target shop is holding for approval', async () => {
    registry({
      a23_authorize_actor_switch: () => ({ data: null, error: { code: 'MU066' } }),
      a23_prepare_enrollment: () => ({
        data: { allowed: false, held: true, approved: false, enforced: true, legacyUnbound: false },
        error: null,
      }),
    });
    await expect(switchShop(boundCaller, { shopId: 'shop-2' }))
      .rejects.toMatchObject({ status: 403, code: 'shop_switch_approval_required' });
    expect(rpcCalls('a23_bind_auth_session')).toHaveLength(0);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('fails closed and transiently when the device gate cannot answer', async () => {
    registry({
      a23_session_gate: () => ({ data: null, error: { code: '08006' } }),
    });
    await expect(switchShop(boundCaller, { shopId: 'shop-2' }))
      .rejects.toMatchObject({ status: 503, code: 'device_gate_unavailable' });
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('puts the binding back on the source shop when the auth identity cannot move', async () => {
    registry();
    mocks.updateUserById.mockResolvedValueOnce({ error: { message: 'gotrue down' } });
    await expect(switchShop(boundCaller, { shopId: 'shop-2' })).rejects.toMatchObject({ status: 500 });
    expect(rpcCalls('a23_authorize_actor_switch')).toEqual([
      expect.objectContaining({ p_shop_id: 'shop-2', p_actor_user_id: 'actor-2' }),
      {
        p_shop_id: 'shop-1', p_device_public_id: 'install-1',
        p_actor_user_id: 'actor-1', p_auth_session_id: 'session-1',
      },
    ]);
  });
});
