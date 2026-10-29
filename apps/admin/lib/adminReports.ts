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
import {
  netCellText,
  netExportCell,
  netSalesPaisa,
  withheldNetCell,
  type NetExportCell,
} from '@muthoy/utils';
import { ADMIN_REPORT_IDS, type AdminReportExportQuery } from '@muthoy/validation';
import { CSV_CONTENT_TYPE, contentDisposition, toCsv, type CsvDocument } from './adminCsv';
import { dhakaDayLabel, dhakaMonthLabel } from './adminDashboard';
import { dhakaDayAfterIso, dhakaDayStartIso } from './adminFilters';
import {
  collectedPaymentsByMonth,
  NET_SALES_METRIC_IDS,
  requireMetric,
  type Metric,
} from './adminMetrics';
import { PDF_CONTENT_TYPE, PDF_LATIN1_NOTICE, toPdf } from './adminPdf';
import {
  SUPPRESSED_EXPORT,
  SUPPRESSION_K,
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
  /**
   * The bucket this report's rows are, which is NOT the same thing as the
   * range a caller may ask for.
   *
   * ROUND 11 FINDING 2 — OVERLAPPING PERIODS DEFEAT k=5. The pharmacy-sales
   * report buckets by MONTH while the caller picks arbitrary DAYS, so the
   * single `2026-10` row held whatever fell inside the window and the floor
   * was applied to the window's contributors. The reviewer exploited exactly
   * that:
   *
   *   five pharmacies take ৳500 on October 1; one takes ৳80 on October 2
   *   October 2 alone   -> withheld, one contributor
   *   October 1 alone   -> 500.00
   *   October 1 to 2    -> 580.00    and 580 − 500 = the withheld 80.00
   *
   * Per-request suppression cannot stop that, because the two requests are
   * individually legitimate. What stops it is making the published bucket
   * INDEPENDENT OF THE REQUEST: a month-grained report answers only for whole
   * months, so a month's row carries the same value in every window that
   * contains it and no pair of windows differs by a withheld bucket.
   *
   *   'day'      — the row IS the atomic bucket, so any day range is safe.
   *   'month'    — whole months only; a partial month is refused.
   *   'snapshot' — current state, no period dimension at all (see finding 7).
   */
  period: 'day' | 'month' | 'snapshot';
}

function definition(entry: ReportDefinition): ReportDefinition {
  return Object.freeze(entry);
}

/** The last Dhaka day of the month a `YYYY-MM-DD` day falls in. */
export function monthEnd(day: string): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  // Day 0 of the NEXT month is the last day of this one, which also gets
  // February and leap years right without a table.
  const last = new Date(Date.UTC(year, month, 0));
  return last.toISOString().slice(0, 10);
}

/**
 * Refuses a range a report cannot answer without becoming reconstructable.
 *
 * Refusing rather than snapping outward: a report that silently widened the
 * range would return rows outside the range its own subtitle states, which is
 * Gate 5 finding 9 — an export whose caption contradicts its rows — and the
 * reader would have no way to tell.
 */
function assertAnswerablePeriod(
  entry: ReportDefinition,
  query: AdminReportExportQuery,
): void {
  if (entry.period === 'snapshot') {
    // ROUND 11 FINDING 7. These builders read CURRENT state and ignore dates
    // entirely, while the subtitle printed whatever range was asked for — so
    // five subscriptions that began in October 2026 appeared under
    // "2020-01-01 to 2020-01-02", reading as historical evidence. The report
    // cannot honour a period, so it says so instead of implying one.
    if (query.from !== undefined || query.to !== undefined) {
      throw new AdminReportFilterError(
        'The ' + entry.title + ' report is a snapshot of current state, not a history: '
        + 'its rows carry no date, so a date range would be printed in the caption without '
        + 'being applied to the figures. Clear the dates, or use a report with a period.',
      );
    }
    return;
  }

  if (entry.period !== 'month') return;
  assertWholeMonthRange(query, 'The ' + entry.title + ' report');
}

/**
 * Refuses a range that is not whole months.
 *
 * ROUND 12 FINDING 1: exported, because Analytics builds the same monthly
 * buckets from request-windowed rows and had no such gate — so the
 * differencing attack round 11 closed in the export still worked through the
 * page. One predicate, two callers, no chance of them disagreeing about which
 * windows are answerable.
 *
 * An open end is allowed: the attack needs a window the caller chose INSIDE a
 * month, and `from` on the first with no `to` still covers whole months.
 */
