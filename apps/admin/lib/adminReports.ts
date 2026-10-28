// Batch 3 §8.10 — the six platform reports. PURE.
//
// No Supabase client and no Next import: the data arrives as a `ReportData` bag
// and the completeness evidence arrives beside it as `SourceTally[]`. That is
// what lets the completeness gate below be a unit test rather than a thing one
// hopes the query layer did.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO KINDS OF REPORT, AND ONLY TWO.
//
//   registration_metadata  one row per pharmacy, carrying registration facts:
//                          when it registered, its name, district, plan and
//                          commercial status. NOT k-suppressed, because §8.10
//                          permits registration metadata explicitly and
//                          suppressing a shop's own registration date would
//                          make the report empty rather than private.
//
//   aggregate              a bucket, a month or a day. ALWAYS k-suppressed, on
//                          the number of DISTINCT CONTRIBUTORS behind the
//                          value, through lib/adminSuppression.ts and nothing
//                          else.
//
// There is no third kind, and in particular there is no per-shop FINANCIAL
// report. §8.10 forbids one, and the shape of this module is how that is
// enforced: no definition names a sale, a sale line, a customer or a medicine,
// and no reader in `ReportData` can supply one — the sales rows carry a shop
// id, a business date and a total, which is the input an aggregate needs and
// the least that can produce one.
//
// MONEY LABELS COME FROM §5.2'S MANIFEST, never from a string here. A money
// column heading is `requireMetric(id).label`, so a mislabelled figure fails
// adminMetrics.test.ts's per-family assertion rather than reaching a founder.
// It is also why this file passes adminLabels.test.ts: it names metric IDS,
// which that guard exempts by exact name, and never the words themselves.
//
// THE COMPLETENESS GATE IS A HARD FAILURE, not a warning. An export that
// silently dropped its second page would be a number an operator acted on, and
// a partial financial export is worse than no export: a missing row looks
// exactly like a real absence.

import { addPaisa, asPaisa, type Paisa } from '@muthoy/types';
import { netSalesPaisa } from '@muthoy/utils';
import { ADMIN_REPORT_IDS, type AdminReportExportQuery } from '@muthoy/validation';
import { CSV_CONTENT_TYPE, contentDisposition, toCsv, type CsvDocument } from './adminCsv';
import { dhakaDayLabel } from './adminDashboard';
import { dhakaDayEndIso, dhakaDayStartIso } from './adminFilters';
import { collectedPaymentsByMonth, requireMetric, type Metric } from './adminMetrics';
import { PDF_CONTENT_TYPE, PDF_LATIN1_NOTICE, toPdf } from './adminPdf';
import {
  SUPPRESSION_K,
  exportSuppressed,
  suppressBelowK,
  type Aggregate,
} from './adminSuppression';
import { formatCount, type PaymentOrderRow, type SubscriptionRow } from './adminViews';

export type AdminReportId = (typeof ADMIN_REPORT_IDS)[number];

/**
 * The explicit cap §8.10 asks for, applied to the SOURCE rows.
 *
 * Deliberately far above this product's scale: it exists so a runaway export
 * fails with a sentence instead of exhausting the server, not to limit a real
 * report. lib/queries.ts's pager has its own cap (200 pages × 1000 rows); this
 * one is the report layer's own statement, so a change to the pager cannot
 * silently raise it.
 */
export const MAX_EXPORT_SOURCE_ROWS = 100_000;

/** A read that could not be proved complete. Never downgraded to a warning. */
export class ReportCompletenessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportCompletenessError';
  }
}

/**
 * One table's read, with the count it was checked against.
 *
 * `counted` is an EXACT count query; `loaded` is how many rows actually came
 * back through the pager. The two agreeing is the only evidence that paging did
 * not drop anything, and it is evidence the query layer has to supply — which
 * is why it travels with the data rather than being assumed.
 */
export interface SourceTally {
  label: string;
  counted: number;
  loaded: number;
}

