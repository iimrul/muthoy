// Batch 3 E4-B — the publication writer, executed.
//
// Four properties, and the order of the first two is the point:
//
//   1. the PERMISSION is checked before anything is read, so a denied role
//      never learns whether a month would have been publishable — the denial is
//      not a filter applied to a result already computed;
//   2. ELIGIBILITY is checked before the RPC, so an ineligible month never
//      reaches SQL and the operator gets a readable reason rather than a
//      constraint name;
//   3. the figure sent to SQL is the shared gross-minus-refunds subtraction,
//      with the provenance that lets a later disagreement be detected;
//   4. a second call for a published month is reported as already published,
//      not as a failure and not as a second value.
//
// The refusal path is the COMMON case at beta scale, so it is tested as a
// first-class outcome rather than as an error branch.

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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { asPaisa } = await import('@muthoy/types');
const { recentAdminAudit } = await import('./adminAudit');
const { newSessionPayload, signAdminSession } = await import('./adminSession');
const { AdminForbiddenError, AdminDataError } = await import('./errors');
const { SUPPRESSION_K } = await import('./adminSuppression');
const { PUBLISH_RPC, daysOf, publishMonthlySnapshot, sourceDigest } = await import(
  './publicationWriter'
);

const SECRET = 'a'.repeat(32);
type Role = 'super_admin' | 'billing' | 'support' | 'read_only';

function envFor(role: Role): Record<string, string> {
  return {
    ADMIN_SESSION_SECRET: SECRET,
    ADMIN_ROLES: JSON.stringify({ founder: role }),
  };
}

async function signInAs(role: Role): Promise<void> {
  cookieStore.value = await signAdminSession(
    newSessionPayload({ sub: 'founder', role, epoch: 0, now: Date.now() }),
    SECRET,
  );
}

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function createClient(
  options: { rpcError?: string; publishedNow?: boolean; value?: number } = {},
) {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (options.rpcError !== undefined) {
        return Promise.resolve({ data: null, error: { message: options.rpcError } });
      }
      return Promise.resolve({
        data: [
          {
            publication_id: '7b000000-0000-4000-8000-000000000001',
            published_now: options.publishedNow ?? true,
            published_value_paisa: options.value ?? 40_000,
          },
        ],
        error: null,
      });
    },
  };
  return { client, rpcCalls };
}

function row(shop: number, day: string, paisa: number) {
  return { shopId: 'shop-' + shop, businessDate: day, amountPaisa: asPaisa(paisa) };
}

/** A month where `shops` distinct pharmacies both sell and refund every day. */
function eligible(days: readonly string[], shops = SUPPRESSION_K + 1) {
  const sales: ReturnType<typeof row>[] = [];
  const refunds: ReturnType<typeof row>[] = [];
  for (const day of days) {
    for (let shop = 1; shop <= shops; shop += 1) {
      sales.push(row(shop, day, 100_000));
      refunds.push(row(shop, day, 10_000));
    }
  }
  return { sales, refunds };
}

/**
 * The injected dependencies every call needs.
 *
 * `readAssignment` MATTERS and leaving it out is why the first version of this
 * file failed with "No valid admin session" on every test: the real reader
 * opens a Supabase connection, and an unreadable assignment store DENIES by
 * design (Batch 3 §4.3). These calls have no assignment row, which is the
 * unnarrowed case — authority is exactly what ADMIN_ROLES grants.
 */
function deps(role: Role, client: unknown, readSource: () => Promise<ReturnType<typeof eligible>>) {
  return {
    env: envFor(role),
    sinks: [recentAdminAudit],
    readAssignment: async () => null,
    client: client as never,
    readSource,
  };
}

beforeEach(() => {
  cookieStore.value = undefined;
  recentAdminAudit.clear();
});

describe('the permission comes first', () => {
  test('a role without publications.write is refused before the source is read', async () => {
    await signInAs('billing');
    let reads = 0;
    const { client, rpcCalls } = createClient();
    await expect(
      publishMonthlySnapshot('2026-08', deps('billing', client, async () => {
        reads += 1;
        return eligible(['2026-08-01']);
      })),
    ).rejects.toThrow(AdminForbiddenError);
    // NOT MERELY DENIED — it never looked. A denial applied after the read
    // would still have told a timing observer whether the month had data.
    expect(reads).toBe(0);
    expect(rpcCalls).toEqual([]);
  });

  test.each<Role>(['billing', 'support', 'read_only'])('%s cannot publish', async (role) => {
    await signInAs(role);
    const { client } = createClient();
    await expect(
      publishMonthlySnapshot('2026-08', deps(role, client, async () => eligible(['2026-08-01']))),
    ).rejects.toThrow(AdminForbiddenError);
  });

  test('super_admin can, so the test above is not passing by refusing everyone', async () => {
    await signInAs('super_admin');
    const { client, rpcCalls } = createClient();
    const result = await publishMonthlySnapshot('2026-08', deps('super_admin', client, async () => eligible(['2026-08-01'])));
    expect(result.ok).toBe(true);
    expect(rpcCalls).toHaveLength(1);
  });

  test('an unsigned caller is refused', async () => {
    const { client } = createClient();
    await expect(
      publishMonthlySnapshot('2026-08', deps('super_admin', client, async () => eligible(['2026-08-01']))),
    ).rejects.toThrow();
  });
});

