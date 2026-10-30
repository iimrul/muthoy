// Batch 3 E4-B — the publication reader, executed.
//
// Two properties carry this file.
//
// THE FIRST is that a read which cannot reach the table must not look like
// "nothing is published". Those two produce the same withheld cell and mean
// completely different things, and only one of them is an outage.
//
// THE SECOND is the audit cross-check, and it is ROUND 20 FINDING 1. The RPC
// refuses to republish a period it finds in `admin_audit_log`, so the WRITER
// treats that log as authoritative. The reader did not — it read an absent
// serving row as "never published" — so after the documented class-B rollback,
// where the audit history survives and the serving rows do not, the reader
// reported "nothing is published" for a period that certainly was. Both sides
// read the same evidence now.

import { describe, expect, test, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

const { readPublishedMonths } = await import('./publicationQueries');
const { resolveMonthlyMoney, periodEligibility, publishedAmount, publicationsByMonth } =
  await import('./publication');

interface SelectCall {
  table: string;
  columns: string;
  countRequested?: string;
  filters: { method: string; args: unknown[] }[];
}

interface ClientOptions {
  rows?: unknown[];
  error?: string;
  /** The EXACT count the server reports; omit to match the rows returned. */
  count?: number;
  auditCount?: number;
  /** Rows for `admin_audit_log`, as `{ target }`. */
  auditTargets?: (string | null)[];
  auditError?: string;
}

/**
 * A fake Supabase client for two tables.
 *
 * THENABLE at every stage, because the real builder is: the publications query
 * resolves after `.order(...)` and the audit query resolves after its last
 * `.eq(...)`, and a fake that only resolved at one of those shapes would force
 * the production code to be written around the fake.
 */
function createClient(options: ClientOptions = {}) {
  const calls: SelectCall[] = [];
  const client = {
    from(table: string) {
      const call: SelectCall = { table, columns: '', filters: [] };
      const result = () => {
        if (table === 'admin_audit_log') {
          if (options.auditError !== undefined) {
            return { data: null, error: { message: options.auditError }, count: null };
          }
          const audit = (options.auditTargets ?? []).map((target) => ({ target }));
          return { data: audit, error: null, count: options.auditCount ?? audit.length };
        }
        if (options.error !== undefined) {
          return { data: null, error: { message: options.error }, count: null };
        }
        const pubs = options.rows ?? [];
        return { data: pubs, error: null, count: options.count ?? pubs.length };
      };
      const builder: Record<string, unknown> = {
        select(columns: string, opts?: { count?: string }) {
          call.columns = columns;
          call.countRequested = opts?.count;
          calls.push(call);
          return builder;
        },
        eq(...args: unknown[]) {
          call.filters.push({ method: 'eq', args });
          return builder;
        },
        order(...args: unknown[]) {
          call.filters.push({ method: 'order', args });
          return builder;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve);
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

const AUDITED_OCTOBER = 'refund_net_pharmacy_sales:platform_all:2026-10';
const NO_DAYS = periodEligibility([], []);

describe('reading the published set', () => {
  test('returns the records, with bigint strings converted', async () => {
    const { client } = createClient({ rows: [dbRow()], auditTargets: [AUDITED_OCTOBER] });
    const set = await readPublishedMonths({ client: client as never });
    const record = publicationsByMonth(set)?.get('2026-10');
    expect(record?.valuePaisa).toBe(400_000);
    expect(record?.grossPaisa).toBe(500_000);
    expect(record?.refundsPaisa).toBe(100_000);
    expect(publicationsByMonth(set)?.get('2026-09')).toBeUndefined();
  });

  test('filters on the declared metric, cohort and grain rather than reading everything', async () => {
    const { client, calls } = createClient({ rows: [] });
    await readPublishedMonths({ client: client as never });
    const publications = calls.find((call) => call.table === 'financial_publications');
    expect(publications).toBeDefined();
    const eqs = (publications?.filters ?? [])
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
    const columns = calls.find((call) => call.table === 'financial_publications')?.columns ?? '';
    expect(columns).not.toContain('*');
    expect(columns).toContain('value_paisa');
    expect(columns).toContain('source_digest');
  });

  test('reads each table ONCE for a whole report, not once per bucket', async () => {
    const { client, calls } = createClient({
      rows: [dbRow(), dbRow({ period_start: '2026-09-01', period_end: '2026-09-30' })],
      auditTargets: [AUDITED_OCTOBER, 'refund_net_pharmacy_sales:platform_all:2026-09'],
    });
    const set = await readPublishedMonths({ client: client as never });
    const byMonth = publicationsByMonth(set);
    byMonth?.get('2026-10');
    byMonth?.get('2026-09');
    byMonth?.get('2026-08');
    expect(calls).toHaveLength(2);
  });

  test('a read FAILURE yields unavailable, which is not the same as empty', async () => {
    const { client } = createClient({ error: 'relation "financial_publications" does not exist' });
    const set = await readPublishedMonths({ client: client as never });
    expect(set).toBe('unavailable');

    const money = resolveMonthlyMoney('2026-10', NO_DAYS, set);
    expect(money.kind).toBe('unavailable');
    expect(publishedAmount(money)).toBeNull();
  });

  test('an EMPTY table yields an empty set, a different state from unavailable', async () => {
    const { client } = createClient({ rows: [] });
    const set = await readPublishedMonths({ client: client as never });
    expect(set).toEqual([]);
    expect(resolveMonthlyMoney('2026-10', NO_DAYS, set).kind).not.toBe('unavailable');
  });

  test('a money column outside the safe integer range makes the set unavailable, not short', async () => {
    // ROUND 20 FINDING 4. The conversion used to THROW out of this function, so
    // one publication above 2^53-1 broke every read, permanently, on a table
    // where nothing can be edited or deleted. Migration 36 now caps the columns
    // at the reader's range, so this is unreachable through the RPC — and it is
    // handled anyway, because a set quietly missing a published month is the
    // worst of the three possible outcomes.
    const { client } = createClient({ rows: [dbRow({ gross_paisa: '9007199254740993' })] });
    const set = await readPublishedMonths({ client: client as never });
    expect(set).toBe('unavailable');
  });

  test('a duplicate month resolves deterministically to the first row', async () => {
    const { client } = createClient({
      rows: [dbRow({ value_paisa: '400000' }), dbRow({ value_paisa: '111111' })],
      auditTargets: [AUDITED_OCTOBER],
    });
    const set = await readPublishedMonths({ client: client as never });
    // The unique constraint makes this unreachable through the RPC. Asserted
    // anyway, because determinism should not depend on a claim about another
    // layer.
    expect(publicationsByMonth(set)?.get('2026-10')?.valuePaisa).toBe(400_000);
  });
});

describe('a truncated read is refused, not answered', () => {
  // ROUND 21 FINDING 1. PostgREST caps a response at 1,000 rows by default and
  // neither query paginated, so above the cap the audit cross-check compared
  // two independently truncated sets. 1,001 audited months against a serving
  // table holding the first 1,000: the omitted month read as "never published",
  // and recomputed money was released against a figure already disclosed. The
  // same truncation in the other order yields a false `'unavailable'`.
  //
  // Detection rather than pagination, deliberately — one publication per month
  // means 1,000 rows is 83 years, so pagination would be machinery guarding a
  // cliff nobody reaches. A truncated read fails CLOSED instead.

  test('asks for an exact count on both reads', () => {
    // Without this the detection below cannot work, so it is asserted first.
    const { client, calls } = createClient({ rows: [] });
    return readPublishedMonths({ client: client as never }).then(() => {
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call.countRequested, call.table).toBe('exact');
      }
    });
  });

  test('a truncated PUBLICATIONS read yields unavailable', async () => {
    const { client } = createClient({ rows: [dbRow()], count: 1001 });
    expect(await readPublishedMonths({ client: client as never })).toBe('unavailable');
  });

  test('a truncated AUDIT read yields unavailable, which is the dangerous direction', async () => {
    // This is the side truncation makes look SHORTER, and short audit history
    // is what releases money rather than withholding it.
    const { client } = createClient({
      rows: [dbRow()],
      auditTargets: [AUDITED_OCTOBER],
      auditCount: 1001,
    });
    expect(await readPublishedMonths({ client: client as never })).toBe('unavailable');
  });

  test('a COMPLETE read is served, so the rule is truncation and not size', async () => {
    // Non-vacuity: refusing whenever a count is present would pass both tests
    // above and break every read.
    const { client } = createClient({
      rows: [dbRow()],
      count: 1,
      auditTargets: [AUDITED_OCTOBER],
      auditCount: 1,
    });
    const set = await readPublishedMonths({ client: client as never });
    expect(set).not.toBe('unavailable');
    expect(publicationsByMonth(set)?.get('2026-10')?.valuePaisa).toBe(400_000);
  });
});

describe('the audit cross-check', () => {
  test('a period the audit log records as published, with no serving row, is UNAVAILABLE', async () => {
    // ROUND 20 FINDING 1, and the exact state the documented class-B rollback
    // leaves behind: drop the table and the function, re-apply, and the audit
    // history survives while the serving rows do not. The reader used to say
    // "nothing is published" here, so a caller releasing recomputed money
    // released it against a figure that had already been disclosed.
    const { client } = createClient({ rows: [], auditTargets: [AUDITED_OCTOBER] });
    const set = await readPublishedMonths({ client: client as never });
    expect(set).toBe('unavailable');
    expect(resolveMonthlyMoney('2026-10', NO_DAYS, set).kind).toBe('unavailable');
  });

  test('audit history that MATCHES the serving rows is served normally', async () => {
    // Non-vacuity: a cross-check that returned unavailable whenever any audit
    // row existed would pass the test above and make the table useless.
    const { client } = createClient({ rows: [dbRow()], auditTargets: [AUDITED_OCTOBER] });
    const set = await readPublishedMonths({ client: client as never });
    expect(set).not.toBe('unavailable');
    expect(publicationsByMonth(set)?.get('2026-10')?.valuePaisa).toBe(400_000);
  });

  test('a serving row with no audit row is served — the check is one-directional', async () => {
    // Deliberately asymmetric. A publication cannot exist without its audit
    // row, because the RPC writes both in one transaction; but audit retention
    // is an operator decision, so a MISSING audit row is not evidence of
    // anything. Only the other direction — audited but unserved — indicates a
    // store this reader cannot answer from.
    const { client } = createClient({ rows: [dbRow()], auditTargets: [] });
    const set = await readPublishedMonths({ client: client as never });
    expect(publicationsByMonth(set)?.get('2026-10')?.valuePaisa).toBe(400_000);
  });

  test('an audit read failure makes the set unavailable rather than unchecked', async () => {
    const { client } = createClient({ rows: [dbRow()], auditError: 'permission denied' });
    const set = await readPublishedMonths({ client: client as never });
    expect(set).toBe('unavailable');
  });

  test('ignores audit targets belonging to other actions, and malformed months', async () => {
    const { client } = createClient({
      rows: [],
      auditTargets: [
        null,
        'subscription.reconcile_limits',
        'some-account-id',
        'refund_net_pharmacy_sales:platform_all:not-a-month',
        'refund_net_pharmacy_sales:platform_all:2026-13',
        'other_metric:platform_all:2026-10',
      ],
    });
    // None of these names a published period of ours, so an empty serving table
    // is consistent and the set is empty rather than unavailable.
    expect(await readPublishedMonths({ client: client as never })).toEqual([]);
  });

  test('filters the audit query to published successes, not every audit row', async () => {
    const { client, calls } = createClient({ rows: [] });
    await readPublishedMonths({ client: client as never });
    const audit = calls.find((call) => call.table === 'admin_audit_log');
    expect(audit).toBeDefined();
    const eqs = (audit?.filters ?? [])
      .filter((entry) => entry.method === 'eq')
      .map((entry) => entry.args);
    expect(eqs).toEqual([
      ['action', 'publication.published'],
      ['outcome', 'success'],
    ]);
  });
});
