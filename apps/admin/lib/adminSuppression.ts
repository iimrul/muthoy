// Batch 3 §8.5 — k-anonymity, k = 5.
//
// ONE function, and every analytics or report aggregate passes through it. The
// reason it is one function rather than a rule is that a floor applied in nine
// places is a floor forgotten in one, and the one it is forgotten in is the one
// that identifies a pharmacy.
//
// WHAT IS BEING PROTECTED. These are platform aggregates across pharmacies. A
// bucket built from a single shop IS that shop's figure wearing an aggregate's
// label — "average daily sales in Banani" over one pharmacy in Banani is that
// pharmacy's sales. The floor is on the number of DISTINCT CONTRIBUTING SHOPS,
// not on the value and not on the row count: a hundred sales rows from one shop
// is still one shop.
//
// SUPPRESSED MEANS ABSENT, NOT ZERO. A suppressed bucket renders as an em dash
// and exports as an empty cell. Rendering zero would be a lie about the data,
// and rendering the real value "because it is only one shop" is the disclosure
// itself.

/** The floor. Five distinct shops, as §8.5 fixes it. */
export const SUPPRESSION_K = 5;

/** What a page renders for a suppressed value. Matches lib/adminViews.ts. */
export const SUPPRESSED_DISPLAY = '—';

/** What an export writes for a suppressed value: empty, not a placeholder. */
export const SUPPRESSED_EXPORT = '';

export interface Aggregate<T> {
  /** The figure, whatever its unit. */
  value: T;
  /**
   * The DISTINCT shops behind it. A list rather than a count, because the
   * caller usually has the ids, and a count it computed itself is a count that
   * can be computed wrongly.
   */
  contributingShopIds: readonly string[];
}

export type Suppressed<T> =
  | { suppressed: false; value: T; contributorCount: number }
  | { suppressed: true; value: null; contributorCount: number };

function distinctCount(ids: readonly string[]): number {
  return new Set(ids).size;
}

/**
 * The gate. Below k distinct shops, the value does not come out.
 *
 * `contributorCount` is returned in BOTH branches, deliberately: a page may
 * legitimately say "suppressed — fewer than 5 pharmacies", and an operator
 * needs to know a bucket exists at all. The count is not itself identifying;
 * the value is.
 */
export function suppressBelowK<T>(
  aggregate: Aggregate<T>,
  k: number = SUPPRESSION_K,
): Suppressed<T> {
  const contributorCount = distinctCount(aggregate.contributingShopIds);
  if (contributorCount < k) {
    return { suppressed: true, value: null, contributorCount };
  }
  return { suppressed: false, value: aggregate.value, contributorCount };
}

/** A whole series, each point gated independently. */
export function suppressSeriesBelowK<T>(
  points: readonly Aggregate<T>[],
  k: number = SUPPRESSION_K,
): readonly Suppressed<T>[] {
  return points.map((point) => suppressBelowK(point, k));
}

/**
 * A TOTAL over buckets, withheld when any of its buckets is withheld.
 *
 * ROUND 11 FINDING 2. Gating a total on its own union of contributors is not
 * enough, because the union is large whenever any bucket is. The Revenue
 * page's all-time pharmacy total cleared the floor on the union while one of
 * its months was withheld on Analytics — and a visible total minus the visible
 * months IS the withheld month. Publishing an aggregate while withholding a
 * part of it publishes that part by subtraction as soon as the other parts are
 * visible.
 *
 * So the rule is composition, not union: **a total is released only if every
 * bucket inside it is releasable.** That is deliberately stricter than k on
 * the union, and it is the only form that survives someone holding two of this
 * product's own screens side by side.
 *
 * WHAT THIS DOES NOT COVER, stated rather than implied: differencing along
 * dimensions other than the period — two status-filtered queries whose
 * difference is a small group, for instance — is the general query-auditing
 * problem and is not solved here. The period dimension is closed because a
 * published bucket no longer depends on the requested window; see
 * `assertAnswerablePeriod` in adminReports.ts.
 */
/** One day of a money bucket, split by the side that produced it. */
export interface DaySides {
  day: string;
  saleShopIds: readonly string[];
  refundShopIds: readonly string[];
}

/** Whether one SIDE of one day may be published on its own. */
function sideReleasable(ids: readonly string[], k: number): boolean {
  return ids.length === 0 || distinctCount(ids) >= k;
}