/**
 * Throws unless every read is provably complete and within the cap.
 *
 * Called BEFORE any table is built, so a report that cannot be trusted is never
 * rendered at all — an incomplete table that threw on the way out would already
 * have been written to a response body.
 */
export function assertCompleteRead(tallies: readonly SourceTally[]): void {
  if (tallies.length === 0) {
    // A report claiming no reads is a report with no evidence of completeness.
    // Accepting it would make the gate optional.
    throw new ReportCompletenessError('No source read was recorded for this report.');
  }

  for (const tally of tallies) {
    if (tally.counted > MAX_EXPORT_SOURCE_ROWS) {
      throw new ReportCompletenessError(
        tally.label + ' has ' + tally.counted + ' rows, above this export’s cap of '
        + MAX_EXPORT_SOURCE_ROWS + '. Narrow the date range.',
      );
    }
    if (tally.loaded !== tally.counted) {
      throw new ReportCompletenessError(
        tally.label + ' read ' + tally.loaded + ' of ' + tally.counted
        + ' rows. The export is incomplete and has not been produced.',
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────── the row shapes

/** Registration metadata. No money, and no field a sale could occupy. */
export interface ReportShopRow {
  id: string;
  name: string;
  district: string | null;
  plan: string;
  commercialStatus: string;
  createdAt: string;
  /** Last synced change. §8.2's note about this column applies here too. */
  updatedAt: string;
}

/**
 * A day's takings for ONE shop, already totalled by the query.
 *
 * A shop id, a Dhaka business date and a total. There is deliberately no sale
 * id, no line, no customer and no medicine: the aggregate does not need them,
 * and a field that existed could be exported by a later edit.
 */
export interface ReportSaleTotalRow {
  shopId: string;
  businessDate: string;
  totalPaisa: Paisa;
}

export interface ReportData {
  shops: readonly ReportShopRow[];
  subscriptions: readonly SubscriptionRow[];
  orders: readonly PaymentOrderRow[];
  sales: readonly ReportSaleTotalRow[];
  refunds: readonly ReportSaleTotalRow[];
  /** One entry per table actually read, for the completeness gate. */
  tallies: readonly SourceTally[];
}

/** What the query layer provides. Injected, so this module stays pure. */
export type ReportSource = (query: AdminReportExportQuery) => Promise<ReportData>;

// ───────────────────────────────────────────────────────────── the definitions

export type ReportKind = 'registration_metadata' | 'aggregate';

export interface ReportDefinition {
  id: AdminReportId;
  title: string;
  kind: ReportKind;
  columns: readonly string[];
  /**
   * The §5.2 metric this report's money column is, or null for a report with no
   * money in it. A money column with no metric cannot be built.
   */
  metricId: string | null;
  /** What a contributor is, for the k-anonymity caption. */
  contributorNoun: string | null;
  /**
   * Whether this report can honour the `status` filter, and WHAT status it
   * means.
   *
   * GATE 5 FINDING 9. The subtitle appended "status X" whenever the filter was
   * set, while only three of the six builders applied it — so a suspended-only
   * pharmacy-sales report said "status suspended" and returned the full total.
   * An export whose subtitle contradicts its rows is worse than one that
   * refuses the filter, because the reader has no way to tell.
   *
   * `null` means the report CANNOT apply it, and `buildReportTable` refuses the
   * query rather than quietly widening it.
   */
  statusFilter: 'commercial' | 'subscription' | null;
}

function definition(entry: ReportDefinition): ReportDefinition {
  return Object.freeze(entry);
}

/**
 * Money, rendered for a SPREADSHEET rather than for a screen.
 *
 * `formatMoney` is the on-screen form: `৳1,23,456.00`, with the taka sign and
 * lakh/crore grouping. Both are wrong in an export — the grouping commas make
 * every cell text rather than a number, and the sign is outside Latin-1 so the
 * PDF would render it as `?`. So an exported amount is a plain decimal, and the
 * column heading carries the unit.
 */
export function exportTaka(amount: Paisa): string {
  return (Number(amount) / 100).toFixed(2);
}

const MONEY_UNIT_SUFFIX = ' (BDT)';

export const ADMIN_REPORT_DEFINITIONS: readonly ReportDefinition[] = Object.freeze([
  definition({
    id: 'pharmacy_registrations',
    title: 'Pharmacy registrations',
    kind: 'registration_metadata',
    columns: ['Registered', 'Pharmacy', 'District', 'Plan', 'Commercial status'],
    metricId: null,
    contributorNoun: null,
      statusFilter: 'commercial',
  }),
  definition({
    id: 'subscriptions',
    title: 'Subscriptions by tier, cycle and status',
    kind: 'aggregate',
    columns: ['Tier', 'Billing cycle', 'Status', 'Accounts'],
    metricId: null,
    contributorNoun: 'billing accounts',
      statusFilter: 'subscription',
  }),
  definition({
    id: 'subscription_revenue_and_renewals',
    // The heading is the MANIFEST's label, resolved at module load.
    title: requireMetric('collected_subscription_payments_trend').label,
    kind: 'aggregate',
    columns: [
      'Month',
      requireMetric('collected_subscription_payments').label + MONEY_UNIT_SUFFIX,
      'Verified payments',
    ],
    metricId: 'collected_subscription_payments',
    contributorNoun: 'billing accounts',
      statusFilter: null,
  }),
  definition({
    id: 'plan_distribution',
    title: 'Plan distribution',
    kind: 'aggregate',
    columns: ['Plan', 'Pharmacies'],
    metricId: null,
    contributorNoun: 'pharmacies',
      statusFilter: 'commercial',
  }),
  definition({
    id: 'activity_summary',
    title: 'Activity summary',
    kind: 'aggregate',
    columns: ['Day', 'Pharmacies with recorded sales', 'New registrations'],
    metricId: null,
    contributorNoun: 'pharmacies',
      statusFilter: 'commercial',
  }),
  definition({
    id: 'refund_net_pharmacy_sales',
    title: requireMetric('pharmacy_sales_net').label,
    kind: 'aggregate',
    columns: ['Month', requireMetric('pharmacy_sales_net').label + MONEY_UNIT_SUFFIX],
    metricId: 'pharmacy_sales_net',
    contributorNoun: 'pharmacies',
      statusFilter: null,
  }),
]);

export function reportDefinition(id: string): ReportDefinition | undefined {
  return ADMIN_REPORT_DEFINITIONS.find((candidate) => candidate.id === id);
}

/**
 * THROWS on an unknown id, for the reason `requireMetric` does: a report with no
 * definition would otherwise render as an empty table with a blank title, which
 * reads as "no data" rather than as "no such report".
 */
export function requireReportDefinition(id: string): ReportDefinition {
  const found = reportDefinition(id);
  if (found === undefined) throw new Error('No report is defined for id: ' + id);
  return found;
}

/** The §5.2 metric a report's money column is, or null. */
export function reportMetric(entry: ReportDefinition): Metric | null {
  return entry.metricId === null ? null : requireMetric(entry.metricId);
}

// ────────────────────────────────────────────────────────────────── the tables

export interface ReportTable {
  reportId: AdminReportId;
  title: string;
  subtitle: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  /** How many buckets were withheld for k-anonymity. Reported, never hidden. */
  suppressedBuckets: number;
  /** The tallies the gate passed on, so a caller can record the evidence. */
  tallies: readonly SourceTally[];
}

function withinRange(day: string, query: AdminReportExportQuery): boolean {
  if (query.from !== undefined && day < query.from) return false;
  if (query.to !== undefined && day > query.to) return false;
  return true;
}

function withinInstantRange(timestamp: string, query: AdminReportExportQuery): boolean {
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at)) return false;
  if (query.from !== undefined && at < Date.parse(dhakaDayStartIso(query.from))) return false;
  if (query.to !== undefined && at > Date.parse(dhakaDayEndIso(query.to))) return false;
  return true;
}

function rangeCaption(query: AdminReportExportQuery): string {
  if (query.from === undefined && query.to === undefined) return 'All dates';
  return (query.from ?? 'the beginning') + ' to ' + (query.to ?? 'today');
}

/**
 * Raised when a report is asked for a filter it cannot apply.
 *
 * A named class so the page can render a sentence and the export route can
 * answer 400, instead of either of them inferring intent from a generic error.
 */
export class AdminReportFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminReportFilterError';
  }
}

