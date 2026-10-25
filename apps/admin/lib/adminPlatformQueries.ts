import 'server-only';

// Batch 3 — the reads the new pages need. The pure libs decide; this file only
// fetches, and every predicate it applies comes from one of them.
//
// WHY THE COUNT AND THE PAGE SHARE A PREDICATE. §8.2 asks for `.range()`
// pagination with an EXACT count, and that figure is only true if the count
// query carries the same filters as the rows query. So both go through
// lib/adminFilters.ts — `applyShopListFilters` for the count,
// `applyShopListQuery` for the page — and the filters exist in one place. A
// count taken without the filters is a pager reporting "123 pharmacies" over a
// list of nine.
//
// WHY EVERY REPORT READ CARRIES A TALLY. §8.10's completeness gate compares the
// EXACT count of each source table against how many rows the pager actually
// returned. That comparison is evidence, and evidence has to be collected where
// the reading happens — a report layer cannot infer after the fact that its
// second page arrived. `readTallied` is the only reader the report source uses,
// so no table can reach a report without producing its own evidence.

import { addPaisa, asPaisa, type Paisa } from '@muthoy/types';
import { netSalesPaisa } from '@muthoy/utils';
import type { AdminListQuery, AdminReportExportQuery } from '@muthoy/validation';
import {
  applyShopListFilters,
  applyShopListQuery,
  pageMeta,
  rangeSpec,
  type ListFilterBuilder,
  type ListQueryBuilder,
  type PageMeta,
} from './adminFilters';
import type { ShopLocationRow } from './adminGeo';
import {
  collectedPaymentsByMonth,
  collectedSubscriptionPaymentsPaisa,
  expiredWithoutCancellation,
  monthlyRecurringRevenue,
  recordedCancellations,
  type MrrBreakdown,
} from './adminMetrics';
import type { ReportData, ReportSaleTotalRow, ReportShopRow, SourceTally } from './adminReports';
import {
  summarizeSupportCase,
  supportCaseDetail,
  type SupportCaseDetail,
  type SupportCaseSummary,
} from './adminSupport';
import {
  listSupportCases as readSupportCases,
  listSupportNotes,
  readSupportCase,
} from './adminSupportStore';
import type { OfferingRow, PaymentOrderRow, SubscriptionRow } from './adminViews';
import { AdminDataError } from './errors';
import { readAllPages } from './queries';
import { getSupabaseAdmin } from './supabaseAdmin';

const SHOP_LIST_COLUMNS =
  'id,name,name_en,phone,district,thana,plan,commercial_status,created_at,updated_at';

const SHOP_LOCATION_COLUMNS =
  'id,name,latitude,longitude,location_captured_at,district,plan,commercial_status';

function text(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value);
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ─────────────────────────────────────────────────────── the narrow boundary
//
// PostgREST's builder carries generics deep enough that checking it against a
// structural interface makes tsc give up outright ("type instantiation is
// excessively deep"), and `.select()` with a non-literal column string loses
// the row type altogether and comes back as `GenericStringError[]`.
//
// So the builder is narrowed ONCE, here, to exactly the two shapes this module
// consumes: a count response and a page of untyped records. The cast is at a
// boundary this module owns, the thing on the other side of it IS the real
// builder, and the rows are mapped field by field immediately afterwards — so
// nothing downstream depends on a type that was asserted rather than checked.

interface CountResponse {
  count: number | null;
  error: { message: string } | null;
}

interface RowsResponse {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}

/** A count query the shared filters can be applied to. */
type FilterableCountQuery = ListFilterBuilder & PromiseLike<CountResponse>;

/** A page query the shared filters, sort and range can be applied to. */
type FilterablePageQuery = ListQueryBuilder & PromiseLike<RowsResponse>;

function asCountQuery(builder: unknown): FilterableCountQuery {
  return builder as FilterableCountQuery;
}

function asPageQuery(builder: unknown): FilterablePageQuery {
  return builder as FilterablePageQuery;
}

// ─────────────────────────────────────────────────── §8.2 the paginated list

