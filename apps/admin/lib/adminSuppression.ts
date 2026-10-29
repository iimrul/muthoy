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
 * Whether a MONTH may be published, given the days inside it.
 *
 * THE RULE, AND THE THREE WRONG VERSIONS BEFORE IT.
 *
 * Round 13 established that composition has to hold downwards: a month
 * differenced against a day published elsewhere discloses the difference.
 *
 * Round 14 showed that version was wrong twice -- it lived only in the report
 * builder, and it compared the daily UNION while the Dashboard gates per side.
 *
 * Round 14's own fix, "every day must be releasable", was then reproduced as
 * over-withholding, so round 15 narrowed it to "only days the Dashboard
 * publishes". ROUND 15 FINDINGS 1 and 2 killed that narrowing:
 *
 *   - FINDING 1. `publishedMoneyDays` was incomplete. The shop drill-down
 *     publishes each pharmacy's GROSS SALES TODAY (accepted 8.2 scope, and
 *     `shops.read` is held by all four roles). Five drill-downs give
 *     5 x 100.00 = 500.00 of gross; the monthly net reads 420.00; the
 *     difference is one pharmacy's 80.00 refund. The Dashboard withholding its
 *     own net changed nothing, because the gross came from somewhere else.
 *   - FINDING 2. A day published YESTERDAY is still remembered. Midnight does
 *     not erase a disclosure, so keying the rule to "today" was never sound.
 *
 * WHAT IS ACTUALLY EXPOSED, stated precisely, because it decides the rule.
 * Per-shop GROSS is visible by design. Per-shop REFUNDS are not visible
 * anywhere. Net = gross - refunds, so publishing a net figure alongside
 * visible gross figures discloses REFUNDS. The sale side needs no extra
 * protection -- it is already public per pharmacy -- and the refund side needs
 * it on EVERY day, not just today, because a reader can keep notes.
 *
 * So: a month is releasable only if every day's REFUND side clears the floor.
 *
 * ONE INPUT, BECAUSE THERE IS ONE RULE. This function used to take a
 * `publishedDays` list as well, and after round 15 narrowed the rule to the
 * refund side that argument stopped being read. It was still being threaded in
 * from `buildReportTable`'s options through `suppressRows` and passed by both
 * pages, so every reader of those call sites -- including me, twice -- would
 * believe a published-day set still gated something here. A dead parameter on
 * a money path is a defect waiting for someone to trust it, and two tests
 * were already passing `[]` against `['2026-10-02']` in cases whose outcome
 * can no longer differ. It is gone.
 *
 * THE COST, WHICH IS LARGE AND IS THE POINT. At beta scale -- ten pharmacies --
 * almost no day has five distinct refunding pharmacies, so almost every
 * monthly net figure is withheld. That is not the rule failing; it is
 * k-anonymity giving the correct answer for a population in which five
 * contributors genuinely do not exist. The honest options are (a) withhold, as
 * here, (b) stop publishing per-shop gross, which is accepted 8.2
 * functionality, or (c) accept the disclosure. (a) is the only one of the
 * three this code can choose on its own.
 */
export function daysReleasable(
  days: readonly DaySides[],
  k: number = SUPPRESSION_K,
): boolean {
  // The REFUND side of every day. The sale side is public per pharmacy on the
  // drill-down, so gating it here protects nothing while hiding a great deal;
  // the refund side is the only part a net figure can disclose.
  return days.every((day) => sideReleasable(day.refundShopIds, k));
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
