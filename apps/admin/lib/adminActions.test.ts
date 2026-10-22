// W4-08 — the three write actions, executed.
//
// What has to be true of an admin write, and is asserted here one by one:
//
//  - the PERMISSION is checked before anything else, so a denied role never
//    reaches a client, an RPC or a table — the denial is not a filter applied
//    to a result that was already fetched;
//  - the id is validated, so a route-shaped string cannot become a filter;
//  - each action is IDEMPOTENT: the two RPCs re-derive state from source rows,
//    and the one direct update carries the guard that makes a second click a
//    no-op rather than a second effect;
//  - success AND failure are audited, with the actor, the role and the target;
//  - nothing grants an entitlement. Only the verified webhook may do that.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'muthoy_admin_session' && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));
// The real module would need a Next request scope; the action's own revalidate
// hook is injected in these tests instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { recentAdminAudit } = await import('./adminAudit');
const { newSessionPayload, signAdminSession } = await import('./adminSession');
const { AdminForbiddenError, AdminDataError } = await import('./errors');
const { expireStalePaymentOrder, reconcilePlanLimits, refreshEntitlementSnapshot } =
  await import('./adminActions');

const SECRET = 'a'.repeat(32);
const ACCOUNT = '86666666-6666-4666-8666-666666666666';
const ORDER = '7b000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-22T06:00:00.000Z');

function envFor(role: 'super_admin' | 'billing' | 'support' | 'read_only'): Record<string, string> {
  return {
    ADMIN_SESSION_SECRET: SECRET,
    ADMIN_ROLES: JSON.stringify({ founder: role }),
  };
}

async function signInAs(role: 'super_admin' | 'billing' | 'support' | 'read_only'): Promise<void> {
  cookieStore.value = await signAdminSession(
    newSessionPayload({ sub: 'founder', role, epoch: 0, now: Date.now() }),
    SECRET,
  );
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
  filters: { method: string; args: unknown[] }[];
}

function createClient(options: { rpcError?: string; updateError?: string; updated?: unknown[] } = {}) {
  const rpcCalls: RpcCall[] = [];
  const updateCalls: UpdateCall[] = [];

  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return Promise.resolve(
        options.rpcError === undefined
          ? { data: null, error: null }
          : { data: null, error: { message: options.rpcError } },
      );
    },
    from(table: string) {
      const call: UpdateCall = { table, values: {}, filters: [] };
      const builder: Record<string, unknown> = {
        update(values: Record<string, unknown>) {
          call.values = values;
          updateCalls.push(call);
          return builder;
        },
        select() {
          return Promise.resolve(
            options.updateError === undefined
              ? { data: options.updated ?? [{ id: ORDER, status: 'expired' }], error: null }
              : { data: null, error: { message: options.updateError } },
          );
        },
      };
      for (const method of ['eq', 'in', 'lte', 'gte', 'order']) {
        builder[method] = (...args: unknown[]) => {
          call.filters.push({ method, args });
          return builder;
        };
      }
      return builder;
    },
  };

  return { client, rpcCalls, updateCalls };
}

function deps(role: 'super_admin' | 'billing' | 'support' | 'read_only', client?: unknown) {
  return {
    env: envFor(role),
    now: () => NOW,
    sinks: [recentAdminAudit],
    revalidate: () => undefined,
    ...(client === undefined ? {} : { client: client as never }),
  };
}

beforeEach(() => {
  cookieStore.value = undefined;
  recentAdminAudit.clear();
});

