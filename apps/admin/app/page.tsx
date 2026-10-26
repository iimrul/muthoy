import Link from 'next/link';
import { formatMoney, formatNumber } from '@muthoy/utils';
import ChartPanel from '../components/charts/ChartPanel';
import ErrorNotice from '../components/ErrorNotice';
import { EmptyState, MetricTile } from '../components/PageParts';
import StatCard from '../components/StatCard';
import { requireAdminPermission } from '../lib/adminAuthz';
import {
  dashboardAlerts,
  distinctShopCount,
  subscriptionDistribution,
  TREND_DAYS,
  type DashboardAlert,
} from '../lib/adminDashboard';
import {
  accountsEverPaid,
  entitlementCounts,
  isActiveSubscriptionNow,
  monthlyRecurringRevenue,
  requireMetric,
} from '../lib/adminMetrics';
import { dashboardOverview, type DashboardOverview } from '../lib/adminPlatformQueries';
import { suppressSeriesBelowK } from '../lib/adminSuppression';
import { formatCount, formatDhakaDate } from '../lib/adminViews';
import { toDisplayMessage } from '../lib/errors';
import type { PlatformStats } from '../lib/platformStats';
import { getPlatformStats } from '../lib/queries';

// Batch 3 §8.1 — the Dashboard.
//
// NINE METRICS AND FIVE COMPUTED ALERT CLASSES. Every one is derived from rows
// that were read; §8 forbids a hardcoded statistic, and a KPI card is where a
// placeholder would last longest, because a plausible number looks exactly
// like a real one.
//
// ONE INSTANT FOR ALL OF IT. lib/adminPlatformQueries.ts reads the seven
// sources in parallel and lib/adminDashboard.ts applies every predicate to the
// same `nowMs`, so an alert cannot count a subscription the card above it
// excluded. React's purity rule also refuses `Date.now()` in a render body —
// and reading the clock in the loader is the more honest reading anyway.
//
// THE RUN RATE IS ABSENT WITHOUT `revenue.read`, AND THE PAGE IS STILL RIGHT.
// The effective permission set decides, not the environment role, so a
// narrowed account sees the narrowed page. Every other figure is a count or a
// pharmacy-sales figure and needs no money permission.
//
// THE TWO SERIES ARE TREATED DIFFERENTLY ON PURPOSE. Registrations are
// registration metadata, which §8.10 permits unsuppressed. The activity series
// is an aggregate derived from `sales`, so every one of its points goes
// through §8.5's k floor — a day on which one pharmacy traded is that
// pharmacy's day.

export const dynamic = 'force-dynamic';

type DashboardResult =
  | { ok: true; overview: DashboardOverview; stats: PlatformStats; nowMs: number }
  | { ok: false; message: string };

/**
 * The fetch is what can throw, so only the fetch sits in try/catch. React
 * renders JSX lazily, so a catch wrapped around JSX would never fire.
 */
