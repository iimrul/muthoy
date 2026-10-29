import 'server-only';

// W4-07 — the reads behind the management pages.
//
// READ-ONLY, and every list is paged through the same bounded reader
// lib/queries.ts already uses, because PostgREST caps a single response and a
// silently truncated list on a platform console is worse than an error.
//
// Drill-downs are parameterised by a VALIDATED UUID and nothing else. No
// client-supplied filter, column list or ordering string reaches a query: a
// route param decides WHICH account a service-role read returns, so it is
// treated as the untrusted input it is (isUuid, in lib/adminViews.ts).
//
// Joins happen in lib/adminViews.ts, in pure functions, against separate paged
// reads rather than PostgREST embedding — so the shaping is unit-testable
// without a database, and one missing foreign-key relationship cannot turn a
// whole page into an error.

import { AdminDataError } from './errors';
import { assertCompleteRead } from './adminReports';
import { readAllPages } from './queries';
import { dhakaDayRange } from './platformStats';
import { getSupabaseAdmin } from './supabaseAdmin';
import {
  isUuid,
  summarizeAccounts,
  summarizePaymentOrders,
  summarizeSubscriptions,
  sumPaisa,
  type AccountRow,
  type AccountSummary,
  type EntitlementRow,
  type MembershipRow,
  type OfferingRow,
  type PaymentOrderRow,
  type PaymentOrderSummary,
  type ProviderEventRow,
  type ShopDetailView,
  type ShopRow,
  type SubscriptionRow,
  type SubscriptionSummary,
} from './adminViews';
import { asPaisa } from '@muthoy/types';

function requireUuid(value: string, label: string): string {
  if (!isUuid(value)) {
    // Never echo the value: it reaches the server log, and a malformed id is
    // caller-controlled text.
    throw new AdminDataError(label + ' is not a valid id');
  }
  return value;
}

async function readShops(): Promise<ShopRow[]> {
  const supabase = getSupabaseAdmin();
  const rows = await readAllPages<Record<string, unknown>>('shops', (from, to) =>
    supabase
      .from('shops')
      .select('id,name,phone,created_at,plan,commercial_status,commercial_reason,archived_at,billing_account_id')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return rows.map(toShopRow);
}

function toShopRow(row: Record<string, unknown>): ShopRow {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    phone: String(row.phone ?? ''),
    createdAt: String(row.created_at ?? ''),
    plan: String(row.plan ?? 'free'),
    commercialStatus: String(row.commercial_status ?? 'active'),
    commercialReason: row.commercial_reason === null || row.commercial_reason === undefined
      ? null
      : String(row.commercial_reason),
    archivedAt: row.archived_at === null || row.archived_at === undefined ? null : String(row.archived_at),
    billingAccountId: row.billing_account_id === null || row.billing_account_id === undefined
      ? null
      : String(row.billing_account_id),
  };
}

async function readAccounts(): Promise<AccountRow[]> {
  const supabase = getSupabaseAdmin();
  const rows = await readAllPages<Record<string, unknown>>('billing_accounts', (from, to) =>
    supabase
      .from('billing_accounts')
      .select('id,principal_owner_user_id,primary_shop_id,launch_trial_granted_at,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => ({
    id: String(row.id),
    principalOwnerUserId: String(row.principal_owner_user_id),
    primaryShopId: String(row.primary_shop_id),
    launchTrialGrantedAt: row.launch_trial_granted_at === null || row.launch_trial_granted_at === undefined
      ? null
      : String(row.launch_trial_granted_at),
    createdAt: String(row.created_at ?? ''),
  }));
}

async function readEntitlements(): Promise<EntitlementRow[]> {
  const supabase = getSupabaseAdmin();
  const rows = await readAllPages<Record<string, unknown>>('entitlement_snapshots', (from, to) =>
    supabase
      .from('entitlement_snapshots')
      .select('billing_account_id,tier,status,trial_ends_at,paid_through,grace_ends_at,verified_at')
      .order('billing_account_id', { ascending: true })
      .range(from, to),
  );
  return rows.map(toEntitlementRow);
}

