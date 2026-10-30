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

/**
 * WHETHER A PUBLISHED FIGURE CAN STILL CHANGE — and today it can, so
 * confidentiality-sensitive pharmacy money is not published at all.
 *
 * FOUNDER DECISION 2, 2026-10-30: "Published confidentiality-sensitive
 * financial aggregates must follow a stable, defensible publication policy. A
 * freshness delay alone is not sufficient unless the data is demonstrably final
 * and cannot later change in a way that discloses sensitive differences." And
 * the fallback, which is what applies here: "If a safe publication mechanism
 * cannot be implemented within the authorized local scope, retain suppression
 * and report the exact unresolved acceptance blocker."
 *
 * THE DISCLOSURE, as the reviewer reproduced it (round 1B finding 3). The same
 * whole-month query answered 457.00, then 450.00 after one more refund arrived.
 * Both answers cleared every floor. The difference is one pharmacy's 7.00
 * refund, and no floor can see it, because the floor examines one answer at a
 * time and the attack needs two.
 *
 * WHY NO STORAGE-FREE RULE CLOSES IT. The obvious candidate is "publish only
 * finished periods", and it fails on this product's own architecture: refunds
 * bucket by their own business date (`adminReports.ts`), so a month is stable
 * once it ends ONLY IF every device has synced. Muthoy is offline-first by
 * design. A pharmacy offline for three days syncs rows carrying their original
 * dates, so a closed month moves afterwards, and `shops.updated_at` cannot
 * prove otherwise -- it is a last-write-wins client timestamp, not a statement
 * that the device had nothing older queued. A delay long enough to be safe
 * would be a delay nobody can justify as safe, which is the "unproven freshness
 * delay" the decision refuses by name.
 *
 * SO THE ANSWER IS SUPPRESSION, and this constant is where it is stated once.
 * Making a figure publishable requires an immutable, versioned publication
 * snapshot -- persisted state, therefore a migration, therefore a hosted apply
 * the founder has reserved to a separate authorization. The migration is
 * implementable locally without touching a sealed artifact (the successor-file
 * pattern E4 already used); it just cannot DO anything until it is applied. See
 * `docs/plans/admin-architecture-rbac.md` §6n.
 *
 * Flip this to `true` only together with that mechanism, and only when a
 * published figure is read from a snapshot rather than recomputed.
 */
export const PUBLICATION_IS_REVISION_SAFE = false;

/**
 * The sentence a withheld pharmacy MONEY figure gets, wherever it is shown.
 *
 * ROUND 4 FINDING 4. I fixed the Dashboard's explanation and left three
 * others — the Revenue composition, the chart panel's withheld note and the
 * report cell's tooltip — still blaming "fewer than five pharmacies
 * contributed" when the revision policy was the actual refusal. None of them
 * recreated the round 3 oracle, because each was a fixed sentence rather than
 * one that moved with refunds, but all three told the operator something that
 * was not true.
 *
 * Taking the floor sentence as an argument rather than hard-coding one keeps
 * each surface's own wording for the case where the floor IS the reason, which
 * is what they will say again once publication becomes revision-safe.
 */
export function moneyWithholdingReason(floorReason: string): string {
  return PUBLICATION_IS_REVISION_SAFE ? floorReason : REVISABLE_WITHHOLDING;
}

/** The sentence a figure withheld for revisability gets, everywhere. */
export const REVISABLE_WITHHOLDING =
  'Withheld: this figure could change as offline pharmacies sync, and a changed '
  + 'figure would disclose the difference. Publication needs immutable snapshots.';

/** Whether one SIDE of one day may be published on its own. */
function sideReleasable(ids: readonly string[], k: number): boolean {
  return ids.length === 0 || distinctCount(ids) >= k;
}

/**
 * Whether the SALE side of one day clears the floor, asked on its own.
 *
 * EXPORTED, and ROUND 20 FINDING 5 is why. `withheldSide` answers "which side
 * failed FIRST", which is right for a caption about one day and wrong for
 * counting days across a period: a day short on BOTH sides is reported as a
 * sale failure, so counting refund failures by subtracting sale failures from
 * the total undercounts them. The publication policy has to ask each side
 * independently, and the only honest way to let it is to export the predicates
 * rather than have it re-derive them — two copies of this rule is how rounds 13
 * through 15 happened.
 */
