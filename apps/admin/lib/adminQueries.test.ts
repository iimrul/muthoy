// W4-07 — the reads, executed against a doubled Supabase client.
//
// Three properties are worth a test here, and none of them is "the SQL is
// right": that is what the live grant and the pgtest answer. These are the ones
// a doubled client CAN settle:
//
//  1. a drill-down parameter is validated BEFORE a query is built, so a
//     malformed id never becomes a filter on a service-role read;
//  2. a page is bounded — the pager keeps asking until an empty page arrives,
//     and a failing read raises AdminDataError instead of a half list;
//  3. no client-supplied ordering or column list reaches PostgREST: the
//     select/order/filter calls are fixed in the source.

import { beforeEach, describe, expect, test, vi } from 'vitest';

interface RecordedCall {
  table: string;
  select: string | null;
  filters: { method: string; args: unknown[] }[];
}

const supabase = vi.hoisted(() => ({
  calls: [] as RecordedCall[],
  rowsByTable: new Map<string, Record<string, unknown>[]>(),
  errorTable: null as string | null,
  countByTable: new Map<string, number>(),
  responseCap: Number.POSITIVE_INFINITY,
}));

vi.mock('./supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const call: RecordedCall = { table, select: null, filters: [] };
      supabase.calls.push(call);

      const rows = supabase.rowsByTable.get(table) ?? [];
      let range: { from: number; to: number } | null = null;

      let isCount = false;

      const builder: Record<string, unknown> = {
        select(columns: string, options?: { count?: string; head?: boolean }) {
          call.select = columns + (options?.count ? ' count:' + options.count : '');
          // A head count is awaited directly, but the real code chains .eq()
          // filters after it — so the builder stays chainable and becomes a
          // thenable instead of resolving here.
          if (options?.head === true) isCount = true;
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          if (!isCount) {
            return Promise.reject(new Error('awaited a list read without range()')).then(resolve, reject);
          }
          return Promise.resolve(
            supabase.errorTable === table
              ? { count: null, error: { message: table + ' count failed' } }
              : { count: supabase.countByTable.get(table) ?? rows.length, error: null },
          ).then(resolve, reject);
        },
        range(from: number, to: number) {
          range = { from, to };
          return Promise.resolve(
            supabase.errorTable === table
              ? { data: null, error: { message: table + ' read failed' } }
              : { data: rows.slice(from, Math.min(to + 1, from + supabase.responseCap)), error: null },
          );
        },
        maybeSingle() {
          return Promise.resolve(
            supabase.errorTable === table
              ? { data: null, error: { message: table + ' read failed' } }
              : { data: rows[0] ?? null, error: null },
          );
        },
      };

      for (const method of ['eq', 'neq', 'in', 'gte', 'lt', 'lte', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          call.filters.push({ method, args });
          return builder;
        };
      }
      // Referenced so the recorded range is observable in a failure message.
      builder.appliedRange = () => range;
      return builder;
    },
  }),
}));

const { AdminDataError } = await import('./errors');
const { getAccountDetail, getShopDetail, listAccountSummaries, listPaymentOrderSummaries, listSubscriptionSummaries } =
  await import('./adminQueries');

const ACCOUNT = '86666666-6666-4666-8666-666666666666';
const SHOP = '81111111-1111-4111-8111-111111111111';

function seed(table: string, rows: Record<string, unknown>[]): void {
  supabase.rowsByTable.set(table, rows);
}

