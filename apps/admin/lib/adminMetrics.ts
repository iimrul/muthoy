// Batch 3 §5 — the three money figures, defined ONCE and kept apart.
//
// PURE. No Supabase client, no Next import, no clock of its own: every
// function takes the rows, and the ones that still judge a date take the
// instant explicitly. That is what makes them testable against a fixture
// carrying one row of every status, which is the only way to know they are
// right.
//
// THE ENTITLEMENT VERDICT IS NO LONGER DERIVED HERE. It used to be: a
// transcription of `b4_user_has_premium`
// (20260831000000_b4_commercial_platform.sql:261-272) that re-derived the
// status/date rule in TypeScript, with three exported predicates spelling out
// its branches. Migration 37 (E11) made every server-side decision
// additionally require the snapshot to AGREE with the `billing_subscriptions`
// row behind it, and no transcription can follow that: the evidence lives in
// another table.
//
// So the transcription is GONE. `entitlementCounts` takes
// `EntitlementVerdictRow`, carrying `b4_effective_tier`'s own answer, and it
// takes NO CLOCK at all — see the function for why that is the real fix.
//
// WHY A SEVENTH COPY WAS NOT WRITTEN INSTEAD. Codex round 34 reproduced what
// the transcription did: for an account the database treats as having no
// entitlement whatsoever, `entitlementCounts` answered
// `{trialing: 0, currentlyPaid: 1, entitled: 1}`. The defect was never the
// arithmetic — it was that a second definition of the rule existed at all, and
// so could drift from the first. There were SIX copies in SQL before migration
// 37 consolidated them into one, and this file held the seventh. Re-deriving
// the new two-table rule here would have made it the seventh again.
//
// WHAT IS STILL DEFINED HERE, deliberately: `isMrrEligible` and
// `isActiveSubscriptionNow`. Both read `billing_subscriptions` rows, not
// entitlement snapshots, and neither has a server-side counterpart to consume
// — MRR is an admin reporting concept the database has no opinion about, and
// it differs from entitlement by design (a canceled row is still entitled and
// will not recur). They are not copies of the tier rule; they are different
// questions asked of the evidence table itself.
// THE THREE FIGURES, and what each is NOT:
//
//   MRR                              a forward-looking RUN RATE. Not cash.
//   Collected subscription payments  cash Muthoy received. Not MRR.
//   Pharmacy sales (refund-net)      a PHARMACY's takings. Not Muthoy's revenue.
//
// §5.2's manifest at the bottom is what stops them being mislabelled: a money
// figure reaches a page only through a `Metric`, and a test asserts no
// pharmacy-sales label says revenue and no subscription label says sales.

import { addPaisa, asPaisa, type Paisa } from '@muthoy/types';
import { dhakaMonthLabel } from './adminDashboard';
import type {
  AccountRow,
  EntitlementVerdictRow,
  OfferingRow,
  PaymentOrderRow,
  SubscriptionRow,
} from './adminViews';

const ZERO: Paisa = asPaisa(0);
const PAID_TIERS: readonly string[] = ['pro', 'ultra'];
/** `b4_effective_tier`'s answer for an account with no entitlement. */
const FREE_TIER = 'free';
const TRIALING_STATUS = 'trialing';
const MONTHS_PER_YEAR = 12;

/**
 * A timestamp strictly after `nowMs`, by the same reading Postgres gives `>`.
 *
 * A null is NOT in the future. The SQL compares `e.paid_through > p_now`, and a
 * null comparison there yields NULL, which the `case` treats as not-true — so
 * null must be false here too, rather than "unbounded".
 */
function isAfter(timestamp: string | null, nowMs: number): boolean {
  if (timestamp === null) return false;
  const parsed = Date.parse(timestamp);
  // An unparseable timestamp is not a future one. Returning true would grant
  // entitlement on malformed data, which is the wrong direction to fail.
  return Number.isFinite(parsed) && parsed > nowMs;
}

// ───────────────────────────────────────────────────────────────── predicates

/**
 * The MRR predicate: the paid predicate MINUS `canceled`.
 *
 * MRR is forward-looking, and a cancellation will not recur. The row is still
 * entitled until `paid_through` — which is why it counts towards *currently
 * paid entitlements* and not towards the run rate. One predicate for both would
 * have made one of the two figures wrong.
 */
export function isMrrEligible(
  row: Pick<SubscriptionRow, 'tier' | 'status' | 'paidThrough' | 'graceEndsAt'>,
  nowMs: number,
): boolean {
  if (!PAID_TIERS.includes(row.tier)) return false;
  if (row.status === 'active' && isAfter(row.paidThrough, nowMs)) return true;
  return ['active', 'past_due', 'grace'].includes(row.status) && isAfter(row.graceEndsAt, nowMs);
}