export interface ShopListRow {
  id: string;
  name: string;
  nameEn: string | null;
  phone: string;
  district: string | null;
  thana: string | null;
  plan: string;
  commercialStatus: string;
  createdAt: string;
  updatedAt: string;
}

function toShopListRow(row: Record<string, unknown>): ShopListRow {
  return {
    id: text(row.id),
    name: text(row.name),
    nameEn: nullableText(row.name_en),
    phone: text(row.phone),
    district: nullableText(row.district),
    thana: nullableText(row.thana),
    plan: text(row.plan, 'free'),
    commercialStatus: text(row.commercial_status, 'active'),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

export interface ShopListPage {
  rows: readonly ShopListRow[];
  meta: PageMeta;
}

/**
 * One page of pharmacies, with the exact total for the pager.
 *
 * The count and the page are issued in PARALLEL and both carry the same
 * filters. They are two queries against a changing table, so the count can be
 * one row stale relative to the page — which is honest for a list that is
 * paginated at all, and far better than a count that filtered differently.
 */
export async function listShopsPage(query: AdminListQuery): Promise<ShopListPage> {
  const supabase = getSupabaseAdmin();

  const countRequest = applyShopListFilters(
    asCountQuery(
      supabase.from('shops').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
    ),
    query,
  );
  const pageRequest = applyShopListQuery(
    asPageQuery(supabase.from('shops').select(SHOP_LIST_COLUMNS).eq('is_deleted', false)),
    query,
  );

  const [counted, paged] = await Promise.all([countRequest, pageRequest]);

  if (counted.error) {
    console.error('[admin] shop count query failed:', counted.error.message);
    throw new AdminDataError('pharmacy count query failed');
  }
  if (paged.error) {
    console.error('[admin] shop page query failed:', paged.error.message);
    throw new AdminDataError('pharmacy list query failed');
  }

  return {
    rows: (paged.data ?? []).map((row) => toShopListRow(row as Record<string, unknown>)),
    meta: pageMeta(rangeSpec(query), counted.count ?? 0),
  };
}

/** The distinct districts present, for the filter control. Bounded. */
export async function listShopDistricts(): Promise<readonly string[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('shops')
    .select('district')
    .eq('is_deleted', false)
    .not('district', 'is', null)
    .order('district', { ascending: true })
    .range(0, 4_999);

  if (error) {
    console.error('[admin] district list query failed:', error.message);
    throw new AdminDataError('district list query failed');
  }

  const districts = new Set<string>();
  for (const row of data ?? []) {
    const district = nullableText((row as Record<string, unknown>).district);
    if (district !== null && district.trim().length > 0) districts.add(district.trim());
  }
  return [...districts].sort();
}

// ────────────────────────────────────────────────────────── §8.6 the map read

/**
 * Every shop's coordinate columns.
 *
 * Read even though lib/adminGeo.ts will plot none of them, and that is
 * deliberate: the page's empty state reports how many shops were WITHHELD for
 * want of a consent record, and a zero that came from not looking is not the
 * same claim as a zero that came from looking.
 */
export async function listShopLocations(): Promise<readonly ShopLocationRow[]> {
  const rows = await readAllPages<Record<string, unknown>>('shop locations', (from, to) =>
    getSupabaseAdmin()
      .from('shops')
      .select(SHOP_LOCATION_COLUMNS)
      .eq('is_deleted', false)
      .order('id', { ascending: true })
      .range(from, to),
  );

  return rows.map((row) => ({
    id: text(row.id),
    name: text(row.name),
    latitude: finiteNumber(row.latitude),
    longitude: finiteNumber(row.longitude),
    locationCapturedAt: nullableText(row.location_captured_at),
    district: nullableText(row.district),
    plan: text(row.plan, 'free'),
    commercialStatus: text(row.commercial_status, 'active'),
  }));
}

// ───────────────────────────────────────────────────── §8.7 the support reads

/**
 * Shop names for a set of ids, as a map.
 *
 * `in` rather than one query per case: a list of fifty cases would otherwise be
 * fifty round trips. An id with no matching shop is simply absent from the map
 * and the caller renders null — a case whose shop was soft-deleted is still a
 * case, and dropping it would hide support history.
 */
async function shopNamesFor(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const { data, error } = await getSupabaseAdmin()
    .from('shops')
    .select('id,name')
    .in('id', unique)
    .range(0, Math.max(0, unique.length - 1));

  if (error) {
    console.error('[admin] support shop name lookup failed:', error.message);
    throw new AdminDataError('shop name lookup failed');
  }

  const names = new Map<string, string>();
  for (const row of data ?? []) {
    const record = row as Record<string, unknown>;
    names.set(text(record.id), text(record.name));
  }
  return names;
}

export async function listSupportCaseSummaries(
  query: { status?: string; shopId?: string } = {},
  now: Date = new Date(),
): Promise<readonly SupportCaseSummary[]> {
  const cases = await readSupportCases(query);
  const names = await shopNamesFor(cases.map((entry) => entry.shopId));

  return cases.map((row) =>
    summarizeSupportCase({
      row,
      shopName: names.get(row.shopId) ?? null,
      nowMs: now.getTime(),
    }),
  );
}

export async function getSupportCaseDetail(
  caseId: string,
  now: Date = new Date(),
): Promise<SupportCaseDetail | null> {
  const row = await readSupportCase(caseId);
  if (row === null) return null;

  const [notes, names] = await Promise.all([listSupportNotes(caseId), shopNamesFor([row.shopId])]);

  return supportCaseDetail({
    row,
    shopName: names.get(row.shopId) ?? null,
    notes,
    nowMs: now.getTime(),
  });
}

// ───────────────────────────────────── §8.4 and §8.5 the overview composites

const OFFERING_COLUMNS = 'tier,billing_cycle,amount_paisa,is_active';

/**
 * The window the cancellation count covers, and why it is bounded at all.
 *
 * A renewal overwrites the same `billing_subscriptions` row and clears
 * `canceled_at`, so a count over all time is not "every cancellation ever" —
 * it is every cancellation that has not yet been overwritten, which is a
 * figure whose meaning changes as rows are renewed. Ninety days is stated so
 * the page can say what the number covers.
 */
const CANCELLATION_WINDOW_DAYS = 90;

/** The price list MRR is derived from. Small and operator-maintained. */
export async function listPlanOfferings(): Promise<readonly OfferingRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('plan_offerings')
    .select(OFFERING_COLUMNS)
    .order('tier', { ascending: true })
    .range(0, 199);

  if (error) {
    console.error('[admin] plan_offerings read failed:', error.message);
    throw new AdminDataError('plan offering read failed');
  }

  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      tier: text(row.tier, 'free'),
      billingCycle: text(row.billing_cycle, 'monthly'),
      amountPaisa: asPaisa(finiteNumber(row.amount_paisa) ?? 0),
      isActive: row.is_active === true,
    };
  });
}

