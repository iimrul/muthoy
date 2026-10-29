// Batch 3 §8.1 — the Dashboard's figures and its five alert classes, computed.
//
// PURE, and deliberately so. Every function here takes rows and an instant and
// returns a number or a list; nothing reads the clock, nothing reaches a
// database, and nothing formats. That is what makes "pharmacies active today"
// testable against a fixture rather than against a live platform.
//
// NOT ONE HARDCODED STATISTIC. §8 forbids them outright, and the dashboard is
// where a placeholder would survive longest, because a plausible number on a
// KPI card looks exactly like a real one. Every figure below is derived from a
// row that was read.
//
// THE FIVE ALERT CLASSES ARE THE FIVE §8.1 NAMES, and the list is frozen so a
// sixth cannot be bolted on without the manifest test seeing it. Each alert
// carries its own `href`, because an alert an operator cannot act on is a
// decoration.

import type {
  EntitlementRow,
  PaymentOrderRow,
  ProviderEventRow,
  ShopRow,
  SubscriptionRow,
} from './adminViews';
import { isStaleOpenOrder } from './adminViews';

/** §8.1's "expiring within seven days". */
export const EXPIRY_HORIZON_DAYS = 7;

/**
 * How long a freshly registered shop is allowed to have no billing account.
 *
 * A shop and its billing account are created by two different writes, so a
 * shop read moments after registration legitimately has a null
 * `billing_account_id`. Alerting on that would make the dashboard cry wolf on
 * every signup. 24 hours is the bootstrap window §8.1 names.
 */
export const BILLING_BOOTSTRAP_HOURS = 24;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The statuses that mean "paid access is at risk right now". */
const AT_RISK_STATUSES: readonly string[] = ['past_due', 'grace'];

/** The subscription statuses that can still expire, so a horizon applies. */
const EXPIRABLE_STATUSES: readonly string[] = ['active', 'trialing', 'past_due', 'grace'];

