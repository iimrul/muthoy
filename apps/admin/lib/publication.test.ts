// Batch 3 E4-B — the publication policy and the reader, executed.
//
// THE ONE ASSERTION THAT MATTERS MOST is `serves the PUBLISHED figure, not the
// recomputed one`. Everything else in this file supports it. If a published
// month were served from a recomputation, the whole mechanism would be
// decoration: the recomputation is what moves, and the movement is the
// disclosure.
//
// So every published fixture here deliberately records a value the
// recomputation does NOT produce. A test whose published and recomputed figures
// agreed could not tell which one the reader used — which is the class of
// vacuous assertion this batch has been caught by repeatedly.

import { describe, expect, test } from 'vitest';
import { asPaisa, type Paisa } from '@muthoy/types';
import { parseCsv } from '@muthoy/utils';
import { adminReportExportQuerySchema } from '@muthoy/validation';
import { SUPPRESSED_DISPLAY, SUPPRESSION_K, type DaySides } from './adminSuppression';
import {
  buildReportTable,
  reportTextRows,
  reportToCsv,
  reportToPdf,
  type ReportData,
  type ReportSaleTotalRow,
} from './adminReports';
import {
  PUBLICATION_COHORT,
  PUBLICATION_METRIC,
  dayAxisAgreesWithSuppression,
  monthOf,
  periodEligibility,
  periodEndOf,
  periodStartOf,
  publicationDrift,
  publishedAmount,
  recordIsServable,
  resolveMonthlyMoney,
  type PublicationRecord,
  type PublicationSet,
} from './publication';

const REPORT = 'refund_net_pharmacy_sales';
const DIGEST = 'f'.repeat(64);
const COMPLETE = [
  { label: 'sales', counted: 0, loaded: 0 },
  { label: 'refunds', counted: 0, loaded: 0 },
];

function query(raw: Record<string, string>) {
  const parsed = adminReportExportQuerySchema.safeParse(raw);
  if (!parsed.success) throw new Error('fixture does not parse: ' + parsed.error.message);
  return parsed.data;
}

function row(shop: number, day: string, paisa: number): ReportSaleTotalRow {
  return { shopId: 'shop-' + shop, businessDate: day, totalPaisa: asPaisa(paisa) };
}

/**
 * A month that CLEARS the floor: `shops` distinct pharmacies both sell and
 * refund on every trading day.
 *
 * Non-vacuity depends on this existing. If no fixture ever cleared k=5, every
 * publication assertion below would pass by withholding, and the suite would
 * prove only that withholding works.
 */