function toEntitlementRow(row: Record<string, unknown>): EntitlementRow {
  const optional = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);
  return {
    billingAccountId: String(row.billing_account_id),
    tier: String(row.tier ?? 'free'),
    status: String(row.status ?? 'unknown'),
    trialEndsAt: optional(row.trial_ends_at),
    paidThrough: optional(row.paid_through),
    graceEndsAt: optional(row.grace_ends_at),
    verifiedAt: String(row.verified_at ?? ''),
  };
}

async function readMemberships(): Promise<MembershipRow[]> {
  const supabase = getSupabaseAdmin();
  const rows = await readAllPages<Record<string, unknown>>('shop_memberships', (from, to) =>
    supabase
      .from('shop_memberships')
      .select('id,billing_account_id,shop_id,principal_user_id,role,is_active,created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return rows.map((row) => ({
    id: String(row.id),
    billingAccountId: String(row.billing_account_id),
    shopId: String(row.shop_id),
    principalUserId: String(row.principal_user_id),
    role: String(row.role ?? ''),
    isActive: row.is_active === true,
    createdAt: String(row.created_at ?? ''),
  }));
}

export async function listAccountSummaries(): Promise<AccountSummary[]> {
  const [accounts, shops, memberships, entitlements] = await Promise.all([
    readAccounts(),
    readShops(),
    readMemberships(),
    readEntitlements(),
  ]);
  return summarizeAccounts({ accounts, shops, memberships, entitlements });
}

export interface AccountDetailView {
  account: AccountSummary;
  shops: readonly ShopRow[];
  memberships: readonly MembershipRow[];
  subscriptions: readonly SubscriptionRow[];
  entitlement: EntitlementRow | null;
}

export async function getAccountDetail(accountId: string): Promise<AccountDetailView | null> {
  const id = requireUuid(accountId, 'account');
  const supabase = getSupabaseAdmin();

  const [accounts, shops, memberships, entitlements] = await Promise.all([
    readAccounts(),
    readShops(),
    readMemberships(),
    readEntitlements(),
  ]);

  const summary = summarizeAccounts({ accounts, shops, memberships, entitlements })
    .find((candidate) => candidate.id === id);
  if (!summary) return null;

  const subscriptionRows = await readAllPages<Record<string, unknown>>('billing_subscriptions', (from, to) =>
    supabase
      .from('billing_subscriptions')
      .select('id,billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,canceled_at,provider,created_at')
      .eq('billing_account_id', id)
      .order('created_at', { ascending: false })
      .range(from, to),
  );

  return {
    account: summary,
    shops: shops.filter((shop) => shop.billingAccountId === id),
    memberships: memberships.filter((membership) => membership.billingAccountId === id),
    subscriptions: subscriptionRows.map(toSubscriptionRow),
    entitlement: entitlements.find((entitlement) => entitlement.billingAccountId === id) ?? null,
  };
}

function toSubscriptionRow(row: Record<string, unknown>): SubscriptionRow {
  const optional = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);
  return {
    id: String(row.id),
    billingAccountId: String(row.billing_account_id),
    tier: String(row.tier ?? ''),
    billingCycle: String(row.billing_cycle ?? ''),
    status: String(row.status ?? ''),
    startsAt: String(row.starts_at ?? ''),
    paidThrough: String(row.paid_through ?? ''),
    graceEndsAt: optional(row.grace_ends_at),
    canceledAt: optional(row.canceled_at),
    provider: String(row.provider ?? ''),
    createdAt: String(row.created_at ?? ''),
  };
}