describe('permission comes first', () => {
  test.each([
    ['read_only', 'refreshEntitlementSnapshot'],
    ['support', 'refreshEntitlementSnapshot'],
    ['read_only', 'reconcilePlanLimits'],
    ['support', 'reconcilePlanLimits'],
  ])('%s cannot run %s, and no RPC is reached', async (role, _action) => {
    await signInAs(role as 'support');
    const { client, rpcCalls } = createClient();

    await expect(refreshEntitlementSnapshot(ACCOUNT, deps(role as 'support', client)))
      .rejects.toBeInstanceOf(AdminForbiddenError);
    await expect(reconcilePlanLimits(ACCOUNT, deps(role as 'support', client)))
      .rejects.toBeInstanceOf(AdminForbiddenError);

    expect(rpcCalls).toEqual([]);
  });

  test.each(['read_only', 'billing'])('%s cannot expire a payment order', async (role) => {
    await signInAs(role as 'billing');
    const { client, updateCalls } = createClient();

    await expect(expireStalePaymentOrder(ORDER, deps(role as 'billing', client)))
      .rejects.toBeInstanceOf(AdminForbiddenError);

    expect(updateCalls).toEqual([]);
  });

  test('a denial is audited with the permission that was missing', async () => {
    await signInAs('read_only');
    const { client } = createClient();

    await expect(refreshEntitlementSnapshot(ACCOUNT, deps('read_only', client))).rejects.toThrow();

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      role: 'read_only',
      action: 'authz.denied',
      outcome: 'denied',
      meta: { permission: 'subscriptions.write' },
    }]);
  });

  test('no session at all is refused before any client is built', async () => {
    const { client, rpcCalls, updateCalls } = createClient();

    await expect(refreshEntitlementSnapshot(ACCOUNT, deps('super_admin', client))).rejects.toThrow();
    await expect(expireStalePaymentOrder(ORDER, deps('super_admin', client))).rejects.toThrow();

    expect(rpcCalls).toEqual([]);
    expect(updateCalls).toEqual([]);
  });

  test('a demoted role loses the action on the next call, cookie unchanged', async () => {
    await signInAs('billing');
    const { client, rpcCalls } = createClient();

    await expect(refreshEntitlementSnapshot(ACCOUNT, deps('billing', client))).resolves.toMatchObject({ ok: true });
    // Same cookie, ADMIN_ROLES now says support.
    await expect(refreshEntitlementSnapshot(ACCOUNT, deps('support', client)))
      .rejects.toBeInstanceOf(AdminForbiddenError);

    expect(rpcCalls).toHaveLength(1);
  });
});

describe('refreshEntitlementSnapshot', () => {
  test('calls the existing SECURITY DEFINER RPC with the account id and nothing else', async () => {
    await signInAs('billing');
    const { client, rpcCalls } = createClient();

    const result = await refreshEntitlementSnapshot(ACCOUNT, deps('billing', client));

    expect(result).toMatchObject({ ok: true });
    expect(rpcCalls).toEqual([
      { name: 'b4_refresh_entitlement_snapshot', args: { p_billing_account_id: ACCOUNT } },
    ]);
  });

  test('is idempotent: the second call is the same single call', async () => {
    await signInAs('billing');
    const { client, rpcCalls } = createClient();

    await refreshEntitlementSnapshot(ACCOUNT, deps('billing', client));
    await refreshEntitlementSnapshot(ACCOUNT, deps('billing', client));

    expect(rpcCalls).toEqual([rpcCalls[0], rpcCalls[0]]);
  });

  test('audits the success with actor, role and target', async () => {
    await signInAs('super_admin');
    const { client } = createClient();

    await refreshEntitlementSnapshot(ACCOUNT, deps('super_admin', client));

    expect(recentAdminAudit.entries()).toMatchObject([{
      actor: 'founder',
      role: 'super_admin',
      action: 'subscription.refresh_snapshot',
      target: ACCOUNT,
      outcome: 'success',
    }]);
  });

  test('an RPC failure is audited, reported safely, and never thrown raw', async () => {
    await signInAs('billing');
    const { client } = createClient({ rpcError: 'permission denied for function' });

    const result = await refreshEntitlementSnapshot(ACCOUNT, deps('billing', client));

    expect(result).toMatchObject({ ok: false });
    expect(result.message).not.toContain('permission denied');
    expect(recentAdminAudit.entries()).toMatchObject([{ outcome: 'failure', meta: { reason: 'rpc_failed' } }]);
  });

  test.each([
    ['a bare word', 'founder'],
    ['a PostgREST filter', 'eq.' + ACCOUNT],
    ['an empty string', ''],
  ])('refuses %s without calling the RPC', async (_label, id) => {
    await signInAs('billing');
    const { client, rpcCalls } = createClient();

    await expect(refreshEntitlementSnapshot(id, deps('billing', client))).rejects.toBeInstanceOf(AdminDataError);
    expect(rpcCalls).toEqual([]);
  });
});

