import { ADMIN_MAX_RANGE_DAYS } from '@muthoy/validation';
import ChartPanel from '../../components/charts/ChartPanel';
import NetSalesTrend from '../../components/NetSalesTrend';
import { EMPTY_VALUE, formatCount } from '../../lib/adminViews';
import ErrorNotice from '../../components/ErrorNotice';
import { FilterForm, MetricTile } from '../../components/PageParts';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { parseListQuery } from '../../lib/adminFilters';
import { requireMetric } from '../../lib/adminMetrics';
import { analyticsOverview, type AnalyticsOverview } from '../../lib/adminPlatformQueries';
import { featureState } from '../../lib/adminSettings';
import { daysReleasable, SUPPRESSION_K, suppressBelowK } from '../../lib/adminSuppression';
import { dhakaTodayLabel } from '../../lib/adminDashboard';
import { toDisplayMessage } from '../../lib/errors';

// Batch 3 §8.5 — Analytics.
//
// EVERY SERIES POINT GOES THROUGH `suppressBelowK`, in one place: `toPoints`
// below. A floor applied in four charts is a floor forgotten in one, and the one
// it is forgotten in is the one that identifies a pharmacy.
//
// The conversion TILE is the one figure that is not a series, so it calls the
// same gate directly rather than through `toPoints`. It was forgotten exactly
// as the paragraph above predicts, and the delta review caught it: a single
// trialed account published "100.0%" and "1 of 1".
//
// THE FLOOR IS ON DISTINCT CONTRIBUTING SHOPS, not on the value and not on the
// row count. A hundred sales rows from one pharmacy is still one pharmacy, and
// "the day's takings in Banani" over a single shop IS that shop's takings
// wearing an aggregate's label. That is why `analyticsOverview` hands this page
// the shop ids rather than finished totals — a reader that returned numbers
// would have thrown away the only thing the floor can be applied to.
//
// SUPPRESSED MEANS ABSENT, NOT ZERO. A withheld point is an em dash in the
// table and absent from the line; plotting it as zero would draw a cliff that is
// not in the data. ChartPanel states how many were withheld.
//
// NO CUSTOMER, NO SALE LINE AND NO MEDICINE is read or rendered anywhere here.

export const dynamic = 'force-dynamic';

/**
 * One series, gated. The ONLY path from a bucket to a chart on this page.
 *
 * `withheld` is returned alongside, because an operator seeing a gap needs to
 * know whether there was no data or whether it is being withheld — different
 * facts about the product, and only one of them is a reason to investigate.
 */
function toPoints<T>(
  buckets: readonly T[],
  labelOf: (bucket: T) => string,
  valueOf: (bucket: T) => number,
  shopsOf: (bucket: T) => readonly string[],
): { points: { label: string; value: number | null }[]; withheld: number } {
  let withheld = 0;
  const points = buckets.map((bucket) => {
    const gated = suppressBelowK({
      value: valueOf(bucket),
      contributingShopIds: shopsOf(bucket),
    });
    if (gated.suppressed) withheld += 1;
    return { label: labelOf(bucket), value: gated.suppressed ? null : gated.value };
  });
  return { points, withheld };
}

type AnalyticsResult = { ok: true; data: AnalyticsOverview } | { ok: false; message: string };

