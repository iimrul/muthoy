import 'server-only';

import { AdminDataError } from './errors';
import {
  dhakaDayRange,
  sumSaleTotals,
  type PharmacyRow,
  type PlatformStats,
  type SaleTotalRow,
} from './platformStats';
import { getSupabaseAdmin } from './supabaseAdmin';

// Read-only access to the live cloud mirror. Reads only; the admin panel never
// writes, and nothing here touches RLS policies or the schema.
//
// PostgREST caps a single response, so every list is read in pages — otherwise
// a busy day would silently report only the first page of sales as the total.
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

type PageReader<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

async function readAllPages<T>(label: string, readPage: PageReader<T>): Promise<T[]> {
  const rows: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error(`[admin] ${label} query failed:`, error.message);
      throw new AdminDataError(`${label} query failed`);
    }

    const batch = data ?? [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) {
      return rows;
    }
  }

  console.error(`[admin] ${label} exceeded ${MAX_PAGES} pages of ${PAGE_SIZE} rows`);
  throw new AdminDataError(`${label} result set is larger than this page can read`);
}

interface ShopSelectRow {
  id: string;
  name: string;
  phone: string;
  created_at: string;
  plan: string;
}

/** Volume 5 P0: read-only shop name / phone / registration date / plan. */
export async function listPharmacies(): Promise<PharmacyRow[]> {
  const supabase = getSupabaseAdmin();

  const rows = await readAllPages<ShopSelectRow>('shops', (from, to) =>
    supabase
      .from('shops')
      .select('id,name,phone,created_at,plan')
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
  }));
}

/** Volume 5 P0: two numbers — total shops, and today's sales across all shops. */
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

  const saleRows = await readAllPages<SaleTotalRow>('sales', (from, to) =>
    supabase
      .from('sales')
      .select('total')
      .eq('is_deleted', false)
      .gte('created_at', day.startInclusive)
      .lt('created_at', day.endExclusive)
      .order('id', { ascending: true })
      .range(from, to),
  );

  return {
    totalShops: count ?? 0,
    totalSalesToday: sumSaleTotals(saleRows),
    day,
  };
}
