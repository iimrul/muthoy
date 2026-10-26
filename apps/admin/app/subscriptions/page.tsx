import Link from 'next/link';
import DataTable, { type DataColumn } from '../../components/DataTable';
import ErrorNotice from '../../components/ErrorNotice';
import { EmptyState, FilterForm, Pager } from '../../components/PageParts';
import { formatMoney } from '@muthoy/utils';
import { recentAdminAudit, type AdminAuditEntry } from '../../lib/adminAudit';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { parseListQuery } from '../../lib/adminFilters';
import { subscriptionsOverview, type SubscriptionsOverview } from '../../lib/adminPlatformQueries';
import {
  LIFECYCLE_OVERRIDE_UNAVAILABLE,
  nextBillingBasisLabel,
  SUBSCRIPTION_STATUS_FILTERS,
  upcomingExpirations,
  type SubscriptionDetailRow,
} from '../../lib/adminSubscriptionViews';
import {
  billingCycleLabel,
  formatCount,
  formatDhakaDate,
  formatDhakaDateTime,
  statusLabel,
  tierLabel,
} from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

// Batch 3 §8.3 — Subscriptions.
//
// "Billed amount" is the plan_offerings price for the tier and cycle. It is NOT
// income, a run rate or a charged total, and must not be described as any of
// those (the ledger's interim safety boundary 1). lib/adminLabels.test.ts
// enforces it.
//
// THE NEXT BILLING DATE CARRIES ITS BASIS. A bare date invites the reader to
// assume a charge; for a trial it is the day access stops unless something is
// paid, and for a grace period it is the day access stops outright. So the
// column prints the date AND which field it came from, and a canceled or
// expired row prints an em dash rather than a past `paid_through` that would
// read as an upcoming charge.
//
// RENEWAL HISTORY IS VERIFIED ORDERS ONLY. A created or pending order is a
// renewal somebody started. Counting one would show a pharmacy renewing on a
// day it did not pay.
//
// §8.3(i) — NO LIFECYCLE OVERRIDE EXISTS, AND NONE IS MOCKED UP. Trial
// extension and status override are rendered as a notice with gate E10, not as
// a disabled button: a greyed-out control says "this exists and you may not use
// it", and the truth is that the design was withdrawn. §8.3(ii)'s entitlement
// refresh was removed from the panel entirely in this same batch (E11).

export const dynamic = 'force-dynamic';

/** §8.3's "upcoming expirations" horizon, the same seven days §8.1 alerts on. */
const UPCOMING_DAYS = 7;

/** The audit actions that are a change to a subscription or its payments. */
const SUBSCRIPTION_AUDIT_PREFIXES = ['subscriptions.', 'payments.', 'accounts.'] as const;

const COLUMNS: readonly DataColumn<SubscriptionDetailRow>[] = [
  { heading: 'Account', cell: (row) => row.accountLabel },
  { heading: 'Plan', cell: (row) => tierLabel(row.tier) },
  { heading: 'Cycle', cell: (row) => billingCycleLabel(row.billingCycle) },
  { heading: 'Subscription status', cell: (row) => statusLabel(row.status) },
  { heading: 'Entitlement status', cell: (row) => statusLabel(row.entitlementStatus) },
  {
    heading: 'Billed amount',
    cell: (row) => formatMoney(row.billedAmountPaisa),
    isMoney: true,
    align: 'right',
  },
  { heading: 'Started', cell: (row) => formatDhakaDate(row.startsAt) },
  { heading: 'Paid through', cell: (row) => formatDhakaDate(row.paidThrough) },
  {
    heading: 'Next billing',
    cell: (row) =>
      row.nextBilling.on === null ? (
        '—'
      ) : (
        <>
          {formatDhakaDate(row.nextBilling.on)}
          <span className="ml-1 text-xs text-midGray">
            ({nextBillingBasisLabel(row.nextBilling.basis)})
          </span>
        </>
      ),
  },
  {
    heading: 'Renewals',
    cell: (row) =>
      row.latestRenewal === null ? (
        '—'
      ) : (
        <>
          {formatCount(row.renewalCount)}
          <span className="ml-1 text-xs text-midGray">
            (latest {formatDhakaDate(row.latestRenewal.verifiedAt)})
          </span>
        </>
      ),
  },
  { heading: 'Grace ends', cell: (row) => formatDhakaDate(row.graceEndsAt) },
];

const AUDIT_COLUMNS: readonly DataColumn<AdminAuditEntry>[] = [
  { heading: 'When', cell: (entry) => formatDhakaDateTime(entry.at) },
  { heading: 'Actor', cell: (entry) => entry.actor },
  { heading: 'Action', cell: (entry) => entry.action },
  { heading: 'Target', cell: (entry) => entry.target ?? '—' },
  { heading: 'Outcome', cell: (entry) => entry.outcome },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  ...SUBSCRIPTION_STATUS_FILTERS.map((status) => ({ value: status, label: statusLabel(status) })),
];

type Result =
  | { ok: true; data: SubscriptionsOverview; nowMs: number }
  | { ok: false; message: string };

