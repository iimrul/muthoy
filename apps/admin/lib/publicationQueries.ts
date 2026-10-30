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
  type PublicationRecord,
  type PublicationSet,
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
): Promise<PublicationSet> {
  const client = deps.client ?? getSupabaseAdmin();
  const { data, error } = await client
    .from('financial_publications')
    .select(COLUMNS)
    .eq('metric_family', PUBLICATION_METRIC)
    .eq('cohort_key', PUBLICATION_COHORT)
    .eq('period_grain', PUBLICATION_GRAIN)
    .order('period_start', { ascending: false });

  if (error) {
    // LOUD, then `'unavailable'`. A swallowed error here would read to an
    // operator as "nothing has been published", which is a different fact.
    console.error('[admin] reading financial_publications failed:', error.message);
    return 'unavailable';
  }

  const records: PublicationRecord[] = [];
  for (const row of (data ?? []) as unknown as PublicationRow[]) {
    try {
      records.push(toRecord(row));
    } catch (conversionError: unknown) {
      // ONE BAD ROW DOES NOT ABORT THE READ — but it does make the whole set
      // unavailable rather than silently short.
      //
      // ROUND 20 FINDING 4: the conversion used to throw out of this function,
      // so a single publication carrying a value above 2^53-1 broke every
      // read, permanently, on a table where nothing can be edited or deleted.
      // Migration 36 now caps the columns at the reader's range so this is
      // unreachable through the RPC. It is handled anyway, because "unreachable"
      // is a claim about a constraint, and returning a set that is quietly
      // missing a published month would be the worst of the three outcomes.
      console.error(
        '[admin] a financial_publications row could not be converted:',
        conversionError instanceof Error ? conversionError.message : 'unknown error',
      );
      return 'unavailable';
    }
  }

  // THE AUDIT CROSS-CHECK. ROUND 20 FINDING 1.
  //
  // The RPC refuses to republish a period it finds in `admin_audit_log`, so the
  // WRITER treats the audit log as authoritative. The reader did not: it read
  // an absent serving row as "never published". After the documented class-B
  // rollback — drop the table and the function, re-apply — the audit history
  // survives and the serving rows do not, so the reader reported "nothing is
  // published" for a period that certainly was, and a caller releasing
  // recomputed money then released it against a figure already disclosed.
  //
  // Both sides read the same evidence now. A period the audit log says was
  // published, with no serving row to serve, makes the set UNAVAILABLE: the
  // store is in a state this reader cannot answer from, and the honest answer
  // is to say so rather than to answer wrongly in either direction.
  const audited = await readAuditedMonths(client);
  if (audited === 'unavailable') return 'unavailable';
  const served = new Set(records.map((record) => record.periodStart.slice(0, 7)));
  const missing = [...audited].filter((month) => !served.has(month));
  if (missing.length > 0) {
    console.error(
      '[admin] financial_publications is missing periods the audit log records as published:',
      missing.join(', '),
    );
    return 'unavailable';
  }

  return records;
}

/**
 * The `YYYY-MM` periods `admin_audit_log` records as having been published.
 *
 * Read through the same client, as a separate query rather than a join: the
 * audit table is append-only with its own index on `(at desc, id)`, and a join
 * would make the money read depend on that table's size.
 */
async function readAuditedMonths(
  client: Pick<ReturnType<typeof getSupabaseAdmin>, 'from'>,
): Promise<Set<string> | 'unavailable'> {
  const { data, error } = await client
    .from('admin_audit_log')
    .select('target')
    .eq('action', 'publication.published')
    .eq('outcome', 'success');
  if (error) {
    console.error('[admin] reading publication audit history failed:', error.message);
    return 'unavailable';
  }
  const months = new Set<string>();
  for (const row of (data ?? []) as unknown as { target: string | null }[]) {
    // `<metric>:<cohort>:<YYYY-MM>`, written by the RPC. A target that does not
    // parse is ignored rather than guessed at: the prefix is what identifies it
    // as one of ours, and anything else in this column is another action's.
    const prefix = PUBLICATION_METRIC + ':' + PUBLICATION_COHORT + ':';
    const target = row.target ?? '';
    if (!target.startsWith(prefix)) continue;
    const month = target.slice(prefix.length);
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) months.add(month);
  }
  return months;
}
