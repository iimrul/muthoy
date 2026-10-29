// Batch 3 §8.10 — the six reports, the k floor at its boundary, the
// completeness gate, and what a report row may never carry.
//
// THE COMPLETENESS GATE IS TESTED WITH A FIXTURE LARGER THAN ONE PAGE, as the
// plan requires: 1500 counted rows, read as 1500, pass; read as 1000 — one page
// short — fail. A gate tested only on equal numbers would pass against code
// that never compared them.
//
// THE K BOUNDARY IS TESTED AT k−1 AND k, for a count bucket and for a money
// bucket. A floor that suppresses at 4 and shows at 5 is correct; one that
// shows at 4 discloses a pharmacy; one that suppresses at 5 withholds data
// nobody asked it to. Only the exact pair distinguishes the three.
//
// AND THE NEGATIVE: no report row carries a sale, a customer or a medicine.
// That is asserted against the DEFINITIONS and against built output, because
// the claim is about what the module can produce, not about one fixture.

import { describe, expect, test } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { NetSalesProvenanceError } from '@muthoy/utils';
import { ADMIN_REPORT_IDS, adminReportExportQuerySchema } from '@muthoy/validation';
import { requireMetric } from './adminMetrics';
import { SUPPRESSED_DISPLAY, SUPPRESSION_K } from './adminSuppression';
import type { PaymentOrderRow, SubscriptionRow } from './adminViews';
import {
  ADMIN_REPORT_DEFINITIONS,
  MAX_EXPORT_SOURCE_ROWS,
  ReportCompletenessError,
  assertCompleteRead,
  buildReport,
  buildReportTable,
  exportTaka,
  reportDefinition,
  reportDownload,
  reportTextRows,
  reportFilename,
  reportMetric,
  reportToCsv,
  reportToPdf,
  requireReportDefinition,
  type ReportData,
  type ReportSaleTotalRow,
  type ReportShopRow,
  type SourceTally,
  AdminReportFilterError,
} from './adminReports';

function query(raw: Record<string, string>) {
  const parsed = adminReportExportQuerySchema.safeParse(raw);
  if (!parsed.success) throw new Error('fixture does not parse: ' + parsed.error.message);
  return parsed.data;
}

const COMPLETE: readonly SourceTally[] = [{ label: 'shops', counted: 3, loaded: 3 }];

function shop(index: number, overrides: Partial<ReportShopRow> = {}): ReportShopRow {
  return {
    id: 'shop-' + index,
    name: 'Pharmacy ' + index,
    district: 'Dhaka',
    plan: 'free',
    commercialStatus: 'active',
    createdAt: '2026-10-0' + ((index % 9) + 1) + 'T06:00:00.000Z',
    updatedAt: '2026-10-10T06:00:00.000Z',
    ...overrides,
  };
}