function matchesStatus(value: string, query: AdminReportExportQuery): boolean {
  return query.status === undefined || query.status.length === 0 || value === query.status;
}

/** Groups by a key, keeping the contributor ids each bucket was built from. */
function groupContributors<T>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
  contributorOf: (row: T) => string,
): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === null) continue;
    const held = buckets.get(key);
    if (held === undefined) buckets.set(key, [contributorOf(row)]);
    else held.push(contributorOf(row));
  }
  return buckets;
}

interface AggregateRow {
  key: string;
  /** The already-formatted cells after the key, in column order. */
  values: readonly string[];
  contributorIds: readonly string[];
  /**
   * Optional PER-VALUE contributors, index-aligned with `values`.
   *
   * Present only where one row mixes a suppressible aggregate with a value
   * that must be gated separately — or not at all. An `undefined` entry means
   * that column is exempt, which is how §8.10's registration metadata sits
   * beside a sales aggregate without either weakening the other.
   */
  valueContributorIds?: readonly (readonly string[] | undefined)[];
}

/**
 * Applies the k floor to every aggregate row, in ONE place.
 *
 * A row below k has every value column EMPTIED — not zeroed. `exportSuppressed`
 * is what writes the empty cell, so a formatter cannot be the thing that leaks
 * a suppressed figure. The KEY stays, because the existence of a bucket is not
 * the disclosure and an operator needs to see that a month exists at all.
 */