describe('reconcilePlanLimits', () => {
  test('passes the account id and an explicit timestamp', async () => {
    await signInAs('billing');
    const { client, rpcCalls } = createClient();

    await reconcilePlanLimits(ACCOUNT, deps('billing', client));

    expect(rpcCalls).toEqual([{
      name: 'b4_reconcile_plan_limits',
      args: { p_billing_account_id: ACCOUNT, p_now: NOW.toISOString() },
    }]);
  });

  test('audits its own action name, not the other one', async () => {
    await signInAs('billing');
    const { client } = createClient();

    await reconcilePlanLimits(ACCOUNT, deps('billing', client));

    expect(recentAdminAudit.entries()[0]).toMatchObject({ action: 'subscription.reconcile_limits' });
  });
});

describe('expireStalePaymentOrder — the only direct write in the panel', () => {
  test('carries the SAME guard billingStatus uses, and touches two columns only', async () => {
    await signInAs('support');
    const { client, updateCalls } = createClient();

    const result = await expireStalePaymentOrder(ORDER, deps('support', client));

    expect(result).toMatchObject({ ok: true });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.table).toBe('payment_orders');
    expect(updateCalls[0]?.values).toEqual({
      status: 'expired',
      failure_code: 'checkout_expired',
      updated_at: NOW.toISOString(),
    });
    expect(updateCalls[0]?.filters).toEqual([
      { method: 'eq', args: ['id', ORDER] },
      { method: 'in', args: ['status', ['created', 'pending']] },
      { method: 'lte', args: ['expires_at', NOW.toISOString()] },
    ]);
  });

  test('a second click changes nothing and says so, rather than reporting success', async () => {
    await signInAs('support');
    // The guard matched no row: already expired, already terminal, or still live.
    const { client } = createClient({ updated: [] });

    const result = await expireStalePaymentOrder(ORDER, deps('support', client));

    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('not a stale open order');
    expect(recentAdminAudit.entries()).toMatchObject([{ outcome: 'failure', meta: { reason: 'not_stale' } }]);
  });

  test('it can never grant an entitlement — no RPC is called at all', async () => {
    await signInAs('support');
    const { client, rpcCalls } = createClient();

    await expireStalePaymentOrder(ORDER, deps('support', client));

    expect(rpcCalls).toEqual([]);
  });

  test('it writes to payment_orders and to no other table', async () => {
    await signInAs('super_admin');
    const { client, updateCalls } = createClient();

    await expireStalePaymentOrder(ORDER, deps('super_admin', client));

    expect([...new Set(updateCalls.map((call) => call.table))]).toEqual(['payment_orders']);
  });

  test('a failing update is audited and reported without the driver message', async () => {
    await signInAs('support');
    const { client } = createClient({ updateError: 'permission denied for table payment_orders' });

    const result = await expireStalePaymentOrder(ORDER, deps('support', client));

    expect(result).toMatchObject({ ok: false });
    expect(result.message).not.toContain('permission denied');
    expect(recentAdminAudit.entries()).toMatchObject([{ outcome: 'failure', meta: { reason: 'update_failed' } }]);
  });

  test.each([
    ['a bare word', 'order'],
    ['a wildcard', '*'],
  ])('refuses %s without building an update', async (_label, id) => {
    await signInAs('support');
    const { client, updateCalls } = createClient();

    await expect(expireStalePaymentOrder(id, deps('support', client))).rejects.toBeInstanceOf(AdminDataError);
    expect(updateCalls).toEqual([]);
  });

  test('the audit target is the order, so the record names what was changed', async () => {
    await signInAs('support');
    const { client } = createClient();

    await expireStalePaymentOrder(ORDER, deps('support', client));

    expect(recentAdminAudit.entries()).toMatchObject([{
      action: 'payment.expire_stale_order',
      target: ORDER,
      outcome: 'success',
      role: 'support',
    }]);
  });
});
