// E11 / Decision 5 — the Dashboard asks the SERVER whether an account is
// entitled, and uses the answer it gets back.
//
// Three layers settle this change, and this file is the middle one:
//
//   this file   the RPC is issued at all, once per account, with the page's
//               own instant, and a failure is not answered around;
//   app/adminRoutes.contract.test.tsx
//               the rendered figures move when the verdict moves and the
//               snapshot does not;
//   backend/supabase/pgtest/e11-entitlement-verification.pgtest.ts
//               an unbacked claim really does answer 'free' on PostgreSQL.
//
// None of them is sufficient alone. A route test can pass while the app asks
// the wrong question; a unit test of `entitlementCounts` can pass while
// nothing ever fetches a verdict; and both can pass against a database that
// does not actually refuse an unbacked claim.

import { beforeEach, describe, expect, test, vi } from 'vitest';

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const supabase = vi.hoisted(() => ({
  rowsByTable: new Map<string, Record<string, unknown>[]>(),
  rpcCalls: [] as RpcCall[],
  /** `b4_effective_tier`'s answer per account id; absent means `null`. */
  tierByAccount: new Map<string, string | null>(),
  rpcError: null as string | null,
  /** Accounts whose RPC fails; empty means use `rpcError` for all of them. */
  failingAccounts: new Set<string>(),
  /** Runs on each RPC call, to simulate a concurrent write mid-fan-out. */
  onRpc: null as ((accountId: string) => void) | null,
}));

vi.mock('./supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      const rows = supabase.rowsByTable.get(table) ?? [];
      let isCount = false;
      const builder: Record<string, unknown> = {
        select: (_columns: string, options?: { count?: string; head?: boolean }) => {
          if (options?.head === true) isCount = true;
          return builder;
        },
        // A head count is awaited directly while a list read is awaited
        // through range(), so the builder has to be both. listPlanOfferings
        // cross-checks the count against the rows it loaded and refuses a
        // short read, so a double without this path fails every test here on
        // completeness rather than on anything they assert.
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
          (isCount
            ? Promise.resolve({ count: rows.length, error: null })
            : Promise.reject(new Error('awaited a list read without range()'))
          ).then(resolve, reject),
        range: (from: number, to: number) =>
          Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
      };
      for (const method of ['eq', 'neq', 'in', 'gte', 'lt', 'lte', 'order', 'limit']) {
        builder[method] = () => builder;
      }
      return builder;
    },
    rpc(name: string, args: Record<string, unknown>) {
      supabase.rpcCalls.push({ name, args });
      const accountId = String(args.p_billing_account_id);
      supabase.onRpc?.(accountId);
      const fails = supabase.rpcError !== null
        && (supabase.failingAccounts.size === 0 || supabase.failingAccounts.has(accountId));
      if (fails) {
        return Promise.resolve({ data: null, error: { message: supabase.rpcError } });
      }
      return Promise.resolve({
        data: supabase.tierByAccount.get(accountId) ?? null,
        error: null,
      });
    },
  }),
}));

const { AdminDataError } = await import('./errors');
const { dashboardOverview } = await import('./adminPlatformQueries');

const NOW = new Date('2026-10-31T06:00:00.000Z');
const A1 = '8a111111-1111-4111-8111-111111111111';
const A2 = '8a222222-2222-4222-8222-222222222222';

function snapshot(
  accountId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    billing_account_id: accountId,
    tier: 'pro',
    status: 'active',
    trial_ends_at: null,
    // Dates a status/date reading would call entitled, so a test that expects
    // 'free' is testing the verdict rather than the fixture.
    paid_through: '2026-12-01T00:00:00.000Z',
    grace_ends_at: null,
    verified_at: '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  supabase.rowsByTable = new Map();
  supabase.rpcCalls = [];
  supabase.tierByAccount = new Map();
  supabase.rpcError = null;
  supabase.failingAccounts = new Set();
  supabase.onRpc = null;
  supabase.rowsByTable.set('plan_offerings', [
    { tier: 'pro', billing_cycle: 'monthly', amount_paisa: 39_900, is_active: true },
  ]);
  supabase.rowsByTable.set('entitlement_snapshots', [snapshot(A1)]);
});

const verdictCalls = (): RpcCall[] =>
  supabase.rpcCalls.filter((call) => call.name === 'b4_effective_tier');