export interface RevenueOverview {
  /** The forward-looking monthly run rate. */
  runRate: MrrBreakdown;
  /** Cash collected, by month. NOT an MRR series — see §8.4 and gate E12. */
  collectedByMonth: readonly { month: string; totalPaisa: Paisa; orderCount: number }[];
  collectedTotalPaisa: Paisa;
  subscriptions: readonly SubscriptionRow[];
  orders: readonly PaymentOrderRow[];
  offerings: readonly OfferingRow[];
  recordedCancellations: number;
  expiredWithoutCancellation: number;
}

/**
 * Everything Revenue & Billing renders, in one read.
 *
 * The three money figures stay apart: `mrr` is a forward-looking run rate,
 * `collectedByMonth` is cash that arrived, and refund-net pharmacy sales — a
 * PHARMACY's takings, not Muthoy's — is a separate section fed by
 * `analyticsOverview`. §5 exists because those three get conflated.
 */
export async function revenueOverview(now: Date = new Date()): Promise<RevenueOverview> {
  const supabase = getSupabaseAdmin();

  const [subscriptions, orders, offerings] = await Promise.all([
    readAllPages<Record<string, unknown>>('billing_subscriptions', (from, to) =>
      asPageQuery(supabase.from('billing_subscriptions').select(REPORT_SUBSCRIPTION_COLUMNS))
        .order('id', { ascending: true })
        .range(from, to),
    ).then((rows) => rows.map(toSubscriptionRow)),
    readAllPages<Record<string, unknown>>('payment_orders', (from, to) =>
      asPageQuery(supabase.from('payment_orders').select(REPORT_ORDER_COLUMNS))
        .order('id', { ascending: true })
        .range(from, to),
    ).then((rows) => rows.map(toPaymentOrderRow)),
    listPlanOfferings(),
  ]);

  const nowMs = now.getTime();

  return {
    runRate: monthlyRecurringRevenue({ subscriptions, offerings, nowMs }),
    collectedByMonth: collectedPaymentsByMonth(orders),
    collectedTotalPaisa: collectedSubscriptionPaymentsPaisa(orders),
    subscriptions,
    orders,
    offerings,
    // A cancellation count needs an explicit PERIOD, because a renewal
    // overwrites the same row and clears `canceled_at` — so this is
    // "cancellations still visible in current state within the window", not a
    // historical churn series. An immutable lifecycle table is gate E12, and
    // §8.4 reports the trend as blocked rather than inventing one.
    recordedCancellations: recordedCancellations(subscriptions, {
      fromMs: nowMs - CANCELLATION_WINDOW_DAYS * 86_400_000,
      toMs: nowMs,
    }),
    expiredWithoutCancellation: expiredWithoutCancellation(subscriptions, nowMs),
  };
}

