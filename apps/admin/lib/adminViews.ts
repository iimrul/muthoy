// W4-07 — pure shaping for the management pages.
//
// Same split platformStats.ts/queries.ts already established in this app: the
// row types, the joins and the labels live here, framework-free and unit
// tested; lib/adminQueries.ts does the reading. Nothing here imports Next,
// React or Supabase, so nothing here can reach the service-role key.
//
// LABELS, deliberately: the ledger's interim safety boundary 1 binds this
// batch — the dashboard reports GROSS sales and must not be described as net
// revenue anywhere. So the figures below are "billed amount" and "order
// amount", never revenue, MRR or net. lib/adminLabels.test.ts enforces that
// mechanically rather than trusting anyone to remember it.

import { ZERO_PAISA, addPaisa, asPaisa, type Paisa } from '@muthoy/types';

const EMPTY_VALUE = '—';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Every drill-down route parameter goes through this before it reaches a query.
 * A route param is client input: it decides WHICH shop or account a
 * service-role read returns, so a malformed one must stop at the page rather
 * than becoming a filter.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export type EntitlementTier = 'free' | 'pro' | 'ultra';
export type EntitlementStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'grace'
  | 'canceled'
  | 'expired';

export interface EntitlementRow {
  billingAccountId: string;
  tier: string;
  status: string;
  trialEndsAt: string | null;
  paidThrough: string | null;
  graceEndsAt: string | null;
  verifiedAt: string;
}

export interface AccountRow {
  id: string;
  principalOwnerUserId: string;
  primaryShopId: string;
  launchTrialGrantedAt: string | null;
  createdAt: string;
}

export interface ShopRow {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  plan: string;
  commercialStatus: string;
  commercialReason: string | null;
  archivedAt: string | null;
  billingAccountId: string | null;
}