function suppressRows(rows: readonly AggregateRow[]): {
  rows: readonly (readonly string[])[];
  suppressedBuckets: number;
} {
  const out: (readonly string[])[] = [];
  let suppressedBuckets = 0;

  for (const row of rows) {
    // GATE 5 FINDING 4 — PER-VALUE GATING.
    //
    // Row-level gating alone was a real k=5 bypass. `activity_summary`
    // declared the UNION of its registration and sales contributors, so a day
    // on which five shops registered and ONE of them traded cleared the floor
    // and then published the active count of 1 — which identifies that exactly
    // one of those five traded. The test meant to catch this asserted the
    // bypass and rationalised it as "safe BECAUSE five shops stand behind the
    // row"; the floor is on the contributors to THAT VALUE, not to the row.
    //
    // A row may now declare `valueContributorIds`, index-aligned with
    // `values`, and each value is gated by its own contributors. A value with
    // NO declared contributors is exempt — that is how registration metadata
    // rides in the same row as a suppressed aggregate, which §8.10 permits
    // explicitly. A row without the field keeps the previous whole-row
    // behaviour, so no other report changes.
    if (row.valueContributorIds !== undefined) {
      const perValue = row.values.map((value, index) => {
        const contributors = row.valueContributorIds?.[index];
        if (contributors === undefined) return { cell: value, suppressed: false };
        const gated = suppressBelowK({ value, contributingShopIds: contributors });
        return {
          cell: gated.suppressed ? exportSuppressed(gated, () => '') : value,
          suppressed: gated.suppressed,
        };
      });
      if (perValue.some((entry) => entry.suppressed)) suppressedBuckets += 1;
      out.push([row.key, ...perValue.map((entry) => entry.cell)]);
      continue;
    }

    const aggregate: Aggregate<readonly string[]> = {
      value: row.values,
      contributingShopIds: row.contributorIds,
    };
    const gated = suppressBelowK(aggregate);
    if (gated.suppressed) {
      suppressedBuckets += 1;
      out.push([row.key, ...row.values.map(() => exportSuppressed(gated, () => ''))]);
      continue;
    }
    out.push([row.key, ...row.values]);
  }

  return { rows: out, suppressedBuckets };
}