export interface AnalyticsOverview {
  /** Per Dhaka day: the shops that recorded a sale. */
  activeByDay: readonly { day: string; shopIds: readonly string[] }[];
  /** Per Dhaka day: the shops that registered. */
  registeredByDay: readonly { day: string; shopIds: readonly string[] }[];
  /** Per month: the refund-net total and the shops behind it. */
  pharmacySalesByMonth: readonly {
    month: string;
    totalPaisa: Paisa;
    shopIds: readonly string[];
  }[];
  /** Per plan tier: the shops on it. */
  shopsByPlan: readonly { plan: string; shopIds: readonly string[] }[];
}

function groupShops<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  shopOf: (row: T) => string,
): Map<string, string[]> {
  const buckets = new Map<string, string[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const held = buckets.get(key);
    if (held === undefined) buckets.set(key, [shopOf(row)]);
    else held.push(shopOf(row));
  }
  return buckets;
}

function sumTotals(rows: readonly ReportSaleTotalRow[]): Paisa {
  return rows.reduce<Paisa>((total, row) => addPaisa(total, row.totalPaisa), asPaisa(0));
}

/**
 * The analytics series, each carrying the CONTRIBUTING SHOP IDS rather than a
 * finished number.
 *
 * Deliberate: lib/adminSuppression.ts counts DISTINCT shops, so a reader that
 * returned totals would have thrown away the only thing the k floor can be
 * applied to — and the page would then have had to either recount or publish
 * an unsuppressed figure.
 *
 * It goes through the SAME tallied reads the reports use, so Analytics and the
 * matching report cannot disagree about a day's figure.
 */