describe('eligibility is enforced before SQL', () => {
  beforeEach(async () => {
    await signInAs('super_admin');
  });

  test('an ineligible month never reaches the RPC, and says why', async () => {
    const { client, rpcCalls } = createClient();
    const source = eligible(['2026-08-01']);
    // One pharmacy refunds on the second day. That day fails the refund-side
    // floor, so the whole month is unpublishable by composition.
    source.sales.push(row(1, '2026-08-02', 50_000));
    source.refunds.push(row(1, '2026-08-02', 500));

    const result = await publishMonthlySnapshot('2026-08', deps('super_admin', client, async () => source));
    expect(result.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
    if (!result.ok) {
      expect(result.message).toContain('1 of 2 trading days');
      // A readable sentence, not a constraint name.
      expect(result.message).not.toContain('financial_publications');
    }
  });

  test('a month below the cohort floor never reaches the RPC', async () => {
    const { client, rpcCalls } = createClient();
    const result = await publishMonthlySnapshot('2026-08', {
      ...deps('super_admin', client, async () => eligible(['2026-08-01'], 2)),
    });
    expect(result.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
  });

  test('a refusal is audited as denied, with the month as the target', async () => {
    const { client } = createClient();
    await publishMonthlySnapshot('2026-08', {
      ...deps('super_admin', client, async () => eligible(['2026-08-01'], 1)),
    });
    const entry = recentAdminAudit
      .entries()
      .find((item) => item.action === 'publication.refused');
    expect(entry?.outcome).toBe('denied');
    expect(entry?.target).toBe('2026-08');
    expect(entry?.actor).toBe('founder');
  });

  test('a period that has NOT ENDED is refused before it reaches SQL', async () => {
    // Not a reviewer finding -- this one came out of fixing the empty-period
    // defect, because refusing an empty period does not stop the sharper act:
    // publish a month on its first day, after one trading day that clears the
    // floor, and it is frozen at a day's worth of trade, irreversibly.
    //
    // `now` is injected so the test does not depend on the calendar, and the
    // RPC re-checks against the database's own `current_date` regardless.
    const { client, rpcCalls } = createClient();
    const result = await publishMonthlySnapshot('2026-08', {
      ...deps('super_admin', client, async () => eligible(['2026-08-01'])),
      now: () => new Date('2026-08-15T00:00:00.000Z'),
    });
    expect(result.ok).toBe(false);
    expect(rpcCalls).toEqual([]);
    if (!result.ok) {
      expect(result.message).toContain('has not ended');
      expect(result.message).toContain('2026-08-31');
    }
  });

  test('the SAME month publishes once it has ended, so the rule is the date and not the month', async () => {
    const { client, rpcCalls } = createClient();
    const result = await publishMonthlySnapshot('2026-08', {
      ...deps('super_admin', client, async () => eligible(['2026-08-01'])),
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    expect(rpcCalls).toHaveLength(1);
  });

  test('a malformed month is refused before it reaches SQL', async () => {
    const { client, rpcCalls } = createClient();
    for (const bad of ['2026-13', '2026-1', 'october', '2026-10-01', "2026-10'; drop table"]) {
      await expect(
        publishMonthlySnapshot(bad, deps('super_admin', client, async () => eligible(['2026-08-01']))),
      ).rejects.toThrow(AdminDataError);
    }
    expect(rpcCalls).toEqual([]);
  });
});

describe('what is sent to SQL', () => {
  beforeEach(async () => {
    await signInAs('super_admin');
  });

  test('carries the figure, its two sides and the eligibility that was true', async () => {
    const { client, rpcCalls } = createClient();
    const source = eligible(['2026-08-01', '2026-08-02']);
    await publishMonthlySnapshot('2026-08', deps('super_admin', client, async () => source));
    const args = rpcCalls[0]!.args;
    expect(rpcCalls[0]!.name).toBe(PUBLISH_RPC);
    // 12 sales at 1000.00, 12 refunds at 100.00.
    expect(args.p_gross_paisa).toBe(1_200_000);
    expect(args.p_refunds_paisa).toBe(120_000);
    expect(args.p_value_paisa).toBe(1_080_000);
    // The subtraction, asserted rather than assumed (CLAUDE.md rule 4).
    expect(args.p_value_paisa).toBe(
      (args.p_gross_paisa as number) - (args.p_refunds_paisa as number),
    );
    expect(args.p_source_sale_rows).toBe(12);
    expect(args.p_source_refund_rows).toBe(12);
    expect(args.p_days_requiring_floor).toBe(2);
    expect(args.p_days_clearing_floor).toBe(2);
    expect(args.p_contributor_count).toBe(SUPPRESSION_K + 1);
    expect(args.p_k_floor).toBe(SUPPRESSION_K);
    expect(args.p_published_by).toBe('founder');
  });

  test('sends a whole month, both ends, computed not guessed', async () => {
    const { client, rpcCalls } = createClient();
    await publishMonthlySnapshot('2024-02', deps('super_admin', client, async () => eligible(['2024-02-01'])));
    expect(rpcCalls[0]!.args.p_period_start).toBe('2024-02-01');
    // A leap February, so the end is arithmetic rather than a 28 somewhere.
    expect(rpcCalls[0]!.args.p_period_end).toBe('2024-02-29');
  });

  test('sends the declared metric and the single declared cohort', async () => {
    const { client, rpcCalls } = createClient();
    await publishMonthlySnapshot('2026-08', deps('super_admin', client, async () => eligible(['2026-08-01'])));
    expect(rpcCalls[0]!.args.p_metric_family).toBe('refund_net_pharmacy_sales');
    expect(rpcCalls[0]!.args.p_cohort_key).toBe('platform_all');
  });

  test('reports an RPC failure without leaking the SQL message', async () => {
    const { client } = createClient({
      rpcError: 'duplicate key value violates unique constraint "x" DETAIL: value_paisa=40000',
    });
    const result = await publishMonthlySnapshot('2026-08', deps('super_admin', client, async () => eligible(['2026-08-01'])));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The parameter list is money, and a SQL error can echo it back.
      expect(result.message).not.toContain('value_paisa');
      expect(result.message).not.toContain('40000');
      expect(result.message).toContain('server log');
    }
  });

  test('reports an already-published month as published, not as a failure', async () => {
    const { client } = createClient({ publishedNow: false });
    const result = await publishMonthlySnapshot('2026-08', deps('super_admin', client, async () => eligible(['2026-08-01'])));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toContain('already published');
  });
});

describe('the provenance digest', () => {
  test('is stable under row order, so drift means a real change', () => {
    const source = eligible(['2026-08-01']);
    const shuffled = {
      sales: [...source.sales].reverse(),
      refunds: [...source.refunds].reverse(),
    };
    expect(sourceDigest(shuffled)).toBe(sourceDigest(source));
  });

  test('changes when a single amount changes', () => {
    const source = eligible(['2026-08-01']);
    const changed = {
      sales: source.sales,
      refunds: [...source.refunds.slice(1), row(1, '2026-08-01', 10_001)],
    };
    expect(sourceDigest(changed)).not.toBe(sourceDigest(source));
  });

  test('distinguishes a sale from a refund of the same amount', () => {
    // Without the side marker, moving an amount from one side to the other
    // would leave the digest alone while reversing the figure's meaning.
    const one = { sales: [row(1, '2026-08-01', 500)], refunds: [] };
    const other = { sales: [], refunds: [row(1, '2026-08-01', 500)] };
    expect(sourceDigest(one)).not.toBe(sourceDigest(other));
  });

  test('distinguishes two shops from one shop twice', () => {
    const two = { sales: [row(1, '2026-08-01', 500), row(2, '2026-08-01', 500)], refunds: [] };
    const once = { sales: [row(1, '2026-08-01', 500), row(1, '2026-08-01', 500)], refunds: [] };
    expect(sourceDigest(two)).not.toBe(sourceDigest(once));
  });

  test('is a sha256 hex digest, which is what the column CHECK accepts', () => {
    expect(sourceDigest(eligible(['2026-08-01']))).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('the day split handed to the policy', () => {
  test('groups by business date and counts DISTINCT shops per side', () => {
    const days = daysOf({
      sales: [row(1, '2026-10-01', 100), row(1, '2026-10-01', 100), row(2, '2026-10-02', 100)],
      refunds: [row(3, '2026-10-01', 10)],
    });
    expect(days).toHaveLength(2);
    expect(days[0]).toEqual({
      day: '2026-10-01',
      saleShopIds: ['shop-1'],
      refundShopIds: ['shop-3'],
    });
    expect(days[1]).toEqual({
      day: '2026-10-02',
      saleShopIds: ['shop-2'],
      refundShopIds: [],
    });
  });

  test('buckets by the row own business date, not by when it arrived', () => {
    // Offline-first: a device syncing today sends rows carrying their original
    // business dates, and that is what the period is composed from.
    const days = daysOf({ sales: [row(1, '2026-09-28', 100)], refunds: [] });
    expect(days[0]?.day).toBe('2026-09-28');
  });
});