/**
 * The DHAKA day a registration belongs to.
 *
 * GATE 5 FINDING 10. These three call sites sliced the ISO string, which is the
 * UTC day — so a shop registered at `2026-10-25T20:00:00Z` was filed under
 * October 25 when Dhaka had already turned 26. The Dashboard already used the
 * Dhaka conversion, so Analytics, the reports and the Dashboard disagreed about
 * the same registration.
 *
 * The raw slice is kept as a LAST RESORT for a timestamp `Date.parse` cannot
 * read. That branch is unreachable through the database — `shops.created_at`
 * is `timestamptz NOT NULL DEFAULT now()`, and `withinInstantRange` already
 * excludes an unparseable instant before any bucketing happens — so it exists
 * only so that this function is total and can never return `null` into a
 * report key. It is NOT a claim that such a row survives into a report; it
 * does not, and the test below records that.
 */
function registrationDay(createdAt: string): string {
  return dhakaDayLabel(createdAt) ?? createdAt.slice(0, 10);
}

function sumPaisaOf(rows: readonly ReportSaleTotalRow[]): Paisa {
  return rows.reduce<Paisa>((total, row) => addPaisa(total, row.totalPaisa), asPaisa(0));
}

function buildRegistrations(data: ReportData, query: AdminReportExportQuery): AggregateRow[] {
  return data.shops
    .filter((shop) => withinInstantRange(shop.createdAt, query))
    .filter((shop) => matchesStatus(shop.commercialStatus, query))
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    .map((shop) => ({
      key: registrationDay(shop.createdAt),
      values: [shop.name, shop.district ?? '', shop.plan, shop.commercialStatus],
      // Registration metadata is not suppressed, so this list is not consulted.
      // It is still the shop's own id rather than an empty one, so a later
      // change to `kind` cannot un-suppress a bucket by having nothing to count.
      contributorIds: [shop.id],
    }));
}

function buildSubscriptionBuckets(data: ReportData, query: AdminReportExportQuery): AggregateRow[] {
  const relevant = data.subscriptions.filter((row) => matchesStatus(row.status, query));
  const buckets = groupContributors(
    relevant,
    (row) => row.tier + '\u0000' + row.billingCycle + '\u0000' + row.status,
    (row) => row.billingAccountId,
  );

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, contributorIds]) => {
      const [tier = '', cycle = '', status = ''] = key.split('\u0000');
      return {
        key: tier,
        values: [cycle, status, formatCount(new Set(contributorIds).size)],
        contributorIds,
      };
    });
}

function buildSubscriptionPaymentsByMonth(
  data: ReportData,
  query: AdminReportExportQuery,
): AggregateRow[] {
  const verified = data.orders.filter(
    (order) => order.verifiedAt !== null && withinInstantRange(order.verifiedAt, query),
  );
  // The monthly totals come from §5's own helper, so this report and the
  // Revenue page cannot disagree about what a month's collected payments are.
  const months = collectedPaymentsByMonth(verified);
  const contributors = groupContributors(
    verified,
    (order) => order.verifiedAt?.slice(0, 7) ?? null,
    (order) => order.billingAccountId,
  );

  return months.map((month) => ({
    key: month.month,
    values: [exportTaka(month.totalPaisa), formatCount(month.orderCount)],
    contributorIds: contributors.get(month.month) ?? [],
  }));
}

function buildPlanDistribution(data: ReportData, query: AdminReportExportQuery): AggregateRow[] {
  const buckets = groupContributors(
    data.shops.filter((shop) => matchesStatus(shop.commercialStatus, query)),
    (shop) => shop.plan,
    (shop) => shop.id,
  );

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([plan, contributorIds]) => ({
      key: plan,
      values: [formatCount(new Set(contributorIds).size)],
      contributorIds,
    }));
}