async function loadAnalytics(from: string, to: string): Promise<AnalyticsResult> {
  try {
    return {
      ok: true,
      data: await analyticsOverview({
        ...(from.length > 0 ? { from } : {}),
        ...(to.length > 0 ? { to } : {}),
      }),
    };
  } catch (error: unknown) {
    console.error('[admin] analytics failed to load:', error);
    return { ok: false, message: toDisplayMessage(error) };
  }
}

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  try {
    await requireAdminPermission('analytics.read');
  } catch (error: unknown) {
    console.error('[admin] analytics denied:', error);
    return <ErrorNotice message={toDisplayMessage(error)} />;
  }

  const flag = await featureState('flag.analytics_enabled');
  if (flag === 'disabled') {
    return (
      <>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p role="status" className="mt-4 text-sm text-midGray">
          Analytics is switched off in Settings. Nothing is hidden by this page itself.
        </p>
      </>
    );
  }
  if (flag === 'unknown') {
    return (
      <ErrorNotice message="The settings store could not be read, so analytics was not loaded. Analytics has not been switched off." />
    );
  }

  const params = await searchParams;

  // GATE 5 FINDING 7. `from` and `to` previously went straight from the search
  // params into the query, and the 400-day cap existed only as text on the
  // page. So a reversed range, a malformed date or a ten-year span all reached
  // the business queries — the cap was a promise rather than a rule.
  //
  // `parseListQuery` runs the SHARED schema, whose `rangeIsSane` refine
  // enforces both `from <= to` and the 400-day bound, and a malformed range is
  // reported WITH its reason rather than thrown: a stale bookmark is not a
  // server fault.
  const parsedRange = parseListQuery(params);
  if (!parsedRange.ok) {
    return (
      <>
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p role="alert" className="mt-4 text-sm text-richBlack">
          {parsedRange.message} Nothing was queried. The range is capped at{' '}
          {ADMIN_MAX_RANGE_DAYS} days.
        </p>
        <FilterForm range={{ from: '', to: '' }} />
      </>
    );
  }

  const from = parsedRange.query.from ?? '';
  const to = parsedRange.query.to ?? '';

  const result = await loadAnalytics(from, to);
  if (!result.ok) return <ErrorNotice message={result.message} />;

  const {
    activeByDay,
    registeredByDay,
    pharmacySalesByMonth,
    shopsByPlan,
    conversion,
    subscriptionsStartedByMonth,
    cancellationsByMonth,
  } = result.data;

  const distinct = (ids: readonly string[]) => new Set(ids).size;

  const active = toPoints(
    activeByDay,
    (bucket) => bucket.day,
    (bucket) => distinct(bucket.shopIds),
    (bucket) => bucket.shopIds,
  );
  const registered = toPoints(
    registeredByDay,
    (bucket) => bucket.day,
    (bucket) => distinct(bucket.shopIds),
    (bucket) => bucket.shopIds,
  );
  // §8.5's growth and cancellation series. Suppressed on the ACCOUNTS behind
  // each month, for the same reason every other bucket is: a month built from
  // one account is that account's month.
  const growth = toPoints(
    subscriptionsStartedByMonth,
    (bucket) => bucket.month,
    (bucket) => distinct(bucket.accountIds),
    (bucket) => bucket.accountIds,
  );
  const cancellations = toPoints(
    cancellationsByMonth,
    (bucket) => bucket.month,
    (bucket) => distinct(bucket.accountIds),
    (bucket) => bucket.accountIds,
  );
  // Gated on the SELLING shops, not on every contributor to the net total.
  // One selling shop beside four refund-only shops is one shop's sale count.
  const volume = toPoints(
    pharmacySalesByMonth,
    (bucket) => bucket.month,
    (bucket) => bucket.saleCount,
    (bucket) => bucket.saleShopIds,
  );

  // §8.5's conversion, through the same floor as every series on this page.
  // The unit here is the billing ACCOUNT, as it is for growth and
  // cancellations: the figure describes accounts, so accounts are what the
  // floor counts.
  const conversionGate = suppressBelowK({
    value: conversion.ratio,
    contributingShopIds: conversion.accountIds,
  });

  // §6i ROUND 11: this page no longer holds the net series' POINTS at all.
  //
  // Round 10 moved the conversion into `netChartPoints`, a sink taking opaque
  // amounts, which closed the numeric selector the reviewer had used. Round 11
  // then showed the sink stopped one step short of the output, because it
  // handed back a plain array and this page owned it from there:
  //
  //   points: netChartPoints(salesBuckets).map((point) => ({
  //     ...point, value: point.value === null ? null : 230,
  //   })),
  //
  // plotted 230.00 under the canonical caption. A lying `format` prop and a
  // swapped heading worked for the same reason -- the page held the formatter
  // and the words too.
  //
  // So the page hands the BUCKETS to `NetSalesTrend` and nothing else. It
  // cannot pass a number, a formatter or a caption, because that component has
  // no prop for any of them.
  const salesBuckets = pharmacySalesByMonth.map((bucket) => {
    const gated = suppressBelowK({
      value: bucket.totalPaisa,
      contributingShopIds: bucket.shopIds,
    });
    // ROUND 14 FINDING 3: the DAY rule too. Round 13 put downward composition
    // in the report builder only, so this page published 420.00 for a month
    // the report withheld -- and the Dashboard's 500.00 day minus that 420.00
    // was still the withheld 80.00. One predicate, every output.
    return {
      label: bucket.month,
      amount: bucket.totalPaisa,
      suppressed: gated.suppressed || !daysReleasable(bucket.days, [dhakaTodayLabel()]),
    };
  });
  const plans = toPoints(
    shopsByPlan,
    (bucket) => bucket.plan,
    (bucket) => distinct(bucket.shopIds),
    (bucket) => bucket.shopIds,
  );

  return (
    <>
      <h1 className="text-xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-midGray">
        Platform aggregates only. Any bucket built from fewer than five distinct pharmacies is
        withheld, because such a bucket is one pharmacy&rsquo;s figure wearing an aggregate&rsquo;s
        label. No customer, sale line or medicine appears here.
      </p>

      <FilterForm range={{ from, to }} />
      <p className="mt-1 text-xs text-midGray">
        A range of at most {ADMIN_MAX_RANGE_DAYS} days. Leave both dates blank for all time.
      </p>

      <div className="mt-6 space-y-6">

      {/* §8.5's TRIAL-TO-PAID CONVERSION (Gate 5 finding 8), which was absent
          from this page and from the billing page the acceptance record also
          claimed it on. NULL rather than 0% when nobody was ever granted a
          trial: "0% converted" reads as a failure, and "no trials granted yet"
          is the truth.

          GATE 5 DELTA FINDING 2: both the percentage AND the numerator /
          denominator note are now behind the floor. The note was the worse
          leak of the two — "1 of 1 accounts granted a trial later held a
          verified payment" states one account's payment activity outright,
          while the percentage at least needs the denominator to decode. */}
      <div className="mt-6 max-w-md">
        <MetricTile
          metric={requireMetric('trial_to_paid_conversion')}
          value={
            conversion.ratio === null || conversionGate.suppressed
              ? EMPTY_VALUE
              : (conversion.ratio * 100).toFixed(1) + '%'
          }
          note={
            conversion.ratio === null
              ? 'No account has been granted a launch trial, so there is nothing to convert. This is not a zero.'
              : conversionGate.suppressed
                ? 'Withheld: fewer than '
                  + formatCount(SUPPRESSION_K)
                  + ' accounts have been granted a trial, so a conversion figure here would describe those accounts individually.'
                : formatCount(conversion.numerator)
                  + ' of '
                  + formatCount(conversion.denominator)
                  + ' accounts granted a trial later held a verified payment.'
          }
        />
      </div>

        <ChartPanel
          heading={requireMetric('active_pharmacies_today').label + ', by day'}
          description="Distinct pharmacies that recorded a sale on each Dhaka business date."
          kind="trend"
          points={active.points}
          valueLabel="Pharmacies"
          withheld={active.withheld}
          emptyMessage="No sale has been recorded in this range, so there is no activity series."
        />

        <ChartPanel
          heading={requireMetric('registered_pharmacies').label + ', by day'}
          description="New registrations on each Dhaka day."
          kind="trend"
          points={registered.points}
          valueLabel="Registrations"
          withheld={registered.withheld}
          emptyMessage="No pharmacy registered in this range."
        />

        {/* §6i round 11: buckets in, nothing else. The heading, the series
            name, the description, the conversion and the per-point formatting
            all live inside NetSalesTrend, which resolves them from the §5.2
            manifest entry named by the ID. There is no points prop to map
            over, no format prop to falsify and no heading prop to swap. */}
        <NetSalesTrend
          metricId="pharmacy_sales_net"
          buckets={salesBuckets}
          grain="month"
          emptyMessage="No sale has been recorded in this range, so there is no sales series."
        />

        <ChartPanel
          heading="Plan distribution"
          description="Distinct pharmacies on each plan tier."
          kind="distribution"
          points={plans.points}
          valueLabel="Pharmacies"
          withheld={plans.withheld}
          emptyMessage="No pharmacy is registered, so there is no plan distribution."
        />

        {/* §8.5's REMAINING FIGURES (Gate 5 finding 8). All four were
            specified, none rendered, and the acceptance record claimed them. */}
        <ChartPanel
          heading="Subscription growth, by month"
          description="Subscriptions that STARTED in each month, by the account behind them. A renewal is not a start, so this counts new agreements rather than activity."
          kind="trend"
          points={growth.points}
          valueLabel="Subscriptions started"
          withheld={growth.withheld}
          emptyMessage="No subscription has started yet, so there is no growth series."
        />

        <ChartPanel
          heading={requireMetric('recorded_cancellations').label + ', by month'}
          description="Subscriptions carrying a cancellation in that month. NOT a churn series: a renewal overwrites the same row and clears the flag, so a past month can only ever under-report (gate E12)."
          kind="trend"
          points={cancellations.points}
          valueLabel="Recorded cancellations"
          withheld={cancellations.withheld}
          emptyMessage="No cancellation is recorded in current state."
        />

        <ChartPanel
          heading="Pharmacy sales volume, by month"
          description="How many sales were rung up, beside the money total above — whose own
            caption comes from the metric manifest. A refund is not a sale, so it is not
            counted here."
          kind="trend"
          points={volume.points}
          valueLabel="Sales recorded"
          withheld={volume.withheld}
          emptyMessage="No sale has been recorded, so there is no volume series."
        />
      </div>

      <p className="mt-8 text-xs text-midGray">
        Trial-to-paid conversion and the subscription figures are reported on the billing page,
        where the subscription family is kept together. Churn is not claimed: a renewal overwrites
        the subscription row, so a true churn trend needs an immutable subscription-lifecycle table
        (gate E12).
      </p>
    </>
  );
}