function subscription(index: number, overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: 'sub-' + index,
    billingAccountId: 'account-' + index,
    tier: 'pro',
    billingCycle: 'monthly',
    status: 'active',
    startsAt: '2026-09-01T00:00:00.000Z',
    paidThrough: '2026-11-01T00:00:00.000Z',
    graceEndsAt: null,
    canceledAt: null,
    provider: 'sslcommerz',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function order(index: number, overrides: Partial<PaymentOrderRow> = {}): PaymentOrderRow {
  return {
    id: 'order-' + index,
    billingAccountId: 'account-' + index,
    tier: 'pro',
    billingCycle: 'monthly',
    amountPaisa: asPaisa(50_000),
    status: 'verified',
    provider: 'sslcommerz',
    failureCode: null,
    expiresAt: '2026-10-02T00:00:00.000Z',
    verifiedAt: '2026-10-01T06:00:00.000Z',
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function saleTotal(
  shopIndex: number,
  overrides: Partial<ReportSaleTotalRow> = {},
): ReportSaleTotalRow {
  return {
    shopId: 'shop-' + shopIndex,
    businessDate: '2026-10-01',
    totalPaisa: asPaisa(150_000),
    ...overrides,
  };
}

function data(overrides: Partial<ReportData> = {}): ReportData {
  return {
    shops: [],
    subscriptions: [],
    orders: [],
    sales: [],
    refunds: [],
    tallies: COMPLETE,
    ...overrides,
  };
}

describe('the six reports are exactly the six ids', () => {
  test('every schema id has a definition, and every definition is a schema id', () => {
    expect(ADMIN_REPORT_DEFINITIONS.map((entry) => entry.id).sort()).toEqual(
      [...ADMIN_REPORT_IDS].sort(),
    );
  });

  test('an unknown report id THROWS rather than rendering an empty table', () => {
    expect(reportDefinition('all_the_money')).toBeUndefined();
    expect(() => requireReportDefinition('all_the_money')).toThrow();
  });

  test('every definition can be built, so no id is a dead entry', () => {
    for (const entry of ADMIN_REPORT_DEFINITIONS) {
      const table = buildReportTable(
        entry.id,
        data(),
        query({ reportId: entry.id, format: 'csv' }),
      );

      expect(table.reportId).toBe(entry.id);
      expect(table.columns).toEqual(entry.columns);
    }
  });

  test('a money column’s heading comes from the §5.2 manifest', () => {
    const sales = requireReportDefinition('refund_net_pharmacy_sales');

    expect(reportMetric(sales)?.id).toBe('pharmacy_sales_net');
    // The heading IS the manifest's label, not a string typed beside it.
    expect(sales.columns[1]).toContain(requireMetric('pharmacy_sales_net').label);
  });

  test('a report with no money has no metric, rather than a wrong one', () => {
    expect(reportMetric(requireReportDefinition('pharmacy_registrations'))).toBeNull();
    expect(reportMetric(requireReportDefinition('plan_distribution'))).toBeNull();
  });

  test('the two money reports carry the two different families', () => {
    // Keeping the families apart is the whole of §5: one is Muthoy's money and
    // the other is a pharmacy's.
    expect(
      reportMetric(requireReportDefinition('subscription_revenue_and_renewals'))?.family,
    ).toBe('subscription');
    expect(reportMetric(requireReportDefinition('refund_net_pharmacy_sales'))?.family).toBe(
      'pharmacy_sales',
    );
  });
});

describe('the completeness gate', () => {
  test('equal counted and loaded passes', () => {
    expect(() =>
      assertCompleteRead([{ label: 'shops', counted: 1500, loaded: 1500 }]),
    ).not.toThrow();
  });

  test('a fixture LARGER THAN ONE PAGE that read short is refused', () => {
    // 1500 counted, 1000 loaded: exactly one 1000-row page short, which is the
    // failure a single-page fixture could never produce.
    expect(() => assertCompleteRead([{ label: 'shops', counted: 1500, loaded: 1000 }])).toThrow(
      ReportCompletenessError,
    );
  });

  test('the refusal names both numbers, so the operator knows what was lost', () => {
    try {
      assertCompleteRead([{ label: 'sales', counted: 1500, loaded: 1000 }]);
      expect.unreachable('the gate did not throw');
    } catch (error: unknown) {
      expect((error as Error).message).toContain('1000 of 1500');
      expect((error as Error).message).toContain('has not been produced');
    }
  });

  test('loading MORE than counted is also refused — it is not "good enough"', () => {
    // A duplicated page is a doubled total, wrong in the direction an operator
    // would never suspect.
    expect(() => assertCompleteRead([{ label: 'shops', counted: 1000, loaded: 2000 }])).toThrow(
      ReportCompletenessError,
    );
  });

  test('a count above the explicit cap is refused with the cap named', () => {
    expect(() =>
      assertCompleteRead([
        {
          label: 'sales',
          counted: MAX_EXPORT_SOURCE_ROWS + 1,
          loaded: MAX_EXPORT_SOURCE_ROWS + 1,
        },
      ]),
    ).toThrow(/cap of/);
  });

  test('NO tally at all is refused — a gate that can be skipped is not a gate', () => {
    expect(() => assertCompleteRead([])).toThrow(ReportCompletenessError);
  });

  test('every tally is checked, not just the first', () => {
    expect(() =>
      assertCompleteRead([
        { label: 'shops', counted: 10, loaded: 10 },
        { label: 'sales', counted: 1500, loaded: 1000 },
      ]),
    ).toThrow(/sales/);
  });

  test('the gate runs BEFORE the table is built, so no partial rows exist', () => {
    expect(() =>
      buildReportTable(
        'pharmacy_registrations',
        data({ shops: [shop(1)], tallies: [{ label: 'shops', counted: 1500, loaded: 1000 }] }),
        query({ reportId: 'pharmacy_registrations', format: 'csv' }),
      ),
    ).toThrow(ReportCompletenessError);
  });
});

/** `count` shops, all on the same plan, so they land in one bucket. */
function shopsOnOnePlan(count: number): ReportShopRow[] {
  return Array.from({ length: count }, (_unused, index) => shop(index + 1, { plan: 'pro' }));
}

describe('k-anonymity at the boundary', () => {

  test(`k-1 (${SUPPRESSION_K - 1}) contributors: the bucket exists and its value is EMPTY`, () => {
    const table = buildReportTable(
      'plan_distribution',
      data({ shops: shopsOnOnePlan(SUPPRESSION_K - 1) }),
      query({ reportId: 'plan_distribution', format: 'csv' }),
    );

    expect(reportTextRows(table)).toHaveLength(1);
    // The key stays — the bucket's existence is not the disclosure.
    expect(reportTextRows(table)[0]?.[0]).toBe('pro');
    // The value is empty, not zero: zero would be a lie about the data.
    expect(reportTextRows(table)[0]?.[1]).toBe('');
    expect(table.suppressedBuckets).toBe(1);
  });

  test(`k (${SUPPRESSION_K}) contributors: the value is visible`, () => {
    const table = buildReportTable(
      'plan_distribution',
      data({ shops: shopsOnOnePlan(SUPPRESSION_K) }),
      query({ reportId: 'plan_distribution', format: 'csv' }),
    );

    expect(reportTextRows(table)[0]?.[1]).toBe(String(SUPPRESSION_K));
    expect(table.suppressedBuckets).toBe(0);
  });

  test('a MONEY bucket below k is emptied too', () => {
    const sales = Array.from({ length: SUPPRESSION_K - 1 }, (_unused, index) =>
      saleTotal(index + 1),
    );

    const table = buildReportTable(
      'refund_net_pharmacy_sales',
      data({ sales, tallies: [{ label: 'sales', counted: sales.length, loaded: sales.length }] }),
      query({ reportId: 'refund_net_pharmacy_sales', format: 'csv' }),
    );

    expect(reportTextRows(table)[0]?.[0]).toBe('2026-10');
    expect(reportTextRows(table)[0]?.[1]).toBe('');
  });

  test('a money bucket at k shows the refund-subtracted total', () => {
    const sales = Array.from({ length: SUPPRESSION_K }, (_unused, index) => saleTotal(index + 1));
    const refunds = [saleTotal(1, { totalPaisa: asPaisa(50_000) })];

    const table = buildReportTable(
      'refund_net_pharmacy_sales',
      data({
        sales,
        refunds,
        tallies: [{ label: 'sales', counted: sales.length, loaded: sales.length }],
      }),
      query({ reportId: 'refund_net_pharmacy_sales', format: 'csv' }),
    );

    // 5 x 1500.00 - 500.00 = 7000.00, through the shared subtraction.
    expect(reportTextRows(table)[0]?.[1]).toBe('7000.00');
  });

  test('MANY ROWS from ONE shop is still one contributor', () => {
    // A hundred sales from one pharmacy is that pharmacy's figure wearing an
    // aggregate's label. The floor is on distinct shops, not on row count.
    const sales = Array.from({ length: 100 }, () => saleTotal(1));

    const table = buildReportTable(
      'refund_net_pharmacy_sales',
      data({ sales, tallies: [{ label: 'sales', counted: 100, loaded: 100 }] }),
      query({ reportId: 'refund_net_pharmacy_sales', format: 'csv' }),
    );

    expect(reportTextRows(table)[0]?.[1]).toBe('');
    expect(table.suppressedBuckets).toBe(1);
  });

  test('the caption says how many buckets were withheld', () => {
    const table = buildReportTable(
      'plan_distribution',
      data({ shops: shopsOnOnePlan(SUPPRESSION_K - 1) }),
      query({ reportId: 'plan_distribution', format: 'csv' }),
    );

    expect(table.subtitle).toContain('1 withheld');
    expect(table.subtitle).toContain('fewer than ' + SUPPRESSION_K);
  });

  test('registration metadata is NOT suppressed — §8.10 permits it', () => {
    // Suppressing a shop's own registration date would make the report empty
    // rather than private, and §8.10 names registration metadata explicitly.
    const table = buildReportTable(
      'pharmacy_registrations',
      data({ shops: [shop(1)] }),
      query({ reportId: 'pharmacy_registrations', format: 'csv' }),
    );

    expect(reportTextRows(table)).toHaveLength(1);
    expect(reportTextRows(table)[0]?.[1]).toBe('Pharmacy 1');
    expect(table.suppressedBuckets).toBe(0);
  });

  test('an activity day suppresses EACH figure by its OWN contributors', () => {
    // RETARGETED, Gate 5 finding 4. This test previously asserted the opposite
    // and rationalised it: five registrations plus one seller cleared the floor
    // on the UNION, and the row then published the active count of 1 as "only
    // safe BECAUSE five shops stand behind the row".
    //
    // That reasoning was wrong. An active count of 1 identifies that exactly
    // one of those five traded that day, which is precisely the single-shop
    // disclosure the k floor exists to prevent. The floor is on the
    // contributors to THAT VALUE.
    const shops = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      shop(index + 1, { createdAt: '2026-10-01T06:00:00.000Z' }),
    );

    const table = buildReportTable(
      'activity_summary',
      data({
        shops,
        sales: [saleTotal(1)],
        tallies: [{ label: 'shops', counted: shops.length, loaded: shops.length }],
      }),
      query({ reportId: 'activity_summary', format: 'csv' }),
    );

    // The active count is WITHHELD — one shop traded. The registration count
    // stands, because registration metadata is exempt by §8.10 and five
    // pharmacies registering discloses nothing about any of their trade.
    expect(reportTextRows(table)[0]).toEqual(['2026-10-01', '', String(SUPPRESSION_K)]);
    expect(table.suppressedBuckets).toBe(1);
  });

  test('an activity day shows BOTH figures once k shops have traded', () => {
    // The other side of the boundary, so the fix is not simply "withhold
    // everything": with five sellers the active count is visible.
    const shops = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      shop(index + 1, { createdAt: '2026-10-01T06:00:00.000Z' }),
    );
    const sales = Array.from({ length: SUPPRESSION_K }, (_unused, index) => saleTotal(index + 1));

    const table = buildReportTable(
      'activity_summary',
      data({
        shops,
        sales,
        tallies: [{ label: 'shops', counted: shops.length, loaded: shops.length }],
      }),
      query({ reportId: 'activity_summary', format: 'csv' }),
    );

    expect(reportTextRows(table)[0]).toEqual(['2026-10-01', String(SUPPRESSION_K), String(SUPPRESSION_K)]);
    expect(table.suppressedBuckets).toBe(0);
  });

  test('MUTATION: gating the activity row on the UNION republishes the one seller', () => {
    // The bypass, reconstructed from the same fixture: five distinct shops in
    // the union clears the floor, so a union-gated row would have emitted the
    // real active count of 1. That is what the retargeted test above refuses.
    const activeShops = ['shop-1'];
    const registeredShops = Array.from({ length: SUPPRESSION_K }, (_u, i) => 'shop-' + (i + 1));

    const unionContributors = new Set([...activeShops, ...registeredShops]).size;
    const ownContributors = new Set(activeShops).size;

    expect(unionContributors).toBeGreaterThanOrEqual(SUPPRESSION_K);
    expect(ownContributors).toBeLessThan(SUPPRESSION_K);
  });
});

describe('the filters', () => {
  test('the date range excludes a registration outside it', () => {
    const table = buildReportTable(
      'pharmacy_registrations',
      data({ shops: [shop(1, { createdAt: '2026-09-01T06:00:00.000Z' }), shop(2)] }),
      query({
        reportId: 'pharmacy_registrations',
        format: 'csv',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    );

    expect(reportTextRows(table).map((row) => row[1])).toEqual(['Pharmacy 2']);
  });

  test('a Dhaka-day range INCLUDES a registration late in its last day', () => {
    // A `lte(created_at, '2026-10-02')` bound would drop this row.
    const table = buildReportTable(
      'pharmacy_registrations',
      data({ shops: [shop(1, { createdAt: '2026-10-02T17:30:00.000Z' })] }),
      query({
        reportId: 'pharmacy_registrations',
        format: 'csv',
        from: '2026-10-01',
        to: '2026-10-02',
      }),
    );

    expect(reportTextRows(table)).toHaveLength(1);
  });

  test('the status filter narrows the registrations', () => {
    const table = buildReportTable(
      'pharmacy_registrations',
      data({ shops: [shop(1), shop(2, { commercialStatus: 'suspended' })] }),
      query({ reportId: 'pharmacy_registrations', format: 'csv', status: 'suspended' }),
    );

    expect(reportTextRows(table).map((row) => row[1])).toEqual(['Pharmacy 2']);
    expect(table.subtitle).toContain('status suspended');
  });

  test('the subscriptions report groups by tier, cycle and status', () => {
    const subscriptions = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      subscription(index + 1),
    );

    const table = buildReportTable(
      'subscriptions',
      data({
        subscriptions,
        tallies: [
          { label: 'subscriptions', counted: subscriptions.length, loaded: subscriptions.length },
        ],
      }),
      query({ reportId: 'subscriptions', format: 'csv' }),
    );

    expect(reportTextRows(table)).toEqual([['pro', 'monthly', 'active', String(SUPPRESSION_K)]]);
  });

  test('an UNVERIFIED payment order is not counted as collected', () => {
    const orders = Array.from({ length: SUPPRESSION_K }, (_unused, index) => order(index + 1));
    orders.push(order(99, { status: 'failed', verifiedAt: null }));

    const table = buildReportTable(
      'subscription_revenue_and_renewals',
      data({
        orders,
        tallies: [{ label: 'orders', counted: orders.length, loaded: orders.length }],
      }),
      query({ reportId: 'subscription_revenue_and_renewals', format: 'csv' }),
    );

    // Five verified orders at 500.00 each; the failed one contributes nothing.
    expect(reportTextRows(table)[0]).toEqual(['2026-10', '2500.00', String(SUPPRESSION_K)]);
  });
});

describe('no report row carries a sale, a customer or a medicine', () => {
  const FORBIDDEN = ['sale_id', 'saleid', 'line', 'customer', 'medicine', 'batch', 'invoice'];

  test('no column heading names one', () => {
    for (const entry of ADMIN_REPORT_DEFINITIONS) {
      for (const heading of entry.columns) {
        for (const word of FORBIDDEN) {
          expect(heading.toLowerCase(), entry.id + ' heading').not.toContain(word);
        }
      }
    }
  });

  test('the sales input carries only a shop, a day and a total', () => {
    // The TYPE is the guarantee: there is no field a sale line could occupy.
    expect(Object.keys(saleTotal(1)).sort()).toEqual(['businessDate', 'shopId', 'totalPaisa']);
  });

  test('a built money report emits no identifier at all, only a month and a figure', () => {
    const sales = Array.from({ length: SUPPRESSION_K }, (_unused, index) => saleTotal(index + 1));

    const table = buildReportTable(
      'refund_net_pharmacy_sales',
      data({ sales, tallies: [{ label: 'sales', counted: sales.length, loaded: sales.length }] }),
      query({ reportId: 'refund_net_pharmacy_sales', format: 'csv' }),
    );

    // No shop id reaches the rows, even though five of them were counted.
    expect(JSON.stringify(reportTextRows(table))).not.toContain('shop-');
  });
});

describe('the exports', () => {
  function registrationsTable() {
    return buildReportTable(
      'pharmacy_registrations',
      data({ shops: [shop(1, { name: 'Banani Pharmacy' })] }),
      query({ reportId: 'pharmacy_registrations', format: 'csv' }),
    );
  }

  test('money is a PLAIN decimal, so a spreadsheet reads it as a number', () => {
    // Not `৳1,500.00`: the grouping commas make the cell text, and the taka
    // sign is outside Latin-1 so the PDF would print `?`.
    expect(exportTaka(asPaisa(150_000))).toBe('1500.00');
    expect(exportTaka(asPaisa(-50_000))).toBe('-500.00');
    expect(exportTaka(asPaisa(1))).toBe('0.01');
  });

  test('the CSV carries the BOM, CRLF and the headings', () => {
    const csv = reportToCsv(registrationsTable());

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('Pharmacy');
    expect(csv).toContain('Banani Pharmacy');
  });

  test('a formula-shaped pharmacy name is neutralised on the way out', () => {
    const table = buildReportTable(
      'pharmacy_registrations',
      data({ shops: [shop(1, { name: "=cmd|' /c calc'!A1" })] }),
      query({ reportId: 'pharmacy_registrations', format: 'csv' }),
    );

    // The apostrophe goes INSIDE the quotes, where a parser reads it as text.
    expect(reportToCsv(table)).toContain("\"'=cmd");
  });

  test('the PDF is a parseable 1.4 stream with the title', () => {
    const pdf = reportToPdf(registrationsTable());

    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('%%EOF');
    expect(pdf).toContain('Pharmacy registrations');
  });

  test('the filename carries the report and the range, and no path', () => {
    expect(
      reportFilename(
        query({
          reportId: 'plan_distribution',
          format: 'csv',
          from: '2026-10-01',
          to: '2026-10-31',
        }),
      ),
    ).toBe('plan_distribution_2026-10-01_2026-10-31.csv');
  });

  test('a PDF download states the Latin-1 limit; a CSV download does not', () => {
    const table = registrationsTable();

    const pdf = reportDownload(table, query({ reportId: 'pharmacy_registrations', format: 'pdf' }));
    expect(pdf.contentType).toBe('application/pdf');
    expect(pdf.notice).toContain('Latin');

    const csv = reportDownload(table, query({ reportId: 'pharmacy_registrations', format: 'csv' }));
    expect(csv.contentType).toContain('charset=utf-8');
    expect(csv.notice).toBeNull();
  });

  test('the Content-Disposition filename cannot carry a quote or a path', () => {
    const download = reportDownload(
      registrationsTable(),
      query({ reportId: 'pharmacy_registrations', format: 'csv' }),
    );

    expect(download.contentDisposition).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"$/);
  });
});

describe('buildReport reads through its injected source', () => {
  test('the query reaches the source unchanged', async () => {
    const seen: unknown[] = [];
    // A DAY-grained report: round 11 finding 7 refuses a date range on a
    // snapshot report such as plan_distribution, because its rows carry no
    // date and the caption would have claimed one anyway.
    const table = await buildReport(
      query({ reportId: 'activity_summary', format: 'csv', from: '2026-10-01' }),
      async (received) => {
        seen.push(received);
        return data({ shops: [shop(1)] });
      },
    );

    expect(seen).toEqual([{ reportId: 'activity_summary', format: 'csv', from: '2026-10-01' }]);
    expect(table.reportId).toBe('activity_summary');
  });

  test('a source whose read was incomplete propagates the refusal', async () => {
    await expect(
      buildReport(query({ reportId: 'plan_distribution', format: 'csv' }), async () =>
        data({ tallies: [{ label: 'shops', counted: 1500, loaded: 1000 }] }),
      ),
    ).rejects.toThrow(ReportCompletenessError);
  });
});

describe('registrations are bucketed by the DHAKA day (Gate 5 finding 10)', () => {
  // THE DEFECT. These sites sliced the ISO string, which is the UTC day. A shop
  // registered at 20:00Z belongs to the NEXT Dhaka day — and the Dashboard
  // already filed it that way, so Analytics, the reports and the Dashboard
  // disagreed about the same registration.
  const BEFORE_MIDNIGHT = '2026-10-25T17:59:00.000Z'; // 23:59 Dhaka, the 25th
  const AFTER_MIDNIGHT = '2026-10-25T18:00:00.000Z'; // 00:00 Dhaka, the 26th
  const LATE_EVENING = '2026-10-25T20:00:00.000Z'; // 02:00 Dhaka, the 26th

  test('the UTC slice and the Dhaka day genuinely differ here', () => {
    // Non-vacuity: if these agreed, the assertions below would prove nothing.
    expect(AFTER_MIDNIGHT.slice(0, 10)).toBe('2026-10-25');
    expect(LATE_EVENING.slice(0, 10)).toBe('2026-10-25');
  });

  test('a registration just before Dhaka midnight stays on its own day', () => {
    const table = buildReportTable(
      'pharmacy_registrations',
      data({
        shops: [shop(1, { createdAt: BEFORE_MIDNIGHT })],
        tallies: [{ label: 'shops', counted: 1, loaded: 1 }],
      }),
      query({ reportId: 'pharmacy_registrations', format: 'csv' }),
    );

    expect(reportTextRows(table)[0]?.[0]).toBe('2026-10-25');
  });

  test('a registration after Dhaka midnight moves to the NEXT day', () => {
    const table = buildReportTable(
      'pharmacy_registrations',
      data({
        shops: [shop(1, { createdAt: AFTER_MIDNIGHT }), shop(2, { createdAt: LATE_EVENING })],
        tallies: [{ label: 'shops', counted: 2, loaded: 2 }],
      }),
      query({ reportId: 'pharmacy_registrations', format: 'csv' }),
    );

    // Both would have read 2026-10-25 under the UTC slice.
    expect(reportTextRows(table).map((row) => row[0])).toEqual(['2026-10-26', '2026-10-26']);
  });

  test('the activity report agrees with it, so the two views cannot drift', () => {
    const table = buildReportTable(
      'activity_summary',
      data({
        shops: [shop(1, { createdAt: LATE_EVENING })],
        sales: [],
        tallies: [{ label: 'shops', counted: 1, loaded: 1 }],
      }),
      query({ reportId: 'activity_summary', format: 'csv' }),
    );

    expect(reportTextRows(table)[0]?.[0]).toBe('2026-10-26');
  });

  test('an unreadable timestamp is EXCLUDED before bucketing, and that is stated', () => {
    // Written expecting the row to survive; it does not, and the code is right.
    // `withinInstantRange` refuses an instant `Date.parse` cannot read even
    // when no range is set, so the row never reaches a bucket. Recorded as the
    // real behaviour rather than left as an assumption, because
    // `shops.created_at` is `timestamptz NOT NULL DEFAULT now()` and the case
    // is unreachable through the database.
    const table = buildReportTable(
      'pharmacy_registrations',
      data({
        shops: [shop(1, { createdAt: 'not-a-date' })],
        tallies: [{ label: 'shops', counted: 1, loaded: 1 }],
      }),
      query({ reportId: 'pharmacy_registrations', format: 'csv' }),
    );

    expect(reportTextRows(table)).toEqual([]);
  });
});

describe('the status filter is applied or REFUSED, never claimed falsely (finding 9)', () => {
  // THE DEFECT. The subtitle appended "status X" whenever the filter was set,
  // while only three of the six builders applied it. Reproduced by the
  // reviewer: with every shop active, a suspended-only pharmacy-sales report
  // still returned the full total AND said "status suspended". An export whose
  // subtitle contradicts its rows is worse than one that refuses the filter,
  // because the reader has no way to tell which is true.
  const shops = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
    shop(index + 1, { createdAt: '2026-10-01T06:00:00.000Z' }),
  );
  const sales = Array.from({ length: SUPPRESSION_K }, (_unused, index) => saleTotal(index + 1));

  function build(reportId: string, status?: string) {
    return buildReportTable(
      reportId as Parameters<typeof buildReportTable>[0],
      data({
        shops,
        sales,
        tallies: [{ label: 'shops', counted: shops.length, loaded: shops.length }],
      }),
      query({ reportId, format: 'csv', ...(status === undefined ? {} : { status }) }),
    );
  }

  test('every report declares whether it can honour the filter', () => {
    for (const entry of ADMIN_REPORT_DEFINITIONS) {
      expect(['commercial', 'subscription', null], entry.id).toContain(entry.statusFilter);
    }
    // Non-vacuity: both answers are actually used, so this is a real decision
    // per report rather than a field nobody set.
    const declared = ADMIN_REPORT_DEFINITIONS.map((entry) => entry.statusFilter);
    expect(declared.filter((value) => value === null).length).toBeGreaterThan(0);
    expect(declared.filter((value) => value !== null).length).toBeGreaterThan(0);
  });

  test('a report that CANNOT filter by status refuses the query', () => {
    // The exact case the reviewer reproduced.
    expect(() => build('refund_net_pharmacy_sales', 'suspended')).toThrow(AdminReportFilterError);
    expect(() => build('subscription_revenue_and_renewals', 'suspended')).toThrow(
      AdminReportFilterError,
    );
  });

  test('and it still builds normally with NO status filter', () => {
    // The refusal must be about the filter, not about the report.
    expect(build('refund_net_pharmacy_sales').rows.length).toBeGreaterThan(0);
  });

  test('the refusal explains itself, rather than reading as a server fault', () => {
    try {
      build('refund_net_pharmacy_sales', 'suspended');
      throw new Error('expected a refusal');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AdminReportFilterError);
      expect((error as Error).message).toContain('cannot be filtered by status');
      expect((error as Error).message).toContain('Clear the status filter');
    }
  });

  test('activity_summary APPLIES the filter to both halves', () => {
    // It reads `shops`, so it can — and "activity, status suspended" has only
    // one honest reading: the activity of the shops that match.
    const all = build('activity_summary');
    expect(all.rows.length).toBeGreaterThan(0);

    const suspended = build('activity_summary', 'suspended');

    // Every fixture shop is active, so a suspended-only view has no rows at
    // all — rather than the full total under a "status suspended" subtitle.
    expect(suspended.rows).toEqual([]);
    expect(suspended.subtitle).toContain('status suspended');
    expect(suspended.subtitle).toContain('0 rows');
  });

  test('established sellers are NOT dropped from an activity report', () => {
    // GATE 5 DELTA FINDING 4, the exact case the reviewer reproduced: five
    // shops that SOLD in October but REGISTERED in August. The fix to finding
    // 9 restricted the sales half to `data.shops`, and the reader narrows
    // that read by registration date, so their October sales vanished — with
    // or without a status filter.
    //
    // `platformReportData` now reads every shop for this report (see
    // REPORTS_READING_ALL_SHOPS), so the builder must handle shops whose
    // registration falls outside the period rather than treating their
    // absence as a reason to drop their activity.
    const established = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      shop(index + 1, { createdAt: '2026-08-15T06:00:00.000Z' }),
    );
    const octoberSales = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      saleTotal(index + 1),
    );

    const table = buildReportTable(
      'activity_summary',
      data({
        shops: established,
        sales: octoberSales,
        tallies: [{ label: 'shops', counted: established.length, loaded: established.length }],
      }),
      // An OCTOBER query, which is what makes the defect visible: the
      // reader's range on `shops.created_at` excluded every one of these
      // August registrations, so the sales half had no shop to match.
      query({ reportId: 'activity_summary', format: 'csv', from: '2026-10-01', to: '2026-10-31' }),
    );

    // The activity rows exist, and the active count is the five sellers.
    expect(reportTextRows(table).length).toBeGreaterThan(0);
    const active = reportTextRows(table).map((row) => row[1]);
    expect(active).toContain(String(SUPPRESSION_K));
    // And NO registration is claimed in the period, because none happened in
    // it: widening the read must not smuggle August registrations into an
    // October report.
    expect(reportTextRows(table).every((row) => row[2] === '0' || row[2] === SUPPRESSED_DISPLAY)).toBe(true);
  });

  test('a status filter still restricts those established sellers', () => {
    // The capability finding 9 asked for, on the shops finding 4 restored:
    // the filter must still work when the sellers registered long before the
    // period, which is exactly the population the broken version could not
    // see at all.
    const established = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      shop(index + 1, { createdAt: '2026-08-15T06:00:00.000Z', commercialStatus: 'suspended' }),
    );
    const octoberSales = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      saleTotal(index + 1),
    );

    const build = (status?: string) =>
      buildReportTable(
        'activity_summary',
        data({
          shops: established,
          sales: octoberSales,
          tallies: [{ label: 'shops', counted: established.length, loaded: established.length }],
        }),
        query({
          reportId: 'activity_summary',
          format: 'csv',
          from: '2026-10-01',
          to: '2026-10-31',
          ...(status === undefined ? {} : { status }),
        }),
      );

    // All five are suspended: a suspended-only view keeps their activity...
    expect(build('suspended').rows.length).toBeGreaterThan(0);
    // ...and an active-only view has none of it.
    expect(build('active').rows).toEqual([]);
  });

  test('MUTATION: the old behaviour returned the full total under that subtitle', () => {
    // What the defect looked like: the subtitle claimed the scope and the rows
    // ignored it. Reconstructed so the regression is visible as a comparison.
    const unfiltered = build('activity_summary');
    const filtered = build('activity_summary', 'suspended');

    expect(unfiltered.rows.length).toBeGreaterThan(0);
    expect(filtered.rows.length).toBe(0);
    expect(filtered.rows).not.toEqual(unfiltered.rows);
  });
});