beforeEach(() => {
  supabase.calls = [];
  supabase.rowsByTable = new Map();
  supabase.errorTable = null;
  supabase.countByTable = new Map();
  supabase.responseCap = Number.POSITIVE_INFINITY;
  seed('shops', [{
    id: SHOP, name: 'Alpha Pharmacy', phone: '01700000011', created_at: '2026-09-01T06:00:00.000Z',
    plan: 'pro', commercial_status: 'active', commercial_reason: null, archived_at: null,
    billing_account_id: ACCOUNT,
  }]);
  seed('billing_accounts', [{
    id: ACCOUNT, principal_owner_user_id: 'owner-1', primary_shop_id: SHOP,
    launch_trial_granted_at: null, created_at: '2026-09-01T06:00:00.000Z',
  }]);
  seed('entitlement_snapshots', [{
    billing_account_id: ACCOUNT, tier: 'pro', status: 'active', trial_ends_at: null,
    paid_through: '2026-11-01T06:00:00.000Z', grace_ends_at: null, verified_at: '2026-10-01T06:00:00.000Z',
  }]);
  seed('shop_memberships', [{
    id: 'm1', billing_account_id: ACCOUNT, shop_id: SHOP, principal_user_id: 'owner-1',
    role: 'owner', is_active: true, created_at: '2026-09-01T06:00:00.000Z',
  }]);
  seed('plan_offerings', [{ tier: 'pro', billing_cycle: 'monthly', amount_paisa: 39_900, is_active: true }]);
  seed('billing_subscriptions', []);
  seed('payment_orders', []);
  seed('payment_provider_events', []);
  seed('sales', []);
  seed('users', []);
});

describe('drill-down parameters are validated before any query', () => {
  test.each([
    ['a bare word', 'founder'],
    ['a PostgREST filter', 'eq.' + ACCOUNT],
    ['a SQL fragment', "' or 1=1--"],
    ['an empty string', ''],
    ['a wildcard', '*'],
  ])('getAccountDetail refuses %s and builds NO query', async (_label, id) => {
    await expect(getAccountDetail(id)).rejects.toBeInstanceOf(AdminDataError);
    expect(supabase.calls).toEqual([]);
  });

  test.each([
    ['a bare word', 'shop'],
    ['a traversal', '../../etc/passwd'],
    ['a wildcard', '%'],
  ])('getShopDetail refuses %s and builds NO query', async (_label, id) => {
    await expect(getShopDetail(id)).rejects.toBeInstanceOf(AdminDataError);
    expect(supabase.calls).toEqual([]);
  });

  test('the refusal message never echoes the caller-supplied id', async () => {
    const probe = "' or 1=1--";
    await expect(getAccountDetail(probe)).rejects.toThrow(/account is not a valid id/);
    await expect(getAccountDetail(probe)).rejects.not.toThrow(new RegExp(probe.slice(0, 4)));
  });
});