export async function listSubscriptionSummaries(): Promise<SubscriptionSummary[]> {
  const supabase = getSupabaseAdmin();
  const [accounts, subscriptionRows, entitlements, offeringRows] = await Promise.all([
    listAccountSummaries(),
    readAllPages<Record<string, unknown>>('billing_subscriptions', (from, to) =>
      supabase
        .from('billing_subscriptions')
        .select('id,billing_account_id,tier,billing_cycle,status,starts_at,paid_through,grace_ends_at,canceled_at,provider,created_at')
        .order('paid_through', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readEntitlements(),
    readAllPages<Record<string, unknown>>('plan_offerings', (from, to) =>
      supabase
        .from('plan_offerings')
        .select('tier,billing_cycle,amount_paisa,is_active')
        .order('tier', { ascending: true })
        .range(from, to),
    ),
  ]);

  const offerings: OfferingRow[] = offeringRows.map((row) => ({
    tier: String(row.tier ?? ''),
    billingCycle: String(row.billing_cycle ?? ''),
    amountPaisa: asPaisa(Number(row.amount_paisa ?? 0)),
    isActive: row.is_active === true,
  }));

  return summarizeSubscriptions({
    subscriptions: subscriptionRows.map(toSubscriptionRow),
    entitlements,
    offerings,
    accounts,
  });
}

export async function listPaymentOrderSummaries(
  now: Date = new Date(),
): Promise<PaymentOrderSummary[]> {
  const supabase = getSupabaseAdmin();
  const [accounts, orderRows, eventRows] = await Promise.all([
    listAccountSummaries(),
    readAllPages<Record<string, unknown>>('payment_orders', (from, to) =>
      supabase
        .from('payment_orders')
        .select('id,billing_account_id,tier,billing_cycle,amount_paisa,status,provider,failure_code,expires_at,verified_at,created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    ),
    readAllPages<Record<string, unknown>>('payment_provider_events', (from, to) =>
      supabase
        .from('payment_provider_events')
        .select('id,payment_order_id,processing_status,error_code,received_at')
        .order('received_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ]);

  const orders: PaymentOrderRow[] = orderRows.map((row) => ({
    id: String(row.id),
    billingAccountId: String(row.billing_account_id),
    tier: String(row.tier ?? ''),
    billingCycle: String(row.billing_cycle ?? ''),
    amountPaisa: asPaisa(Number(row.amount_paisa ?? 0)),
    status: String(row.status ?? ''),
    provider: String(row.provider ?? ''),
    failureCode: row.failure_code === null || row.failure_code === undefined ? null : String(row.failure_code),
    expiresAt: String(row.expires_at ?? ''),
    verifiedAt: row.verified_at === null || row.verified_at === undefined ? null : String(row.verified_at),
    createdAt: String(row.created_at ?? ''),
  }));

  const events: ProviderEventRow[] = eventRows.map((row) => ({
    id: String(row.id),
    paymentOrderId: row.payment_order_id === null || row.payment_order_id === undefined
      ? null
      : String(row.payment_order_id),
    processingStatus: String(row.processing_status ?? ''),
    errorCode: row.error_code === null || row.error_code === undefined ? null : String(row.error_code),
    receivedAt: String(row.received_at ?? ''),
  }));

  return summarizePaymentOrders({ orders, events, accounts, now: now.getTime() });
}

/**
 * One shop, by validated id. The GROSS sales figure is the same day-bounded
 * read the dashboard performs — labelled gross on the page, never revenue
 * (the ledger's interim safety boundary 1).
 */
export async function getShopDetail(
  shopId: string,
  now: Date = new Date(),
): Promise<ShopDetailView | null> {
  const id = requireUuid(shopId, 'shop');
  const supabase = getSupabaseAdmin();
  const day = dhakaDayRange(now);

  const { data: shopData, error: shopError } = await supabase
    .from('shops')
    // §8.2 (Gate 5 finding 16) adds `owner_id` and `updated_at`: the owner
    // information and the last synced change were specified and were not read.
    // ONE LITERAL, deliberately: `.select()` with a concatenated string loses
    // the row type and comes back as GenericStringError[].
    .select('id,name,phone,created_at,updated_at,owner_id,plan,commercial_status,commercial_reason,archived_at,billing_account_id')
    .eq('id', id)
    .eq('is_deleted', false)
    .maybeSingle();

  if (shopError) {
    console.error('[admin] shop detail query failed:', shopError.message);
    throw new AdminDataError('shop detail query failed');
  }
  if (!shopData) return null;

  const shop = toShopRow(shopData as Record<string, unknown>);
  const shopRecord = shopData as Record<string, unknown>;
  const ownerId = shopRecord.owner_id === null || shopRecord.owner_id === undefined
    ? null
    : String(shopRecord.owner_id);
  const lastSyncedChangeAt = shopRecord.updated_at === null || shopRecord.updated_at === undefined
    ? null
    : String(shopRecord.updated_at);

  // The owner's own row. Read by id, so one shop's detail cannot contain
  // another's owner — and a failure to read it is reported as "could not be
  // read" rather than as "no owner", which are different facts.
  let ownerName: string | null = null;
  let ownerPhone: string | null = null;
  if (ownerId !== null) {
    const { data: ownerData, error: ownerError } = await supabase
      .from('users')
      .select('id,name,phone')
      .eq('id', ownerId)
      .eq('is_deleted', false)
      .maybeSingle();
    if (ownerError) {
      console.error('[admin] shop owner lookup failed:', ownerError.message);
      throw new AdminDataError('shop owner lookup failed');
    }
    if (ownerData) {
      const owner = ownerData as Record<string, unknown>;
      ownerName = owner.name === null || owner.name === undefined ? null : String(owner.name);
      ownerPhone = owner.phone === null || owner.phone === undefined ? null : String(owner.phone);
    }
  }

  const { count: staffCount, error: staffError } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', id)
    .eq('is_deleted', false)
    .eq('is_active', true);

  if (staffError) {
    console.error('[admin] shop staff count failed:', staffError.message);
    throw new AdminDataError('shop staff count failed');
  }

  const saleRows = await readAllPages<Record<string, unknown>>('shop sales', (from, to) =>
    supabase
      .from('sales')
      .select('total')
      .eq('shop_id', id)
      .eq('is_deleted', false)
      .gte('created_at', day.startInclusive)
      .lt('created_at', day.endExclusive)
      .order('id', { ascending: true })
      .range(from, to),
  );

  // ROUND 15 FINDING 3, second half. This read was uncounted too: six sales of
  // 100.00 for one shop with a response cap of five rendered gross 500.00 and
  // a count of 5 on the drill-down, against a real 600.00 and 6. The figure is
  // labelled GROSS and belongs to one named pharmacy, so a short read here is
  // a wrong number about an identified shop.
  const saleCount = await supabase
    .from('sales')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', id)
    .eq('is_deleted', false)
    .gte('created_at', day.startInclusive)
    .lt('created_at', day.endExclusive);
  if (saleCount.error) {
    console.error('[admin] shop sales count failed:', saleCount.error.message);
    throw new AdminDataError('shop sales count failed');
  }
  assertCompleteRead([
    { label: 'shop sales', counted: saleCount.count ?? 0, loaded: saleRows.length },
  ]);

  const memberships = (await readMemberships()).filter((membership) => membership.shopId === id);
  const entitlement = shop.billingAccountId === null
    ? null
    : (await readEntitlements()).find((row) => row.billingAccountId === shop.billingAccountId) ?? null;

  return {
    shop,
    accountId: shop.billingAccountId,
    tier: entitlement?.tier ?? shop.plan,
    entitlementStatus: entitlement?.status ?? 'unknown',
    accessEndsAt: entitlement === null
      ? null
      : entitlement.status === 'trialing'
        ? entitlement.trialEndsAt
        : entitlement.graceEndsAt ?? entitlement.paidThrough ?? null,
    activeStaffCount: staffCount ?? 0,
    memberships,
    ownerName,
    ownerPhone,
    lastSyncedChangeAt,
    grossSalesTodayPaisa: sumPaisa(saleRows.map((row) => Number(row.total ?? 0))),
    saleCountToday: saleRows.length,
  };
}
