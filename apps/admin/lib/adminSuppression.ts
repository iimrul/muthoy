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