export function saleSideClears(day: DaySides, k: number = SUPPRESSION_K): boolean {
  return sideReleasable(day.saleShopIds, k);
}

/** Whether the REFUND side of one day clears the floor, asked on its own. */
export function refundSideClears(day: DaySides, k: number = SUPPRESSION_K): boolean {
  return refundSideReleasable(day, k);
}

/**
 * The REFUND side, where an EMPTY set is not a free pass.
 *
 * FOUNDER DECISION 3, 2026-10-30: "Treat zero-valued refund contributions as
 * protected under the relevant release threat model. Do not automatically
 * publish a previously suppressed result merely because the refund side is
 * zero."
 *
 * WHY ZERO IS A DISCLOSURE. Ten pharmacies sold and none refunded: publishing
 * the day tells a reader that every one of those ten refunded NOTHING, and it
 * identifies all ten, because the set of zero-refunders is the whole set of
 * sellers. k=5 protects the IDENTITY of a contributor inside a crowd; with
 * zero refunders there is no crowd to hide in. Five refunders out of ten
 * sellers is the case k was designed for -- five did and five did not, and
 * which is which stays unknown.
 *
 * AND WHY EMPTINESS ALONE IS NOT THE TEST. A day on which nobody traded
 * discloses nothing about anybody: there is no pharmacy whose zero is being
 * revealed. Keying the rule to an empty refund list alone would have withheld
 * every month containing one quiet day, which is over-withholding with no
 * privacy gain -- the defect round 14 was reproduced for. So the sale side
 * decides whether there is anything to protect, and the refund side decides
 * whether it is protected.
 */
function refundSideReleasable(day: DaySides, k: number): boolean {
  // ROUND 3 FINDING 3 CORRECTED THIS. The exemption used to be
  // `day.saleShopIds.length === 0`, which let a REFUND-ONLY day through: zero
  // sellers, one refunder, releasable -- and that day discloses exactly one
  // pharmacy's refund against a sale it made earlier. The intent was always
  // "nobody traded at all", so that is what it now says.
  if (day.saleShopIds.length === 0 && day.refundShopIds.length === 0) return true;
  return distinctCount(day.refundShopIds) >= k;
}

/** Whether a whole DAY may be published: every non-empty side clears the floor. */
export function dayReleasable(day: DaySides, k: number = SUPPRESSION_K): boolean {
  return withheldSide(day, k) === null;
}

/** Which side of a day failed the floor, or null if the day may be published. */
export type WithheldSide = 'sale' | 'refund' | null;

/**
 * WHICH SIDE, as one exported answer, because two copies of this rule is how
 * round 14 finding 2 happened: the Dashboard gated per side with its own
 * inline `suppressBelowK` calls while the report composed days through
 * `daysReleasable`, and the two drifted. The caption and the gate now read the
 * same function, so a page cannot withhold for one reason and say another --
 * which is round 1B finding 7 -- and cannot publish what the report would
 * withhold.
 *
 * The sale side is reported first when both fail, because that is the one an
 * operator can act on: no sales means no trading, and a missing refund crowd
 * is a privacy floor rather than an operational fact.
 */
export function withheldSide(day: DaySides, k: number = SUPPRESSION_K): WithheldSide {
  if (!sideReleasable(day.saleShopIds, k)) return 'sale';
  if (!refundSideReleasable(day, k)) return 'refund';
  return null;
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
  // BOTH SIDES of every day, which is a change ROUND 3 FINDING 3 forced and
  // FOUNDER DECISION 1 made correct. This used to check only the refund side,
  // and the justification was explicit: per-pharmacy GROSS was published, so
  // gating the sale side here protected nothing while hiding a great deal.
  // Decision 1 removed per-pharmacy gross, so that justification is void --
  // and the asymmetry it left behind was a real hole, since `(1 seller, 5
  // refunders)` failed `dayReleasable` and passed `daysReleasable`, letting a
  // month be composed from a day that identifies its single seller.
  return days.every((day) => dayReleasable(day, k));
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