describe('ROUND 11 FINDING 2: overlapping periods cannot reconstruct a withheld month', () => {
  // The reviewer's reproduction, executed. Five pharmacies take money on
  // October 1 and ONE takes money on October 2:
  //
  //   October 2 alone -> withheld (one contributor)
  //   October 1 alone -> 500.00
  //   October 1 to 2  -> 580.00,  and 580 - 500 = the withheld 80.00
  //
  // Both requests were individually legitimate, so per-request suppression
  // could never have stopped it. What stops it is that a month-grained report
  // answers only for WHOLE months, so the row for October carries the same
  // figure in every window that contains it.

  const october = () => {
    const first = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      saleTotal(index + 1, { businessDate: '2026-10-01', totalPaisa: asPaisa(10_000) }),
    );
    const second = [saleTotal(99, { businessDate: '2026-10-02', totalPaisa: asPaisa(8_000) })];
    const sales = [...first, ...second];
    return data({
      sales,
      tallies: [{ label: 'sales', counted: sales.length, loaded: sales.length }],
    });
  };

  test('a part-month window is REFUSED rather than answered', () => {
    for (const range of [
      { from: '2026-10-01', to: '2026-10-01' },
      { from: '2026-10-01', to: '2026-10-02' },
      { from: '2026-10-02', to: '2026-10-02' },
      { from: '2026-10-15', to: '2026-10-31' },
    ]) {
      expect(
        () =>
          buildReportTable(
            'refund_net_pharmacy_sales',
            october(),
            query({ reportId: 'refund_net_pharmacy_sales', format: 'csv', ...range }),
          ),
        JSON.stringify(range) + ' was answered',
      ).toThrow(AdminReportFilterError);
    }
  });

  test('the refusal says WHY, so the operator can correct the range', () => {
    try {
      buildReportTable(
        'refund_net_pharmacy_sales',
        october(),
        query({
          reportId: 'refund_net_pharmacy_sales',
          format: 'csv',
          from: '2026-10-01',
          to: '2026-10-02',
        }),
      );
      expect.unreachable('the part-month range was answered');
    } catch (error) {
      expect((error as Error).message).toContain('whole months');
      expect((error as Error).message).toContain('withheld month');
    }
  });

  test('a WHOLE month answers, and answers the same in a wider window', () => {
    const whole = buildReportTable(
      'refund_net_pharmacy_sales',
      october(),
      query({
        reportId: 'refund_net_pharmacy_sales',
        format: 'csv',
        from: '2026-10-01',
        to: '2026-10-31',
      }),
    );
    const wider = buildReportTable(
      'refund_net_pharmacy_sales',
      october(),
      query({
        reportId: 'refund_net_pharmacy_sales',
        format: 'csv',
        from: '2026-09-01',
        to: '2026-10-31',
      }),
    );

    // Six contributors across the whole month, so October is released -- and
    // it is 580.00 in BOTH windows. There is no pair of answers to subtract.
    expect(reportTextRows(whole)).toEqual([['2026-10', '580.00']]);
    expect(reportTextRows(wider).find((row) => row[0] === '2026-10')).toEqual([
      '2026-10',
      '580.00',
    ]);
  });

  test('an open-ended range is still allowed, and still whole-month', () => {
    const open = buildReportTable(
      'refund_net_pharmacy_sales',
      october(),
      query({ reportId: 'refund_net_pharmacy_sales', format: 'csv', from: '2026-10-01' }),
    );

    expect(reportTextRows(open)).toEqual([['2026-10', '580.00']]);
  });

  test('February and a leap year are month ends too, not a 30/31 guess', () => {
    const empty = () =>
      data({ sales: [], tallies: [{ label: 'sales', counted: 0, loaded: 0 }] });
    const run = (from: string, to: string) =>
      buildReportTable(
        'refund_net_pharmacy_sales',
        empty(),
        query({ reportId: 'refund_net_pharmacy_sales', format: 'csv', from, to }),
      );

    // 2026 is not a leap year, so the 28th IS February's end and the 27th is
    // a part month. The month end is computed, not guessed at 30 or 31.
    expect(() => run('2026-01-01', '2026-02-28')).not.toThrow();
    expect(() => run('2026-01-01', '2026-02-27')).toThrow(AdminReportFilterError);
    // 2028 IS a leap year, so the 29th is that month's end -- and the 28th is
    // then a part month, which is the opposite answer for the same day number.
    expect(() => run('2028-02-01', '2028-02-29')).not.toThrow();
    expect(() => run('2028-02-01', '2028-02-28')).toThrow(AdminReportFilterError);
  });

  test('an impossible calendar date is refused by the SCHEMA, before this gate', () => {
    // My first version of the test above asserted that 2026-02-29 reached this
    // gate. It does not: the shared query schema rejects a date that does not
    // exist, which is the better layer for it. Recorded so the division of
    // labour is visible rather than rediscovered.
    expect(() =>
      query({
        reportId: 'refund_net_pharmacy_sales',
        format: 'csv',
        from: '2026-02-01',
        to: '2026-02-29',
      }),
    ).toThrow(/real calendar date/);
  });
});