/**
 * §5.1c's "active subscriptions": a subscription ROW that is active and whose
 * period has not ended.
 *
 * GATE 5 FINDING 11. The Dashboard counted `status === 'active'` literally, so a
 * row left at `active` with `paid_through` in the past was reported as active
 * indefinitely — a stale row presented as a live customer.
 *
 * Deliberately NOT `isMrrEligible` and NOT `currentlyPaid`:
 *
 *   - `isMrrEligible` additionally requires a PAID TIER, because a run rate
 *     needs a price. A `free`-tier active subscription is still a real active
 *     subscription and belongs in this count;
 *   - `currentlyPaid` is counted over ENTITLEMENT SNAPSHOTS, which is what a
 *     device honours. Keeping the two apart is the point of showing both: a
 *     subscription row and the entitlement derived from it can disagree, and
 *     that disagreement is worth seeing.
 *
 * The time conditions are the canonical ones, in the same shape
 * `b4_user_has_premium` uses: either the paid period or the grace period must
 * still be running.
 */
export function isActiveSubscriptionNow(
  row: Pick<SubscriptionRow, 'status' | 'paidThrough' | 'graceEndsAt'>,
  nowMs: number,
): boolean {
  if (row.status !== 'active') return false;
  return isAfter(row.paidThrough, nowMs) || isAfter(row.graceEndsAt, nowMs);
}

// ───────────────────────────────────────────────────────────────── MRR

function isLater(candidate: SubscriptionRow, held: SubscriptionRow): boolean {
  if (candidate.startsAt !== held.startsAt) return candidate.startsAt > held.startsAt;
  if (candidate.createdAt !== held.createdAt) return candidate.createdAt > held.createdAt;
  return candidate.id > held.id;
}

/**
 * One subscription per account: the CURRENT one.
 *
 * An account with historical rows must be counted once, so the rows are reduced
 * before anything is summed. "Current" is the latest `startsAt`, tie-broken by
 * `createdAt` and then by `id` — a total order, so the result does not depend
 * on the order PostgREST happened to return them in.
 */
export function currentSubscriptionPerAccount(
  rows: readonly SubscriptionRow[],
): readonly SubscriptionRow[] {
  const byAccount = new Map<string, SubscriptionRow>();
  for (const row of rows) {
    const held = byAccount.get(row.billingAccountId);
    if (held === undefined || isLater(row, held)) byAccount.set(row.billingAccountId, row);
  }
  return [...byAccount.values()];
}

/**
 * What one subscription contributes to the monthly run rate.
 *
 * The offering is matched on the subscription's OWN tier and cycle, with
 * `is_active` IGNORED: a grandfathered price is still the price that account
 * pays, and skipping it would under-report the run rate every time a plan is
 * retired. An annual plan contributes `floor(amount / 12)`; the residue is
 * never redistributed, and the page says the annual contribution is floored.
 *
 * Returns null when no offering matches, so the caller can report the gap
 * instead of silently counting the subscription as zero.
 */
export function monthlyContributionPaisa(
  subscription: Pick<SubscriptionRow, 'tier' | 'billingCycle'>,
  offerings: readonly OfferingRow[],
): Paisa | null {
  const offering = offerings.find(
    (candidate) => candidate.tier === subscription.tier
      && candidate.billingCycle === subscription.billingCycle,
  );
  if (offering === undefined) return null;
  if (subscription.billingCycle === 'annual') {
    return asPaisa(Math.floor(offering.amountPaisa / MONTHS_PER_YEAR));
  }
  return offering.amountPaisa;
}

export interface MrrBreakdown {
  totalPaisa: Paisa;
  /** How many subscriptions contributed. */
  countedSubscriptions: number;
  /** Subscriptions that qualified but matched no offering, so contributed nothing. */
  unpricedSubscriptions: number;
  /** Per tier, so a page can show the split without recomputing the predicate. */
  byTierPaisa: Readonly<Record<string, Paisa>>;
}