describe('the entitlement verdict is fetched, not derived', () => {
  test('one b4_effective_tier call per account in the snapshot read', async () => {
    supabase.rowsByTable.set('entitlement_snapshots', [snapshot(A1), snapshot(A2)]);
    supabase.tierByAccount.set(A1, 'pro');
    supabase.tierByAccount.set(A2, 'ultra');

    const overview = await dashboardOverview(NOW);

    expect(verdictCalls()).toHaveLength(2);
    expect(verdictCalls().map((call) => call.args.p_billing_account_id).sort())
      .toEqual([A1, A2].sort());
    expect(overview.entitlementVerdicts).toEqual([
      { billingAccountId: A1, status: 'active', effectiveTier: 'pro' },
      { billingAccountId: A2, status: 'active', effectiveTier: 'ultra' },
    ]);
  });

  test('p_now is the instant the PAGE was built for, not a fresh clock', async () => {
    // The page takes one clock reading and passes it to both reads so its
    // trend and its totals describe the same moment. A verdict computed from
    // the function's own `now()` default would be a second reading, and at a
    // period boundary the counts could disagree with the rest of the page.
    supabase.tierByAccount.set(A1, 'pro');

    await dashboardOverview(NOW);

    expect(verdictCalls()[0]?.args.p_now).toBe(NOW.toISOString());
  });

  test('the snapshot does NOT override the server: paid-looking dates, free verdict', async () => {
    // The fixture's own columns say pro/active with paid_through five weeks
    // out. This is the round-34 reproduction, at the fetch boundary.
    supabase.tierByAccount.set(A1, 'free');

    const overview = await dashboardOverview(NOW);

    expect(overview.entitlements[0]).toMatchObject({ tier: 'pro', status: 'active' });
    expect(overview.entitlementVerdicts).toEqual([
      { billingAccountId: A1, status: 'active', effectiveTier: 'free' },
    ]);
  });

  test('a null answer is free, exactly as every SQL caller coalesces it', async () => {
    // b4_effective_tier returns NULL when the account has no snapshot row, and
    // migration 37's own callers each wrap it in coalesce(...,'free'). Reading
    // it any other way would be a branch this app invented.
    const overview = await dashboardOverview(NOW);

    expect(verdictCalls()).toHaveLength(1);
    expect(overview.entitlementVerdicts[0]?.effectiveTier).toBe('free');
  });

  test('ONE account failing raises, although the other replied', async () => {
    // Review finding: the previous version of this test failed EVERY account,
    // so no successful peer existed and it never established that a partial
    // answer is refused -- which is the property it was named for. Only A2
    // fails here, and A1's verdict is available.
    supabase.rowsByTable.set('entitlement_snapshots', [snapshot(A1), snapshot(A2)]);
    supabase.tierByAccount.set(A1, 'pro');
    supabase.failingAccounts = new Set([A2]);
    supabase.rpcError = 'permission denied for function b4_effective_tier';

    await expect(dashboardOverview(NOW)).rejects.toThrow(AdminDataError);
    // The successful peer really did reply, so the refusal is about the
    // missing verdict and not about the whole read failing.
    expect(verdictCalls().map((call) => call.args.p_billing_account_id).sort())
      .toEqual([A1, A2].sort());
  });

  test('every account failing also raises', async () => {
    supabase.rpcError = 'permission denied for function b4_effective_tier';

    await expect(dashboardOverview(NOW)).rejects.toThrow(AdminDataError);
  });

  test('no accounts means no RPC traffic at all', async () => {
    supabase.rowsByTable.set('entitlement_snapshots', []);

    const overview = await dashboardOverview(NOW);

    expect(verdictCalls()).toEqual([]);
    expect(overview.entitlementVerdicts).toEqual([]);
  });

  test('the read path issues NO write RPC', async () => {
    // b4_reconcile_plan_limits is the only RPC this app may write through, and
    // lib/adminActions.ts is the only place permitted to call it. Rendering a
    // dashboard must not reconcile anybody's plan limits as a side effect.
    supabase.tierByAccount.set(A1, 'pro');

    await dashboardOverview(NOW);

    expect(supabase.rpcCalls.map((call) => call.name)).toEqual(['b4_effective_tier']);
  });

  // ── The coherence check ─────────────────────────────────────────────────
  //
  // Review finding, reproduced on real PostgreSQL by the reviewer: `status`
  // comes from the snapshot read and the verdict from a later round trip, so a
  // row that moved between them was reported as a pair the SQL CASE cannot
  // produce. These two tests pin the refusal and its non-vacuity.

  test('a snapshot that MOVES mid-fan-out is refused, not reported', async () => {
    // Exactly the reviewer's sequence: read as `trialing`, then the account
    // becomes a backed `pro/active` before the verdict is fetched. The old
    // code answered `{trialing: 1, currentlyPaid: 0}` for a paying customer.
    supabase.rowsByTable.set('entitlement_snapshots', [
      snapshot(A1, { tier: 'free', status: 'trialing', trial_ends_at: '2026-11-10T00:00:00.000Z', paid_through: null }),
    ]);
    supabase.tierByAccount.set(A1, 'pro');
    supabase.onRpc = () => {
      supabase.rowsByTable.set('entitlement_snapshots', [snapshot(A1)]);
    };

    await expect(dashboardOverview(NOW)).rejects.toThrow(AdminDataError);
  });

  test('a verification STAMP is not a move, so ordinary polling does not refuse the page', async () => {
    // b4_refresh_entitlement_snapshot bumps verified_at and version on every
    // device poll. If those counted as a move, the dashboard would refuse
    // almost every load -- so the token covers only the columns the SQL CASE
    // reads. This is the control that keeps the check above from being
    // stricter than it should be.
    supabase.tierByAccount.set(A1, 'pro');
    supabase.onRpc = () => {
      supabase.rowsByTable.set('entitlement_snapshots', [
        snapshot(A1, { verified_at: '2026-10-31T06:00:00.000Z' }),
      ]);
    };

    const overview = await dashboardOverview(NOW);

    expect(overview.entitlementVerdicts).toEqual([
      { billingAccountId: A1, status: 'active', effectiveTier: 'pro' },
    ]);
  });

  test('NEGATIVE CONTROL: the double can answer non-free, so the free cases are not vacuous', async () => {
    supabase.tierByAccount.set(A1, 'ultra');

    const overview = await dashboardOverview(NOW);

    expect(overview.entitlementVerdicts[0]?.effectiveTier).toBe('ultra');
  });
});
