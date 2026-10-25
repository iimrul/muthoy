import { ADMIN_MAX_RANGE_DAYS } from '@muthoy/validation';
import ChartPanel from '../../components/charts/ChartPanel';
import ErrorNotice from '../../components/ErrorNotice';
import { FilterForm } from '../../components/PageParts';
import { requireAdminPermission } from '../../lib/adminAuthz';
import { requireMetric } from '../../lib/adminMetrics';
import { analyticsOverview, type AnalyticsOverview } from '../../lib/adminPlatformQueries';
import { featureState } from '../../lib/adminSettings';
import { suppressBelowK } from '../../lib/adminSuppression';
import { toDisplayMessage } from '../../lib/errors';

// Batch 3 §8.5 — Analytics.
//
// EVERY SERIES POINT GOES THROUGH `suppressBelowK`, in one place: `toPoints`
// below. A floor applied in four charts is a floor forgotten in one, and the one
// it is forgotten in is the one that identifies a pharmacy.
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

function firstParam(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

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
  const from = firstParam(params.from);
  const to = firstParam(params.to);

  const result = await loadAnalytics(from, to);
  if (!result.ok) return <ErrorNotice message={result.message} />;

  const { activeByDay, registeredByDay, pharmacySalesByMonth, shopsByPlan } = result.data;

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
  const sales = toPoints(
    pharmacySalesByMonth,
    (bucket) => bucket.month,
    (bucket) => Number(bucket.totalPaisa) / 100,
    (bucket) => bucket.shopIds,
  );
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

        <ChartPanel
          heading={requireMetric('pharmacy_sales_net').label + ', by month'}
          // The family is named in the description as well as in the label:
          // this is a PHARMACY's takings, not Muthoy's money, and the two are
          // never added together.
          description="Refund-subtracted takings across pharmacies, in taka. This is the pharmacies' own money, not Muthoy's — Muthoy's own figures are on the billing page."
          kind="trend"
          points={sales.points}
          valueLabel="Taka"
          isMoney
          withheld={sales.withheld}
          emptyMessage="No sale has been recorded in this range, so there is no sales series."
          format={(value) => value.toFixed(2)}
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