function eligibleMonth(days: readonly string[], shops = SUPPRESSION_K + 1) {
  const sales: ReportSaleTotalRow[] = [];
  const refunds: ReportSaleTotalRow[] = [];
  for (const day of days) {
    for (let shop = 1; shop <= shops; shop += 1) {
      sales.push(row(shop, day, 100_000));
      refunds.push(row(shop, day, 10_000));
    }
  }
  return { sales, refunds };
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

function record(overrides: Partial<PublicationRecord> = {}): PublicationRecord {
  return {
    metricFamily: PUBLICATION_METRIC,
    cohortKey: PUBLICATION_COHORT,
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    // 5000.00 - 1000.00 = 4000.00. The fixture month recomputes to something
    // else entirely, which is how these tests can tell them apart.
    grossPaisa: asPaisa(500_000),
    refundsPaisa: asPaisa(100_000),
    valuePaisa: asPaisa(400_000),
    sourceSaleRows: 6,
    sourceRefundRows: 6,
    sourceDigest: DIGEST,
    kFloor: SUPPRESSION_K,
    contributorCount: SUPPRESSION_K + 1,
    publishedAt: '2026-10-31T18:00:00.000Z',
    ...overrides,
  };
}

// The published SET is now a value, so this is just the records.
const lookupFor = (...records: readonly PublicationRecord[]): PublicationSet => records;

const WHOLE_OCTOBER = { reportId: REPORT, format: 'csv', from: '2026-10-01', to: '2026-10-31' };

function octoberTable(
  source: { sales: ReportSaleTotalRow[]; refunds: ReportSaleTotalRow[] },
  publications?: PublicationSet,
) {
  return buildReportTable(
    REPORT,
    data({
      sales: source.sales,
      refunds: source.refunds,
      tallies: [
        { label: 'sales', counted: source.sales.length, loaded: source.sales.length },
        { label: 'refunds', counted: source.refunds.length, loaded: source.refunds.length },
      ],
    }),
    query(WHOLE_OCTOBER),
    publications === undefined ? {} : { publications },
  );
}

/**
 * A WITHHELD money cell, as the EXPORT path writes it.
 *
 * `SUPPRESSED_EXPORT` (empty), not `SUPPRESSED_DISPLAY` (the em dash). The two
 * are deliberately different and I had this wrong at first: the em dash is what
 * a PAGE renders, and an export must write an empty cell so a spreadsheet
 * totalling the column does not pick up a placeholder it would treat as text or
 * as zero. `reportTextRows`, CSV and PDF are all the export path.
 */
const WITHHELD_TEXT = '';

/** The net cell's text for the first data row. */
function netCellText(table: ReturnType<typeof buildReportTable>): string {
  const rows = reportTextRows(table);
  return rows[0]?.[1] ?? '(no row)';
}

/** The last CSV row, which is the data row after the preamble. */
function csvDataRow(csv: string): readonly string[] {
  return parseCsv(csv).at(-1) ?? [];
}

// ──────────────────────────────────────────────── 1-2. the figure and its sides

describe('the published figure, and which one is served', () => {
  test('serves the PUBLISHED figure, not the recomputed one', () => {
    const source = eligibleMonth(['2026-10-01', '2026-10-02']);
    const withheld = octoberTable(source);
    expect(netCellText(withheld)).toBe(WITHHELD_TEXT);

    const published = octoberTable(source, lookupFor(record()));
    // 4000.00 is the SNAPSHOT. The recomputation is 10800.00, and it is nowhere
    // in this table.
    expect(netCellText(published)).toBe('4000.00');
    expect(reportTextRows(published).flat().join(' ')).not.toContain('10800.00');
  });

  test('the published value goes through the shared gross-minus-refunds subtraction', () => {
    // CLAUDE.md rule 4. `netExportCell` takes a branded NetSales that only
    // `netSalesPaisa` mints, so the cell is rebuilt from the record's two sides
    // rather than cast from its value column. A record whose sides did not
    // subtract to its value is refused outright by `recordIsServable`, which
    // the test below exercises.
    const table = octoberTable(
      eligibleMonth(['2026-10-01']),
      lookupFor(
        record({
          grossPaisa: asPaisa(300_000),
          refundsPaisa: asPaisa(50_000),
          valuePaisa: asPaisa(250_000),
        }),
      ),
    );
    expect(netCellText(table)).toBe('2500.00');
  });

  test('refuses to serve a record whose value is not gross minus refunds', () => {
    const broken = record({ valuePaisa: asPaisa(999_999) });
    expect(recordIsServable(broken, '2026-10')).toContain('gross minus refunds');
    const money = resolveMonthlyMoney('2026-10', periodEligibility([], []), lookupFor(broken));
    expect(money.kind).toBe('failed');
    // NOT published, and NOT the broken number.
    expect(publishedAmount(money)).toBeNull();
  });
});

// ──────────────────────────────────────── 3-7. eligibility, the policy itself

describe('period eligibility', () => {
  const day = (d: string, sellers: number, refunders: number): DaySides => ({
    day: d,
    saleShopIds: Array.from({ length: sellers }, (_, i) => 'shop-' + i),
    refundShopIds: Array.from({ length: refunders }, (_, i) => 'shop-' + i),
  });

  test('an eligible month clears both axes and gives no reason', () => {
    const eligibility = periodEligibility(
      [day('2026-10-01', 6, 6), day('2026-10-02', 5, 5)],
      ['a', 'b', 'c', 'd', 'e'],
    );
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.reason).toBeNull();
    expect(eligibility.daysRequiringFloor).toBe(2);
    expect(eligibility.daysClearingFloor).toBe(2);
  });

  test('one short refund day withholds the whole month, and says which count', () => {
    const eligibility = periodEligibility(
      [day('2026-10-01', 6, 6), day('2026-10-02', 6, 1)],
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.daysRequiringFloor).toBe(2);
    expect(eligibility.daysClearingFloor).toBe(1);
    expect(eligibility.reason).toContain('1 of 2 trading days');
  });

  test('a quiet day does NOT require the floor, so one does not withhold a month', () => {
    // The over-withholding round 14 was reproduced for. A day nobody traded on
    // reveals no pharmacy's figure.
    const eligibility = periodEligibility(
      [day('2026-10-01', 6, 6), day('2026-10-02', 0, 0)],
      ['a', 'b', 'c', 'd', 'e'],
    );
    expect(eligibility.daysRequiringFloor).toBe(1);
    expect(eligibility.eligible).toBe(true);
  });

  test('a month with trade but too few contributors overall is withheld', () => {
    const eligibility = periodEligibility([day('2026-10-01', 6, 6)], ['a', 'b']);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toContain('below the k=5 floor');
  });

  test('a month with NO trade is NOT eligible, which this test used to assert the opposite of', () => {
    // ROUND 18 FINDING 3. This read `expect(eligibility.eligible).toBe(true)`,
    // and the reasoning behind it — an empty month discloses nothing about
    // anybody — was right about privacy and silent about everything else. A
    // month can look empty because nobody has SYNCED, and publishing 0.00
    // freezes a figure that was never the figure. Worse: publishing an
    // inactive month as zero means a later refund makes the report GAIN a
    // `0.00` row, so the row's existence discloses the refund.
    const eligibility = periodEligibility([day('2026-10-01', 0, 0)], []);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.contributorCount).toBe(0);
    expect(eligibility.daysRequiringFloor).toBe(0);
    expect(eligibility.reason).toContain('no trading activity');
  });

  test('names the SALE side when the sale side is what failed', () => {
    // ROUND 18 FINDING 8. `dayReleasable` fails when EITHER side is short, and
    // the reason always said "refunding pharmacies" — so one seller and five
    // refunders was refused with a sentence blaming the refunders. That is
    // round 1B finding 7's defect: withholding for one reason, stating another.
    const eligibility = periodEligibility(
      [day('2026-10-01', 1, 6)],
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toContain('selling pharmacies');
    expect(eligibility.reason).not.toContain('refunding');
  });

  test('MIXED failing sides are counted separately, not merged into one false clause', () => {
    // ROUND 19 FINDING 6, which was my round-18 fix still being wrong. I took
    // the noun from the FIRST failing day and the count from ALL of them, so a
    // period failing one day on the sale side and one on the refund side
    // reported "2 days had fewer than 5 selling pharmacies" when exactly one
    // did. A true word and a true number combined into a false sentence —
    // worse than the original, because it reads as precise.
    const eligibility = periodEligibility(
      [day('2026-10-01', 1, 6), day('2026-10-02', 6, 1)],
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.daysRequiringFloor).toBe(2);
    expect(eligibility.daysClearingFloor).toBe(0);
    const reason = eligibility.reason ?? '';
    // Both sides named, each with ITS OWN count of one.
    expect(reason).toContain('1 had fewer than 5 distinct selling pharmacies');
    expect(reason).toContain('1 had fewer than 5 distinct refunding pharmacies');
    // And the total is still right.
    expect(reason).toContain('2 of 2 trading days');
    // The old sentence would have claimed two days on one side.
    expect(reason).not.toContain('2 had fewer than');
  });

  test('names the REFUND side when the refund side is what failed', () => {
    const eligibility = periodEligibility(
      [day('2026-10-01', 6, 1)],
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    expect(eligibility.reason).toContain('refunding pharmacies');
    expect(eligibility.reason).not.toContain('selling');
  });

  test('the day axis agrees with daysReleasable, which is the one shared rule', () => {
    // Asserted rather than claimed in a comment. If the publication path and
    // the report path ever applied different rules, one of them would be wrong
    // and this is where it surfaces.
    const cases: readonly DaySides[][] = [
      [],
      [day('2026-10-01', 6, 6)],
      [day('2026-10-01', 6, 1)],
      [day('2026-10-01', 1, 6)],
      [day('2026-10-01', 0, 0)],
      [day('2026-10-01', 0, 3)],
      [day('2026-10-01', 6, 6), day('2026-10-02', 0, 0)],
      [day('2026-10-01', 6, 6), day('2026-10-02', 4, 6)],
    ];
    for (const days of cases) {
      expect(dayAxisAgreesWithSuppression(days), JSON.stringify(days)).toBe(true);
    }
  });
});

// ──────────────────────────────────── 8-9, 13. late rows and repeated queries

describe('a published figure does not move', () => {
  const source = eligibleMonth(['2026-10-01']);

  test('a LATE REFUND arriving after publication changes nothing', () => {
    const published = lookupFor(record());
    const before = octoberTable(source, published);
    // A pharmacy syncs a refund it entered three days ago, against a closed
    // month. This is the round-1B oracle: the same query answered 457.00 and
    // then 450.00, and the 7.00 difference was one pharmacy's refund.
    const late = {
      sales: source.sales,
      refunds: [...source.refunds, row(1, '2026-10-01', 700)],
    };
    const after = octoberTable(late, published);
    expect(netCellText(after)).toBe(netCellText(before));
    expect(netCellText(after)).toBe('4000.00');
  });

  test('a LATE SALE from a device that was offline changes nothing', () => {
    const published = lookupFor(record());
    const late = {
      sales: [...source.sales, row(9, '2026-10-01', 250_000)],
      refunds: source.refunds,
    };
    expect(netCellText(octoberTable(late, published))).toBe('4000.00');
  });

  test('a NEW pharmacy joining, changing the contributor population, changes nothing', () => {
    const published = lookupFor(record());
    const grown = eligibleMonth(['2026-10-01'], SUPPRESSION_K + 4);
    expect(netCellText(octoberTable(grown, published))).toBe('4000.00');
  });

  test('the population DROPPING below the floor still serves the published figure', () => {
    // A published figure wins unconditionally, before eligibility. Withdrawing
    // it later would itself be a disclosure: the withdrawal says the crowd
    // shrank, and the figure was already read.
    const published = lookupFor(record());
    const shrunk = eligibleMonth(['2026-10-01'], 1);
    expect(netCellText(octoberTable(shrunk, published))).toBe('4000.00');
  });

  test('a hundred repeated reads give one answer', () => {
    const published = lookupFor(record());
    const answers = new Set(
      Array.from({ length: 100 }, () => netCellText(octoberTable(source, published))),
    );
    expect([...answers]).toEqual(['4000.00']);
  });
});

// ─────────────────────────────── 10-12. inference, subset sums, differencing

describe('what cannot be inferred from a publication', () => {
  test('an UNPUBLISHED month is absent from the figures, not shown as zero', () => {
    const table = octoberTable(eligibleMonth(['2026-10-01']));
    const text = reportTextRows(table).flat();
    expect(text).toContain(WITHHELD_TEXT);
    // "Do not display a suppressed amount as zero." A spreadsheet totalling
    // this column must not pick up a 0.00 that was never a figure.
    expect(text).not.toContain('0.00');
  });

  test('publishing September does not disclose an unpublished October by subtraction', () => {
    // The composition rule: the two months are separate published buckets, and
    // an unpublished one contributes NO visible figure to subtract from.
    const september = eligibleMonth(['2026-09-01']);
    const october = eligibleMonth(['2026-10-01']);
    const table = buildReportTable(
      REPORT,
      data({
        sales: [...september.sales, ...october.sales],
        refunds: [...september.refunds, ...october.refunds],
        tallies: COMPLETE,
      }),
      query({ reportId: REPORT, format: 'csv', from: '2026-09-01', to: '2026-10-31' }),
      { publications: lookupFor(record({ periodStart: '2026-09-01', periodEnd: '2026-09-30' })) },
    );
    const rows = reportTextRows(table);
    expect(rows.find((entry) => entry[0] === '2026-09')?.[1]).toBe('4000.00');
    // October is present as a bucket and withheld as a figure. There is no
    // range total anywhere in this table to subtract September from.
    expect(rows.find((entry) => entry[0] === '2026-10')?.[1]).toBe(WITHHELD_TEXT);
    expect(rows.flat()).not.toContain('0.00');
  });

  test('a partial month is refused outright, so no window can be chosen inside one', () => {
    // Round 11 finding 2, still closed. The differencing attack needs a
    // caller-chosen window; a month-grained report answers only whole months.
    expect(() =>
      buildReportTable(
        REPORT,
        data({ ...eligibleMonth(['2026-10-01']), tallies: COMPLETE }),
        query({ reportId: REPORT, format: 'csv', from: '2026-10-01', to: '2026-10-02' }),
        { publications: lookupFor(record()) },
      ),
      // The REFUSAL's own wording, not a word any error could contain. The
      // first version of this matcher was /month/i, and it would have passed
      // on "fixture does not parse" — which is exactly how a negative test
      // ends up asserting nothing.
    ).toThrow(/answers for whole months only/);
  });

  test('a record for ANOTHER period is not served for this one', () => {
    // A lookup that returned the wrong month's record would publish September's
    // figure under October's label, which is a disclosure AND a lie.
    const wrongMonth = record({ periodStart: '2026-09-01', periodEnd: '2026-09-30' });
    expect(recordIsServable(wrongMonth, '2026-10')).toContain('is not 2026-10-01');
  });

  test('a record carrying a second cohort is refused, not served', () => {
    const otherCohort = record({ cohortKey: 'banani' });
    expect(recordIsServable(otherCohort, '2026-10')).toContain('unexpected cohort');
    expect(
      resolveMonthlyMoney('2026-10', periodEligibility([], []), lookupFor(otherCohort)).kind,
    ).toBe('failed');
  });

  test('a record claiming month 13 is refused, not normalised into existence', () => {
    // ROUND 21 FINDING 3, and it is a good demonstration of why a boundary
    // must not derive its expectation from its input. `periodEndOf` builds its
    // answer with `Date.UTC`, which NORMALISES an out-of-range month:
    // `Date.UTC(2026, 13, 0)` is 2027-01-31. So a record claiming
    // `periodStart: '2026-13-01'` with `periodEnd: '2027-01-31'` validated
    // against itself perfectly, and the report rendered `2026-13,4000.00`
    // labelled as published.
    const impossible = record({ periodStart: '2026-13-01', periodEnd: '2027-01-31' });
    expect(recordIsServable(impossible, '2026-13')).toContain('not the first of a real month');

    // And it does not reach a report row.
    const table = buildReportTable(
      REPORT,
      data({ sales: [], refunds: [], tallies: COMPLETE }),
      query({ reportId: REPORT, format: 'csv' }),
      { publications: [impossible] },
    );
    expect(reportTextRows(table).flat().join(' ')).not.toContain('2026-13');
    expect(reportToCsv(table)).not.toContain('4000.00');
  });

  test('an EARLY-YEAR record is refused, where Date.UTC would have normalised it', () => {
    // ROUND 22 FINDING 2, and my round-21 fix for the month-13 case still went
    // through `Date`. `Date.UTC` maps a year of 0-99 into 1900-1999, so a
    // record spanning 0026-10-01 to 1926-10-31 validated perfectly against an
    // expectation derived through that normalisation, and exported
    // `0026-10,4000.00`.
    //
    // `periodEndOf` is now arithmetic. The Gregorian leap rule is three lines
    // and has no surprises; `Date` has at least two, and both of them have now
    // produced a finding.
    expect(periodEndOf('0026-10')).toBe('0026-10-31');
    const normalised = record({ periodStart: '0026-10-01', periodEnd: '1926-10-31' });
    expect(recordIsServable(normalised, '0026-10')).toContain('not a whole month');
    const table = buildReportTable(
      REPORT,
      data({ sales: [], refunds: [], tallies: COMPLETE }),
      query({ reportId: REPORT, format: 'csv' }),
      { publications: [normalised] },
    );
    expect(reportTextRows(table).flat().join(' ')).not.toContain('0026-10');
  });

  test('a YEAR-ZERO record is refused, because no date column can hold it', () => {
    // ROUND 23 FINDING 2. The arithmetic is correct about the proleptic
    // Gregorian calendar — year 0 IS a leap year — so `0000-02-01` to
    // `0000-02-29` validated and an unbounded report exported
    // `0000-02,4000.00`. PostgreSQL rejects those dates with 22008, so such a
    // record cannot have come from the store this guard exists to serve.
    // Being right about the calendar is not being right about the database.
    expect(periodEndOf('0000-02')).toBe('0000-02-29');
    const yearZero = record({ periodStart: '0000-02-01', periodEnd: '0000-02-29' });
    expect(recordIsServable(yearZero, '0000-02')).toContain('year zero');
    const table = buildReportTable(
      REPORT,
      data({ sales: [], refunds: [], tallies: COMPLETE }),
      query({ reportId: REPORT, format: 'csv' }),
      { publications: [yearZero] },
    );
    expect(reportTextRows(table).flat().join(' ')).not.toContain('0000-02');
  });

  test('month ends are arithmetic in every century, including leap rules', () => {
    // 1900 is not a leap year, 2000 is, 2024 is, 2100 is not. A `Date`-based
    // implementation gets these right and gets early years wrong; arithmetic
    // has to get both right.
    expect(periodEndOf('1900-02')).toBe('1900-02-28');
    expect(periodEndOf('2000-02')).toBe('2000-02-29');
    expect(periodEndOf('2024-02')).toBe('2024-02-29');
    expect(periodEndOf('2100-02')).toBe('2100-02-28');
    expect(periodEndOf('0004-02')).toBe('0004-02-29');
  });

  test('a malformed record OUTSIDE the requested range does not claim a withholding', () => {
    // ROUND 22 FINDING 3. The outage flag asked the WHOLE set, so a malformed
    // September record produced the outage caption on an October-only report
    // that had withheld nothing and exported its figure happily — a caption
    // asserting an outcome that did not occur, which is GATE 5 FINDING 9 in a
    // new place.
    //
    // The requested range is caller-chosen and public, so narrowing by it leaks
    // nothing — unlike narrowing by which source buckets exist, which is what
    // rounds 19 and 20 were about.
    const malformedSeptember = record({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-29',
    });
    const table = octoberTable(eligibleMonth(['2026-10-01']), [record(), malformedSeptember]);
    expect(netCellText(table)).toBe('4000.00');
    expect(table.subtitle).not.toContain('could NOT be read');
  });

  test('a record whose period end is not a real date is refused', () => {
    expect(
      recordIsServable(record({ periodEnd: '2026-10-32' }), '2026-10'),
    ).toContain('not a real calendar date');
  });

  test('a MALFORMED record is captioned as unreadable, not as policy', () => {
    // ROUND 21 FINDING 2, and a regression I introduced in round 20: moving the
    // caption off the rows to stop it leaking bucket existence also stopped it
    // noticing a record that resolves to `failed`. A publication whose
    // `periodEnd` is not the month end withheld correctly and then got the
    // POLICY caption — byte-identical output to "nothing is published".
    //
    // Servability is a property of the SET, which is the same category as the
    // option itself, so reporting it reveals nothing private.
    const malformed = record({ periodEnd: '2026-10-30' });
    const table = octoberTable(eligibleMonth(['2026-10-01']), [malformed]);
    const policy = octoberTable(eligibleMonth(['2026-10-01']));

    expect(netCellText(table)).toBe(WITHHELD_TEXT);
    expect(table.subtitle).toContain('could NOT be read');
    expect(policy.subtitle).not.toContain('could NOT be read');
    expect(table.subtitle).not.toBe(policy.subtitle);
  });

  test('a record carrying another metric family is refused, not served', () => {
    const otherMetric = record({ metricFamily: 'subscription_revenue_and_renewals' });
    expect(recordIsServable(otherMetric, '2026-10')).toContain('unexpected metric');
  });
});

// ────────────────────────────────────────── 14-15. zero refunds, the k floor

describe('zero refunds and the k floor', () => {
  test('a day with sellers and NO refunders is withheld, not published as safe', () => {
    // Founder decision 3. Ten pharmacies sold and none refunded: publishing
    // tells a reader all ten refunded nothing, and identifies all ten, because
    // the set of zero-refunders is the whole set of sellers.
    const source = { sales: eligibleMonth(['2026-10-01']).sales, refunds: [] };
    const eligibility = periodEligibility(
      [{ day: '2026-10-01', saleShopIds: ['a', 'b', 'c', 'd', 'e', 'f'], refundShopIds: [] }],
      ['a', 'b', 'c', 'd', 'e', 'f'],
    );
    expect(eligibility.eligible).toBe(false);
    expect(netCellText(octoberTable(source))).toBe(WITHHELD_TEXT);
  });

  test('the floor is on DISTINCT shops, not on row count', () => {
    // ROUND 24 FINDING 4. This used to pass `['shop-1']` as the period's
    // contributors, so the row was refused TWICE OVER — once by the daily
    // deduplication this test names, and once by the period cohort of one
    // falling below k. The reviewer removed the deduplication and the
    // assertion still held, so the test proved nothing about the rule in its
    // own title.
    //
    // SIX PERIOD CONTRIBUTORS and a SECOND QUALIFYING DAY, so the cohort floor
    // is satisfied and the only thing left to refuse the period is the one
    // shop repeated fifty times on day one.
    const oneShopManyRows: DaySides = {
      day: '2026-10-01',
      saleShopIds: Array.from({ length: 50 }, () => 'shop-1'),
      refundShopIds: Array.from({ length: 50 }, () => 'shop-1'),
    };
    const sixDistinctShops: DaySides = {
      day: '2026-10-02',
      saleShopIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      refundShopIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    };
    const cohort = ['shop-1', 'a', 'b', 'c', 'd', 'e', 'f'];

    const eligibility = periodEligibility([oneShopManyRows, sixDistinctShops], cohort);
    expect(eligibility.eligible).toBe(false);
    // Exactly ONE of the two days failed, and it is the deduplicated one.
    expect(eligibility.daysRequiringFloor).toBe(2);
    expect(eligibility.daysClearingFloor).toBe(1);
    // And the cohort floor is NOT what refused it, which is the isolation.
    expect(eligibility.contributorCount).toBe(7);
    expect(eligibility.reason).not.toContain('below the k=5 floor');

    // The control, stated: the same day with fifty DISTINCT shops passes.
    const fiftyDistinct: DaySides = {
      day: '2026-10-01',
      saleShopIds: Array.from({ length: 50 }, (_, i) => 'shop-' + i),
      refundShopIds: Array.from({ length: 50 }, (_, i) => 'shop-' + i),
    };
    expect(periodEligibility([fiftyDistinct, sixDistinctShops], cohort).eligible).toBe(true);
  });
});

// ─────────────────────── 16-18. every output, and no way round the boundary

describe('every output path, and the boundary', () => {
  const source = eligibleMonth(['2026-10-01']);

  test('CSV, PDF and the rendered rows all carry the SAME published figure', () => {
    const table = octoberTable(source, lookupFor(record()));
    const csv = reportToCsv(table);
    const pdf = reportToPdf(table);
    expect(csvDataRow(csv)[1]).toBe('4000.00');
    expect(pdf).toContain('4000.00');
    expect(netCellText(table)).toBe('4000.00');
    // AND THE RECOMPUTATION APPEARS IN NONE OF THEM.
    //
    // ROUND 18 FINDING 9: these two lines excluded `10800.00`, which is the
    // TWO-day fixture's recomputation. This test uses the one-day fixture,
    // which recomputes to 5400.00 — so the assertions excluded a number the
    // code could never have produced here, and would have tolerated the actual
    // disclosure. A negative assertion aimed at the wrong number is the exact
    // vacuity this file claims to guard against, in the test whose whole
    // subject is which figure got out.
    expect(csv).not.toContain('5400.00');
    expect(pdf).not.toContain('5400.00');
  });

  test('a published month wins even when revisionSafe is true', () => {
    // ROUND 18 FINDING 2. Snapshot resolution lived only inside the
    // `!revisionSafe` branch, so this combination served 5400.00 — the
    // recomputation — against a published 4000.00. Not reachable in production
    // (the constant is false), and still wrong in the direction that matters:
    // a published figure and a recomputation of the same period, both
    // reachable, ARE the pair of answers the snapshot exists to eliminate.
    const table = buildReportTable(
      REPORT,
      data({ ...eligibleMonth(['2026-10-01']), tallies: COMPLETE }),
      query(WHOLE_OCTOBER),
      { publications: lookupFor(record()), revisionSafe: true },
    );
    expect(netCellText(table)).toBe('4000.00');
    expect(reportTextRows(table).flat().join(' ')).not.toContain('5400.00');
  });

  test('a FAILED lookup is captioned as an outage, not as policy', () => {
    // ROUND 18 FINDING 6. `failed` collapsed into the same withheld cell with
    // the same policy caption, so an outage and a deliberate withholding
    // produced byte-identical output. The cell stays withheld — showing an
    // unverified figure would be worse — but the caption now tells them apart.
    const exploding: PublicationSet = 'unavailable';
    const failed = octoberTable(eligibleMonth(['2026-10-01']), exploding);
    const withheld = octoberTable(eligibleMonth(['2026-10-01']));

    expect(netCellText(failed)).toBe(WITHHELD_TEXT);
    expect(netCellText(withheld)).toBe(WITHHELD_TEXT);
    // Same cell, different caption. That is the whole fix.
    expect(failed.subtitle).toContain('could NOT be read');
    // ROUND 22 FINDING 3 reworded this: the old sentence asserted an OUTCOME
    // ("money figures are withheld because of that") and could appear over a
    // table that withheld nothing.
    expect(failed.subtitle).toContain('not by policy');
    expect(withheld.subtitle).not.toContain('could NOT be read');
    expect(failed.subtitle).not.toBe(withheld.subtitle);
  });

  test('revisionSafe WITHOUT a lookup is refused outright', () => {
    // ROUND 19 FINDING 1, and it is round 18 finding 5 repeating one layer up.
    // That finding was `deps.k` — a test seam that let a caller lower the k
    // floor — and the rule it established is that a test seam on a privacy
    // control is a production hole. I removed `deps.k` and left this one.
    //
    // `{ revisionSafe: true }` with no lookup resolved "no publication" and then
    // released the recomputation: 5400.00 through CSV and PDF against a stored
    // 4000.00. The combination is now impossible rather than merely
    // ill-advised, so a caller must state that it consulted the record.
    expect(() =>
      buildReportTable(
        REPORT,
        data({ ...eligibleMonth(['2026-10-01']), tallies: COMPLETE }),
        query(WHOLE_OCTOBER),
        { revisionSafe: true },
      ),
    ).toThrow(/requires a publications lookup/);
  });

  test('revisionSafe WITH an empty lookup is allowed, so the rule is the claim not the ceremony', () => {
    // Non-vacuity for the test above: if the combination were simply banned,
    // every k-floor assertion in adminReports.test.ts would be unreachable.
    // `() => undefined` is the explicit, truthful claim "I looked, nothing is
    // published" — and it releases the recomputation, which is what
    // `revisionSafe` means.
    const table = buildReportTable(
      REPORT,
      data({ ...eligibleMonth(['2026-10-01']), tallies: COMPLETE }),
      query(WHOLE_OCTOBER),
      { revisionSafe: true, publications: [] },
    );
    expect(netCellText(table)).toBe('5400.00');
  });

  test('the outage caption does NOT depend on which buckets exist', () => {
    // ROUND 20 FINDING 2, and this is the second time I moved this leak rather
    // than closing it. Round 18 reported failures as a COUNT, which announced
    // an omitted bucket; I replaced the count with a BOOLEAN set while walking
    // rows, and a boolean set per row is still a function of which rows exist.
    // "Empty October" and "October with one refund and no sales" both render
    // zero rows, and their captions differed by one bit.
    //
    // The signal now comes from the OPTION — the set either could be read or
    // could not, which is a property of the request and not of the data. So
    // these two captions must be identical.
    const empty = { sales: [], refunds: [] };
    const refundOnly = { sales: [], refunds: eligibleMonth(['2026-10-01']).refunds };

    const emptyFailed = octoberTable(empty, 'unavailable');
    const refundFailed = octoberTable(refundOnly, 'unavailable');

    expect(reportTextRows(emptyFailed)).toHaveLength(0);
    expect(reportTextRows(refundFailed)).toHaveLength(0);
    // THE ASSERTION. Byte-identical captions over identical zero-row tables.
    expect(refundFailed.subtitle).toBe(emptyFailed.subtitle);
    // And an EMPTY report still reports the outage, which it previously missed
    // entirely because no row existed to set the flag.
    expect(emptyFailed.subtitle).toContain('could NOT be read');
    expect(reportToCsv(emptyFailed)).toBe(reportToCsv(refundFailed));
  });

  test('a published month is served even when its source rows are GONE', () => {
    // ROUND 20 FINDING 3. The report's months came from `sales` and `refunds`
    // alone, so a published month whose last source row had gone simply
    // vanished — the reviewer supplied a valid October snapshot, removed the
    // one remaining source row, and 4000.00 disappeared from CSV and PDF while
    // the publication was never consulted.
    //
    // Wrong in both directions: a published figure is a statement already
    // made, so it does not stop being true because the rows behind it moved;
    // and the row's PRESENCE becoming conditional on current source data is
    // round 18 finding 3's existence channel with the condition inverted.
    const table = octoberTable({ sales: [], refunds: [] }, lookupFor(record()));
    const rows = reportTextRows(table);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[0]).toBe('2026-10');
    expect(rows[0]?.[1]).toBe('4000.00');
    // Through the ordinary path, so it still satisfies the net-cell verifier
    // and both serializers.
    expect(reportToCsv(table)).toContain('4000.00');
    expect(reportToPdf(table)).toContain('4000.00');
  });

  test('a published month OUTSIDE the requested range is not added', () => {
    // Non-vacuity for the union above: adding every published month regardless
    // of the range would make the range caption a lie.
    const table = buildReportTable(
      REPORT,
      data({ sales: [], refunds: [], tallies: COMPLETE }),
      query({ reportId: REPORT, format: 'csv', from: '2026-09-01', to: '2026-09-30' }),
      { publications: lookupFor(record()) },
    );
    expect(reportTextRows(table)).toHaveLength(0);
  });

  test('a REFUND-ONLY month whose lookup failed still reports the outage', () => {
    // ROUND 19 FINDING 4, and my round-18 fix was incomplete in a way worth
    // recording. I set the failure counter AFTER the `existsWithoutRefunds`
    // omission, so a refund-only month — which is omitted from the table
    // entirely by round 3 finding 1, and which CAN legitimately be eligible —
    // produced byte-identical output to a policy withholding, with no sign
    // that anything had failed to read.
    //
    // ROUND 20 FINDING 2 then showed that fix was ALSO incomplete: a boolean
    // set while walking rows is still a function of which rows exist. The
    // signal now comes from the option, and the test above
    // ("the outage caption does NOT depend on which buckets exist") is the one
    // that pins it. This one keeps the narrower claim: a refund-only period
    // reports the outage at all.
    const refundOnly = { sales: [], refunds: eligibleMonth(['2026-10-01']).refunds };
    const failed = octoberTable(refundOnly, 'unavailable');
    const withheld = octoberTable(refundOnly);

    // The row is omitted in BOTH, which is still correct.
    expect(reportTextRows(failed)).toHaveLength(0);
    expect(reportTextRows(withheld)).toHaveLength(0);
    // The outage is reported; the policy case is not.
    expect(failed.subtitle).toContain('could NOT be read');
    expect(withheld.subtitle).not.toContain('could NOT be read');
    // And NO NUMBER appears, because a count would announce the omitted bucket.
    expect(failed.subtitle).not.toMatch(/\d+ money figure/);
  });

  test('a failed lookup withholds even when revisionSafe is true', () => {
    // A failed lookup means we do not KNOW whether a publication exists, and
    // serving a recomputation against an unknown publication is the pair
    // channel again. So it withholds in both modes.
    const exploding: PublicationSet = 'unavailable';
    const table = buildReportTable(
      REPORT,
      data({ ...eligibleMonth(['2026-10-01']), tallies: COMPLETE }),
      query(WHOLE_OCTOBER),
      { publications: exploding, revisionSafe: true },
    );
    expect(netCellText(table)).toBe(WITHHELD_TEXT);
    expect(reportTextRows(table).flat().join(' ')).not.toContain('5400.00');
  });

  test('CSV writes an EMPTY cell for a withheld month, never a placeholder', () => {
    const csv = reportToCsv(octoberTable(source));
    expect(csvDataRow(csv)[1]).toBe(WITHHELD_TEXT);
  });

  test('a caller that does not pass a lookup gets WITHHELD, never published', () => {
    // THE DEFAULT IS THE SAFE ONE. A route, a cache or an export that has not
    // been taught about publications cannot disclose anything by omission —
    // which is the direct-reader-bypass case, and the reason the option is
    // absent rather than defaulting to "assume published".
    const table = octoberTable(source);
    expect(netCellText(table)).toBe(WITHHELD_TEXT);
    expect(table.subtitle).toContain('could change');
  });

  test('the subtitle says what happened rather than asserting the policy', () => {
    const published = octoberTable(source, lookupFor(record()));
    expect(published.subtitle).toContain('published from immutable snapshots');
    // The old unconditional sentence would now contradict its own rows.
    expect(published.subtitle).not.toContain('could change');
  });

  test('an UNREADABLE set yields unavailable, not a figure and not a zero', () => {
    const exploding: PublicationSet = 'unavailable';
    const money = resolveMonthlyMoney('2026-10', periodEligibility([], []), exploding);
    expect(money.kind).toBe('unavailable');
    expect(publishedAmount(money)).toBeNull();
    if (money.kind === 'unavailable') expect(money.reason).toContain('could not be read');
  });
});