export function monthlyRecurringRevenue(input: {
  subscriptions: readonly SubscriptionRow[];
  offerings: readonly OfferingRow[];
  nowMs: number;
}): MrrBreakdown {
  const current = currentSubscriptionPerAccount(input.subscriptions)
    .filter((row) => isMrrEligible(row, input.nowMs));

  let total: Paisa = ZERO;
  let counted = 0;
  let unpriced = 0;
  const byTier = new Map<string, Paisa>();

  for (const row of current) {
    const contribution = monthlyContributionPaisa(row, input.offerings);
    if (contribution === null) {
      unpriced += 1;
      continue;
    }
    total = addPaisa(total, contribution);
    counted += 1;
    byTier.set(row.tier, addPaisa(byTier.get(row.tier) ?? ZERO, contribution));
  }

  return {
    totalPaisa: total,
    countedSubscriptions: counted,
    unpricedSubscriptions: unpriced,
    byTierPaisa: Object.freeze(Object.fromEntries(byTier)),
  };
}

// ───────────────────────────────────────────────────────── collected payments

/**
 * Cash Muthoy actually received: verified payment orders.
 *
 * This is NOT MRR and the page that renders it says so. §8.4 reports the MRR
 * trend as BLOCKED (gate E12) precisely because this series is the only
 * historical money evidence that exists, and it is collected cash rather than
 * run rate.
 */
export function collectedSubscriptionPaymentsPaisa(orders: readonly PaymentOrderRow[]): Paisa {
  let total: Paisa = ZERO;
  for (const order of orders) {
    if (order.status !== 'verified') continue;
    total = addPaisa(total, order.amountPaisa);
  }
  return total;
}

/**
 * The same cash, bucketed by the DHAKA calendar month of `verified_at`.
 *
 * ROUND 11 FINDING 8. This sliced the ISO string, which is the UTC month, so
 * five payments verified at `2026-09-30T20:00:00Z` — October 1 in Dhaka — were
 * filed under `2026-09`, and an October report exported `2026-09,500.00,5`.
 * Every other period in this product is the Dhaka business day; a monthly
 * money figure on a different calendar is money in the wrong month.
 */
export function collectedPaymentsByMonth(
  orders: readonly PaymentOrderRow[],
): readonly { month: string; totalPaisa: Paisa; orderCount: number }[] {
  const buckets = new Map<string, { totalPaisa: Paisa; orderCount: number }>();
  for (const order of orders) {
    if (order.status !== 'verified' || order.verifiedAt === null) continue;
    const month = dhakaMonthLabel(order.verifiedAt);
    if (month === null || !/^\d{4}-\d{2}$/.test(month)) continue;
    const held = buckets.get(month) ?? { totalPaisa: ZERO, orderCount: 0 };
    buckets.set(month, {
      totalPaisa: addPaisa(held.totalPaisa, order.amountPaisa),
      orderCount: held.orderCount + 1,
    });
  }
  return [...buckets.entries()]
    .map(([month, bucket]) => ({ month, ...bucket }))
    .sort((left, right) => left.month.localeCompare(right.month));
}

// ───────────────────────────────────────────────────────────────── counts

/** Accounts holding at least one verified payment order, ever. */
export function accountsEverPaid(orders: readonly PaymentOrderRow[]): number {
  const accounts = new Set<string>();
  for (const order of orders) {
    if (order.status === 'verified') accounts.add(order.billingAccountId);
  }
  return accounts.size;
}

export interface ConversionRatio {
  /** Accounts granted a launch trial. */
  denominator: number;
  /** Of those, the ones that later paid. */
  numerator: number;
  /** null when nobody was ever granted a trial — NOT zero. */
  ratio: number | null;
  /**
   * The accounts behind the figure, so the caller can apply §8.5's floor.
   *
   * GATE 5 DELTA FINDING 2. This returned only finished numbers, and the page
   * rendered them ungated: one trialed account published "100.0%" and "1 of
   * 1", which is that account's payment activity. A ratio is as identifying as
   * a total when the denominator is one. Ids rather than a count, for the same
   * reason as Aggregate's: a count the caller computes itself can be computed
   * wrongly.
   */
  accountIds: readonly string[];
}

/**
 * Trial-to-paid conversion.
 *
 * `ratio` is null rather than 0 for an empty denominator: on a fresh platform
 * "0% converted" reads as a failure, and "no trials granted yet" is the truth.
 */
export function trialToPaidConversion(input: {
  accounts: readonly AccountRow[];
  orders: readonly PaymentOrderRow[];
}): ConversionRatio {
  const trialed = input.accounts.filter((account) => account.launchTrialGrantedAt !== null);
  const paid = new Set<string>();
  for (const order of input.orders) {
    if (order.status === 'verified') paid.add(order.billingAccountId);
  }
  const numerator = trialed.filter((account) => paid.has(account.id)).length;
  return {
    denominator: trialed.length,
    numerator,
    ratio: trialed.length === 0 ? null : numerator / trialed.length,
    accountIds: trialed.map((account) => account.id),
  };
}