function buildActivitySummary(data: ReportData, query: AdminReportExportQuery): AggregateRow[] {
  // GATE 5 FINDING 9: the status filter now reaches BOTH halves of this report.
  // The sales half carries no status of its own, so it is restricted to the
  // shops that match — which is the only honest reading of "activity, status
  // suspended" and is possible here because this report reads `shops`.
  const matchingShopIds = new Set(
    data.shops
      .filter((shop) => matchesStatus(shop.commercialStatus, query))
      .map((shop) => shop.id),
  );

  const salesByDay = groupContributors(
    data.sales
      .filter((row) => withinRange(row.businessDate, query))
      .filter((row) => matchingShopIds.has(row.shopId)),
    (row) => row.businessDate,
    (row) => row.shopId,
  );
  const registrationsByDay = groupContributors(
    data.shops
      .filter((shop) => withinInstantRange(shop.createdAt, query))
      .filter((shop) => matchesStatus(shop.commercialStatus, query)),
    (shop) => registrationDay(shop.createdAt),
    (shop) => shop.id,
  );

  const days = [...new Set([...salesByDay.keys(), ...registrationsByDay.keys()])].sort();

  return days.map((day) => {
    const active = salesByDay.get(day) ?? [];
    const registered = registrationsByDay.get(day) ?? [];
    return {
      key: day,
      values: [formatCount(new Set(active).size), formatCount(new Set(registered).size)],
      contributorIds: [...active, ...registered],
      // EACH VALUE BY ITS OWN CONTRIBUTORS (Gate 5 finding 4).
      //
      // The active count is a sales-derived aggregate and is gated by the
      // shops that actually traded — so a day on which five shops registered
      // and one traded shows the registration count and withholds the active
      // one. Taking the union, as this did, published that single shop's day.
      //
      // The registration count is REGISTRATION METADATA, which §8.10 permits
      // unsuppressed, so it declares no contributors and is exempt. That
      // exemption is narrow and deliberate: a count of pharmacies that
      // registered is not a disclosure about any pharmacy's trade.
      valueContributorIds: [active, undefined],
    };
  });
}

function buildPharmacySalesByMonth(
  data: ReportData,
  query: AdminReportExportQuery,
): AggregateRow[] {
  const sales = data.sales.filter((row) => withinRange(row.businessDate, query));
  const refunds = data.refunds.filter((row) => withinRange(row.businessDate, query));

  const months = [
    ...new Set([...sales, ...refunds].map((row) => row.businessDate.slice(0, 7))),
  ].sort();

  return months.map((month) => {
    const monthSales = sales.filter((row) => row.businessDate.startsWith(month));
    const monthRefunds = refunds.filter((row) => row.businessDate.startsWith(month));
    // W4-04's shared subtraction, not a local one: the device and the panel
    // must produce the same figure from the same two sums.
    const total = netSalesPaisa(sumPaisaOf(monthSales), sumPaisaOf(monthRefunds));
    return {
      key: month,
      values: [exportTaka(total)],
      contributorIds: [
        ...monthSales.map((row) => row.shopId),
        ...monthRefunds.map((row) => row.shopId),
      ],
    };
  });
}

const BUILDERS: ReadonlyMap<
  string,
  (data: ReportData, query: AdminReportExportQuery) => AggregateRow[]
> = new Map([
  ['pharmacy_registrations', buildRegistrations],
  ['subscriptions', buildSubscriptionBuckets],
  ['subscription_revenue_and_renewals', buildSubscriptionPaymentsByMonth],
  ['plan_distribution', buildPlanDistribution],
  ['activity_summary', buildActivitySummary],
  ['refund_net_pharmacy_sales', buildPharmacySalesByMonth],
]);