function instant(value: string | null): number | null {
  if (value === null || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// ──────────────────────────────────────────────────────────── the five alerts

export const DASHBOARD_ALERT_IDS = Object.freeze([
  'subscriptions_expiring_soon',
  'accounts_at_risk',
  'shops_without_billing_account',
  'stale_open_payment_orders',
  'rejected_provider_events',
] as const);

export type DashboardAlertId = (typeof DASHBOARD_ALERT_IDS)[number];

export interface DashboardAlert {
  id: DashboardAlertId;
  /** What the operator is being told, in words that name the condition. */
  label: string;
  count: number;
  /** What to read next. Null only where no page shows the rows. */
  href: string | null;
  /** Why this is an alert and not merely a number. */
  detail: string;
}

/**
 * Subscriptions whose paid or trial period ends within the horizon.
 *
 * `paid_through` for anything paid, `grace_ends_at` where a grace period is
 * what is actually running out. A row already past its end is NOT counted:
 * that has expired, which is a different fact from "expiring soon", and
 * conflating them would make the alert never clear.
 */
export function expiringWithinDays(
  subscriptions: readonly SubscriptionRow[],
  nowMs: number,
  days: number = EXPIRY_HORIZON_DAYS,
): number {
  const horizon = nowMs + days * DAY_MS;
  return subscriptions.filter((subscription) => {
    if (!EXPIRABLE_STATUSES.includes(subscription.status)) return false;
    const endsAt = instant(subscription.graceEndsAt) ?? instant(subscription.paidThrough);
    return endsAt !== null && endsAt > nowMs && endsAt <= horizon;
  }).length;
}

/** Entitlements in `past_due` or `grace` — access is at risk, not yet gone. */
export function accountsAtRisk(entitlements: readonly EntitlementRow[]): number {
  return entitlements.filter((entitlement) => AT_RISK_STATUSES.includes(entitlement.status))
    .length;
}

/**
 * Shops with no billing account, registered longer ago than the bootstrap
 * window.
 *
 * A shop whose `created_at` cannot be parsed is COUNTED, not skipped: an
 * unreadable timestamp on a row with no billing account is itself something an
 * operator should look at, and skipping it would hide the worse case.
 */
export function shopsWithoutBillingAccount(
  shops: readonly ShopRow[],
  nowMs: number,
  bootstrapHours: number = BILLING_BOOTSTRAP_HOURS,
): number {
  const cutoff = nowMs - bootstrapHours * HOUR_MS;
  return shops.filter((shop) => {
    if (shop.billingAccountId !== null) return false;
    const createdAt = instant(shop.createdAt);
    return createdAt === null || createdAt <= cutoff;
  }).length;
}

/** Orders still open and already past `expires_at`, by the shared predicate. */
export function staleOpenPaymentOrders(
  orders: readonly PaymentOrderRow[],
  nowMs: number,
): number {
  return orders.filter((order) => isStaleOpenOrder(order, nowMs)).length;
}

/** Provider events the webhook refused. */
export function rejectedProviderEvents(events: readonly ProviderEventRow[]): number {
  return events.filter((event) => event.processingStatus === 'rejected').length;
}

export interface AlertInput {
  shops: readonly ShopRow[];
  subscriptions: readonly SubscriptionRow[];
  entitlements: readonly EntitlementRow[];
  orders: readonly PaymentOrderRow[];
  events: readonly ProviderEventRow[];
}

/**
 * All five classes, always all five.
 *
 * A zero is RETURNED rather than omitted, so the page can state "0 stale
 * payment orders" as a checked fact. An absent row would read as an unchecked
 * one, and on an operational dashboard those are opposites.
 */
export function dashboardAlerts(input: AlertInput, nowMs: number): readonly DashboardAlert[] {
  return Object.freeze([
    {
      id: 'subscriptions_expiring_soon' as const,
      label: 'Subscriptions expiring within ' + EXPIRY_HORIZON_DAYS + ' days',
      count: expiringWithinDays(input.subscriptions, nowMs),
      href: '/subscriptions',
      detail:
        'Counted from the running period end — grace where a grace period is what expires, '
        + 'otherwise the paid-through date. A period that has already ended is expired, not '
        + 'expiring, and is not counted here.',
    },
    {
      id: 'accounts_at_risk' as const,
      label: 'Accounts past due or in grace',
      count: accountsAtRisk(input.entitlements),
      href: '/subscriptions',
      detail: 'Entitlement status, which is what the device actually honours.',
    },
    {
      id: 'shops_without_billing_account' as const,
      label: 'Pharmacies with no billing account',
      count: shopsWithoutBillingAccount(input.shops, nowMs),
      href: '/pharmacies',
      detail:
        'Only past the ' + BILLING_BOOTSTRAP_HOURS + '-hour bootstrap window, because a shop '
        + 'and its billing account are two separate writes and a fresh signup is briefly '
        + 'expected to have neither.',
    },
    {
      id: 'stale_open_payment_orders' as const,
      label: 'Payment orders open past expiry',
      count: staleOpenPaymentOrders(input.orders, nowMs),
      href: '/payments',
      detail:
        'Created or pending, and already past expires_at. The bounded expire action on the '
        + 'order view re-checks both conditions in its own update guard.',
    },
    {
      id: 'rejected_provider_events' as const,
      label: 'Provider events rejected',
      count: rejectedProviderEvents(input.events),
      href: '/payments',
      detail: 'A webhook the server refused. Each one is a payment signal that was not applied.',
    },
  ]);
}

// ──────────────────────────────────────────────── the subscription breakdown

/** The six statuses §8.3 enumerates, so a zero is stated rather than absent. */
export const SUBSCRIPTION_STATUSES = Object.freeze([
  'trialing',
  'active',
  'past_due',
  'grace',
  'canceled',
  'expired',
] as const);

export interface DistributionBucket {
  key: string;
  count: number;
}

/**
 * Subscriptions per status, every declared status present.
 *
 * A status the data holds but the list does not is appended rather than
 * dropped — the page's job is to report what is there, and a status nobody
 * declared is precisely the thing worth seeing.
 */
export function subscriptionDistribution(
  subscriptions: readonly SubscriptionRow[],
): readonly DistributionBucket[] {
  const counts = new Map<string, number>();
  for (const status of SUBSCRIPTION_STATUSES) counts.set(status, 0);
  for (const subscription of subscriptions) {
    counts.set(subscription.status, (counts.get(subscription.status) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

/** Subscriptions per plan tier, declared tiers first. */
export function tierDistribution(
  subscriptions: readonly SubscriptionRow[],
): readonly DistributionBucket[] {
  const counts = new Map<string, number>();
  for (const tier of ['free', 'pro', 'ultra']) counts.set(tier, 0);
  for (const subscription of subscriptions) {
    counts.set(subscription.tier, (counts.get(subscription.tier) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

// ──────────────────────────────────────────────────────────── the 30-day axis

/** §8.1's trend window. */
export const TREND_DAYS = 30;

const DHAKA_OFFSET_MS = 6 * 60 * 60_000;

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The Dhaka calendar day a UTC instant falls on, as `YYYY-MM-DD`.
 *
 * The SAME fixed-offset arithmetic lib/platformStats.ts uses, and for the same
 * reason: Bangladesh has no DST, the server runs in UTC, and a naive UTC day
 * boundary rolls over at 6am Dhaka — so six hours of every day would be filed
 * under the wrong date. Returns null for an unparseable timestamp rather than
 * a plausible-looking wrong day.
 */
export function dhakaDayLabel(isoTimestamp: string): string | null {
  const parsed = Date.parse(isoTimestamp);
  if (!Number.isFinite(parsed)) return null;
  const shifted = new Date(parsed + DHAKA_OFFSET_MS);
  return (
    shifted.getUTCFullYear()
    + '-'
    + padTwo(shifted.getUTCMonth() + 1)
    + '-'
    + padTwo(shifted.getUTCDate())
  );
}

/**
 * TODAY's Dhaka business date.
 *
 * ROUND 14's relaxation of the sub-period rule needs to know which day's money
 * is published elsewhere, and exactly one is: today's net, on the Dashboard.
 * Injectable so the rule is testable at a fixed date rather than against
 * whatever day the suite happens to run on.
 */
export function dhakaTodayLabel(nowMs: number = Date.now()): string {
  return dhakaDayLabel(new Date(nowMs).toISOString()) ?? '';
}

/**
 * The Dhaka calendar MONTH a UTC instant falls in, as `YYYY-MM`.
 *
 * ROUND 11 FINDING 8. Two places sliced the ISO string — `collectedPaymentsByMonth`
 * for the totals, and the report's own contributor grouping — so both used the
 * UTC month. Five payments verified at `2026-09-30T20:00:00Z` belong to October 1
 * in Dhaka, and an October report exported them as `2026-09,500.00,5`: money
 * filed in the wrong reporting month, and a contributor set that could drift
 * into a different month from the total it was gating.
 *
 * Derived from `dhakaDayLabel` rather than repeating the offset arithmetic, so
 * the month a figure lands in can never disagree with the day it lands on.
 */
export function dhakaMonthLabel(isoTimestamp: string): string | null {
  return dhakaDayLabel(isoTimestamp)?.slice(0, 7) ?? null;
}

/**
 * The Dhaka days of the trend window, oldest first, as `YYYY-MM-DD`.
 *
 * Stepped back from Dhaka noon on the anchor day, so a whole-day subtraction
 * can never land either side of a midnight boundary. The labels are produced
 * by the same function that files a row, so an axis label and a row's day
 * cannot disagree about what day it is.
 */
export function trendDays(todayDhaka: string, days: number = TREND_DAYS): readonly string[] {
  const anchor = Date.parse(todayDhaka + 'T12:00:00+06:00');
  if (!Number.isFinite(anchor)) return [];
  const out: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const label = dhakaDayLabel(new Date(anchor - offset * DAY_MS).toISOString());
    if (label !== null) out.push(label);
  }
  return out;
}

export interface DayBucket {
  day: string;
  shopIds: readonly string[];
}

/**
 * Aligns a sparse per-day series onto the full window.
 *
 * A day with no rows becomes an EMPTY bucket rather than being skipped, so the
 * trend has one point per day and a quiet Friday is visibly quiet instead of
 * invisible.
 */
export function alignToWindow(
  buckets: readonly DayBucket[],
  days: readonly string[],
): readonly DayBucket[] {
  const byDay = new Map(buckets.map((bucket) => [bucket.day, bucket.shopIds]));
  return days.map((day) => ({ day, shopIds: byDay.get(day) ?? [] }));
}

/** Distinct shops in a bucket. The count a registration point renders. */
export function distinctShopCount(bucket: DayBucket): number {
  return new Set(bucket.shopIds).size;
}