describe('ROUND 11 FINDING 7: a snapshot report does not claim a period', () => {
  // The reviewer put five subscriptions that began in October 2026 under
  // "2020-01-01 to 2020-01-02": the builders read CURRENT state and ignore
  // dates, while the subtitle printed whatever was asked for. Current state
  // under a historical caption reads as historical evidence.

  for (const reportId of ['subscriptions', 'plan_distribution'] as const) {
    test(reportId + ' refuses a date range instead of printing it', () => {
      expect(() =>
        buildReportTable(
          reportId,
          data(),
          query({ reportId, format: 'csv', from: '2020-01-01', to: '2020-01-02' }),
        ),
      ).toThrow(AdminReportFilterError);
    });

    test(reportId + ' still answers with no dates at all', () => {
      expect(() =>
        buildReportTable(reportId, data(), query({ reportId, format: 'csv' })),
      ).not.toThrow();
    });
  }

  test('the refusal explains that the rows carry no date', () => {
    try {
      buildReportTable(
        'subscriptions',
        data(),
        query({ reportId: 'subscriptions', format: 'csv', from: '2020-01-01' }),
      );
      expect.unreachable('the snapshot report accepted a period');
    } catch (error) {
      expect((error as Error).message).toContain('snapshot of current state');
      expect((error as Error).message).toContain('no date');
    }
  });
});

