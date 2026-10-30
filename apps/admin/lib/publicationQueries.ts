import 'server-only';

// Batch 3 E4-B — reading published snapshots.
//
// SEPARATE FROM publication.ts because that module is pure and must stay
// importable from anywhere in the server component graph. This one holds the
// database round trip.
//
// ─────────────────────────────────── WHY NOTHING CALLS THIS IN PRODUCTION YET
//
// Stated here rather than left for a reader to discover: no page or route
// passes this lookup to `buildReportTable` today, and that is deliberate, not
// an oversight.
//
// `financial_publications` exists in migration 36, which is applied to NO
// hosted project — the founder reserved hosted application to a separate
// authorization, and this batch did not request it. A page wired to read a
// table that does not exist would surface `failed` on every Admin money figure
// where it currently shows a correct `withheld`. That is strictly worse for an
// operator and it would be a regression delivered in the name of integration.
//
// So the wiring is ONE argument at each call site, named in Report B, and it
// becomes correct the moment the migration is applied. Until then every money
// figure resolves to `withheld`, which is what it already was.
//
// WHAT THIS MUST NOT DO is fail quietly. A read that cannot reach the table
// returns a lookup that THROWS, which `resolveMonthlyMoney` converts into the
// `failed` state — visible, carrying its reason, and never a figure and never a
// zero. Returning "no publications" on an error would be indistinguishable
// from "nothing is published", and the operator would read a withheld figure
// as policy when it was an outage.

import { asPaisa, type Paisa } from '@muthoy/types';
import {
  PUBLICATION_COHORT,
  PUBLICATION_GRAIN,
  PUBLICATION_METRIC,
  type PublicationLookup,
  type PublicationRecord,
} from './publication';
import { getSupabaseAdmin } from './supabaseAdmin';

/** The columns the reader needs, named rather than `select('*')`. */
const COLUMNS = [
  'metric_family',
  'cohort_key',
  'period_start',
  'period_end',
  'value_paisa',
  'gross_paisa',
  'refunds_paisa',
  'source_sale_rows',
  'source_refund_rows',
  'source_digest',
  'k_floor',
  'contributor_count',
  'published_at',
].join(', ');

interface PublicationRow {
  metric_family: string;
  cohort_key: string;
  period_start: string;
  period_end: string;
  value_paisa: number | string;
  gross_paisa: number | string;
  refunds_paisa: number | string;
  source_sale_rows: number;
  source_refund_rows: number;
  source_digest: string;
  k_floor: number;
  contributor_count: number;
  published_at: string;
}

/**
 * `bigint` arrives as a STRING from PostgREST, not a number.
 *
 * Worth its own function: `Number(row.value_paisa)` scattered at three call
 * sites is three places to forget, and a money column silently becoming NaN is
 * the kind of thing that renders as "NaN" in a report nobody tests.
 */
function paisaFrom(value: number | string, column: string): Paisa {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isSafeInteger(amount)) {
    throw new Error('publication column ' + column + ' is not a safe integer: ' + String(value));
  }
  return asPaisa(amount);
}

function toRecord(row: PublicationRow): PublicationRecord {
  return {
    metricFamily: row.metric_family,
    cohortKey: row.cohort_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    valuePaisa: paisaFrom(row.value_paisa, 'value_paisa'),
    grossPaisa: paisaFrom(row.gross_paisa, 'gross_paisa'),
    refundsPaisa: paisaFrom(row.refunds_paisa, 'refunds_paisa'),
    sourceSaleRows: row.source_sale_rows,
    sourceRefundRows: row.source_refund_rows,
    sourceDigest: row.source_digest,
    kFloor: row.k_floor,
    contributorCount: row.contributor_count,
    publishedAt: row.published_at,
  };
}

export interface PublicationReadDeps {
  client?: Pick<ReturnType<typeof getSupabaseAdmin>, 'from'>;
}

/**
 * Every published month for the declared metric and cohort, as a lookup.
 *
 * READ ONCE PER REQUEST, not once per bucket. A report covering a year would
 * otherwise issue twelve round trips, and the N+1 would be inside the money
 * path where it is least welcome.
 *
 * The filters are on the DECLARED metric, cohort and grain rather than open:
 * `recordIsServable` refuses anything else at the boundary anyway, and a reader
 * that fetched every row and relied on a later check would be one refactor away
 * from serving a row it should not.
 */
export async function readPublishedMonths(
  deps: PublicationReadDeps = {},
): Promise<PublicationLookup> {
  const client = deps.client ?? getSupabaseAdmin();
  const { data, error } = await client
    .from('financial_publications')
    .select(COLUMNS)
    .eq('metric_family', PUBLICATION_METRIC)
    .eq('cohort_key', PUBLICATION_COHORT)
    .eq('period_grain', PUBLICATION_GRAIN)
    .order('period_start', { ascending: false });

  if (error) {
    // LOUD, then a throwing lookup. See the header: a swallowed error here
    // reads to an operator as "nothing has been published".
    console.error('[admin] reading financial_publications failed:', error.message);
    return () => {
      throw new Error('published figures are currently unavailable');
    };
  }

  const byMonth = new Map<string, PublicationRecord>();
  for (const row of (data ?? []) as unknown as PublicationRow[]) {
    const record = toRecord(row);
    const month = record.periodStart.slice(0, 7);
    // FIRST WINS, and the order is period_start descending, so a duplicate
    // month cannot be resolved by whichever row the driver happened to return
    // last. The unique constraint makes this unreachable through the RPC; it is
    // here because "unreachable" is a claim about the schema, and this function
    // should not depend on that claim in order to be deterministic.
    if (!byMonth.has(month)) byMonth.set(month, record);
  }
  return (month) => byMonth.get(month);
}