describe('the reads themselves', () => {
  test('a smaller response cap preserves every account, order and provider event', async () => {
    const secondAccount = '86666666-6666-4666-8666-666666666667';
    const secondShop = '81111111-1111-4111-8111-111111111112';
    seed('billing_accounts', [
      ...(supabase.rowsByTable.get('billing_accounts') ?? []),
      { id: secondAccount, primary_shop_id: secondShop, principal_owner_user_id: 'owner-2', created_at: '2026-10-01T00:00:00Z' },
    ]);
    seed('shops', [
      ...(supabase.rowsByTable.get('shops') ?? []),
      { id: secondShop, name: 'Second pharmacy', billing_account_id: secondAccount, created_at: '2026-10-01T00:00:00Z' },
    ]);
    seed('payment_orders', ['order-a', 'order-b'].map((id) => ({
      id, billing_account_id: ACCOUNT, amount_paisa: 100, status: 'created',
      tier: 'pro', billing_cycle: 'monthly', created_at: '2026-10-01T00:00:00Z',
    })));
    seed('payment_provider_events', ['event-a', 'event-b'].map((id) => ({
      id, payment_order_id: 'order-a', processing_status: 'received', received_at: '2026-10-01T00:00:00Z',
    })));
    supabase.responseCap = 1;

    expect(await listAccountSummaries()).toHaveLength(2);
    expect((await getAccountDetail(secondAccount))?.account.primaryShopName).toBe('Second pharmacy');
    const orders = await listPaymentOrderSummaries();
    expect(orders).toHaveLength(2);
    expect(orders.find((order) => order.id === 'order-a')?.eventCount).toBe(2);
  });

  test('listAccountSummaries joins the four reads into one summary', async () => {
    const summaries = await listAccountSummaries();

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: ACCOUNT,
      primaryShopName: 'Alpha Pharmacy',
      tier: 'pro',
      status: 'active',
      shopCount: 1,
      activeMemberCount: 1,
    });
    expect([...new Set(supabase.calls.map((call) => call.table))].sort()).toEqual([
      'billing_accounts',
      'entitlement_snapshots',
      'shop_memberships',
      'shops',
    ]);
  });

  test('getAccountDetail scopes the subscription read to the validated id', async () => {
    seed('billing_subscriptions', [{
      id: 's1', billing_account_id: ACCOUNT, tier: 'pro', billing_cycle: 'monthly', status: 'active',
      starts_at: '2026-10-01T06:00:00.000Z', paid_through: '2026-11-01T06:00:00.000Z',
      grace_ends_at: null, canceled_at: null, provider: 'sslcommerz', created_at: '2026-10-01T06:00:00.000Z',
    }]);

    const detail = await getAccountDetail(ACCOUNT);

    expect(detail?.subscriptions).toHaveLength(1);
    const subscriptionCall = supabase.calls.find((call) => call.table === 'billing_subscriptions');
    expect(subscriptionCall?.filters).toEqual(
      expect.arrayContaining([{ method: 'eq', args: ['billing_account_id', ACCOUNT] }]),
    );
  });

  test('getAccountDetail answers null for an id that is well-formed but absent', async () => {
    expect(await getAccountDetail('89999999-9999-4999-8999-999999999999')).toBeNull();
  });

  test('getShopDetail returns the shop, its staff count and GROSS day sales', async () => {
    supabase.countByTable.set('users', 3);
    seed('sales', [{ total: 1_000 }, { total: 2_500 }]);

    const detail = await getShopDetail(SHOP, new Date('2026-10-22T06:00:00.000Z'));

    expect(detail).toMatchObject({
      accountId: ACCOUNT,
      tier: 'pro',
      entitlementStatus: 'active',
      activeStaffCount: 3,
      grossSalesTodayPaisa: 3_500,
      saleCountToday: 2,
    });
  });

  test('getShopDetail bounds the sales read to the Dhaka day', async () => {
    await getShopDetail(SHOP, new Date('2026-10-22T06:00:00.000Z'));

    const salesCall = supabase.calls.find((call) => call.table === 'sales');
    const methods = salesCall?.filters.map((filter) => filter.method) ?? [];
    expect(methods).toContain('gte');
    expect(methods).toContain('lt');
    // 00:00 Dhaka on 2026-10-22 is 18:00 UTC on the 21st.
    expect(salesCall?.filters).toEqual(
      expect.arrayContaining([{ method: 'gte', args: ['created_at', '2026-10-21T18:00:00.000Z'] }]),
    );
  });

  test('getShopDetail answers null for an absent shop rather than an empty page', async () => {
    seed('shops', []);
    expect(await getShopDetail(SHOP)).toBeNull();
  });

  test('a failing read raises AdminDataError, never a partial list', async () => {
    supabase.errorTable = 'billing_accounts';
    await expect(listAccountSummaries()).rejects.toBeInstanceOf(AdminDataError);

    supabase.errorTable = 'payment_orders';
    await expect(listPaymentOrderSummaries()).rejects.toBeInstanceOf(AdminDataError);

    supabase.errorTable = 'billing_subscriptions';
    await expect(listSubscriptionSummaries()).rejects.toBeInstanceOf(AdminDataError);
  });

  test('a failing read does not leak the driver message to the caller', async () => {
    supabase.errorTable = 'shops';
    await expect(getShopDetail(SHOP)).rejects.toThrow(/shop detail query failed/);
    await expect(getShopDetail(SHOP)).rejects.not.toThrow(/read failed/);
  });

  test('every list is paged — the reader asks with an explicit range', async () => {
    await listAccountSummaries();
    for (const call of supabase.calls) {
      // A head-count call has no range; every list read must have one.
      if (call.select?.includes('count')) continue;
      expect(call.filters.some((filter) => filter.method === 'order')).toBe(true);
    }
  });

  test('no query takes a column list or ordering from anything but the source', async () => {
    await listSubscriptionSummaries();
    await listPaymentOrderSummaries();

    for (const call of supabase.calls) {
      expect(call.select ?? '').not.toMatch(/[*;]/);
      for (const filter of call.filters) {
        for (const argument of filter.args) {
          // Every filter argument is a literal from the source or a validated
          // uuid — never a caller-shaped string with PostgREST syntax in it.
          if (typeof argument === 'string') expect(argument).not.toMatch(/[,;()*]/);
        }
      }
    }
  });
});