/** Whether a whole DAY may be published: every non-empty side clears the floor. */
export function dayReleasable(day: DaySides, k: number = SUPPRESSION_K): boolean {
  return sideReleasable(day.saleShopIds, k) && sideReleasable(day.refundShopIds, k);
}

/**
 * Whether a MONTH may be published, given the days in it and the days whose
 * money is published SOMEWHERE ELSE.
 *
 * ROUND 13 FINDING 2 established that composition has to hold downwards, and
 * ROUND 14 FINDINGS 3 and 4 showed my first attempt was wrong twice over: it
 * lived only in the report builder, and it checked the daily UNION while the
 * Dashboard gates per side.
 *
 * My SECOND attempt -- "every day must be releasable" -- was sound and far too
 * strict, which the reviewer also reproduced: six genuine one-pharmacy days
 * hid a six-pharmacy monthly total that no query discloses. Refunds are rarer
 * than sales, so almost every month contains a day with fewer than k
 * refunders, and the panel would have withheld nearly every money figure it
 * exists to show. Withholding everything is not privacy; it is a broken
 * report that also happens to be private.
 *
 * So the rule is the composition rule on the partition that ACTUALLY EXISTS.
 * Exactly one day's money is published anywhere in this panel: TODAY's net, on
 * the Dashboard. For each such day D inside the month:
 *
 *   - if D is NOT releasable, the Dashboard withholds it, so there is nothing
 *     to subtract and the month is unaffected;
 *   - if D IS releasable, then month - D is derivable, so the REST of the
 *     month must clear the floor per side as well.
 *
 * A day nobody publishes constrains nothing, which is why a historical month
 * is unaffected. `publishedDays` is passed in rather than read from a clock
 * here, so the rule is testable at a fixed date and so a future page that
 * publishes another day's money has exactly one place to declare it.
 */
export function daysReleasable(
  days: readonly DaySides[],
  publishedDays: readonly string[] = [],
  k: number = SUPPRESSION_K,
): boolean {
  for (const published of publishedDays) {
    const day = days.find((candidate) => candidate.day === published);
    if (day === undefined) continue;
    // Withheld there, so not subtractable from here.
    if (!dayReleasable(day, k)) continue;

    const rest = days.filter((candidate) => candidate.day !== published);
    const restSales = rest.flatMap((candidate) => [...candidate.saleShopIds]);
    const restRefunds = rest.flatMap((candidate) => [...candidate.refundShopIds]);
    // An empty rest is not a disclosure: month - D = nothing.
    if (restSales.length === 0 && restRefunds.length === 0) continue;
    if (!sideReleasable(restSales, k) || !sideReleasable(restRefunds, k)) return false;
  }
  return true;
}

export function suppressTotalAcrossBuckets<T>(
  total: T,
  buckets: readonly Aggregate<unknown>[],
  k: number = SUPPRESSION_K,
): Suppressed<T> {
  const union = distinctCount(buckets.flatMap((bucket) => [...bucket.contributingShopIds]));
  const anyBucketWithheld = buckets.some(
    (bucket) => distinctCount(bucket.contributingShopIds) < k,
  );
  if (anyBucketWithheld || union < k) {
    return { suppressed: true, value: null, contributorCount: union };
  }
  return { suppressed: false, value: total, contributorCount: union };
}

/**
 * The rendering form: the value's own text, or the em dash.
 *
 * `format` is only called for a value that survived, so a formatter cannot be
 * the thing that leaks a suppressed figure.
 */
export function displaySuppressed<T>(
  gated: Suppressed<T>,
  format: (value: T) => string,
): string {
  return gated.suppressed ? SUPPRESSED_DISPLAY : format(gated.value);
}

/** The export form: an empty cell, never a placeholder a spreadsheet would total. */
export function exportSuppressed<T>(
  gated: Suppressed<T>,
  format: (value: T) => string,
): string {
  return gated.suppressed ? SUPPRESSED_EXPORT : format(gated.value);
}

/**
 * Drops suppressed points entirely, for a chart.
 *
 * A chart cannot render an em dash, and plotting a gap as zero would draw a
 * cliff that is not in the data. So a suppressed point is absent from the
 * series and the chart's own caption says how many were withheld.
 */
export function visiblePoints<T>(
  gated: readonly Suppressed<T>[],
): { points: readonly T[]; withheld: number } {
  const points: T[] = [];
  let withheld = 0;
  for (const point of gated) {
    if (point.suppressed) {
      withheld += 1;
      continue;
    }
    points.push(point.value);
  }
  return { points, withheld };
}
