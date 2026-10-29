import Link from 'next/link';
import { formatMoney, sumNetSales } from '@muthoy/utils';
import ChartPanel from '../../components/charts/ChartPanel';
import ErrorNotice from '../../components/ErrorNotice';
import NetSalesCard from '../../components/NetSalesCard';
import { EmptyState, MetricTile } from '../../components/PageParts';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { requireMetric } from '../../lib/adminMetrics';
import {
  analyticsOverview,
  revenueOverview,
  type AnalyticsOverview,
  type RevenueOverview,
} from '../../lib/adminPlatformQueries';
import { suppressBelowK } from '../../lib/adminSuppression';
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

type RevenueResult =
  | { ok: true; data: RevenueOverview; pharmacy: AnalyticsOverview }
  | { ok: false; message: string };

/**
 * BOTH families, in one load.
 *
 * The pharmacy figure comes through `analyticsOverview`, which goes through the
 * same tallied reads the reports use — so this page and Analytics cannot
 * disagree about what the pharmacies sold. Fetching it here is what makes the
 * §5.2 guard meaningful on this page: a manifest that can mislabel is only
 * dangerous where two families render together, and this is that page.
 */
async function loadRevenue(): Promise<RevenueResult> {
  try {
    const [data, pharmacy] = await Promise.all([revenueOverview(), analyticsOverview()]);
    return { ok: true, data, pharmacy };
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

  // §8.4's billing exceptions, ALL FIVE, all computed — never a hardcoded
  // figure, and never a silent omission.
  //
  // GATE 5 FINDING 5: this page previously checked only failed orders and
  // missing verification timestamps, so it could announce "No billing
  // exception is on record" while every exception §8.4 actually names was
  // present. The three missing classes need the webhook's own record, which is
  // why `revenueOverview` now reads `payment_provider_events`.
  const accountsWithSubscription = new Set(
    result.data.subscriptions.map((subscription) => subscription.billingAccountId),
  );
  const orderIds = new Set(orders.map((order) => order.id));

  const exceptions = [
    {
      id: 'verified_no_timestamp',
      count: orders.filter((order) => order.status === 'verified' && order.verifiedAt === null)
        .length,
      describe: (count: number) =>
        formatCount(count)
        + ' order' + (count === 1 ? '' : 's')
        + ' marked verified with no verification timestamp. They are absent from the collected'
        + ' series, because an order with no date cannot be placed in a month.',
    },
    {
      id: 'verified_no_subscription',
      // Money arrived and nothing was granted for it. The worst of the five.
      count: orders.filter(
        (order) =>
          order.status === 'verified' && !accountsWithSubscription.has(order.billingAccountId),
      ).length,
      describe: (count: number) =>
        formatCount(count)
        + ' verified order' + (count === 1 ? '' : 's')
        + ' whose billing account holds no subscription at all — paid for, and nothing granted.',
    },
    {
      id: 'event_no_order',
      count: result.data.events.filter(
        (event) => event.paymentOrderId === null || !orderIds.has(event.paymentOrderId),
      ).length,
      describe: (count: number) =>
        formatCount(count)
        + ' provider event' + (count === 1 ? '' : 's')
        + ' referencing no order this platform holds — a payment signal with nothing to apply to.',
    },
    {
      id: 'rejected_event',
      count: result.data.events.filter((event) => event.processingStatus === 'rejected').length,
      describe: (count: number) =>
        formatCount(count)
        + ' provider event' + (count === 1 ? '' : 's')
        + ' the server REFUSED. Each one is a payment signal that was not applied.',
    },
    {
      id: 'failed_order',
      count: orders.filter((order) => order.status === 'failed').length,
      describe: (count: number) =>
        formatCount(count) + ' failed order' + (count === 1 ? '' : 's') + '.',
    },
  ];
  const raisedExceptions = exceptions.filter((entry) => entry.count > 0);

  // The last twelve months of the collected series, newest last.
  const trend = collectedByMonth.slice(-12).map((month) => ({
    label: month.month,
    value: Number(month.totalPaisa) / 100,
  }));

  // W4-04, on this page because §8.4 puts it here — and kept in its own
  // section, with its own metric, because it is a DIFFERENT FAMILY. Every
  // figure above is Muthoy's own money; this one is the pharmacies'.
  //
  // k-suppressed like every other cross-pharmacy aggregate: the total derives
  // from the shops behind it, and a total built from fewer than five shops is
  // those shops' takings wearing a platform label.
  const pharmacyShopIds = result.pharmacy.pharmacySalesByMonth.flatMap((month) => month.shopIds);
  // §6i: aggregated by `sumNetSales`, which verifies every part, rather than
  // by a `reduce` that coerced each month's total with `Number(...)`.
  //
  // That coercion was the hole Gate 5 round 9 walked through: it accepts
  // anything, so
  // `((_amount: number) => Number(collectedTotalPaisa))(pharmacyNetSalesPaisa)`
  // substituted collected payments into this tile with no compile error and no
  // source-guard finding. `sumNetSales` cannot be fed a collected total — its
  // parameter is `NetSales` and each element is checked — and the result stays
  // opaque all the way into the renderer.
  const pharmacyNetSales = sumNetSales(
    result.pharmacy.pharmacySalesByMonth.map((month) => month.totalPaisa),
  );
  const pharmacySales = suppressBelowK({
    value: pharmacyNetSales,
    contributingShopIds: pharmacyShopIds,
  });

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
        {raisedExceptions.length === 0 ? (
          <EmptyState
            message={
              'No billing exception is on record, across all '
              + exceptions.length
              + ' classes checked. That is the data, not an unchecked list.'
            }
          />
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {raisedExceptions.map((entry) => (
              <li key={entry.id}>{entry.describe(entry.count)}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-midGray">
          All {exceptions.length} classes are checked on every load: a verified order with no
          verification timestamp, a verified order whose account holds no subscription, a provider
          event referencing no order, an event the server rejected, and a failed order.
        </p>
      </section>

      <section aria-labelledby="pharmacy-sales" className="mt-10 rounded border border-black/10 bg-offWhite p-4">
        <h2 id="pharmacy-sales" className="text-base font-semibold">
          Pharmacy sales — a different family of money
        </h2>
        <p className="mt-1 text-sm text-richBlack">
          W4-04&rsquo;s refund-net pharmacy takings, shown here because the founder reads both
          figures in one place. <strong>It is not Muthoy&rsquo;s money</strong> and is never added
          to anything above: these are the pharmacies&rsquo; own sales, less their own refunds,
          both sides windowed on the same business date.
        </p>
        <div className="mt-4 max-w-sm">
          {/* §6i: NetSalesCard, not MetricTile.
              `MetricTile` takes an already-formatted string, so the caller
              owned the value under this caption — and round 9 used exactly
              that to render ৳230.00 of collected payments here. This card
              takes the opaque amount instead and formats it itself, after
              verifying provenance. The suppressed case passes `withheld`
              rather than a substitute value, so k-anonymity withholds the
              figure without anything else taking its place. */}
          <NetSalesCard
            metricId="pharmacy_sales_net"
            amount={pharmacyNetSales}
            withheld={pharmacySales.suppressed}
            composition={
              pharmacySales.suppressed
                ? 'Withheld: fewer than five pharmacies contributed, so the total would be those pharmacies’ own takings.'
                : formatCount(pharmacySales.contributorCount)
                  + ' contributing pharmacies, all time. Their money, not Muthoy’s.'
            }
          />
        </div>
      </section>

      <p className="mt-8 text-xs text-midGray">
        No payment gateway is activated. Historical SSLCommerz orders stay readable and
        reconcilable; no new initiation exists, and no bKash figure is shown, because there is none.
      </p>
    </>
  );
}