/**
 * One report, built from already-read data.
 *
 * THE COMPLETENESS GATE RUNS FIRST. Building the table and then checking would
 * mean the rows existed, and a row that exists is a row something can return.
 */
export function buildReportTable(
  reportId: string,
  data: ReportData,
  query: AdminReportExportQuery,
): ReportTable {
  const entry = requireReportDefinition(reportId);
  assertCompleteRead(data.tallies);

  const builder = BUILDERS.get(entry.id);
  if (builder === undefined) {
    // Unreachable through requireReportDefinition, which is why reaching it
    // must not produce an empty report that looks like no data.
    throw new Error('No builder is registered for report: ' + entry.id);
  }
  // Refused BEFORE a row is built, so no partially-filtered table can exist.
  if (query.status !== undefined && query.status.length > 0 && entry.statusFilter === null) {
    throw new AdminReportFilterError(
      'The ' + entry.title + ' report cannot be filtered by status: its rows carry no status, '
      + 'and applying the filter to a different table would silently change what the figures '
      + 'mean. Clear the status filter, or use a report that supports it.',
    );
  }

  const built = builder(data, query);

  const { rows, suppressedBuckets } =
    entry.kind === 'aggregate'
      ? suppressRows(built)
      : { rows: built.map((row) => [row.key, ...row.values]), suppressedBuckets: 0 };

  const parts = [rangeCaption(query), rows.length + ' rows'];
  if (query.status !== undefined && query.status.length > 0) {
    parts.push('status ' + query.status);
  }
  if (entry.kind === 'aggregate') {
    parts.push(
      'buckets with fewer than ' + SUPPRESSION_K + ' '
      + (entry.contributorNoun ?? 'contributors') + ' are withheld'
      + (suppressedBuckets > 0 ? ' (' + suppressedBuckets + ' withheld)' : ''),
    );
  }

  return {
    reportId: entry.id,
    title: entry.title,
    subtitle: parts.join(' · '),
    columns: entry.columns,
    rows,
    suppressedBuckets,
    tallies: data.tallies,
  };
}

/** Reads the data through the injected source, then builds the table. */
export async function buildReport(
  query: AdminReportExportQuery,
  source: ReportSource,
): Promise<ReportTable> {
  return buildReportTable(query.reportId, await source(query), query);
}

// ───────────────────────────────────────────────────────────────── the exports

export function reportToCsvDocument(table: ReportTable): CsvDocument {
  return { headers: table.columns, rows: table.rows };
}

export function reportToCsv(table: ReportTable): string {
  return toCsv(reportToCsvDocument(table));
}

export function reportToPdf(table: ReportTable): string {
  return toPdf({
    title: table.title,
    subtitle: table.subtitle,
    headers: table.columns,
    rows: table.rows,
  });
}

/**
 * The download filename.
 *
 * Built from the report id and the range, both already parsed by the shared
 * schema, and then run through `contentDisposition`'s own character filter —
 * belt and braces, because this is the one value that crosses into an HTTP
 * header.
 */
export function reportFilename(query: AdminReportExportQuery): string {
  const range = [query.from, query.to].filter((part) => part !== undefined).join('_');
  const stem = range.length === 0 ? query.reportId : query.reportId + '_' + range;
  return stem + '.' + query.format;
}

export interface ReportDownload {
  body: string;
  contentType: string;
  contentDisposition: string;
  /** Set for a PDF: the Latin-1 limit, stated beside the link and in the body. */
  notice: string | null;
}

export function reportDownload(table: ReportTable, query: AdminReportExportQuery): ReportDownload {
  if (query.format === 'pdf') {
    return {
      body: reportToPdf(table),
      contentType: PDF_CONTENT_TYPE,
      contentDisposition: contentDisposition(reportFilename(query)),
      notice: PDF_LATIN1_NOTICE,
    };
  }
  return {
    body: reportToCsv(table),
    contentType: CSV_CONTENT_TYPE,
    contentDisposition: contentDisposition(reportFilename(query)),
    notice: null,
  };
}