export function assertWholeMonthRange(
  range: { from?: string; to?: string },
  subject: string,
): void {
  const starts = range.from === undefined || range.from.endsWith('-01');
  const ends = range.to === undefined || range.to === monthEnd(range.to);
  if (starts && ends) return;

  throw new AdminReportFilterError(
    subject + ' is grouped by month, so it answers for whole months only. A part-month '
    + 'range would make each month’s figure depend on the window, and two overlapping '
    + 'windows would then differ by a withheld month. Use the first day of a month as the '
    + 'start and the last day of a month as the end.',
  );
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
    period: 'day',
    title: 'Pharmacy registrations',
    kind: 'registration_metadata',
    columns: ['Registered', 'Pharmacy', 'District', 'Plan', 'Commercial status'],
    metricId: null,
    contributorNoun: null,
      statusFilter: 'commercial',
  }),
  definition({
    id: 'subscriptions',
    period: 'snapshot',
    title: 'Subscriptions by tier, cycle and status',
    kind: 'aggregate',
    columns: ['Tier', 'Billing cycle', 'Status', 'Accounts'],
    metricId: null,
    contributorNoun: 'billing accounts',
      statusFilter: 'subscription',
  }),
  definition({
    id: 'subscription_revenue_and_renewals',
    period: 'month',
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
    period: 'snapshot',
    title: 'Plan distribution',
    kind: 'aggregate',
    columns: ['Plan', 'Pharmacies'],
    metricId: null,
    contributorNoun: 'pharmacies',
      statusFilter: 'commercial',
  }),
  definition({
    id: 'activity_summary',
    period: 'day',
    title: 'Activity summary',
    kind: 'aggregate',
    columns: ['Day', 'Pharmacies with recorded sales', 'New registrations'],
    metricId: null,
    contributorNoun: 'pharmacies',
      statusFilter: 'commercial',
  }),
  definition({
    id: 'refund_net_pharmacy_sales',
    period: 'month',
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
  /**
   * The rows, still carrying OPAQUE cells in any refund-net column.
   *
   * ROUND 12 FINDING 4. This was `readonly string[][]`, verified inside
   * `buildReportTable` and then handed out as plain text -- so the
   * verification happened one step before the output, again. The reviewer
   * substituted at the HANDLER:
   *
   *   reportDownload({ ...table, rows: table.rows.map((row) =>
   *     row.map((value, column) => (column === 1 ? '500.00' : value))) }, query)
   *
   * and both serializers returned 200 with 500.00 under the canonical net
   * caption, zero diagnostics, no forged cell.
   *
   * So the cells stay opaque all the way into the serializer, and
   * `reportTextRows` is the only thing that turns them into text. Read them
   * through that function, never by indexing this array for display.
   */
  rows: readonly (readonly ReportCell[])[];
  /** How many buckets were withheld for k-anonymity. Reported, never hidden. */
  suppressedBuckets: number;
  /** The tallies the gate passed on, so a caller can record the evidence. */
  tallies: readonly SourceTally[];
}

/**
 * The register of tables this module actually built.
 *
 * ROUND 13 FINDING 1. Round 12 made the serializer derive the net columns from
 * `table.reportId` instead of trusting a field on the table. The reviewer then
 * changed `reportId` INSTEAD:
 *
 *   reportDownload({ ...table, reportId: 'plan_distribution',
 *     rows: table.rows.map((row) => [row[0], '500.00']) }, query)
 *
 * -> HTTP 200, the canonical net caption, 500.00, zero diagnostics. Because
 * `title` and `columns` are independent fields, the net HEADING came along for
 * the ride while the identity that drove verification did not. Appending a
 * plain-string column under the net heading worked for the same reason.
 *
 * The lesson, fifth time around: a value built by this module must not be
 * reassemblable by a caller. Identity, captions and rows are bound together by
 * the OBJECT rather than by any field, so `{ ...table, ... }` is not a report
 * table at all. A WeakSet and not a brand property, because a symbol-keyed
 * marker is copied by a spread -- which is the whole reason §6i uses one.
 */
const AUTHENTIC_TABLES = new WeakSet<object>();

/** Freezes and registers a table. The only way one is created. */
function mintTable(table: ReportTable): ReportTable {
  Object.freeze(table.columns);
  Object.freeze(table.rows);
  Object.freeze(table);
  AUTHENTIC_TABLES.add(table);
  return table;
}

/** Thrown when something that is not a built report table reaches an output. */
export class ReportTableProvenanceError extends Error {
  constructor() {
    super(
      'this report table was not produced by buildReportTable, so its caption, its identity '
      + 'and its rows cannot be trusted to describe each other',
    );
    this.name = 'ReportTableProvenanceError';
  }
}

/**
 * The gate every output path crosses first.
 *
 * Exported so the route and the page can state the refusal in their own words
 * rather than letting a 500 happen somewhere lower down.
 */
export function assertAuthenticReportTable(table: ReportTable): void {
  if (!AUTHENTIC_TABLES.has(table)) throw new ReportTableProvenanceError();
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
  // Round 13 finding 4: HALF-OPEN. `Date.parse` keeps milliseconds, so an
  // inclusive `.999` bound here agreed with the old query bound -- and both
  // dropped the same rows. A strict compare against the next midnight cannot.
  if (query.to !== undefined && at >= Date.parse(dhakaDayAfterIso(query.to))) return false;
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

/**
 * One exported cell: plain text, or an OPAQUE refund-net cell.
 *
 * §6i ROUND 11. `values` used to be `readonly string[]`, and any string
 * satisfies a string, so the reviewer put an identity-shaped call between the
 * net sink and the row —
 *
 *   values: [((_: string) => exportTaka(sumPaisaOf(monthSales)))(netExportTaka(total))]
 *
 * — and a GROSS monthly sum was exported under the heading "Pharmacy sales,
 * net of refunds (BDT)", in the CSV and in the PDF, with no type error.
 *
 * A net cell is now a value only `netExportCell` can mint, and the columns a
 * report declares as refund-net money are resolved through `netCellText`,
 * which verifies. A plain string standing in one of those columns throws.
 */
export type ReportCell = string | NetExportCell;

interface AggregateRow {
  key: string;
  /** The already-formatted cells after the key, in column order. */
  values: readonly ReportCell[];
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
  /**
   * The contributors a STATUS FILTER excluded from this bucket.
   *
   * ROUND 12 FINDING 3. A filtered aggregate and the unfiltered one differ by
   * exactly the excluded group, so publishing both publishes that group:
   *
   *   activity_summary, no status -> 6
   *   activity_summary, active    -> 5
   *   activity_summary, suspended -> withheld      6 - 5 = the withheld 1
   *
   * I had recorded this as a documented limitation of k-anonymity. The
   * reviewer rejected that, correctly: these are shipped filters on a shipped
   * report, and a limitation you can execute is a defect.
   *
   * The rule is the composition rule again — a part may be published only if
   * every other part could be. So a filtered figure is released only when the
   * complement ALSO clears the floor, and the unfiltered view (whose
   * complement is empty) keeps answering. In the fixture above: 6 is
   * published, and the active-5 and suspended-1 views are both withheld, so
   * there is no pair to subtract.
   *
   * `undefined` or empty means nothing was excluded, which is the unfiltered
   * case and the common one.
   */
  complementContributorIds?: readonly string[];
  /** Per-value complements, index-aligned with `values`. */
  valueComplementIds?: readonly (readonly string[] | undefined)[];
  /**
   * The contributor sets of the SUB-PERIODS this bucket aggregates.
   *
   * ROUND 13 FINDING 2. Whole-month windows stopped two monthly answers from
   * differing, but they did nothing about a monthly answer differenced against
   * a DAILY one published elsewhere:
   *
   *   Oct 29: five pharmacies sell 100.00 each -> the Dashboard releases
   *           500.00 for that day, refunds 0.00
   *   Oct 1:  one other pharmacy refunds 80.00, and nothing else happens
   *   the full-October export releases 420.00, because the month's union is
   *   six pharmacies
   *
   *   500.00 - 420.00 = 80.00, which is the lone refunding pharmacy's amount.
   *
   * The composition rule has to hold ACROSS GRANULARITIES, not just within
   * one: a month is releasable only if every day inside it is releasable on
   * its own. That is the same rule `suppressTotalAcrossBuckets` applies to the
   * Revenue total, applied downwards instead of upwards.
   */
  subPeriodContributorIds?: readonly (readonly string[])[];
}

/**
 * Which `values` indexes carry refund-net money, derived from the definition.
 *
 * DERIVED rather than declared per report, so a new money report cannot forget
 * the field and quietly publish an unverified net column. The two things it
 * reads — the report's `metricId` and the column heading built from that
 * metric's label — are already in the definition, and the net report's own
 * entry is asserted non-empty in the tests, so this cannot silently return
 * nothing.
 *
 * `columns[0]` is the key column and `values` is index-aligned with
 * `columns[1...]`, hence the offset.
 */
function netValueIndexes(entry: ReportDefinition): readonly number[] {
  if (entry.metricId === null) return [];
  if (!(NET_SALES_METRIC_IDS as readonly string[]).includes(entry.metricId)) return [];
  const heading = requireMetric(entry.metricId).label + MONEY_UNIT_SUFFIX;
  return entry.columns
    .map((column, index) => (column === heading ? index - 1 : -1))
    .filter((index) => index >= 0);
}

/**
 * Turns the assembled cells into the exported text, verifying the net columns.
 *
 * THIS IS WHERE PROVENANCE ENDS — at the row that becomes CSV bytes and PDF
 * content, not one step before it. Every cell in a declared refund-net column
 * goes through `netCellText`, which throws unless the cell was minted by the
 * net export sink (or by the withheld-cell mint, which suppression uses). A
 * plain string there is a thrown error rather than a published figure.
 */
function toTextRows(
  rows: readonly (readonly ReportCell[])[],
  netIndexes: readonly number[],
): readonly (readonly string[])[] {
  const netColumns = new Set(netIndexes.map((index) => index + 1));
  return rows.map((row) =>
    row.map((cell, column) => {
      if (netColumns.has(column)) return netCellText(cell);
      if (typeof cell !== 'string') {
        // A net cell in a column nobody declared as net: it would stringify as
        // "[object Object]", and more to the point it means the definition and
        // the builder disagree about which column holds the money.
        throw new Error(
          'A refund-net cell appeared in column ' + column + ', which is not declared as one.',
        );
      }
      return cell;
    }),
  );
}

/**
 * Applies the k floor to every aggregate row, in ONE place.
 *
 * A row below k has every value column EMPTIED — not zeroed. `exportSuppressed`
 * is what writes the empty cell, so a formatter cannot be the thing that leaks
 * a suppressed figure. The KEY stays, because the existence of a bucket is not
 * the disclosure and an operator needs to see that a month exists at all.
 *
 * §6i ROUND 11: a suppressed NET column gets `withheldNetCell()` rather than
 * `''`. The cell still has to satisfy `netCellText`, and letting a bare empty
 * string through would have meant teaching the verifier to accept a plain
 * string — which is the hole it exists to close.
 */
function suppressRows(
  rows: readonly AggregateRow[],
  netIndexes: readonly number[],
): {
  rows: readonly (readonly ReportCell[])[];
  suppressedBuckets: number;
} {
  // The withheld cell for one value column.
  //
  // This replaces the `exportSuppressed(gated, …)` call that used to write it.
  // That helper returns `SUPPRESSED_EXPORT` — a plain `''` — and never calls
  // its formatter for a suppressed value, so there was no way to ask it for a
  // withheld NET cell. The property it existed for is kept exactly: the
  // suppressed value is never passed to a formatter, because it is never
  // passed anywhere. `SUPPRESSED_EXPORT` is still what a non-net column gets.
  const suppressedCell = (index: number): ReportCell =>
    netIndexes.includes(index) ? withheldNetCell() : SUPPRESSED_EXPORT;

  // Round 12 finding 3: a non-empty complement below the floor withholds the
  // value, however large the filtered side is.
  const complementBlocks = (complement: readonly string[] | undefined): boolean =>
    complement !== undefined
    && complement.length > 0
    && suppressBelowK({ value: null, contributingShopIds: complement }).suppressed;

  // Round 13 finding 2: a bucket whose SUB-PERIODS are not each releasable is
  // not releasable either, because a sub-period published elsewhere can be
  // subtracted from it.
  const subPeriodBlocks = (row: AggregateRow): boolean =>
    (row.subPeriodContributorIds ?? []).some(
      (contributors) =>
        contributors.length > 0
        && suppressBelowK({ value: null, contributingShopIds: contributors }).suppressed,
    );
  const out: (readonly ReportCell[])[] = [];
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
        const blocked = complementBlocks(row.valueComplementIds?.[index]);
        if (contributors === undefined) {
          // An exempt value is still withheld when the FILTER would expose the
          // excluded group through it.
          return { cell: blocked ? suppressedCell(index) : value, suppressed: blocked };
        }
        const gated = suppressBelowK({ value, contributingShopIds: contributors });
        const suppressed = gated.suppressed || blocked;
        return {
          cell: suppressed ? suppressedCell(index) : value,
          suppressed,
        };
      });
      const subBlocked = subPeriodBlocks(row);
      if (subBlocked || perValue.some((entry) => entry.suppressed)) suppressedBuckets += 1;
      if (subBlocked) {
        out.push([row.key, ...row.values.map((_value, index) => suppressedCell(index))]);
        continue;
      }
      out.push([row.key, ...perValue.map((entry) => entry.cell)]);
      continue;
    }

    const aggregate: Aggregate<readonly ReportCell[]> = {
      value: row.values,
      contributingShopIds: row.contributorIds,
    };
    const gated = suppressBelowK(aggregate);
    if (
      gated.suppressed
      || complementBlocks(row.complementContributorIds)
      || subPeriodBlocks(row)
    ) {
      suppressedBuckets += 1;
      out.push([row.key, ...row.values.map((_value, index) => suppressedCell(index))]);
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
    // Round 11 finding 8: the DHAKA month, the same one `collectedPaymentsByMonth`
    // files the totals under. A UTC slice here would have put a contributor in
    // one month and the money it contributed to in another, so the floor would
    // have been applied to the wrong set.
    (order) => (order.verifiedAt === null ? null : dhakaMonthLabel(order.verifiedAt)),
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
  // ROUND 12 FINDING 3: the same buckets WITHOUT the status filter, so each
  // row can declare what the filter left out. Unfiltered minus filtered is
  // exactly the excluded group, and publishing both publishes that group.
  const unfiltered = groupContributors(
    data.shops,
    (shop) => shop.plan,
    (shop) => shop.id,
  );

  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([plan, contributorIds]) => {
      const kept = new Set(contributorIds);
      return {
        key: plan,
        values: [formatCount(kept.size)],
        contributorIds,
        complementContributorIds: (unfiltered.get(plan) ?? []).filter(
          (shopId) => !kept.has(shopId),
        ),
      };
    });
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
  // ROUND 12 FINDING 3: the sales half WITHOUT the status restriction, so the
  // active count can declare the pharmacies the filter excluded. This is the
  // report the reviewer differenced: 6 unfiltered, 5 active, 1 suspended
  // withheld.
  const salesByDayUnfiltered = groupContributors(
    data.sales.filter((row) => withinRange(row.businessDate, query)),
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
    const activeKept = new Set(active);
    const activeComplement = (salesByDayUnfiltered.get(day) ?? []).filter(
      (shopId) => !activeKept.has(shopId),
    );
    return {
      key: day,
      values: [formatCount(activeKept.size), formatCount(new Set(registered).size)],
      contributorIds: [...active, ...registered],
      // Round 12 finding 3. The REGISTRATION count carries no complement: it
      // is registration metadata, which §8.10 permits unsuppressed, and it is
      // filtered on the shop's own status rather than restricted by a set the
      // reader could difference against a sales figure.
      valueComplementIds: [activeComplement, undefined],
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
      // §6i ROUND 11: the cell is OPAQUE, and `toTextRows` verifies it on the
      // way to the bytes.
      //
      // Round 10 made the sink take the opaque amount and own the conversion,
      // which closed the gap between the unwrap and the formatter. It still
      // returned a `string` into `values: string[]`, and any string satisfies
      // a string, so the reviewer put the identity-shaped call one step LATER:
      //
      //   ((_: string) => exportTaka(sumPaisaOf(monthSales)))(netExportTaka(total))
      //
      // and the CSV and the PDF both exported 500.00 instead of 400.00 under
      // "Pharmacy sales, net of refunds (BDT)", with zero type errors and no
      // forged box. A plain string cannot stand in this column now.
      values: [netExportCell(total)],
      contributorIds: [
        ...monthSales.map((row) => row.shopId),
        ...monthRefunds.map((row) => row.shopId),
      ],
      // Round 13 finding 2: the DAYS inside this month, each with its own
      // contributors. The Dashboard publishes a day; this publishes a month;
      // the difference between them is a day's worth of pharmacies, and a day
      // behind fewer than k of them must not be recoverable that way.
      subPeriodContributorIds: [
        ...new Set([...monthSales, ...monthRefunds].map((row) => row.businessDate)),
      ].map((day) => [
        ...new Set(
          [...monthSales, ...monthRefunds]
            .filter((row) => row.businessDate === day)
            .map((row) => row.shopId),
        ),
      ]),
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
  // Round 11 findings 2 and 7, refused BEFORE a row is built for the same
  // reason the status filter is: a row that exists is a row something can
  // return, and a reconstructable row is worse than a refusal.
  assertAnswerablePeriod(entry, query);

  // Refused BEFORE a row is built, so no partially-filtered table can exist.
  if (query.status !== undefined && query.status.length > 0 && entry.statusFilter === null) {
    throw new AdminReportFilterError(
      'The ' + entry.title + ' report cannot be filtered by status: its rows carry no status, '
      + 'and applying the filter to a different table would silently change what the figures '
      + 'mean. Clear the status filter, or use a report that supports it.',
    );
  }

  const built = builder(data, query);

  // §6i round 11: the net columns are resolved — and verified — HERE, on the
  // rows that become the exported bytes.
  const netIndexes = netValueIndexes(entry);
  const { cells, suppressedBuckets } =
    entry.kind === 'aggregate'
      ? (() => {
          const gated = suppressRows(built, netIndexes);
          return { cells: gated.rows, suppressedBuckets: gated.suppressedBuckets };
        })()
      : {
          cells: built.map((row) => [row.key, ...row.values]),
          suppressedBuckets: 0,
        };
  // NOT flattened here. Round 12 finding 4: the text is produced by
  // `reportTextRows`, at the serializer, so there is no window between a
  // verified row and the bytes in which a caller can substitute one.
  const rows = cells;

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

  return mintTable({
    reportId: entry.id,
    title: entry.title,
    subtitle: parts.join(' · '),
    columns: entry.columns,
    rows,
    suppressedBuckets,
    tallies: data.tallies,
  });
}

/** Reads the data through the injected source, then builds the table. */
export async function buildReport(
  query: AdminReportExportQuery,
  source: ReportSource,
): Promise<ReportTable> {
  return buildReportTable(query.reportId, await source(query), query);
}

// ───────────────────────────────────────────────────────────────── the exports

/**
 * The rows as TEXT, verifying every refund-net cell on the way.
 *
 * ROUND 12 FINDING 4 — THIS IS THE OUTPUT BOUNDARY. Every path that turns a
 * report into something a human reads goes through here: the CSV, the PDF and
 * the on-screen table. A plain string standing in a net column throws.
 *
 * WHICH COLUMNS ARE NET IS DERIVED FROM THE REPORT'S OWN DEFINITION, not read
 * off the table. Trusting a field on the table would mean
 * `{ ...table, netColumns: [] }` disables the check, which is the same shape
 * of bypass as the one this closes. The only thing taken on trust is
 * `reportId`, and a caller who changes that gets a different report's title
 * and columns -- so the net caption it is trying to publish under is gone.
 */
export function reportTextRows(table: ReportTable): readonly (readonly string[])[] {
  // Round 13 finding 1: the whole table, as built, or nothing. Deriving the
  // net columns from `reportId` was not enough while `reportId` was itself a
  // field a caller could replace.
  assertAuthenticReportTable(table);
  const entry = requireReportDefinition(table.reportId);
  return toTextRows(table.rows, netValueIndexes(entry));
}

export function reportToCsvDocument(table: ReportTable): CsvDocument {
  return { headers: table.columns, rows: reportTextRows(table) };
}

export function reportToCsv(table: ReportTable): string {
  return toCsv(reportToCsvDocument(table));
}

export function reportToPdf(table: ReportTable): string {
  return toPdf({
    title: table.title,
    subtitle: table.subtitle,
    headers: table.columns,
    rows: reportTextRows(table),
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