// ─────────────────────────────────────────────────── the five distinct states

describe('the five states stay distinguishable', () => {
  const eligible = periodEligibility(
    [
      {
        day: '2026-10-01',
        saleShopIds: ['a', 'b', 'c', 'd', 'e'],
        refundShopIds: ['a', 'b', 'c', 'd', 'e'],
      },
    ],
    ['a', 'b', 'c', 'd', 'e'],
  );

  test('published', () => {
    const money = resolveMonthlyMoney('2026-10', eligible, lookupFor(record()));
    expect(money.kind).toBe('published');
    expect(publishedAmount(money)).toBe(400_000 as Paisa);
  });

  test('withheld for the floor, with the floor reason', () => {
    const short = periodEligibility(
      [{ day: '2026-10-01', saleShopIds: ['a', 'b', 'c', 'd', 'e'], refundShopIds: ['a'] }],
      ['a', 'b', 'c', 'd', 'e'],
    );
    const money = resolveMonthlyMoney('2026-10', short, []);
    expect(money.kind).toBe('withheld');
    if (money.kind === 'withheld') expect(money.reason).toContain('refunding pharmacies');
  });

  test('withheld although ELIGIBLE, with a different reason an operator can act on', () => {
    // These two are different situations with different remedies: one needs
    // more pharmacies, the other needs somebody to press publish. Telling an
    // operator "fewer than five pharmacies" about a period that cleared the
    // floor sends them after the wrong thing.
    const money = resolveMonthlyMoney('2026-10', eligible, []);
    expect(money.kind).toBe('withheld');
    if (money.kind === 'withheld') {
      expect(money.reason).toContain('has not been published');
      expect(money.reason).not.toContain('fewer than');
    }
  });

  test('no_activity, which is not the same as withheld', () => {
    const quiet = periodEligibility(
      [{ day: '2026-10-01', saleShopIds: [], refundShopIds: [] }],
      [],
    );
    expect(resolveMonthlyMoney('2026-10', quiet, []).kind).toBe('no_activity');
  });

  test('failed, and it carries no amount', () => {
    const money = resolveMonthlyMoney(
      '2026-10',
      eligible,
      lookupFor(record({ cohortKey: 'elsewhere' })),
    );
    expect(money.kind).toBe('failed');
    expect(publishedAmount(money)).toBeNull();
  });

  test('every state is reachable, so none of the above is dead code', () => {
    const kinds = new Set([
      resolveMonthlyMoney('2026-10', eligible, lookupFor(record())).kind,
      resolveMonthlyMoney('2026-10', eligible, []).kind,
      resolveMonthlyMoney(
        '2026-10',
        periodEligibility([{ day: '2026-10-01', saleShopIds: [], refundShopIds: [] }], []),
        [],
      ).kind,
      resolveMonthlyMoney('2026-10', eligible, lookupFor(record({ cohortKey: 'x' }))).kind,
    ]);
    expect([...kinds].sort()).toEqual(['failed', 'no_activity', 'published', 'withheld']);
  });
});

