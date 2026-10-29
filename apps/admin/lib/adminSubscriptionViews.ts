// Batch 3 §8.3 — the Subscriptions page's own views, pure.
//
// THREE THINGS LIVE HERE, and all three are statements about evidence rather
// than about intent:
//
//   1. the NEXT BILLING DATE, which is a different field for a trial, a paid
//      cycle and a grace period — and nothing at all for a canceled or expired
//      row, where a date would imply a charge that is not coming;
//   2. the RENEWAL HISTORY, read only from VERIFIED payment orders, because a
//      created or pending order is a renewal somebody started, not one that
//      happened;
//   3. the LIFECYCLE OVERRIDE NOTICE, which is a sentence and a gate number
//      rather than a disabled button, because `docs/playbook/05-admin.md:47`
//      supersedes the extend-trial / force-status design outright.
//
// WHAT IS NOT HERE, and must not be added: anything that grants or extends paid
// access. §8.3's rule is that no Batch 3 action creates or extends a paid
// entitlement without verified payment evidence, and this module cannot — it
// has no client, no write and no RPC. `adminGrants.test.ts` enforces the same
// thing structurally.

import { asPaisa, type Paisa } from '@muthoy/types';
import type { EntitlementRow, PaymentOrderRow, SubscriptionRow } from './adminViews';

/**
 * §8.3(i), in substance.
 *
 * Rendered as prose with its gate, NOT as a disabled control. A greyed-out
 * "Extend trial" button tells an operator the feature exists and that they
 * lack the permission; the truth is that the design was withdrawn and its
 * replacement needs a separately approved audited server API. Those are
 * different facts and only one of them is true.
 */
export const LIFECYCLE_OVERRIDE_UNAVAILABLE =
  'Trial extension and status override are not available, and are not built. The older '
  + 'manual extend-trial / force-status / direct-table-write design is superseded and '
  + 'unapproved: a trial derives from its original server grant and cannot be reset or '
  + 'extended through client retry, reinstall or login. Any future admin override requires '
  + 'a separately approved audited server API — that is gate E10. No control on this page '
  + 'writes to a subscription, an entitlement or a billing account.';

/**
 * The ENTITLEMENT statuses, in lifecycle order rather than alphabetical.
 *
 * ROUND 14 FINDING 7. This list was offered as the filter on BOTH the maps
 * page and the subscriptions page, and the two filter different columns:
 *
 *   - `/maps` filters `entitlement_snapshots.status`, which genuinely holds
 *     `trialing` — a trial is an entitlement, and the snapshot is the only
 *     record that carries its end date;
 *   - `/subscriptions` filters `billing_subscriptions.status`, whose CHECK is
 *     `('active','past_due','grace','canceled','expired')`. There is no
 *     `trialing` row for it to find, so the option returned zero rows and
 *     zero total — a filter that reads as "there are no trials".
 *
 * So this one keeps the six, for the entitlement-backed view, and the
 * subscriptions page uses `SUBSCRIPTION_STATUSES` — the five its own column
 * allows. The name says `FILTERS` rather than `STATUSES` for that reason.
 */
export const SUBSCRIPTION_STATUS_FILTERS = Object.freeze([
  'trialing',
  'active',
  'past_due',
  'grace',
  'canceled',
  'expired',
] as const);

/** The statuses for which NO next billing date exists. */
const TERMINAL_STATUSES: readonly string[] = ['canceled', 'expired'];

export type NextBillingBasis = 'paid_through' | 'trial_ends_at' | 'grace_ends_at' | 'none';

export interface NextBilling {
  /** The ISO timestamp, or null when nothing is scheduled. */
  on: string | null;
  /** WHICH field produced it, so the page can say which one. */
  basis: NextBillingBasis;
}

function present(value: string | null): string | null {
  return value !== null && value.length > 0 ? value : null;
}

/**
 * The next billing date, and the field it came from.
 *
 * THE BASIS IS RETURNED, not just the date. A date on its own invites the
 * reader to assume it is a charge date, and for a trial it is the day access
 * stops unless something is paid — a different thing to tell an operator. The
 * page prints both.
 *
 * A TERMINAL ROW HAS NO DATE, and gets `none` rather than falling back to
 * `paid_through`. `paid_through` on a canceled row is when access ran out, in
 * the past; showing it under "next billing" would read as an upcoming charge.
 *
 * THE TRIAL DATE COMES FROM THE ENTITLEMENT SNAPSHOT, because that is where
 * `trial_ends_at` lives — `billing_subscriptions` has no such column. A
 * trialing row with no snapshot therefore has no date, which is the truth: the
 * one record that would say when the trial ends is missing.
 */
