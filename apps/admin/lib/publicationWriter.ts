import 'server-only';

// Batch 3 E4-B — the publication writer. The ONE path that discloses a
// pharmacy money figure.
//
// WHY IT IS ITS OWN MODULE rather than a fourth entry in lib/adminActions.ts.
// That file's header states, correctly, that it holds "the admin panel's ONLY
// write actions. Three, deliberately" — and every one of the three either
// re-derives a snapshot from its source rows or performs a guarded status
// transition that matches nothing the second time. This is a different kind of
// act: it DISCLOSES, permanently and irreversibly, and it is the only action in
// the panel the database will not let anyone undo. Filing it under "three
// deliberately" would have made that header false and buried the distinction.
//
// WHAT IT DOES NOT DO. It does not write a table. The only call is the
// SECURITY DEFINER RPC, which inserts the publication row and its
// admin_audit_log row in ONE transaction. service_role holds no INSERT on
// financial_publications, so there is no second way in even for this module.
//
// THE REFUSAL IS THE COMMON CASE. At ten pharmacies almost no month clears the
// k=5 refund-side floor on every trading day, so the expected outcome of
// calling this is `ok: false` with a reason an operator can read. That is the
// mechanism working.

// `hash` rather than `createHash`, for a reason worth stating so nobody
// "tidies" it back. lib/adminGrants.test.ts scans every admin source for
// `.(insert|update|upsert|delete)\(` and treats a match with no preceding
// `.from('table')` as an unattributable table write. `createHash(…).update(…)`
// matches that pattern, so using it here would have made this module look like
// a direct write to the one gate that bounds admin write power — and the fix
// would have been to loosen that gate for every file at once. The one-shot
// `hash()` has no `.update(` call, so the gate keeps its exact strictness.
import { hash } from 'node:crypto';
import { asPaisa, type Paisa } from '@muthoy/types';
import { netSalesAmount, netSalesPaisa } from '@muthoy/utils';
import { type AdminAuditSink } from './adminAudit';
import { recordAdminActionDurably } from './adminAuditStore';
import { type AdminWriteResult } from './adminAssignments';
import {
  requireAdminPermission,
  type AdminAuthzDeps,
  type AdminEnvironment,
} from './adminAuthz';
import { SUPPRESSION_K, type DaySides } from './adminSuppression';
import { AdminDataError } from './errors';
import {
  PUBLICATION_COHORT,
  PUBLICATION_METRIC,
  periodEligibility,
  periodEndOf,
  periodStartOf,
} from './publication';
import { getSupabaseAdmin } from './supabaseAdmin';

/** The SECURITY DEFINER function migration 36 ships. */
export const PUBLISH_RPC = 'publish_financial_snapshot';

/** `YYYY-MM`, and nothing else. A malformed month must not reach SQL. */
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One contributing source row, from either side. */
export interface PublicationSourceRow {
  readonly shopId: string;
  /** The row's own BUSINESS date, which is what it buckets by. */
  readonly businessDate: string;
  readonly amountPaisa: Paisa;
}

export interface PublicationSource {
  readonly sales: readonly PublicationSourceRow[];
  readonly refunds: readonly PublicationSourceRow[];
}

export interface PublicationWriterDeps extends AdminAuthzDeps {
  env?: AdminEnvironment;
  /** Injected in tests; production always uses the real service-role client. */
  client?: Pick<ReturnType<typeof getSupabaseAdmin>, 'rpc'>;
  /**
   * Reads the month's contributing rows. Injected for the same reason
   * `ReportSource` is: the policy stays testable against real inputs.
   */
  readSource?: (month: string) => Promise<PublicationSource>;
  sinks?: readonly AdminAuditSink[];
  k?: number;
}

/**
 * A digest over the rows the figure was computed FROM.
 *
 * CANONICAL ORDER, because the point is detection: two reads that return the
 * same rows in a different order must produce the same digest, or a drift check
 * would fire on every page of every query and mean nothing. Sorted by the
 * fields that identify a contribution, with a separator that cannot occur
 * inside a uuid, an ISO date or a decimal integer.
 *
 * NOT A SECURITY BOUNDARY. It detects that the source rows changed. It does not
 * authenticate them — anything that can write `sales` can write rows with a
 * consistent digest — and nothing here claims otherwise.
 */
export function sourceDigest(source: PublicationSource): string {
  const line = (row: PublicationSourceRow, side: string): string =>
    [side, row.shopId, row.businessDate, String(row.amountPaisa)].join('\u0000');
  const lines = [
    ...source.sales.map((row) => line(row, 'S')),
    ...source.refunds.map((row) => line(row, 'R')),
  ].sort();
  return hash('sha256', lines.join('\n'), 'hex');
}

function sumPaisa(rows: readonly PublicationSourceRow[]): Paisa {
  return asPaisa(rows.reduce((total, row) => total + (row.amountPaisa as number), 0));
}

/**
 * The days inside the month, split by the side that produced them.
 *
 * The same shape `buildPharmacySalesByMonth` produces, so `periodEligibility`
 * is answering the same question about the same input the report asks about.
 */
export function daysOf(source: PublicationSource): DaySides[] {
  const days = [
    ...new Set([...source.sales, ...source.refunds].map((row) => row.businessDate)),
  ].sort();
  return days.map((day) => ({
    day,
    saleShopIds: [
      ...new Set(source.sales.filter((row) => row.businessDate === day).map((row) => row.shopId)),
    ],
    refundShopIds: [
      ...new Set(source.refunds.filter((row) => row.businessDate === day).map((row) => row.shopId)),
    ],
  }));
}