/**
 * Subscriptions with `canceled_at` inside the period.
 *
 * THIS IS NOT A CHURN TREND AND IS NOT LABELLED ONE. A renewal updates the same
 * `billing_subscriptions` row and clears `canceled_at` (20260831000000:704), so
 * historical churn is not recoverable from current state. An immutable
 * lifecycle-event table is gate E12.
 */
export function recordedCancellations(
  rows: readonly SubscriptionRow[],
  period: { fromMs: number; toMs: number },
): number {
  return rows.filter((row) => {
    if (row.canceledAt === null) return false;
    const at = Date.parse(row.canceledAt);
    return Number.isFinite(at) && at >= period.fromMs && at <= period.toMs;
  }).length;
}

/** Reported SEPARATELY from cancellations, because it is a different event. */
export function expiredWithoutCancellation(
  rows: readonly SubscriptionRow[],
  nowMs: number,
): number {
  return rows.filter((row) => {
    if (row.canceledAt !== null) return false;
    const paidThrough = Date.parse(row.paidThrough);
    return Number.isFinite(paidThrough) && paidThrough < nowMs;
  }).length;
}

export interface EntitlementCounts {
  trialing: number;
  currentlyPaid: number;
  /** Trialing plus currently paid: every account the SERVER treats as entitled. */
  entitled: number;
}

/**
 * The three entitlement figures, counted off the server's verdict.
 *
 * NOTE THE SIGNATURE: no `nowMs`. There is nothing to compare a clock
 * against, because `b4_effective_tier` already consumed every date the
 * decision depends on — at the one instant the rest of the page is built for
 * (adminPlatformQueries.ts passes it as `p_now`). A function that cannot see a
 * date cannot drift from the rule that reads them.
 *
 * `effectiveTier` is `'free'` for an account with no entitlement, with an
 * expired one, OR with a live-looking snapshot that no `billing_subscriptions`
 * row and no trial grant backs. Those are one answer here precisely because
 * they are one answer in the database.
 *
 * THE SPLIT IS A LABEL, NOT A SECOND JUDGEMENT. `b4_effective_tier` answers
 * `'ultra'` for a live trial and the plan's tier for a live paid plan, so the
 * tier alone cannot say which. The snapshot's `status` separates them, and the
 * two branches are provably disjoint: read the CASE at migration 37, the
 * `trialing` arm is the only one a `status = 'trialing'` row can reach, and no
 * other status can reach it. So the total is added rather than re-counted —
 * which the previous version could not do, its branches not being disjoint.
 */
export function entitlementCounts(
  rows: readonly EntitlementVerdictRow[],
): EntitlementCounts {
  let trialing = 0;
  let currentlyPaid = 0;
  for (const row of rows) {
    if (row.effectiveTier === FREE_TIER) continue;
    if (row.status === TRIALING_STATUS) trialing += 1;
    else currentlyPaid += 1;
  }
  return { trialing, currentlyPaid, entitled: trialing + currentlyPaid };
}

// ───────────────────────────────────────────────────────── the label guard

/**
 * §5.2. Every money figure reaches a page through one of these, and nothing
 * else. A bare number with a hand-written caption is exactly how a pharmacy's
 * takings get labelled "revenue".
 */
export interface Metric {
  id: string;
  label: string;
  /**
   * Which of the three families this figure belongs to. The families are what
   * the label test checks against, so a mislabelling fails the suite rather
   * than reaching a founder.
   */
  family: 'subscription' | 'pharmacy_sales' | 'count';
  unit: 'paisa' | 'count' | 'ratio';
  /** A heading in docs/plans/admin-metric-definitions.md. */
  definitionRef: string;
}

function metric(entry: Metric): Metric {
  return Object.freeze(entry);
}

/**
 * The manifest. Grouped by family so a reviewer reads the three apart, which is
 * the whole point of §5.
 */