export function nextBillingDate(
  subscription: SubscriptionRow,
  entitlement: EntitlementRow | null,
): NextBilling {
  if (TERMINAL_STATUSES.includes(subscription.status)) {
    return { on: null, basis: 'none' };
  }

  if (subscription.status === 'trialing') {
    const trialEnds = present(entitlement?.trialEndsAt ?? null);
    return trialEnds === null
      ? { on: null, basis: 'none' }
      : { on: trialEnds, basis: 'trial_ends_at' };
  }

  // past_due and grace: the grace end is what is actually running out, and it
  // is later than `paid_through` by construction. Falling through to
  // `paid_through` when no grace end is recorded is correct — that is then the
  // only date there is.
  if (subscription.status === 'past_due' || subscription.status === 'grace') {
    const graceEnds = present(subscription.graceEndsAt);
    if (graceEnds !== null) return { on: graceEnds, basis: 'grace_ends_at' };
  }

  const paidThrough = present(subscription.paidThrough);
  return paidThrough === null
    ? { on: null, basis: 'none' }
    : { on: paidThrough, basis: 'paid_through' };
}

// ───────────────────────────────────────────────────── the renewal history

export interface RenewalEntry {
  orderId: string;
  billingAccountId: string;
  /** Non-null by construction: an undated renewal is counted separately. */
  verifiedAt: string;
  amountPaisa: Paisa;
  tier: string;
  billingCycle: string;
}

export interface RenewalHistory {
  /** Dated, verified renewals per billing account, newest first. */
  byAccount: ReadonlyMap<string, readonly RenewalEntry[]>;
  /**
   * Orders marked verified that carry NO verification timestamp.
   *
   * Counted rather than dropped. §8.4 treats this as a billing exception, and
   * silently excluding them here would make the two pages disagree about how
   * many verified orders exist.
   */
  undatedVerified: number;
}

/**
 * Renewal history from VERIFIED payment orders, and nothing else.
 *
 * A `created` or `pending` order is a renewal somebody began; a `failed` or
 * `expired` one is a renewal that did not happen. Counting any of them as
 * history would show a pharmacy renewing on a day it did not pay — the kind of
 * error that reaches a founder as a number and never as a bug.
 */
export function renewalHistory(orders: readonly PaymentOrderRow[]): RenewalHistory {
  const byAccount = new Map<string, RenewalEntry[]>();
  let undatedVerified = 0;

  for (const order of orders) {
    if (order.status !== 'verified') continue;
    const verifiedAt = present(order.verifiedAt);
    if (verifiedAt === null) {
      undatedVerified += 1;
      continue;
    }
    const entry: RenewalEntry = {
      orderId: order.id,
      billingAccountId: order.billingAccountId,
      verifiedAt,
      amountPaisa: order.amountPaisa,
      tier: order.tier,
      billingCycle: order.billingCycle,
    };
    const held = byAccount.get(order.billingAccountId);
    if (held === undefined) byAccount.set(order.billingAccountId, [entry]);
    else held.push(entry);
  }

  for (const entries of byAccount.values()) {
    entries.sort((left, right) => right.verifiedAt.localeCompare(left.verifiedAt));
  }

  return { byAccount, undatedVerified };
}

// ─────────────────────────────────────────────── the page's own row shape

export interface SubscriptionDetailRow {
  id: string;
  billingAccountId: string;
  accountLabel: string;
  tier: string;
  billingCycle: string;
  status: string;
  /** The plan_offerings amount for this tier and cycle. NOT a charged amount. */
  billedAmountPaisa: Paisa;
  startsAt: string;
  paidThrough: string;
  graceEndsAt: string | null;
  canceledAt: string | null;
  entitlementStatus: string;
  nextBilling: NextBilling;
  /** How many verified, dated renewals this account has. */
  renewalCount: number;
  /** The most recent one, for the column. Null when there is none. */
  latestRenewal: RenewalEntry | null;
  provider: string;
}