export async function analyticsOverview(
  range: { from?: string; to?: string } = {},
): Promise<AnalyticsOverview> {
  const base = { format: 'csv' as const, ...range };
  const [activity, sales] = await Promise.all([
    platformReportData({ ...base, reportId: 'activity_summary' }),
    platformReportData({ ...base, reportId: 'refund_net_pharmacy_sales' }),
  ]);

  const months = new Map<string, { totalPaisa: Paisa; shopIds: string[] }>();
  for (const row of [...sales.sales, ...sales.refunds]) {
    const month = row.businessDate.slice(0, 7);
    const held = months.get(month) ?? { totalPaisa: asPaisa(0), shopIds: [] };
    held.shopIds.push(row.shopId);
    months.set(month, held);
  }
  for (const [month, held] of months) {
    const monthSales = sales.sales.filter((row) => row.businessDate.startsWith(month));
    const monthRefunds = sales.refunds.filter((row) => row.businessDate.startsWith(month));
    // W4-04's shared subtraction, so this page and the report agree exactly.
    held.totalPaisa = netSalesPaisa(sumTotals(monthSales), sumTotals(monthRefunds));
  }

  const toDayEntries = (buckets: Map<string, string[]>) =>
    [...buckets.entries()]
      .map(([day, shopIds]) => ({ day, shopIds }))
      .sort((left, right) => left.day.localeCompare(right.day));

  return {
    activeByDay: toDayEntries(
      groupShops(
        sales.sales,
        (row) => row.businessDate,
        (row) => row.shopId,
      ),
    ),
    registeredByDay: toDayEntries(
      groupShops(
        activity.shops,
        (shop) => shop.createdAt.slice(0, 10),
        (shop) => shop.id,
      ),
    ),
    pharmacySalesByMonth: [...months.entries()]
      .map(([month, held]) => ({ month, totalPaisa: held.totalPaisa, shopIds: held.shopIds }))
      .sort((left, right) => left.month.localeCompare(right.month)),
    shopsByPlan: [
      ...groupShops(
        activity.shops,
        (shop) => shop.plan,
        (shop) => shop.id,
      ),
    ]
      .map(([plan, shopIds]) => ({ plan, shopIds }))
      .sort((left, right) => left.plan.localeCompare(right.plan)),
  };
}

// ─────────────────────────────────────────────────── §8.10 the report source

/**
 * A paged read that also produces its own completeness evidence.
 *
 * The count is taken FIRST and the rows second. In that order a row inserted
 * between the two makes `loaded` exceed `counted`, which the gate refuses — and
 * refusing is right: the export would be of a moment that never existed as a
 * whole. The other order makes the same race look like a short read, which is
 * the same refusal reached by a more confusing route.
 *
 * Each caller passes its OWN two queries, built with literal column lists. One
 * shared filter closure over a dynamic table name would read more tidily and
 * would reintroduce exactly the two type failures the narrow boundary above
 * exists to avoid.
 */
async function readTallied<T>(
  label: string,
  countQuery: PromiseLike<CountResponse>,
  readPage: (from: number, to: number) => PromiseLike<RowsResponse>,
  map: (row: Record<string, unknown>) => T,
): Promise<{ rows: T[]; tally: SourceTally }> {
  const counted = await countQuery;
  if (counted.error) {
    console.error('[admin] ' + label + ' count failed:', counted.error.message);
    throw new AdminDataError(label + ' count query failed');
  }

  const rows = await readAllPages<Record<string, unknown>>(label, readPage);

  return {
    rows: rows.map(map),
    tally: { label, counted: counted.count ?? 0, loaded: rows.length },
  };
}

