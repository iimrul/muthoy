// Batch 3 E4-B — the publication reader, executed.
//
// The property that matters most is the FAILURE one: a read that cannot reach
// the table must not look like "nothing is published". Those two produce the
// same withheld cell on screen and mean completely different things, and only
// one of them is an outage somebody should be paged about.

import { describe, expect, test, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

const { readPublishedMonths } = await import('./publicationQueries');
const { resolveMonthlyMoney, periodEligibility, publishedAmount } = await import('./publication');

interface SelectCall {
  table: string;
  columns: string;
  filters: { method: string; args: unknown[] }[];
}

function createClient(options: { rows?: unknown[]; error?: string } = {}) {
  const calls: SelectCall[] = [];
  const client = {
    from(table: string) {
      const call: SelectCall = { table, columns: '', filters: [] };
      const builder: Record<string, unknown> = {
        select(columns: string) {
          call.columns = columns;
          calls.push(call);
          return builder;
        },
        eq(...args: unknown[]) {
          call.filters.push({ method: 'eq', args });
          return builder;
        },
        order(...args: unknown[]) {
          call.filters.push({ method: 'order', args });
          return Promise.resolve(
            options.error === undefined
              ? { data: options.rows ?? [], error: null }
              : { data: null, error: { message: options.error } },
          );
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

function dbRow(overrides: Record<string, unknown> = {}) {
  return {
    metric_family: 'refund_net_pharmacy_sales',
    cohort_key: 'platform_all',
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    // STRINGS, which is how PostgREST returns bigint. A reader that assumed
    // numbers would hand NaN to a money column.
    value_paisa: '400000',
    gross_paisa: '500000',
    refunds_paisa: '100000',
    source_sale_rows: 6,
    source_refund_rows: 6,
    source_digest: 'f'.repeat(64),
    k_floor: 5,
    contributor_count: 6,
    published_at: '2026-10-31T18:00:00.000Z',
    ...overrides,
  };
}

const NO_DAYS = periodEligibility([], []);

describe('reading published months', () => {
  test('returns a lookup keyed by YYYY-MM, with bigint strings converted', async () => {
    const { client } = createClient({ rows: [dbRow()] });
    const lookup = await readPublishedMonths({ client: client as never });
    const record = lookup('2026-10');
    expect(record?.valuePaisa).toBe(400_000);
    expect(record?.grossPaisa).toBe(500_000);
    expect(record?.refundsPaisa).toBe(100_000);
    expect(lookup('2026-09')).toBeUndefined();
  });

  test('filters on the declared metric, cohort and grain rather than reading everything', async () => {
    const { client, calls } = createClient({ rows: [] });
    await readPublishedMonths({ client: client as never });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe('financial_publications');
    const eqs = calls[0]!.filters
      .filter((entry) => entry.method === 'eq')
      .map((entry) => entry.args);
    expect(eqs).toEqual([
      ['metric_family', 'refund_net_pharmacy_sales'],
      ['cohort_key', 'platform_all'],
      ['period_grain', 'month'],
    ]);
  });

  test('names its columns instead of select(*)', async () => {
    const { client, calls } = createClient({ rows: [] });
    await readPublishedMonths({ client: client as never });
    expect(calls[0]!.columns).not.toContain('*');
    expect(calls[0]!.columns).toContain('value_paisa');
    expect(calls[0]!.columns).toContain('source_digest');
  });

  test('reads ONCE for a whole report, not once per bucket', async () => {
    const { client, calls } = createClient({
      rows: [dbRow(), dbRow({ period_start: '2026-09-01', period_end: '2026-09-30' })],
    });
    const lookup = await readPublishedMonths({ client: client as never });
    lookup('2026-10');
    lookup('2026-09');
    lookup('2026-08');
    expect(calls).toHaveLength(1);
  });

  test('a read FAILURE yields a throwing lookup, which becomes the failed state', async () => {
    // NOT an empty lookup. "Nothing is published" and "I could not find out"
    // render the same withheld cell and mean different things.
    const { client } = createClient({ error: 'relation "financial_publications" does not exist' });
    const lookup = await readPublishedMonths({ client: client as never });
    expect(() => lookup('2026-10')).toThrow(/unavailable/);

    const money = resolveMonthlyMoney('2026-10', NO_DAYS, lookup);
    expect(money.kind).toBe('failed');
    expect(publishedAmount(money)).toBeNull();
  });

  test('an EMPTY table yields something other than failed, so the states stay apart', async () => {
    const { client } = createClient({ rows: [] });
    const lookup = await readPublishedMonths({ client: client as never });
    const money = resolveMonthlyMoney('2026-10', NO_DAYS, lookup);
    // `no_activity` here, because this eligibility fixture has no trading days
    // at all. The point is that it is NOT `failed` — the distinction survives.
    expect(money.kind).not.toBe('failed');
  });

  test('refuses a money column that is not a safe integer rather than yielding NaN', async () => {
    const { client } = createClient({ rows: [dbRow({ value_paisa: 'not-a-number' })] });
    await expect(readPublishedMonths({ client: client as never })).rejects.toThrow(
      /not a safe integer/,
    );
  });

  test('a duplicate month resolves deterministically to the first row', async () => {
    const { client } = createClient({
      rows: [dbRow({ value_paisa: '400000' }), dbRow({ value_paisa: '111111' })],
    });
    const lookup = await readPublishedMonths({ client: client as never });
    // The unique constraint makes this unreachable through the RPC. It is
    // asserted anyway, because determinism should not depend on a claim about
    // another layer.
    expect(lookup('2026-10')?.valuePaisa).toBe(400_000);
  });
});