export interface SubscriptionDetailInput {
  subscriptions: readonly SubscriptionRow[];
  entitlements: readonly EntitlementRow[];
  offerings: readonly { tier: string; billingCycle: string; amountPaisa: Paisa }[];
  /** Account id to a human label, usually the primary shop's name. */
  accountLabels: ReadonlyMap<string, string>;
  renewals: RenewalHistory;
}

const EMPTY_LABEL = '—';

/**
 * What a subscription whose tier/cycle matches no offering is billed.
 *
 * Zero rather than null: the column is a money figure and an absent price is
 * not an unknown price — no offering means nothing is priced, so nothing is
 * billed. lib/adminMetrics.ts's run rate excludes the same row from its total
 * and reports the exclusion, which is where that fact belongs.
 */
const ZERO_BILLED: Paisa = asPaisa(0);

/**
 * One row per subscription, with everything §8.3's columns need.
 *
 * Ordered by the NEXT BILLING DATE where one exists, soonest first, and rows
 * with no date last. A page whose first job is "what is due soon" should not
 * open on a canceled row from last March, and sorting by `paid_through`
 * descending — which the Batch 2 view did — put exactly that at the top.
 */
export function subscriptionDetailRows(
  input: SubscriptionDetailInput,
): readonly SubscriptionDetailRow[] {
  const entitlementByAccount = new Map(
    input.entitlements.map((entitlement) => [entitlement.billingAccountId, entitlement]),
  );
  const offeringAmounts = new Map(
    input.offerings.map((offering) => [
      offering.tier + ':' + offering.billingCycle,
      offering.amountPaisa,
    ]),
  );

  return input.subscriptions
    .map((subscription) => {
      const entitlement = entitlementByAccount.get(subscription.billingAccountId) ?? null;
      const accountRenewals = input.renewals.byAccount.get(subscription.billingAccountId) ?? [];
      return {
        id: subscription.id,
        billingAccountId: subscription.billingAccountId,
        accountLabel: input.accountLabels.get(subscription.billingAccountId) ?? EMPTY_LABEL,
        tier: subscription.tier,
        billingCycle: subscription.billingCycle,
        status: subscription.status,
        billedAmountPaisa:
          offeringAmounts.get(subscription.tier + ':' + subscription.billingCycle)
          ?? ZERO_BILLED,
        startsAt: subscription.startsAt,
        paidThrough: subscription.paidThrough,
        graceEndsAt: subscription.graceEndsAt,
        canceledAt: subscription.canceledAt,
        entitlementStatus: entitlement?.status ?? 'unknown',
        nextBilling: nextBillingDate(subscription, entitlement),
        renewalCount: accountRenewals.length,
        latestRenewal: accountRenewals[0] ?? null,
        provider: subscription.provider,
      };
    })
    .sort((left, right) => {
      // Rows with a date first, soonest first; undated rows after them, with a
      // stable id tiebreak so two identical dates cannot swap between renders.
      if (left.nextBilling.on === null && right.nextBilling.on === null) {
        return left.id.localeCompare(right.id);
      }
      if (left.nextBilling.on === null) return 1;
      if (right.nextBilling.on === null) return -1;
      const byDate = left.nextBilling.on.localeCompare(right.nextBilling.on);
      return byDate !== 0 ? byDate : left.id.localeCompare(right.id);
    });
}

/**
 * The rows billing within the horizon — §8.3's "upcoming expirations".
 *
 * Computed from the SAME `nextBilling` the column shows, so the summary and
 * the table cannot disagree. A date already past is not upcoming.
 */
export function upcomingExpirations(
  rows: readonly SubscriptionDetailRow[],
  nowMs: number,
  days: number,
): readonly SubscriptionDetailRow[] {
  const horizon = nowMs + days * 86_400_000;
  return rows.filter((row) => {
    if (row.nextBilling.on === null) return false;
    const at = Date.parse(row.nextBilling.on);
    return Number.isFinite(at) && at > nowMs && at <= horizon;
  });
}

/** How the page explains which field a date came from. */
export function nextBillingBasisLabel(basis: NextBillingBasis): string {
  switch (basis) {
    case 'paid_through':
      return 'end of the paid cycle';
    case 'trial_ends_at':
      return 'end of the trial';
    case 'grace_ends_at':
      return 'end of the grace period';
    default:
      return 'nothing scheduled';
  }
}