/**
 * Publishes one month, or refuses with a reason.
 *
 * ORDER, and every step of it is load-bearing:
 *
 *   1. PERMISSION first, before a single row is read. An unauthorized caller
 *      must not learn whether a month would have been publishable.
 *   2. The month shape, before it reaches SQL.
 *   3. The source rows, and the figure, through W4-04's shared subtraction.
 *   4. ELIGIBILITY, in the application, using the SAME predicate the report
 *      uses. An ineligible month never reaches the RPC.
 *   5. The RPC, which re-checks eligibility in SQL anyway. Two checks of one
 *      rule is not redundancy here: step 4 produces a readable refusal, and
 *      the SQL one holds even if this module is bypassed or wrong.
 *
 * IDEMPOTENT. A second call for a published month writes no second row — the
 * unique constraint and `on conflict do nothing` make the first publication the
 * answer forever — and reports that it was already published rather than
 * failing. A caller cannot create two values for one period to difference.
 */
export async function publishMonthlySnapshot(
  month: string,
  deps: PublicationWriterDeps = {},
): Promise<AdminWriteResult> {
  const session = await requireAdminPermission('publications.write', deps.env, {
    readAssignment: deps.readAssignment,
  });

  const audit = async (
    action: string,
    outcome: 'success' | 'failure' | 'denied',
    target: string,
    reason?: string,
  ): Promise<void> => {
    await recordAdminActionDurably(
      {
        actor: session.username,
        role: session.role,
        action,
        target,
        outcome,
        ...(reason === undefined ? {} : { reason }),
      },
      deps.sinks,
    );
  };

  if (!MONTH.test(month)) {
    await audit('publication.publish', 'failure', 'invalid', 'invalid_month');
    throw new AdminDataError('month must be YYYY-MM');
  }

  const read = deps.readSource;
  if (read === undefined) throw new AdminDataError('no publication source is configured');
  const source = await read(month);

  const gross = sumPaisa(source.sales);
  const refunds = sumPaisa(source.refunds);
  // W4-04's shared subtraction. The device and the panel must produce the same
  // figure from the same two sums (CLAUDE.md rule 4).
  // NAMED `pharmacyNetSales`, which is not cosmetic. adminLabels.test.ts
  // ("the GROSS boundary", link 1) requires every binding of a refund-net money
  // figure to use one of two anchor names AND to carry its derivation in the
  // same statement, against an exact-text whitelist. That guard has been broken
  // five times by fabrication forms it did not model, so a third derivation
  // site declares itself to the guard rather than being exempted from it.
  const pharmacyNetSales = netSalesPaisa(gross, refunds);
  const k = deps.k ?? SUPPRESSION_K;
  const eligibility = periodEligibility(
    daysOf(source),
    [...source.sales.map((row) => row.shopId), ...source.refunds.map((row) => row.shopId)],
    k,
  );

  if (!eligibility.eligible) {
    // REFUSED IN THE APPLICATION, and recorded as a refusal rather than an
    // error. This is the expected outcome at beta scale, so it must read as a
    // policy decision an operator can understand, not as a fault.
    await audit('publication.refused', 'denied', month, 'ineligible');
    return {
      ok: false,
      message: eligibility.reason ?? 'This period is not publishable.',
    };
  }

  const client = deps.client ?? getSupabaseAdmin();
  const { data, error } = await client.rpc(PUBLISH_RPC, {
    p_metric_family: PUBLICATION_METRIC,
    p_cohort_key: PUBLICATION_COHORT,
    p_period_start: periodStartOf(month),
    p_period_end: periodEndOf(month),
    p_gross_paisa: gross as number,
    p_refunds_paisa: refunds as number,
    // `netSalesAmount`, NOT a cast.
    //
    // This line was a cast to number, and that cast was a real
    // defect my own test caught: `netSalesPaisa` returns an OPAQUE box, so the
    // RPC was being handed `{ paisa: 1080000 }` for a `bigint` parameter. The
    // cast compiled precisely because it told the compiler to stop checking.
    // `netSalesAmount` verifies the value's provenance before unwrapping it,
    // which is the whole reason the brand exists.
    p_value_paisa: netSalesAmount(pharmacyNetSales) as number,
    p_source_sale_rows: source.sales.length,
    p_source_refund_rows: source.refunds.length,
    p_source_digest: sourceDigest(source),
    p_k_floor: k,
    p_contributor_count: eligibility.contributorCount,
    p_days_requiring_floor: eligibility.daysRequiringFloor,
    p_days_clearing_floor: eligibility.daysClearingFloor,
    p_published_by: session.username,
  });

  if (error) {
    // The message is NOT returned to the caller. A SQL error can carry column
    // names, constraint names and parameter values, and this parameter list is
    // money. The server log gets it; the operator gets a sentence.
    console.error('[admin] publish_financial_snapshot failed:', error.message);
    await audit('publication.publish', 'failure', month, 'rpc_failed');
    return { ok: false, message: 'Could not publish this period. The server log has the details.' };
  }

  // NO SECOND AUDIT ROW ON SUCCESS, deliberately. The RPC already wrote one
  // inside the publishing transaction, which is strictly better evidence than
  // anything this module could add afterwards: it cannot exist without the
  // publication, and the publication cannot exist without it. Writing another
  // here would put two rows in admin_audit_log for one act and invite a reader
  // to count them as two publications.
  const first = Array.isArray(data) ? data[0] : data;
  const publishedNow = (first as { published_now?: boolean } | null)?.published_now === true;
  return {
    ok: true,
    message: publishedNow
      ? 'Published ' + month + ' as an immutable snapshot.'
      : month + ' was already published; its first published value stands.',
  };
}