// ──────────────────────────────────────────── drift detection, for audit only

describe('drift detection', () => {
  test('no drift when the recomputation agrees', () => {
    expect(publicationDrift(record(), asPaisa(400_000), DIGEST)).toBeNull();
  });

  test('reports a changed value, with the delta', () => {
    const drift = publicationDrift(record(), asPaisa(399_300), DIGEST);
    expect(drift?.deltaPaisa).toBe(-700);
    expect(drift?.month).toBe('2026-10');
  });

  test('reports a changed source even when the total happens to match', () => {
    // Two offsetting changes leave the total alone. The digest is what catches
    // it, which is why provenance is recorded and not just the figure.
    const drift = publicationDrift(record(), asPaisa(400_000), 'e'.repeat(64));
    expect(drift).not.toBeNull();
    expect(drift?.digestMatches).toBe(false);
    expect(drift?.deltaPaisa).toBe(0);
  });

  test('detecting drift does NOT change what is served', () => {
    // The served figure is the published row, drift or no drift. A publication
    // that corrected itself would be a revision, and the revision is the
    // disclosure.
    const base = eligibleMonth(['2026-10-01']);
    const late = { sales: base.sales, refunds: [...base.refunds, row(1, '2026-10-01', 700)] };
    expect(publicationDrift(record(), asPaisa(399_300), 'e'.repeat(64))).not.toBeNull();
    expect(netCellText(octoberTable(late, lookupFor(record())))).toBe('4000.00');
  });
});