export const ADMIN_METRICS: readonly Metric[] = Object.freeze([
  // ── subscription: Muthoy's own money ──────────────────────────────────────
  metric({
    id: 'mrr',
    label: 'Monthly recurring run rate',
    family: 'subscription',
    unit: 'paisa',
    definitionRef: 'MRR',
  }),
  metric({
    id: 'collected_subscription_payments',
    label: 'Collected subscription payments',
    family: 'subscription',
    unit: 'paisa',
    definitionRef: 'Collected subscription payments',
  }),
  metric({
    id: 'collected_subscription_payments_trend',
    label: 'Collected subscription payments, by month',
    family: 'subscription',
    unit: 'paisa',
    definitionRef: 'Collected subscription payments',
  }),
  // ── pharmacy_sales: somebody ELSE's money ─────────────────────────────────
  metric({
    id: 'pharmacy_sales_net',
    label: 'Pharmacy sales, net of refunds',
    family: 'pharmacy_sales',
    unit: 'paisa',
    definitionRef: 'Pharmacy sales (refund-net)',
  }),
  metric({
    id: 'pharmacy_sales_net_today',
    label: 'Pharmacy sales today, net of refunds',
    family: 'pharmacy_sales',
    unit: 'paisa',
    definitionRef: 'Pharmacy sales (refund-net)',
  }),
  // ── count: everything that is not money ───────────────────────────────────
  metric({
    id: 'registered_pharmacies',
    label: 'Registered pharmacies',
    family: 'count',
    unit: 'count',
    definitionRef: 'Counts, named for what they measure',
  }),
  metric({
    id: 'active_pharmacies_today',
    label: 'Pharmacies active today',
    family: 'count',
    unit: 'count',
    definitionRef: 'Counts, named for what they measure',
  }),
  metric({
    id: 'active_subscriptions',
    label: 'Active subscriptions',
    family: 'count',
    unit: 'count',
    definitionRef: 'Counts, named for what they measure',
  }),
  metric({
    id: 'trial_subscriptions',
    label: 'Trial subscriptions',
    family: 'count',
    unit: 'count',
    definitionRef: 'Counts, named for what they measure',
  }),
  metric({
    id: 'accounts_ever_paid',
    label: 'Accounts that have ever paid',
    family: 'count',
    unit: 'count',
    definitionRef: 'Counts, named for what they measure',
  }),
  metric({
    id: 'currently_paid_entitlements',
    label: 'Currently paid entitlements',
    family: 'count',
    unit: 'count',
    definitionRef: 'Currently paid entitlements',
  }),
  metric({
    id: 'trial_to_paid_conversion',
    label: 'Trial to paid conversion',
    family: 'count',
    unit: 'ratio',
    definitionRef: 'Counts, named for what they measure',
  }),
  metric({
    id: 'recorded_cancellations',
    label: 'Recorded cancellations',
    family: 'count',
    unit: 'count',
    definitionRef: 'Recorded cancellations',
  }),
  metric({
    id: 'expired_without_cancellation',
    label: 'Expired without cancellation',
    family: 'count',
    unit: 'count',
    definitionRef: 'Recorded cancellations',
  }),
]);

export function metricById(id: string): Metric | undefined {
  return ADMIN_METRICS.find((candidate) => candidate.id === id);
}

/**
 * The accessor every page uses. It THROWS on an unknown id rather than
 * returning undefined: a page rendering a figure with no manifest entry is the
 * exact situation §5.2 exists to prevent, and a silent undefined would render
 * as an empty caption beside a real number.
 */
export function requireMetric(id: string): Metric {
  const found = metricById(id);
  if (found === undefined) {
    throw new Error('No metric is declared for id: ' + id);
  }
  return found;
}

/**
 * The two ids a net figure may be rendered under.
 *
 * GATE 5 ROUND 10: `NetSalesCard` takes one of these rather than a `Metric`
 * object, because an object prop is an indirect caption prop -- a spread kept
 * the family and replaced the label, putting an authentic net figure under a
 * subscription caption. A literal union cannot carry a label at all.
 *
 * Asserted against the manifest in adminMetrics.test.ts, so this list cannot
 * drift from the `pharmacy_sales` family it claims to describe.
 */
export const NET_SALES_METRIC_IDS = Object.freeze([
  'pharmacy_sales_net',
  'pharmacy_sales_net_today',
] as const);

export type NetSalesMetricId = (typeof NET_SALES_METRIC_IDS)[number];

/**
 * A manifest entry narrowed to the PHARMACY-TAKINGS family.
 *
 * §6i: `NetSalesCard` accepts only this type, so the net renderer cannot be
 * pointed at a subscription or count metric and a pharmacy figure cannot be
 * captioned as Muthoy's own money. It throws on the wrong family for the same
 * reason `requireMetric` throws on an unknown id -- the alternative is a real
 * number under a caption from the wrong family, which is the mislabelling
 * §5.2 exists to prevent.
 */
export function requirePharmacySalesMetric(id: string): Metric & { family: 'pharmacy_sales' } {
  const found = requireMetric(id);
  if (found.family !== 'pharmacy_sales') {
    throw new Error(
      'Metric ' + id + ' is in the ' + found.family + ' family, not pharmacy_sales',
    );
  }
  return found as Metric & { family: 'pharmacy_sales' };
}
