import 'server-only';

import { AdminDataError } from './errors';
import { assertCompleteRead } from './adminReports';
import { netSalesPaisa } from '@muthoy/utils';
import {
  dhakaDayRange,
  sumRefundTotals,
  sumSaleTotals,
  type PharmacyRow,
  type PlatformStats,
  type SaleRefundTotalRow,
  type SaleTotalRow,
} from './platformStats';
import { getSupabaseAdmin } from './supabaseAdmin';

// Read-only access to the live cloud mirror. Reads only; the admin panel never
// writes, and nothing here touches RLS policies or the schema.
//
// PostgREST caps a single response, so every list is read in pages — otherwise
// a busy day would silently report only the first page of sales as the total.
const PAGE_SIZE = 1000;
const MAX_ROWS = 200_000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

type PageReader<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

/** Exported for lib/adminQueries.ts (W4-07): one bounded pager, not two. */
export async function readAllPages<T>(label: string, readPage: PageReader<T>): Promise<T[]> {
  const rows: T[] = [];

  // PostgREST may cap a response below PAGE_SIZE. Only an empty page proves
  // exhaustion, and advancing by the requested size would skip capped rows.
  // Bound rows, rather than requests, so a smaller server cap does not lower
  // the amount this reader can legitimately return.
  while (rows.length <= MAX_ROWS) {
    const from = rows.length;
    const { data, error } = await readPage(from, Math.min(from + PAGE_SIZE - 1, MAX_ROWS));

    if (error) {
      console.error(`[admin] ${label} query failed:`, error.message);
      throw new AdminDataError(`${label} query failed`);
    }

    const batch = data ?? [];
    if (batch.length === 0) return rows;
    rows.push(...batch);
  }

  console.error(`[admin] ${label} exceeded ${MAX_ROWS} rows`);
  throw new AdminDataError(`${label} result set is larger than this page can read`);
}

interface ShopSelectRow {
  id: string;
  name: string;
  phone: string;
  created_at: string;
  plan: string;
  commercial_status: string;
}

/** Volume 5 P0: read-only shop name / phone / registration date / plan. */
export async function listPharmacies(): Promise<PharmacyRow[]> {
  const supabase = getSupabaseAdmin();

  const rows = await readAllPages<ShopSelectRow>('shops', (from, to) =>
    supabase
      .from('shops')
      .select('id,name,phone,created_at,plan,commercial_status')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      // Secondary key so paging is deterministic when two shops share a timestamp.
      .order('id', { ascending: true })
      .range(from, to),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    phone: row.phone,
    registeredAt: row.created_at,
    plan: row.plan,
    commercialStatus: row.commercial_status,
  }));
}

/**
 * Volume 5 P0's two numbers, with W4-04 applied to the money one: total shops,
 * and today's REFUND-NET sales across all shops.
 *
 * BOTH SIDES ARE WINDOWED ON `business_date`, and that is the correction. This
 * read used `created_at` for sales while refunds carry their own
 * `business_date`, so the two windows disagreed for any row whose business date
 * was backfilled (migration 20260827000000) or whose device clock diverged from
 * Dhaka midnight — a sale counted on one day and its refund on another, which
 * is a net figure wrong in both directions at once.
 * apps/mobile/db/reports.ts already used `business_date` on both sides; the
 * admin panel now matches it exactly, through the same shared subtraction.
 *
 * KNOWN ASYMMETRY, preserved deliberately. The canonical mobile definition
 * (reports.ts:34-37) joins a refund to its sale WITHOUT filtering the sale's
 * `is_deleted`, so a refund whose sale was later soft-deleted still counts
 * against the day while the sale itself does not. That is odd, and it is what
 * the device reports. Admin matches it rather than quietly diverging: two
 * reports of one shop disagreeing is worse than either rule, and changing money
 * semantics on both platforms is a decision, not a cleanup (CLAUDE.md rules 4
 * and 10).
 */
