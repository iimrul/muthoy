import Link from 'next/link';
import { formatMoney } from '@muthoy/utils';
import ChartPanel from '../../components/charts/ChartPanel';
import ErrorNotice from '../../components/ErrorNotice';
import { EmptyState, MetricTile } from '../../components/PageParts';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { requireMetric } from '../../lib/adminMetrics';
import { revenueOverview, type RevenueOverview } from '../../lib/adminPlatformQueries';
import { exportTaka } from '../../lib/adminReports';
import { formatCount } from '../../lib/adminViews';
import { toDisplayMessage } from '../../lib/errors';

// Batch 3 §8.4 — Revenue & Billing.
//
// THE MRR TREND IS REPORTED BLOCKED, NOT CLAIMED. Volume 5 asks for a trend
// "computed from subscriptions history", and that history does not exist: a
// renewal updates the same `billing_subscriptions` row, so past MRR is not
// recoverable. What this page shows instead is a COLLECTED SUBSCRIPTION
// PAYMENTS series from verified payment orders — real evidence, and cash
// received rather than run rate. Labelling that chart "MRR" would be exactly
// the mislabelling §5.2 exists to stop, so it carries its own metric's label
// and the blocked trend is stated beside it with its gate (E12).
//
// THE THREE MONEY FAMILIES STAY APART. Every figure here reaches the page
// through a §5.2 `Metric`, and MetricTile takes its caption from the manifest
// rather than from this file — so a subscription figure cannot be captioned as
// pharmacy sales, or the reverse.
//
// `/payments` IS STILL THE ORDER-LEVEL VIEW, linked from here. It left the top
// nav and lost no functionality.

export const dynamic = 'force-dynamic';

const RUN_RATE_TREND_BLOCKED =
  'A historical run-rate series is not shown, and is not computed. A renewal updates '
  + 'the same subscription row, so past run rate is not recoverable from current '
  + 'state — it needs an immutable subscription-lifecycle table (gate E12). The '
  + 'chart below is collected cash, which is a different figure.';

/** The order statuses §8.4 names, so a zero is stated rather than absent. */
const ORDER_STATUSES = ['created', 'pending', 'verified', 'failed', 'expired'] as const;

type RevenueResult = { ok: true; data: RevenueOverview } | { ok: false; message: string };