function toReportShopRow(row: Record<string, unknown>): ReportShopRow {
  return {
    id: text(row.id),
    name: text(row.name),
    district: nullableText(row.district),
    plan: text(row.plan, 'free'),
    commercialStatus: text(row.commercial_status, 'active'),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function toSubscriptionRow(row: Record<string, unknown>): SubscriptionRow {
  return {
    id: text(row.id),
    billingAccountId: text(row.billing_account_id),
    tier: text(row.tier, 'free'),
    billingCycle: text(row.billing_cycle, 'monthly'),
    status: text(row.status, 'unknown'),
    startsAt: text(row.starts_at),
    paidThrough: text(row.paid_through),
    graceEndsAt: nullableText(row.grace_ends_at),
    canceledAt: nullableText(row.canceled_at),
    provider: text(row.provider),
    createdAt: text(row.created_at),
  };
}

function toPaymentOrderRow(row: Record<string, unknown>): PaymentOrderRow {
  return {
    id: text(row.id),
    billingAccountId: text(row.billing_account_id),
    tier: text(row.tier, 'free'),
    billingCycle: text(row.billing_cycle, 'monthly'),
    amountPaisa: asPaisa(finiteNumber(row.amount_paisa) ?? 0),
    status: text(row.status, 'unknown'),
    provider: text(row.provider),
    failureCode: nullableText(row.failure_code),
    expiresAt: text(row.expires_at),
    verifiedAt: nullableText(row.verified_at),
    createdAt: text(row.created_at),
  };
}

/**
 * The sales and refunds inputs: a shop, a Dhaka business date, a total.
 *
 * BOTH SIDES ARE WINDOWED ON `business_date` — the W4-04 correction. A sale
 * windowed on `created_at` and its refund on `business_date` disagree for any
 * row whose business date was backfilled or whose device clock diverged from
 * Dhaka midnight, and the resulting figure is wrong in both directions at once.
 */
function toSaleTotalRow(column: string) {
  return (row: Record<string, unknown>): ReportSaleTotalRow => ({
    shopId: text(row.shop_id),
    businessDate: text(row.business_date),
    totalPaisa: asPaisa(finiteNumber(row[column]) ?? 0),
  });
}

/** A date range, already in the form its column compares against. */
interface Bounds {
  from?: string;
  to?: string;
}

/**
 * The Dhaka DAY bounds of a report range, as timestamptz literals.
 *
 * For a `timestamptz` column only. A `date` column takes the bare days — see
 * `dayBounds`, and see lib/adminFilters.ts on why `to` is the day's LAST
 * instant rather than its first.
 */
function instantBounds(query: AdminReportExportQuery): Bounds {
  return {
    ...(query.from === undefined ? {} : { from: query.from + 'T00:00:00+06:00' }),
    ...(query.to === undefined ? {} : { to: query.to + 'T23:59:59.999+06:00' }),
  };
}

/**
 * The same range for a `date` column, which `business_date` is.
 *
 * Handing a `date` column a timestamptz literal makes Postgres cast it, and a
 * `2026-10-25T23:59:59.999+06:00` upper bound casts to `2026-10-25` — which
 * happens to be right. `business_date >= '2026-10-01T00:00:00+06:00'` casts
 * the same way. Relying on that is relying on a cast nobody wrote down, so the
 * two shapes are kept apart and named.
 */
function dayBounds(query: AdminReportExportQuery): Bounds {
  return {
    ...(query.from === undefined ? {} : { from: query.from }),
    ...(query.to === undefined ? {} : { to: query.to }),
  };
}

/** Applies a range to a filterable query, leaving it out when unbounded. */
function withRange<B extends ListFilterBuilder>(builder: B, column: string, bounds: Bounds): B {
  let next = builder;
  if (bounds.from !== undefined) next = next.gte(column, bounds.from);
  if (bounds.to !== undefined) next = next.lte(column, bounds.to);
  return next;
}

/**
 * Which tables each report actually needs.
 *
 * Reading all five for every report would make a plan-distribution export page
 * through every sale on the platform — and the completeness gate would then be
 * able to refuse an export over rows it had no use for.
 */
const REPORT_TABLES: ReadonlyMap<
  string,
  readonly ('shops' | 'subscriptions' | 'orders' | 'sales')[]
> = new Map([
  ['pharmacy_registrations', ['shops']],
  ['subscriptions', ['subscriptions']],
  ['subscription_revenue_and_renewals', ['orders']],
  ['plan_distribution', ['shops']],
  ['activity_summary', ['shops', 'sales']],
  ['refund_net_pharmacy_sales', ['sales']],
]);

const REPORT_SHOP_COLUMNS = 'id,name,district,plan,commercial_status,created_at,updated_at';

const REPORT_SUBSCRIPTION_COLUMNS =
  'id,billing_account_id,tier,billing_cycle,status,starts_at,paid_through,'
  + 'grace_ends_at,canceled_at,provider,created_at';

const REPORT_ORDER_COLUMNS =
  'id,billing_account_id,tier,billing_cycle,amount_paisa,status,provider,'
  + 'failure_code,expires_at,verified_at,created_at';

export async function platformReportData(query: AdminReportExportQuery): Promise<ReportData> {
  const supabase = getSupabaseAdmin();
  const needed = REPORT_TABLES.get(query.reportId) ?? [];
  const instants = instantBounds(query);
  const days = dayBounds(query);
  const tallies: SourceTally[] = [];

  let shops: ReportShopRow[] = [];
  let subscriptions: SubscriptionRow[] = [];
  let orders: PaymentOrderRow[] = [];
  let sales: ReportSaleTotalRow[] = [];
  let refunds: ReportSaleTotalRow[] = [];

  if (needed.includes('shops')) {
    const read = await readTallied(
      'shops',
      withRange(
        asCountQuery(
          supabase
            .from('shops')
            .select('id', { count: 'exact', head: true })
            .eq('is_deleted', false),
        ),
        'created_at',
        instants,
      ),
      (from, to) =>
        withRange(
          asPageQuery(supabase.from('shops').select(REPORT_SHOP_COLUMNS).eq('is_deleted', false)),
          'created_at',
          instants,
        )
          .order('id', { ascending: true })
          .range(from, to),
      toReportShopRow,
    );
    shops = read.rows;
    tallies.push(read.tally);
  }

  if (needed.includes('subscriptions')) {
    // NO date window: `billing_subscriptions` is a mutable current-state row
    // (§8.4), so there is no historical date to window on. The report is a
    // snapshot of now, and its caption says so rather than implying a period.
    const read = await readTallied(
      'subscriptions',
      asCountQuery(
        supabase.from('billing_subscriptions').select('id', { count: 'exact', head: true }),
      ),
      (from, to) =>
        asPageQuery(supabase.from('billing_subscriptions').select(REPORT_SUBSCRIPTION_COLUMNS))
          .order('id', { ascending: true })
          .range(from, to),
      toSubscriptionRow,
    );
    subscriptions = read.rows;
    tallies.push(read.tally);
  }

  if (needed.includes('orders')) {
    const read = await readTallied(
      'payment_orders',
      withRange(
        asCountQuery(supabase.from('payment_orders').select('id', { count: 'exact', head: true })),
        'verified_at',
        instants,
      ),
      (from, to) =>
        withRange(
          asPageQuery(supabase.from('payment_orders').select(REPORT_ORDER_COLUMNS)),
          'verified_at',
          instants,
        )
          .order('id', { ascending: true })
          .range(from, to),
      toPaymentOrderRow,
    );
    orders = read.rows;
    tallies.push(read.tally);
  }

  if (needed.includes('sales')) {
    const readSales = await readTallied(
      'sales',
      withRange(
        asCountQuery(
          supabase
            .from('sales')
            .select('id', { count: 'exact', head: true })
            .eq('is_deleted', false),
        ),
        'business_date',
        days,
      ),
      (from, to) =>
        withRange(
          asPageQuery(
            supabase.from('sales').select('id,shop_id,business_date,total').eq('is_deleted', false),
          ),
          'business_date',
          days,
        )
          .order('id', { ascending: true })
          .range(from, to),
      toSaleTotalRow('total'),
    );
    sales = readSales.rows;
    tallies.push(readSales.tally);

    // Through the SAME tallied reader, so paging, the is_deleted filter and the
    // completeness evidence behave identically on both sides of the subtraction
    // rather than one being assumed to match the other.
    const readRefunds = await readTallied(
      'sale_refunds',
      withRange(
        asCountQuery(
          supabase
            .from('sale_refunds')
            .select('id', { count: 'exact', head: true })
            .eq('is_deleted', false),
        ),
        'business_date',
        days,
      ),
      (from, to) =>
        withRange(
          asPageQuery(
            supabase
              .from('sale_refunds')
              .select('id,shop_id,business_date,total_amount')
              .eq('is_deleted', false),
          ),
          'business_date',
          days,
        )
          .order('id', { ascending: true })
          .range(from, to),
      toSaleTotalRow('total_amount'),
    );
    refunds = readRefunds.rows;
    tallies.push(readRefunds.tally);
  }

  return { shops, subscriptions, orders, sales, refunds, tallies };
}