describe('ROUND 11 FINDING 8: collected payments land in the DHAKA month', () => {
  const verifiedAt = (instant: string) =>
    Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      order(index + 1, { verifiedAt: instant, amountPaisa: asPaisa(10_000) }),
    );

  const monthly = (orders: readonly PaymentOrderRow[]) =>
    buildReportTable(
      'subscription_revenue_and_renewals',
      data({
        orders: [...orders],
        tallies: [{ label: 'payment_orders', counted: orders.length, loaded: orders.length }],
      }),
      query({ reportId: 'subscription_revenue_and_renewals', format: 'csv' }),
    );

  test('a payment verified at 20:00 UTC on Sep 30 is OCTOBER money', () => {
    // 2026-09-30T20:00:00Z is 2026-10-01T02:00 in Dhaka. The UTC slice filed
    // it under 2026-09, and an October report exported 2026-09,500.00,5.
    const table = monthly(verifiedAt('2026-09-30T20:00:00.000Z'));

    expect(reportTextRows(table).map((row) => row[0])).toEqual(['2026-10']);
    expect(reportTextRows(table)[0]).toEqual(['2026-10', '500.00', '5']);
  });

  test('the contributors land in the same month as the money', () => {
    // If the total used the Dhaka month while the contributor grouping used
    // the UTC one, the floor would be applied to an empty set -- withholding a
    // real figure, or releasing one it should not.
    const table = monthly(verifiedAt('2026-09-30T20:00:00.000Z'));

    expect(table.suppressedBuckets).toBe(0);
    expect(reportTextRows(table)[0]?.[1]).toBe('500.00');
  });

  test('a midday payment stays in its own month', () => {
    const table = monthly(verifiedAt('2026-10-15T06:00:00.000Z'));

    expect(reportTextRows(table).map((row) => row[0])).toEqual(['2026-10']);
  });

  test('the last Dhaka instant of a month is still that month', () => {
    // 2026-10-31T17:59:59Z is 2026-10-31T23:59:59 Dhaka: the final second.
    const table = monthly(verifiedAt('2026-10-31T17:59:59.000Z'));

    expect(reportTextRows(table).map((row) => row[0])).toEqual(['2026-10']);
  });
});