async function loadRevenue(): Promise<RevenueResult> {
  try {
    return { ok: true, data: await revenueOverview() };
  } catch (error: unknown) {
    console.error('[admin] revenue failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

export default async function RevenuePage() {
  try {
    await requireAdminPermission('revenue.read');
  } catch (error: unknown) {
    console.error('[admin] revenue denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const result = await loadRevenue();
  if (!result.ok) return <ErrorNotice message={result.message} />;

  const {
    runRate,
    collectedByMonth,
    collectedTotalPaisa,
    orders,
    recordedCancellations,
    expiredWithoutCancellation,
  } = result.data;

  const byStatus = new Map<string, number>();
  for (const status of ORDER_STATUSES) byStatus.set(status, 0);
  for (const order of orders) {
    byStatus.set(order.status, (byStatus.get(order.status) ?? 0) + 1);
  }

  // §8.4's billing exceptions, all computed — never a hardcoded figure.
  const verifiedWithNoTimestamp = orders.filter(
    (order) => order.status === 'verified' && order.verifiedAt === null,
  ).length;
  const failedOrders = orders.filter((order) => order.status === 'failed').length;

  // The last twelve months of the collected series, newest last.
  const trend = collectedByMonth.slice(-12).map((month) => ({
    label: month.month,
    value: Number(month.totalPaisa) / 100,
  }));

  return (
    <>
      <h1 className="text-xl font-semibold">Revenue &amp; billing</h1>
      <p className="mt-1 text-sm text-midGray">
        Muthoy&rsquo;s own money. Pharmacy takings are a different family, reported on Analytics and
        never added to these figures.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          metric={requireMetric('mrr')}
          value={formatMoney(runRate.totalPaisa)}
          note={
            formatCount(runRate.countedSubscriptions) +
            ' priced subscriptions' +
            (runRate.unpricedSubscriptions > 0
              ? ' · ' +
                formatCount(runRate.unpricedSubscriptions) +
                ' matched no offering and contributed nothing'
              : '')
          }
        />
        <MetricTile
          metric={requireMetric('collected_subscription_payments')}
          value={formatMoney(collectedTotalPaisa)}
          note="Verified payment orders, all time. Cash received, not run rate."
        />
        <MetricTile
          metric={requireMetric('recorded_cancellations')}
          value={formatCount(recordedCancellations)}
          note="Still visible in current state, last 90 days. A renewal clears the flag."
        />
        <MetricTile
          metric={requireMetric('expired_without_cancellation')}
          value={formatCount(expiredWithoutCancellation)}
          note="A different event from a cancellation, so it is counted apart."
        />
      </div>

      <section
        aria-labelledby="run-rate-trend"
        className="mt-6 rounded border border-black/10 bg-offWhite p-4"
      >
        <h2 id="run-rate-trend" className="text-base font-semibold">
          The historical run-rate trend is blocked
        </h2>
        <p className="mt-1 text-sm text-richBlack">{RUN_RATE_TREND_BLOCKED}</p>
      </section>

      <div className="mt-6">
        <ChartPanel
          heading={requireMetric('collected_subscription_payments_trend').label}
          description="Verified payment orders by month, in taka. This is cash collected — it is not a run rate and it is not a run-rate trend."
          kind="trend"
          points={trend}
          valueLabel="Taka collected"
          isMoney
          emptyMessage="No payment order has been verified, so there is no collected-payments series yet."
          format={(value) => value.toFixed(2)}
        />
      </div>

      <section aria-labelledby="run-rate-tiers" className="mt-6">
        <h2 id="run-rate-tiers" className="text-base font-semibold">
          Run rate by tier
        </h2>
        {Object.keys(runRate.byTierPaisa).length === 0 ? (
          <EmptyState message="No subscription currently qualifies for the run rate, so there is no split to show." />
        ) : (
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">Monthly run rate by plan tier.</caption>
            <thead>
              <tr className="border-b border-black/10 text-left">
                <th scope="col" className="py-1 font-medium">
                  Tier
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {requireMetric('mrr').label} (BDT)
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(runRate.byTierPaisa).map(([tier, amount]) => (
                <tr key={tier} className="border-b border-black/5">
                  <th scope="row" className="py-1 text-left font-normal">
                    {tier}
                  </th>
                  {/* CLAUDE.md rule 6: money in the DM Mono variable. */}
                  <td className="py-1 text-right font-mono tabular-nums">{exportTaka(amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-labelledby="order-status" className="mt-8">
        <h2 id="order-status" className="text-base font-semibold">
          Payment orders by status
        </h2>
        <p className="mt-1 text-sm text-midGray">
          {formatCount(orders.length)} {orders.length === 1 ? 'order' : 'orders'} on record.{' '}
          <Link href="/payments" className="underline">
            Open the order-level view
          </Link>{' '}
          for the individual rows and the bounded expire action.
        </p>
        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Payment orders by status.</caption>
          <thead>
            <tr className="border-b border-black/10 text-left">
              <th scope="col" className="py-1 font-medium">
                Status
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Orders
              </th>
            </tr>
          </thead>
          <tbody>
            {ORDER_STATUSES.map((status) => (
              <tr key={status} className="border-b border-black/5">
                <th scope="row" className="py-1 text-left font-normal">
                  {status}
                </th>
                {/* Every status appears, so "0 failed" is STATED rather than
                    inferred from an absent row. */}
                <td className="py-1 text-right tabular-nums">
                  {formatCount(byStatus.get(status) ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="exceptions" className="mt-8">
        <h2 id="exceptions" className="text-base font-semibold">
          Billing exceptions
        </h2>
        {verifiedWithNoTimestamp === 0 && failedOrders === 0 ? (
          <EmptyState message="No billing exception is on record. That is the data, not an unchecked list." />
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {verifiedWithNoTimestamp > 0 ? (
              <li>
                {formatCount(verifiedWithNoTimestamp)} order
                {verifiedWithNoTimestamp === 1 ? '' : 's'} marked verified with no verification
                timestamp.
              </li>
            ) : null}
            {failedOrders > 0 ? (
              <li>
                {formatCount(failedOrders)} failed order{failedOrders === 1 ? '' : 's'}.
              </li>
            ) : null}
          </ul>
        )}
      </section>

      <p className="mt-8 text-xs text-midGray">
        No payment gateway is activated. Historical SSLCommerz orders stay readable and
        reconcilable; no new initiation exists, and no bKash figure is shown, because there is none.
      </p>
    </>
  );
}