// ──────────────────────────────────────────────────────── the period helpers

describe('the withheld cell has two forms and they must not be confused', () => {
  test('the export form is empty and the display form is the em dash', () => {
    // I WROTE THIS TEST BECAUSE I GOT IT WRONG. The first version of this file
    // asserted the em dash against `reportTextRows`, which is the EXPORT path,
    // and seven tests failed with `expected '' to be '—'`. The two forms exist
    // for different reasons and conflating them in either direction is a
    // defect: an export writing '—' gives a spreadsheet a placeholder in a
    // money column, and a page rendering '' gives an operator a blank cell with
    // no indication anything was withheld.
    expect(WITHHELD_TEXT).toBe('');
    expect(SUPPRESSED_DISPLAY).not.toBe(WITHHELD_TEXT);
    const csv = reportToCsv(octoberTable(eligibleMonth(['2026-10-01'])));
    expect(csvDataRow(csv)[1]).toBe('');
    // Scoped to the DATA ROW. My first version asserted the em dash was absent
    // from the whole document, and the column heading "Pharmacy sales, net of
    // refunds" sits next to one in the preamble — so a true claim about the
    // money cell was written as a false claim about the file.
    expect(csvDataRow(csv).join('|')).not.toContain(SUPPRESSED_DISPLAY);
  });
});

describe('period arithmetic', () => {
  test('month ends are computed, not tabulated', () => {
    expect(periodEndOf('2026-01')).toBe('2026-01-31');
    expect(periodEndOf('2026-02')).toBe('2026-02-28');
    expect(periodEndOf('2028-02')).toBe('2028-02-29');
    expect(periodEndOf('2026-04')).toBe('2026-04-30');
    expect(periodEndOf('2026-12')).toBe('2026-12-31');
  });

  test('period starts and the month round-trip', () => {
    expect(periodStartOf('2026-10')).toBe('2026-10-01');
    expect(monthOf(record())).toBe('2026-10');
  });
});