async function loadSubscriptions(
  query: Parameters<typeof subscriptionsOverview>[0],
): Promise<Result> {
  try {
    // ONE clock reading, used for the "bills within seven days" summary. The
    // read itself takes no instant: every figure it returns is a stored value
    // or a count, so there is nothing in it for a clock to change.
    const now = new Date();
    return { ok: true, data: await subscriptionsOverview(query), nowMs: now.getTime() };
  } catch (error: unknown) {
    console.error('[admin] subscriptions failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

/** The params to carry forward in pager links, as plain strings. */
function carriedParams(raw: Record<string, string | string[] | undefined>): Record<string, string> {
  const carried: Record<string, string> = {};
  for (const key of ['status', 'plan', 'cycle', 'pageSize']) {
    const value = raw[key];
    const first = typeof value === 'string' ? value : Array.isArray(value) ? value[0] : undefined;
    if (first !== undefined && first.length > 0) carried[key] = first;
  }
  return carried;
}

function LifecycleNotice() {
  return (
    <section
      aria-labelledby="lifecycle-overrides"
      className="mt-6 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-4"
    >
      <h2 id="lifecycle-overrides" className="text-base font-semibold text-[#92400E]">
        Lifecycle overrides are unavailable
      </h2>
      <p className="mt-1 text-sm text-[#92400E]">{LIFECYCLE_OVERRIDE_UNAVAILABLE}</p>
    </section>
  );
}

interface SubscriptionsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SubscriptionsPage({ searchParams }: SubscriptionsPageProps) {
  try {
    await requireAdminPermission('subscriptions.read');
  } catch (error: unknown) {
    console.error('[admin] subscriptions denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const raw = await searchParams;
  const parsed = parseListQuery(raw);
  if (!parsed.ok) {
    // A filter that does not parse is reported WITH the reason, and the page
    // still renders its form so the operator can correct it. Nothing is read.
    return (
      <>
        <h1 className="text-xl font-semibold">Subscriptions</h1>
        <p role="alert" className="mt-4 text-sm text-richBlack">
          {parsed.message}
        </p>
        <FilterForm
          selects={[{ name: 'status', label: 'Status', value: '', options: STATUS_OPTIONS }]}
        />
        <LifecycleNotice />
      </>
    );
  }

  const query = parsed.query;
  const result = await loadSubscriptions(query);
  if (!result.ok) return <ErrorNotice message={result.message} />;

  const { rows, meta, undatedVerifiedOrders, cycles, tiers } = result.data;
  const upcoming = upcomingExpirations(rows, result.nowMs, UPCOMING_DAYS);
  const hasFilter =
    (query.status ?? '').length > 0
    || (query.plan ?? '').length > 0
    || (query.cycle ?? '').length > 0;

  // §8.3's change history. The actions are matched by PREFIX against the
  // recorded action name, so a new subscription action is included the day it
  // is added rather than the day somebody remembers to list it here.
  const changes = recentAdminAudit
    .entries()
    .filter((entry) =>
      SUBSCRIPTION_AUDIT_PREFIXES.some((prefix) => entry.action.startsWith(prefix)),
    );

  return (
    <>
      <h1 className="text-xl font-semibold">Subscriptions</h1>
      <p className="mt-1 text-sm text-midGray">
        Read-only. The billed amount is the plan price for that tier and cycle. It is not a charged
        total, not a collected sum, and not a figure to read as income.
      </p>

      <FilterForm
        selects={[
          { name: 'status', label: 'Status', value: query.status ?? '', options: STATUS_OPTIONS },
          {
            name: 'plan',
            label: 'Tier',
            value: query.plan ?? '',
            options: [
              { value: '', label: 'Any tier' },
              ...tiers.map((tier) => ({ value: tier, label: tierLabel(tier) })),
            ],
          },
          {
            name: 'cycle',
            label: 'Cycle',
            value: query.cycle ?? '',
            options: [
              { value: '', label: 'Any cycle' },
              ...cycles.map((cycle) => ({ value: cycle, label: billingCycleLabel(cycle) })),
            ],
          },
        ]}
      />

      <p className="mt-4 text-sm text-midGray">
        {formatCount(upcoming.length)} of the {formatCount(rows.length)} on this page{' '}
        {upcoming.length === 1 ? 'bills' : 'bill'} within {UPCOMING_DAYS} days.
        {undatedVerifiedOrders > 0 ? (
          <>
            {' '}
            {formatCount(undatedVerifiedOrders)} verified payment order
            {undatedVerifiedOrders === 1 ? '' : 's'} carry no verification timestamp and are
            therefore absent from the renewal counts — counted instead among the{' '}
            <Link href="/revenue" className="underline">
              billing exceptions
            </Link>
            .
          </>
        ) : null}
      </p>

      {rows.length === 0 ? (
        <EmptyState
          message={
            meta.isPastEnd
              ? 'That page is past the end of the list. There are '
                + meta.total
                + ' subscriptions in total.'
              : hasFilter
                ? 'No subscription matches these filters. The filters are applied in the query, so this is the real count.'
                : 'No subscription has been created yet. No demo data ships, so a fresh platform is empty.'
          }
        />
      ) : (
        <>
          <div className="mt-4">
            <DataTable
              columns={COLUMNS}
              rows={rows}
              rowKey={(row) => row.id}
              emptyMessage="No subscription has been created yet."
            />
          </div>
          {/* The pager's total is EXACT and carries the same filters as the
              rows. The ordering by next billing date is applied within the
              page, because that date is a different column per status and no
              single SQL order expresses it — stated, not hidden. */}
          <Pager meta={meta} params={carriedParams(raw)} noun="subscriptions" />
        </>
      )}

      <LifecycleNotice />

      <section aria-labelledby="change-history" className="mt-8">
        <h2 id="change-history" className="text-base font-semibold">
          Change history
        </h2>
        <p className="mt-1 text-sm text-midGray">
          Subscription, payment and account actions recorded by THIS server instance, newest first.
          It is not the durable record — the structured line written to stderr is, kept by the host
          platform&apos;s log retention. The Postgres audit table ships in migration 35 and is not
          yet applied to any hosted project.
        </p>
        <div className="mt-3">
          <DataTable
            columns={AUDIT_COLUMNS}
            rows={changes}
            rowKey={(entry) => entry.at + entry.actor + entry.action}
            emptyMessage="This instance has recorded no subscription, payment or account action yet."
          />
        </div>
      </section>
    </>
  );
}