describe('ROUND 12 FINDING 4: the export cell stays opaque until the serializer', () => {
  // The reviewer substituted at the HANDLER, after `buildReportTable` had
  // verified everything:
  //
  //   reportDownload({ ...table, rows: table.rows.map((row) =>
  //     row.map((value, column) => (column === 1 ? '500.00' : value))) }, query)
  //
  // Five sales of 100.00 less 100.00 of refunds build 400.00 correctly; both
  // serializers then returned 200 with 500.00 under the net column heading.
  // Zero diagnostics, no forged cell. The verification was one step before the
  // output, again.

  const fiveSellers = () => {
    const sales = Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
      saleTotal(index + 1, { businessDate: '2026-10-01', totalPaisa: asPaisa(10_000) }),
    );
    const refunds = [saleTotal(1, { businessDate: '2026-10-01', totalPaisa: asPaisa(10_000) })];
    return data({
      sales,
      refunds,
      tallies: [{ label: 'sales', counted: sales.length, loaded: sales.length }],
    });
  };

  const monthly = () =>
    buildReportTable(
      'refund_net_pharmacy_sales',
      fiveSellers(),
      query({ reportId: 'refund_net_pharmacy_sales', format: 'csv' }),
    );

  test('the honest figure is still exactly right', () => {
    // 5 x 100.00 less 100.00 = 400.00, through the shared subtraction.
    expect(reportTextRows(monthly())).toEqual([['2026-10', '400.00']]);
  });

  test('REPRODUCTION: substituting a row at the handler is REFUSED', () => {
    const table = monthly();
    const mutated = {
      ...table,
      rows: table.rows.map((row) =>
        row.map((value, column) => (column === 1 ? '500.00' : value)),
      ),
    };

    // Every output path refuses it, because every output path IS this check.
    expect(() => reportTextRows(mutated)).toThrow(NetSalesProvenanceError);
    expect(() => reportToCsv(mutated)).toThrow(NetSalesProvenanceError);
    expect(() => reportToPdf(mutated)).toThrow(NetSalesProvenanceError);
    expect(() =>
      reportDownload(mutated, query({ reportId: 'refund_net_pharmacy_sales', format: 'csv' })),
    ).toThrow(NetSalesProvenanceError);
    expect(() =>
      reportDownload(mutated, query({ reportId: 'refund_net_pharmacy_sales', format: 'pdf' })),
    ).toThrow(NetSalesProvenanceError);
  });

  test('the net columns are DERIVED, so blanking them cannot disable the check', () => {
    // The obvious next move: keep the substitution and claim the column is not
    // a money column. `reportTextRows` re-derives that from the report's own
    // definition, so there is no field on the table to blank.
    const table = monthly();
    const mutated = {
      ...table,
      rows: table.rows.map((row) =>
        row.map((value, column) => (column === 1 ? '500.00' : value)),
      ),
      netColumns: [],
      suppressedBuckets: 0,
    } as unknown as ReturnType<typeof buildReportTable>;

    expect(() => reportToCsv(mutated)).toThrow(NetSalesProvenanceError);
  });

  test('a report with no money column is unaffected', () => {
    const table = buildReportTable(
      'plan_distribution',
      data({ shops: shopsOnOnePlan(SUPPRESSION_K) }),
      query({ reportId: 'plan_distribution', format: 'csv' }),
    );

    expect(() => reportToCsv(table)).not.toThrow();
    expect(reportTextRows(table)[0]?.[1]).toBe(String(SUPPRESSION_K));
  });

  test('a withheld net bucket serialises as an EMPTY cell, not a zero', () => {
    const sales = Array.from({ length: SUPPRESSION_K - 1 }, (_unused, index) =>
      saleTotal(index + 1, { businessDate: '2026-10-01' }),
    );
    const table = buildReportTable(
      'refund_net_pharmacy_sales',
      data({ sales, tallies: [{ label: 'sales', counted: sales.length, loaded: sales.length }] }),
      query({ reportId: 'refund_net_pharmacy_sales', format: 'csv' }),
    );

    expect(reportTextRows(table)).toEqual([['2026-10', '']]);
    expect(reportToCsv(table)).not.toContain('0.00');
  });
});