async function loadDashboard(): Promise<DashboardResult> {
  try {
    // ONE clock reading, passed to both reads, so the Dhaka day the trend is
    // built on is the same day the sales total is windowed on.
    const now = new Date();
    const [overview, stats] = await Promise.all([dashboardOverview(now), getPlatformStats(now)]);
    return { ok: true, overview, stats, nowMs: now.getTime() };
  } catch (error: unknown) {
    console.error('[admin] dashboard failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const label = (
    <>
      {alert.label}
      <span className="ml-2 font-semibold tabular-nums">{formatCount(alert.count)}</span>
    </>
  );
  return (
    <li className="border-b border-black/5 py-2">
      <p className="text-sm">
        {/* A zero alert is still LISTED — "0 stale payment orders" is a checked
            fact, and an absent row would read as an unchecked one. Only a
            non-zero one is a link, because there is nothing to go and look at
            otherwise. */}
        {alert.count > 0 && alert.href !== null ? (
          <Link href={alert.href} className="underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </p>
      <p className="mt-0.5 text-xs text-midGray">{alert.detail}</p>
    </li>
  );
}

export default async function DashboardPage() {
  // W4-06: authorization FIRST, server-side, before any query runs. A denial
  // must not reach the reads, so this cannot move below the fetch.
  let permissions: readonly string[];
  try {
    const session = await requireAdminPermission('shops.read');
    permissions = session.permissions;
  } catch (error: unknown) {
    console.error('[admin] dashboard denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const result = await loadDashboard();

  if (!result.ok) {
    return <ErrorNotice message={result.message} />;
  }

  const { overview, stats, nowMs } = result;
  const { shops, subscriptions, entitlements, orders, events, offerings } = overview;

  const counts = entitlementCounts(entitlements, nowMs);

  // GATE 5 FINDING 11. These counted the literal status, so a row left at
  // `active` with `paid_through` in the past was reported as active for ever,
  // and an expired trial went on being counted as a trial.
  //
  // Both now use §5.1c's accepted definitions. The ACTIVE count stays on the
  // subscription rows, with the canonical time conditions applied, because a
  // subscription row and the entitlement derived from it can legitimately
  // disagree and showing both is the point. The TRIAL count comes from the
  // entitlement snapshots, because `trial_ends_at` exists nowhere else — a
  // `billing_subscriptions` row has no column saying when its trial ends, so
  // counting `status === 'trialing'` could never have expired.
  const activeSubscriptions = subscriptions.filter((subscription) =>
    isActiveSubscriptionNow(subscription, nowMs),
  ).length;
  const trialSubscriptions = counts.trialing;

  const today = overview.activeByDay[overview.activeByDay.length - 1];
  const activeToday = today === undefined ? 0 : distinctShopCount(today);

  const alerts = dashboardAlerts({ shops, subscriptions, entitlements, orders, events }, nowMs);
  const raisedAlerts = alerts.filter((alert) => alert.count > 0).length;

  // The run rate is computed only where it will be shown: a figure nobody is
  // allowed to see should not be derived either.
  const mayReadMoney = permissions.includes('revenue.read');
  const runRate = mayReadMoney
    ? monthlyRecurringRevenue({ subscriptions, offerings, nowMs })
    : null;

  const registrationPoints = overview.registeredByDay.map((bucket) => ({
    label: bucket.day,
    value: distinctShopCount(bucket),
  }));

  // The whole series through the shared gate in one call, then read twice.
  // No counter is incremented during render: React's immutability rule
  // forbids it, and a reassignment inside a map is how a "withheld" figure
  // ends up one behind the series it describes.
  const gatedActivity = suppressSeriesBelowK(
    overview.activeByDay.map((bucket) => ({
      value: distinctShopCount(bucket),
      contributingShopIds: bucket.shopIds,
    })),
  );
  const activityPoints = gatedActivity.map((gated, index) => ({
    label: overview.activeByDay[index]?.day ?? '',
    value: gated.suppressed ? null : gated.value,
  }));
  const withheldActivityDays = gatedActivity.filter((gated) => gated.suppressed).length;

  const distribution = subscriptionDistribution(subscriptions).map((bucket) => ({
    label: bucket.key,
    value: bucket.count,
  }));

  // Newest first, and only what the registration metadata holds.
  const recent = [...shops]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 10);

  return (
    <>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-midGray">
        Platform totals across every registered shop, for the Dhaka business date{' '}
        {overview.businessDate}.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          metric={requireMetric('registered_pharmacies')}
          value={formatNumber(shops.length)}
          note="Excluding deleted shops."
          href="/pharmacies"
        />
        <MetricTile
          metric={requireMetric('active_pharmacies_today')}
          value={formatCount(activeToday)}
          note="Distinct pharmacies that recorded a sale on this business date."
          href="/analytics"
        />
        <MetricTile
          metric={requireMetric('active_subscriptions')}
          value={formatCount(activeSubscriptions)}
          note="Active rows whose paid or grace period is still running. Entitlement is counted separately below."
          href="/subscriptions"
        />
        <MetricTile
          metric={requireMetric('trial_subscriptions')}
          value={formatCount(trialSubscriptions)}
          note="The canonical trialing branch, read from the entitlement snapshots — the only record that holds a trial's end date."
          href="/subscriptions"
        />
        <MetricTile
          metric={requireMetric('accounts_ever_paid')}
          value={formatCount(accountsEverPaid(orders))}
          note="At least one verified payment order, ever. A past payment, not current access."
          href="/payments"
        />
        <MetricTile
          metric={requireMetric('currently_paid_entitlements')}
          value={formatCount(counts.currentlyPaid)}
          note={
            'What a device would honour right now. '
            + formatCount(counts.trialing)
            + ' trialing, '
            + formatCount(counts.entitled)
            + ' entitled in total.'
          }
          href="/subscriptions"
        />
        {runRate === null ? null : (
          <MetricTile
            metric={requireMetric('mrr')}
            value={formatMoney(runRate.totalPaisa)}
            note={
              formatCount(runRate.countedSubscriptions)
              + ' priced subscriptions. Muthoy’s own money, not a pharmacy’s takings.'
            }
            href="/revenue"
          />
        )}
        <StatCard
          label="Total sales today, net of refunds"
          value={formatMoney(stats.netSalesToday)}
          hint={`All shops · ${stats.day.businessDate} (Asia/Dhaka) · gross ${formatMoney(stats.grossSalesToday)} less refunds ${formatMoney(stats.refundsToday)}`}
          isMoney
        />
      </div>

      <p className="mt-4 text-xs text-midGray">
        Pharmacy takings, net of refunds, on the Dhaka business date — both sides windowed the
        same way. This is what the pharmacies sold, not Muthoy&apos;s own income.
        {mayReadMoney
          ? ''
          : ' The subscription run rate is not shown, because this account does not hold the permission for it.'}
      </p>

      <section aria-labelledby="alerts" className="mt-8">
        <h2 id="alerts" className="text-base font-semibold">
          Operational alerts
        </h2>
        <p className="mt-1 text-sm text-midGray">
          All five classes are checked and all five are listed, so a zero is a checked fact rather
          than a missing row. {formatCount(raisedAlerts)} of {formatCount(alerts.length)}{' '}
          {raisedAlerts === 1 ? 'is' : 'are'} currently raised.
        </p>
        <ul className="mt-3">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </ul>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <ChartPanel
          heading={'Registrations, last ' + TREND_DAYS + ' days'}
          description="Pharmacies that registered, by Dhaka business date. Registration metadata, which is reported unsuppressed."
          kind="trend"
          points={registrationPoints}
          valueLabel="Pharmacies registered"
          emptyMessage="No pharmacy has registered yet. No demo data ships, so a fresh platform is empty."
        />
        <ChartPanel
          heading={'Pharmacies active, last ' + TREND_DAYS + ' days'}
          description="Distinct pharmacies that recorded a sale, by Dhaka business date. Every point passes the k=5 floor."
          kind="trend"
          points={activityPoints}
          valueLabel="Pharmacies active"
          withheld={withheldActivityDays}
          emptyMessage="No sale has been recorded, so there is no activity series yet."
        />
      </div>

      <div className="mt-4">
        <ChartPanel
          heading="Subscriptions by status"
          description="Every status is listed, so a zero is stated rather than inferred from an absent bar."
          kind="distribution"
          points={distribution}
          valueLabel="Subscriptions"
          emptyMessage="No subscription has been created yet."
        />
      </div>

      <section aria-labelledby="recent" className="mt-8">
        <h2 id="recent" className="text-base font-semibold">
          Recent registrations
        </h2>
        {recent.length === 0 ? (
          <EmptyState message="No pharmacy has registered yet, so there is nothing recent to show." />
        ) : (
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">The ten most recently registered pharmacies.</caption>
            <thead>
              <tr className="border-b border-black/10 text-left">
                <th scope="col" className="py-1 font-medium">
                  Pharmacy
                </th>
                <th scope="col" className="py-1 font-medium">
                  Plan
                </th>
                <th scope="col" className="py-1 font-medium">
                  Billing account
                </th>
                <th scope="col" className="py-1 font-medium">
                  Registered
                </th>
              </tr>
            </thead>
            <tbody>
              {recent.map((shop) => (
                <tr key={shop.id} className="border-b border-black/5">
                  <th scope="row" className="py-1 text-left font-normal">
                    <Link href={'/shops/' + shop.id} className="underline">
                      {shop.name}
                    </Link>
                  </th>
                  <td className="py-1">{shop.plan}</td>
                  {/* Whether one EXISTS, not which one: the id is the
                      drill-down's business, and the alert above is about
                      absence. */}
                  <td className="py-1">{shop.billingAccountId === null ? 'none' : 'linked'}</td>
                  <td className="py-1">{formatDhakaDate(shop.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