export interface MembershipRow {
  id: string;
  billingAccountId: string;
  shopId: string;
  principalUserId: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export interface SubscriptionRow {
  id: string;
  billingAccountId: string;
  tier: string;
  billingCycle: string;
  status: string;
  startsAt: string;
  paidThrough: string;
  graceEndsAt: string | null;
  canceledAt: string | null;
  provider: string;
  createdAt: string;
}

export interface PaymentOrderRow {
  id: string;
  billingAccountId: string;
  tier: string;
  billingCycle: string;
  amountPaisa: Paisa;
  status: string;
  provider: string;
  failureCode: string | null;
  expiresAt: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface ProviderEventRow {
  id: string;
  paymentOrderId: string | null;
  processingStatus: string;
  errorCode: string | null;
  receivedAt: string;
}

export interface OfferingRow {
  tier: string;
  billingCycle: string;
  amountPaisa: Paisa;
  isActive: boolean;
}

// ---------------------------------------------------------------- joins

export interface AccountSummary {
  id: string;
  primaryShopId: string;
  primaryShopName: string;
  shopCount: number;
  activeMemberCount: number;
  tier: string;
  status: string;
  /** Whichever of paid_through / grace_ends_at / trial_ends_at applies, or null. */
  accessEndsAt: string | null;
  createdAt: string;
}

/** The access end an entitlement implies, without re-deriving entitlement rules. */
export function accessEndsAt(entitlement: EntitlementRow | undefined): string | null {
  if (!entitlement) return null;
  if (entitlement.status === 'trialing') return entitlement.trialEndsAt;
  return entitlement.graceEndsAt ?? entitlement.paidThrough ?? null;
}

export function summarizeAccounts(input: {
  accounts: readonly AccountRow[];
  shops: readonly ShopRow[];
  memberships: readonly MembershipRow[];
  entitlements: readonly EntitlementRow[];
}): AccountSummary[] {
  const shopsById = new Map(input.shops.map((shop) => [shop.id, shop]));
  const entitlementByAccount = new Map(
    input.entitlements.map((entitlement) => [entitlement.billingAccountId, entitlement]),
  );

  const shopCounts = new Map<string, number>();
  for (const shop of input.shops) {
    if (shop.billingAccountId === null) continue;
    shopCounts.set(shop.billingAccountId, (shopCounts.get(shop.billingAccountId) ?? 0) + 1);
  }

  const memberCounts = new Map<string, number>();
  for (const membership of input.memberships) {
    if (!membership.isActive) continue;
    memberCounts.set(
      membership.billingAccountId,
      (memberCounts.get(membership.billingAccountId) ?? 0) + 1,
    );
  }

  return input.accounts
    .map((account) => {
      const entitlement = entitlementByAccount.get(account.id);
      return {
        id: account.id,
        primaryShopId: account.primaryShopId,
        primaryShopName: shopsById.get(account.primaryShopId)?.name ?? EMPTY_VALUE,
        shopCount: shopCounts.get(account.id) ?? 0,
        activeMemberCount: memberCounts.get(account.id) ?? 0,
        tier: entitlement?.tier ?? 'free',
        status: entitlement?.status ?? 'unknown',
        accessEndsAt: accessEndsAt(entitlement),
        createdAt: account.createdAt,
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export interface SubscriptionSummary {
  id: string;
  billingAccountId: string;
  accountLabel: string;
  tier: string;
  billingCycle: string;
  status: string;
  /** The plan_offerings amount for this tier and cycle, NOT a charged amount. */
  billedAmountPaisa: Paisa;
  paidThrough: string;
  graceEndsAt: string | null;
  entitlementStatus: string;
  provider: string;
}

export function summarizeSubscriptions(input: {
  subscriptions: readonly SubscriptionRow[];
  entitlements: readonly EntitlementRow[];
  offerings: readonly OfferingRow[];
  accounts: readonly AccountSummary[];
}): SubscriptionSummary[] {
  const entitlementByAccount = new Map(
    input.entitlements.map((entitlement) => [entitlement.billingAccountId, entitlement]),
  );
  const accountLabels = new Map(input.accounts.map((account) => [account.id, account.primaryShopName]));
  const offeringAmounts = new Map(
    input.offerings.map((offering) => [offering.tier + ':' + offering.billingCycle, offering.amountPaisa]),
  );

  return input.subscriptions
    .map((subscription) => ({
      id: subscription.id,
      billingAccountId: subscription.billingAccountId,
      accountLabel: accountLabels.get(subscription.billingAccountId) ?? EMPTY_VALUE,
      tier: subscription.tier,
      billingCycle: subscription.billingCycle,
      status: subscription.status,
      billedAmountPaisa:
        offeringAmounts.get(subscription.tier + ':' + subscription.billingCycle) ?? ZERO_PAISA,
      paidThrough: subscription.paidThrough,
      graceEndsAt: subscription.graceEndsAt,
      entitlementStatus: entitlementByAccount.get(subscription.billingAccountId)?.status ?? 'unknown',
      provider: subscription.provider,
    }))
    .sort((left, right) => right.paidThrough.localeCompare(left.paidThrough));
}

export interface PaymentOrderSummary extends PaymentOrderRow {
  accountLabel: string;
  /** How many provider events this order has, and the latest processing status. */
  eventCount: number;
  latestEventStatus: string | null;
  /**
   * Still open AND already past expires_at, decided with the same instant the
   * rows were read at. The page must not call Date.now() while rendering — a
   * Server Component has to be pure — and the write action re-checks both
   * conditions in its own UPDATE guard anyway, so a stale list cannot become a
   * wrong write.
   */
  isStaleOpen: boolean;
}

export function isStaleOpenOrder(order: Pick<PaymentOrderRow, 'status' | 'expiresAt'>, now: number): boolean {
  if (order.status !== 'created' && order.status !== 'pending') return false;
  const expiresAt = Date.parse(order.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function summarizePaymentOrders(input: {
  orders: readonly PaymentOrderRow[];
  events: readonly ProviderEventRow[];
  accounts: readonly AccountSummary[];
  now: number;
}): PaymentOrderSummary[] {
  const accountLabels = new Map(input.accounts.map((account) => [account.id, account.primaryShopName]));
  const eventsByOrder = new Map<string, ProviderEventRow[]>();
  for (const event of input.events) {
    if (event.paymentOrderId === null) continue;
    const bucket = eventsByOrder.get(event.paymentOrderId) ?? [];
    bucket.push(event);
    eventsByOrder.set(event.paymentOrderId, bucket);
  }

  return input.orders
    .map((order) => {
      const events = [...(eventsByOrder.get(order.id) ?? [])]
        .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
      return {
        ...order,
        accountLabel: accountLabels.get(order.billingAccountId) ?? EMPTY_VALUE,
        eventCount: events.length,
        latestEventStatus: events[0]?.processingStatus ?? null,
        isStaleOpen: isStaleOpenOrder(order, input.now),
      };
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export interface ShopDetailView {
  shop: ShopRow;
  accountId: string | null;
  tier: string;
  entitlementStatus: string;
  accessEndsAt: string | null;
  activeStaffCount: number;
  memberships: readonly MembershipRow[];
  /** GROSS sales for the Dhaka day the caller asked for. Never called revenue. */
  grossSalesTodayPaisa: Paisa;
  saleCountToday: number;
}

export function sumPaisa(values: readonly number[]): Paisa {
  // asPaisa validates each integer at the boundary; the branded add is what
  // keeps the total from drifting into float arithmetic.
  let total: Paisa = ZERO_PAISA;
  for (const value of values) total = addPaisa(total, asPaisa(value));
  return total;
}

// ---------------------------------------------------------------- labels

const TIER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  free: 'Free',
  pro: 'Pro',
  ultra: 'Ultra',
});

const STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  grace: 'Grace',
  canceled: 'Canceled',
  expired: 'Expired',
  created: 'Created',
  pending: 'Pending',
  verified: 'Verified',
  failed: 'Failed',
  read_only: 'Read-only',
  received: 'Received',
  rejected: 'Rejected',
  unknown: 'Unknown',
});

/** Own-property lookup, so an inherited name cannot resolve to a label. */
function ownLabel(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

export function tierLabel(tier: string): string {
  return ownLabel(TIER_LABELS, tier) ?? tier;
}

export function statusLabel(status: string): string {
  return ownLabel(STATUS_LABELS, status) ?? status;
}

export function billingCycleLabel(cycle: string): string {
  if (cycle === 'monthly') return 'Monthly';
  if (cycle === 'annual') return 'Annual';
  return cycle;
}

/**
 * A UTC timestamp as a Dhaka-day date, matching the registration dates the
 * pharmacy list already shows. Fixed +06:00: Bangladesh has no DST.
 */
export function formatDhakaDate(timestamp: string | null): string {
  if (timestamp === null) return EMPTY_VALUE;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return EMPTY_VALUE;
  const shifted = new Date(parsed + 6 * 60 * 60 * 1_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

export function formatDhakaDateTime(timestamp: string | null): string {
  if (timestamp === null) return EMPTY_VALUE;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return EMPTY_VALUE;
  const shifted = new Date(parsed + 6 * 60 * 60 * 1_000);
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return formatDhakaDate(timestamp) + ' ' + hours + ':' + minutes;
}

export function formatCount(value: number): string {
  return Number.isFinite(value) ? String(value) : EMPTY_VALUE;
}

export { EMPTY_VALUE };