describe('ROUND 12 FINDING 3: a status filter cannot reconstruct a withheld group', () => {
  // Executed six-pharmacy fixture: five commercially active, one suspended,
  // all trading that day.
  //
  //   activity_summary, no status -> 6
  //   activity_summary, active    -> 5
  //   activity_summary, suspended -> withheld      6 - 5 = the withheld 1
  //
  // I had recorded this as a documented limitation of k-anonymity. It is not a
  // limitation; it is a defect you can execute, and the reviewer did.

  const sixTraders = () => {
    const shops = [
      ...Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
        shop(index + 1, { commercialStatus: 'active' }),
      ),
      shop(99, { commercialStatus: 'suspended' }),
    ];
    const sales = shops.map((row) =>
      saleTotal(0, { shopId: row.id, businessDate: '2026-10-01' }),
    );
    return data({
      shops,
      sales,
      tallies: [{ label: 'shops', counted: shops.length, loaded: shops.length }],
    });
  };

  const activity = (status?: string) =>
    buildReportTable(
      'activity_summary',
      sixTraders(),
      query({
        reportId: 'activity_summary',
        format: 'csv',
        ...(status === undefined ? {} : { status }),
      }),
    );

  test('the UNFILTERED day still publishes its six traders', () => {
    // The complement of "no filter" is empty, so nothing is withheld: this is
    // the figure an operator legitimately needs.
    expect(reportTextRows(activity())[0]?.[1]).toBe(String(SUPPRESSION_K + 1));
  });

  test('REPRODUCTION: the ACTIVE-only view is withheld, its complement being one shop', () => {
    const rows = reportTextRows(activity('active'));

    expect(rows[0]?.[0]).toBe('2026-10-01');
    expect(rows[0]?.[1], 'the active-only count was published').toBe('');
  });

  test('REPRODUCTION: the SUSPENDED-only view is withheld too', () => {
    expect(reportTextRows(activity('suspended'))[0]?.[1]).toBe('');
  });

  test('so there is no pair of answers to subtract', () => {
    const unfiltered = reportTextRows(activity())[0]?.[1] ?? '';
    const active = reportTextRows(activity('active'))[0]?.[1] ?? '';
    const suspended = reportTextRows(activity('suspended'))[0]?.[1] ?? '';

    // Exactly one of the three is a number. Two numbers would be a
    // subtraction, which is the whole attack.
    const published = [unfiltered, active, suspended].filter((cell) => cell.length > 0);
    expect(published).toEqual([String(SUPPRESSION_K + 1)]);
  });

  test('a filter whose complement also clears the floor still answers', () => {
    // The feature survives: the rule withholds only when the EXCLUDED group is
    // small enough to be identified.
    const shops = [
      ...Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
        shop(index + 1, { commercialStatus: 'active' }),
      ),
      ...Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
        shop(index + 50, { commercialStatus: 'suspended' }),
      ),
    ];
    const sales = shops.map((row) =>
      saleTotal(0, { shopId: row.id, businessDate: '2026-10-01' }),
    );
    const table = buildReportTable(
      'activity_summary',
      data({
        shops,
        sales,
        tallies: [{ label: 'shops', counted: shops.length, loaded: shops.length }],
      }),
      query({ reportId: 'activity_summary', format: 'csv', status: 'active' }),
    );

    expect(reportTextRows(table)[0]?.[1]).toBe(String(SUPPRESSION_K));
  });

  test('plan distribution carries the same rule', () => {
    const shops = [
      ...Array.from({ length: SUPPRESSION_K }, (_unused, index) =>
        shop(index + 1, { plan: 'free', commercialStatus: 'active' }),
      ),
      shop(99, { plan: 'free', commercialStatus: 'suspended' }),
    ];
    const withFilter = buildReportTable(
      'plan_distribution',
      data({ shops, tallies: [{ label: 'shops', counted: shops.length, loaded: shops.length }] }),
      query({ reportId: 'plan_distribution', format: 'csv', status: 'active' }),
    );
    const withoutFilter = buildReportTable(
      'plan_distribution',
      data({ shops, tallies: [{ label: 'shops', counted: shops.length, loaded: shops.length }] }),
      query({ reportId: 'plan_distribution', format: 'csv' }),
    );

    expect(reportTextRows(withFilter)[0]?.[1], 'the filtered plan count was published').toBe('');
    expect(reportTextRows(withoutFilter)[0]?.[1]).toBe(String(SUPPRESSION_K + 1));
  });

  test('subscriptions needs no complement, because its buckets ARE the statuses', () => {
    // Non-vacuity for the rule's scope: this report groups BY status, so a
    // status filter selects whole buckets and changes no published value.
    // Adding a complement here would withhold figures for no gain.
    const entry = requireReportDefinition('subscriptions');

    expect(entry.statusFilter).toBe('subscription');
    expect(entry.columns).toContain('Status');
  });
});