export async function getPlatformStats(now: Date = new Date()): Promise<PlatformStats> {
  const supabase = getSupabaseAdmin();
  const day = dhakaDayRange(now);

  const { count, error: countError } = await supabase
    .from('shops')
    .select('id', { count: 'exact', head: true })
    .eq('is_deleted', false);

  if (countError) {
    console.error('[admin] shop count query failed:', countError.message);
    throw new AdminDataError('shop count query failed');
  }

  // ROUND 11 FINDING 1: `shop_id` comes back as well, so the figure and its
  // k-anonymity gate are derived from ONE windowing of these two tables. The
  // column list stays a single literal — a concatenated string makes PostgREST
  // infer `GenericStringError[]` and the row type collapses.
  const saleRows = await readAllPages<SaleTotalRow>('sales', (from, to) =>
    supabase
      .from('sales')
      .select('total, shop_id')
      .eq('is_deleted', false)
      .eq('business_date', day.businessDate)
      .order('id', { ascending: true })
      .range(from, to),
  );

  // Through the same bounded pager as sales, so paging, the is_deleted filter
  // and the AdminDataError path behave identically on both sides rather than
  // one being assumed to match the other.
  const refundRows = await readAllPages<SaleRefundTotalRow>('sale_refunds', (from, to) =>
    supabase
      .from('sale_refunds')
      .select('total_amount, shop_id')
      .eq('is_deleted', false)
      .eq('business_date', day.businessDate)
      .order('id', { ascending: true })
      .range(from, to),
  );

  // ROUND 13 FINDING 3 — THE DASHBOARD IS INSIDE THE COMPLETENESS GATE TOO.
  //
  // `readAllPages` originally stopped when a page came back shorter than
  // `PAGE_SIZE`, making a finished read indistinguishable from a CAPPED
  // one. With six pharmacies selling 100.00 each and a transport returning
  // five rows, the Dashboard published 500.00 and refused nothing, while the
  // matching report correctly rejected `counted: 6, loaded: 5`. Round 12 put
  // Analytics and Revenue inside the gate and left this page outside it.
  //
  // So both reads are counted independently and compared with what loaded.
  // `head: true` asks for the count and no rows, so this is two cheap queries
  // rather than a second pass over the data.
  const [saleCount, refundCount] = await Promise.all([
    supabase
      .from('sales')
      .select('id', { count: 'exact', head: true })
      .eq('is_deleted', false)
      .eq('business_date', day.businessDate),
    supabase
      .from('sale_refunds')
      .select('id', { count: 'exact', head: true })
      .eq('is_deleted', false)
      .eq('business_date', day.businessDate),
  ]);
  if (saleCount.error) {
    console.error('[admin] sales count query failed:', saleCount.error.message);
    throw new AdminDataError('sales count query failed');
  }
  if (refundCount.error) {
    console.error('[admin] sale_refunds count query failed:', refundCount.error.message);
    throw new AdminDataError('sale_refunds count query failed');
  }
  // THROWS on a short read. A dashboard figure built from part of a day is a
  // wrong figure, and showing it is worse than showing an error.
  assertCompleteRead([
    { label: 'sales', counted: saleCount.count ?? 0, loaded: saleRows.length },
    { label: 'sale_refunds', counted: refundCount.count ?? 0, loaded: refundRows.length },
  ]);

  const grossSalesToday = sumSaleTotals(saleRows);
  const refundsToday = sumRefundTotals(refundRows);

  // SEPARATELY, not unioned. Round 12 finding 2: a union of the two sides
  // cleared the floor for a day on which ONE pharmacy sold and four others
  // refunded, and the page then published that one pharmacy's gross takings
  // and an activity count of 1. Each side is gated against its own
  // contributors in app/page.tsx.
  const saleContributorShopIds = [...new Set(saleRows.map((row) => row.shop_id))];
  const refundContributorShopIds = [...new Set(refundRows.map((row) => row.shop_id))];

  return {
    totalShops: count ?? 0,
    grossSalesToday,
    refundsToday,
    netSalesToday: netSalesPaisa(grossSalesToday, refundsToday),
    saleContributorShopIds,
    refundContributorShopIds,
    day,
  };
}
