import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Paisa } from '@muthoy/types';
import {
  canUseFeature,
  planLimits,
  resolveEntitlement,
  type BillingCycle,
  type EffectiveEntitlement,
  type EntitlementSnapshot,
  type PlanTier,
  type PremiumFeature,
} from '../domain/entitlements';
import { generateId } from '../native/id';
import { db, sqliteConnection } from './client';
import {
  billingAccounts,
  entitlementCache,
  paymentAttempts,
  shopDirectory,
  shopMemberships,
  shopSummaryCache,
  shops,
  roles,
  users,
} from './schema';

const commercialListeners = new Set<() => void>();
export function commercialSchemaInstalled(): boolean {
  try {
    sqliteConnection.getFirstSync('SELECT shop_id FROM shop_directory LIMIT 0');
    return true;
  } catch {
    return false;
  }
}
export function subscribeCommercialCache(listener: () => void): () => void {
  commercialListeners.add(listener);
  return () => commercialListeners.delete(listener);
}

export interface ServerCommercialSnapshot {
  directory_complete?: boolean;
  account: {
    id: string;
    principal_owner_user_id: string;
    primary_shop_id: string;
    launch_trial_granted_at: string | null;
    created_at: string;
    updated_at: string;
  };
  entitlement: {
    billing_account_id: string;
    tier: PlanTier;
    status: EntitlementSnapshot['status'];
    trial_ends_at: string | null;
    paid_through: string | null;
    grace_ends_at: string | null;
    verified_at: string;
    version: number;
    updated_at: string;
  };
  memberships: {
    id: string;
    billing_account_id: string;
    principal_user_id: string;
    shop_id: string;
    actor_user_id: string;
    role: 'owner' | 'manager' | 'staff';
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }[];
  shops: {
    id: string;
    name: string;
    name_en: string | null;
    commercial_status: 'active' | 'read_only';
    commercial_reason: string | null;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
  }[];
}

export class StaleCommercialSnapshotError extends Error {
  constructor() {
    super('Commercial snapshot belongs to a stale session.');
    this.name = 'StaleCommercialSnapshotError';
  }
}

function assertSnapshotCurrent(isCurrent?: () => boolean): void {
  if (isCurrent && !isCurrent()) throw new StaleCommercialSnapshotError();
}

/** Atomic server-cache replacement; never records an outbox change. */
export async function cacheCommercialSnapshot(
  snapshot: ServerCommercialSnapshot,
  isCurrent?: () => boolean,
): Promise<void> {
  db.transaction((tx) => {
    // A billing request may outlive its login/shop epoch. Re-check throughout
    // the transaction so invalidation throws and rolls the whole replacement
    // back instead of committing an old principal's response.
    assertSnapshotCurrent(isCurrent);
    tx.insert(billingAccounts).values({
      id: snapshot.account.id,
      principalOwnerUserId: snapshot.account.principal_owner_user_id,
      primaryShopId: snapshot.account.primary_shop_id,
      launchTrialGrantedAt: snapshot.account.launch_trial_granted_at,
      createdAt: snapshot.account.created_at,
      updatedAt: snapshot.account.updated_at,
    }).onConflictDoUpdate({ target: billingAccounts.id, set: {
      principalOwnerUserId: snapshot.account.principal_owner_user_id,
      primaryShopId: snapshot.account.primary_shop_id,
      launchTrialGrantedAt: snapshot.account.launch_trial_granted_at,
      updatedAt: snapshot.account.updated_at,
    } }).run();

    tx.insert(entitlementCache).values({
      billingAccountId: snapshot.entitlement.billing_account_id,
      tier: snapshot.entitlement.tier,
      status: snapshot.entitlement.status,
      trialEndsAt: snapshot.entitlement.trial_ends_at,
      paidThrough: snapshot.entitlement.paid_through,
      graceEndsAt: snapshot.entitlement.grace_ends_at,
      verifiedAt: snapshot.entitlement.verified_at,
      lastObservedAt: snapshot.entitlement.verified_at,
      version: snapshot.entitlement.version,
      updatedAt: snapshot.entitlement.updated_at,
    }).onConflictDoUpdate({ target: entitlementCache.billingAccountId, set: {
      tier: snapshot.entitlement.tier,
      status: snapshot.entitlement.status,
      trialEndsAt: snapshot.entitlement.trial_ends_at,
      paidThrough: snapshot.entitlement.paid_through,
      graceEndsAt: snapshot.entitlement.grace_ends_at,
      verifiedAt: snapshot.entitlement.verified_at,
      version: snapshot.entitlement.version,
      updatedAt: snapshot.entitlement.updated_at,
    } }).run();
    assertSnapshotCurrent(isCurrent);

    if (snapshot.directory_complete) {
      tx.delete(shopDirectory).where(eq(shopDirectory.billingAccountId, snapshot.account.id)).run();
      tx.delete(shopMemberships).where(eq(shopMemberships.billingAccountId, snapshot.account.id)).run();
    }
    assertSnapshotCurrent(isCurrent);

    const directoryValues = snapshot.shops.map((shop) => ({
        shopId: shop.id, billingAccountId: snapshot.account.id, name: shop.name,
        nameEn: shop.name_en, commercialStatus: shop.commercial_status,
        commercialReason: shop.commercial_reason, archivedAt: shop.archived_at,
        createdAt: shop.created_at, updatedAt: shop.updated_at,
      }));
    if (snapshot.directory_complete && directoryValues.length) {
      tx.insert(shopDirectory).values(directoryValues).run();
    } else {
      for (const values of directoryValues) {
        tx.insert(shopDirectory).values(values)
          .onConflictDoUpdate({ target: shopDirectory.shopId, set: values }).run();
      }
    }
    if (snapshot.shops.length) {
      tx.update(shops).set({
        plan: snapshot.entitlement.tier,
        trialEndsAt: snapshot.entitlement.trial_ends_at,
      }).where(inArray(shops.id, snapshot.shops.map((shop) => shop.id))).run();
    }
    assertSnapshotCurrent(isCurrent);

    // Resolve local FK eligibility in two fixed queries, then bulk insert the
    // complete owner directory. No per-membership existence query.
    const localShopRows = tx.select({ id: shops.id }).from(shops).all();
    const localUserRows = tx.select({ id: users.id }).from(users).all();
    const localShopIds = new Set(localShopRows.map((row) => row.id));
    const localUserIds = new Set(localUserRows.map((row) => row.id));
    const membershipValues = snapshot.memberships.filter((membership) =>
      localShopIds.has(membership.shop_id) && localUserIds.has(membership.actor_user_id)
    ).map((membership) => ({
        id: membership.id, billingAccountId: membership.billing_account_id,
        principalUserId: membership.principal_user_id, shopId: membership.shop_id,
        actorUserId: membership.actor_user_id, role: membership.role,
        isActive: membership.is_active, createdAt: membership.created_at,
        updatedAt: membership.updated_at,
      }));
    if (snapshot.directory_complete && membershipValues.length) {
      tx.insert(shopMemberships).values(membershipValues).run();
    } else {
      for (const values of membershipValues) {
        tx.insert(shopMemberships).values(values)
          .onConflictDoUpdate({ target: shopMemberships.id, set: values }).run();
      }
    }
    assertSnapshotCurrent(isCurrent);
  });
  assertSnapshotCurrent(isCurrent);
  for (const listener of commercialListeners) listener();
}

export async function getEffectiveEntitlementForShop(
  shopId: string,
  now = new Date(),
): Promise<EffectiveEntitlement | null> {
  if (!commercialSchemaInstalled()) return null;
  return db.transaction(async (tx) => {
    const row = await tx.select({
      billingAccountId: entitlementCache.billingAccountId,
      tier: entitlementCache.tier,
      status: entitlementCache.status,
      trialEndsAt: entitlementCache.trialEndsAt,
      paidThrough: entitlementCache.paidThrough,
      graceEndsAt: entitlementCache.graceEndsAt,
      verifiedAt: entitlementCache.verifiedAt,
      lastObservedAt: entitlementCache.lastObservedAt,
      version: entitlementCache.version,
    }).from(shopDirectory).innerJoin(
      entitlementCache,
      eq(shopDirectory.billingAccountId, entitlementCache.billingAccountId),
    ).where(eq(shopDirectory.shopId, shopId)).get();
    if (!row) return null;
    const highWater = Date.parse(row.lastObservedAt);
    const effectiveNow = new Date(Math.max(now.getTime(), Number.isFinite(highWater) ? highWater : now.getTime()));
    if (effectiveNow.getTime() > highWater) {
      await tx.update(entitlementCache).set({ lastObservedAt: effectiveNow.toISOString() })
        .where(eq(entitlementCache.billingAccountId, row.billingAccountId));
    }
    return resolveEntitlement(row, effectiveNow, 'offline');
  });
}

export class PlanAccessError extends Error {
  constructor(public readonly feature: PremiumFeature | 'commercial_write' | 'staff_limit') {
    super(feature === 'staff_limit' ? 'Staff plan limit reached.' : 'Upgrade to Pro or Ultra to use this feature.');
    this.name = 'PlanAccessError';
  }
}

export async function requirePremiumFeature(shopId: string, feature: PremiumFeature): Promise<void> {
  if (!commercialSchemaInstalled()) return;
  const entitlement = await getEffectiveEntitlementForShop(shopId);
  if (!entitlement || !canUseFeature(entitlement.effectiveTier, feature)) throw new PlanAccessError(feature);
}

export interface MultiShopContext {
  entitled: boolean;
  primaryShopId: string | null;
  liveShopCount: number;
}

/**
 * Multi-shop's own entitlement read, and unlike requirePremiumFeature it is
 * FAIL-CLOSED: no commercial schema, no directory row, or no cached
 * entitlement all resolve to "not entitled". requirePremiumFeature stays
 * permissive for legacy installs that predate the commercial tables; multi-shop
 * has no such history, and every one of its operations either spends plan
 * capacity or crosses a shop boundary.
 */
export async function readMultiShopContext(shopId: string): Promise<MultiShopContext> {
  const denied: MultiShopContext = { entitled: false, primaryShopId: null, liveShopCount: 0 };
  if (!commercialSchemaInstalled()) return denied;
  const row = await db.select({
    billingAccountId: shopDirectory.billingAccountId,
    primaryShopId: billingAccounts.primaryShopId,
  }).from(shopDirectory)
    .innerJoin(billingAccounts, eq(billingAccounts.id, shopDirectory.billingAccountId))
    .where(eq(shopDirectory.shopId, shopId)).get();
  if (!row) return denied;
  const entitlement = await getEffectiveEntitlementForShop(shopId);
  const live = await db.select({ shopId: shopDirectory.shopId }).from(shopDirectory).where(and(
    eq(shopDirectory.billingAccountId, row.billingAccountId), isNull(shopDirectory.archivedAt),
  )).all();
  return {
    entitled: Boolean(entitlement && canUseFeature(entitlement.effectiveTier, 'multi_shop')),
    primaryShopId: row.primaryShopId,
    liveShopCount: live.length,
  };
}

/** Guards every multi-shop write/read the device performs on its own. */
export async function requireMultiShopAccess(shopId: string): Promise<void> {
  const context = await readMultiShopContext(shopId);
  if (!context.entitled) throw new PlanAccessError('multi_shop');
}

/**
 * Switching is guarded separately from the rest of multi-shop, because a
 * downgrade must not strand the owner on a shop the plan no longer covers.
 * The account's primary shop is the one shop Free always includes, so a
 * non-premium owner may still switch back to it — and nowhere else.
 */
export async function requireShopSwitchAccess(currentShopId: string, targetShopId: string): Promise<void> {
  const context = await readMultiShopContext(currentShopId);
  if (context.entitled) return;
  if (context.primaryShopId && context.primaryShopId === targetShopId) return;
  throw new PlanAccessError('multi_shop');
}

export async function requireCommercialWrite(shopId: string): Promise<void> {
  if (!commercialSchemaInstalled()) return;
  const row = await db.select({
    status: shopDirectory.commercialStatus, archivedAt: shopDirectory.archivedAt,
    billingAccountId: shopDirectory.billingAccountId,
  }).from(shopDirectory).where(eq(shopDirectory.shopId, shopId)).get();
  if (!row) return;
  if (row.status !== 'active' || row.archivedAt) throw new PlanAccessError('commercial_write');
  const entitlement = await getEffectiveEntitlementForShop(shopId);
  const limit = planLimits(entitlement?.effectiveTier ?? 'free').maxActiveShops;
  if (limit !== null && row.billingAccountId) {
    const ranked = await db.select({ id: shopDirectory.shopId }).from(shopDirectory).where(and(
      eq(shopDirectory.billingAccountId, row.billingAccountId), isNull(shopDirectory.archivedAt),
    )).orderBy(shopDirectory.createdAt, shopDirectory.shopId).all();
    if (ranked.findIndex((item) => item.id === shopId) >= limit) throw new PlanAccessError('commercial_write');
  }
}

export async function requireStaffSlot(shopId: string): Promise<void> {
  if (!commercialSchemaInstalled()) return;
  await requireCommercialWrite(shopId);
  const entitlement = await getEffectiveEntitlementForShop(shopId);
  const tier = entitlement?.effectiveTier ?? 'free';
  const limit = planLimits(tier).maxActiveNonOwnerStaffPerShop;
  if (limit === null) return;
  const active = await db.select({ role: roles.name }).from(users).innerJoin(roles, eq(users.roleId, roles.id)).where(and(
    eq(users.shopId, shopId), eq(users.isDeleted, false), eq(users.isActive, true),
  )).all();
  if (active.filter((row) => row.role !== 'owner').length >= limit) throw new PlanAccessError('staff_limit');
}

export async function isUserWithinStaffLimit(shopId: string, userId: string): Promise<boolean> {
  if (!commercialSchemaInstalled()) return true;
  const candidates = await db.select({
    id: users.id,
    role: roles.name,
    createdAt: users.createdAt,
  }).from(users).innerJoin(roles, eq(users.roleId, roles.id)).where(and(
    eq(users.shopId, shopId), eq(users.isDeleted, false), eq(users.isActive, true),
  )).all();
  const actor = candidates.find((row) => row.id === userId);
  if (!actor) return false;
  if (actor.role === 'owner') return true;
  const entitlement = await getEffectiveEntitlementForShop(shopId);
  const limit = planLimits(entitlement?.effectiveTier ?? 'free').maxActiveNonOwnerStaffPerShop;
  if (limit === null) return true;
  const allowed = candidates.filter((row) => row.role !== 'owner')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
  return allowed.some((row) => row.id === userId);
}

export async function getBillingAccountIdForShop(shopId: string): Promise<string | null> {
  if (!commercialSchemaInstalled()) return null;
  const row = await db.select({ billingAccountId: shopDirectory.billingAccountId })
    .from(shopDirectory).where(eq(shopDirectory.shopId, shopId)).get();
  return row?.billingAccountId ?? null;
}

export async function listOwnerShops(billingAccountId: string) {
  const rows = await db.select({
    shopId: shopDirectory.shopId, name: shopDirectory.name, nameEn: shopDirectory.nameEn,
    commercialStatus: shopDirectory.commercialStatus, commercialReason: shopDirectory.commercialReason,
    archivedAt: shopDirectory.archivedAt, createdAt: shopDirectory.createdAt,
    localShopId: shops.id,
  }).from(shopDirectory).leftJoin(shops, eq(shops.id, shopDirectory.shopId))
    .where(eq(shopDirectory.billingAccountId, billingAccountId)).orderBy(shopDirectory.createdAt).all();
  const snapshot = await db.select().from(entitlementCache)
    .where(eq(entitlementCache.billingAccountId, billingAccountId)).get();
  const tier = snapshot ? resolveEntitlement(snapshot).effectiveTier : 'free';
  const limit = planLimits(tier).maxActiveShops;
  let activeOrdinal = 0;
  return rows.map((row) => {
    const ordinal = row.archivedAt ? null : activeOrdinal++;
    const excess = limit !== null && ordinal !== null && ordinal >= limit;
    return {
      ...row,
      commercialStatus: excess ? 'read_only' as const : row.commercialStatus,
      commercialReason: excess ? 'plan_shop_limit' : row.commercialReason,
    };
  });
}

export interface ShopSummarySnapshot {
  shop_id: string;
  sales_paisa: number;
  outstanding_credit_paisa: number;
  low_stock_count: number;
  expiring_count: number;
  transaction_count: number;
  average_sale_paisa: number;
}

export async function cacheShopSummaries(
  billingAccountId: string,
  businessDate: string,
  verifiedAt: string,
  rows: ShopSummarySnapshot[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(shopSummaryCache).where(and(
      eq(shopSummaryCache.billingAccountId, billingAccountId),
      eq(shopSummaryCache.businessDate, businessDate),
    ));
    if (rows.length) await tx.insert(shopSummaryCache).values(rows.map((row) => ({
      billingAccountId, businessDate, shopId: row.shop_id,
      salesPaisa: row.sales_paisa as Paisa,
      outstandingCreditPaisa: row.outstanding_credit_paisa as Paisa,
      lowStockCount: row.low_stock_count, expiringCount: row.expiring_count,
      transactionCount: row.transaction_count,
      averageSalePaisa: row.average_sale_paisa as Paisa, verifiedAt,
    })));
  });
}

export async function readShopSummaries(billingAccountId: string, businessDate: string) {
  return db.select().from(shopSummaryCache).where(and(
    eq(shopSummaryCache.billingAccountId, billingAccountId),
    eq(shopSummaryCache.businessDate, businessDate),
  )).all();
}

export async function membershipForSwitch(principalUserId: string, shopId: string) {
  return db.select({
    id: shopMemberships.id,
    billingAccountId: shopMemberships.billingAccountId,
    principalUserId: shopMemberships.principalUserId,
    shopId: shopMemberships.shopId,
    actorUserId: shopMemberships.actorUserId,
    role: shopMemberships.role,
    isActive: shopMemberships.isActive,
    createdAt: shopMemberships.createdAt,
    updatedAt: shopMemberships.updatedAt,
  }).from(shopMemberships).innerJoin(shopDirectory, eq(shopDirectory.shopId, shopMemberships.shopId)).where(and(
    eq(shopMemberships.principalUserId, principalUserId),
    eq(shopMemberships.shopId, shopId),
    eq(shopMemberships.isActive, true),
    isNull(shopDirectory.archivedAt),
  )).get();
}

export async function createPaymentAttempt(input: {
  billingAccountId: string;
  tier: Exclude<PlanTier, 'free'>;
  billingCycle: BillingCycle;
  amountPaisa: Paisa;
}): Promise<{ id: string; clientRequestId: string }> {
  const id = generateId();
  const clientRequestId = generateId();
  const now = new Date().toISOString();
  await db.insert(paymentAttempts).values({
    id, billingAccountId: input.billingAccountId, clientRequestId,
    tier: input.tier, billingCycle: input.billingCycle, amountPaisa: input.amountPaisa,
    provider: 'sslcommerz', status: 'created', createdAt: now, updatedAt: now,
  });
  return { id, clientRequestId };
}

export async function updatePaymentAttempt(
  id: string,
  values: Partial<Pick<typeof paymentAttempts.$inferInsert,
    'serverOrderId' | 'status' | 'checkoutUrl' | 'failureCode' | 'expiresAt'>>,
): Promise<void> {
  await db.update(paymentAttempts).set({ ...values, updatedAt: new Date().toISOString() }).where(eq(paymentAttempts.id, id));
}

export async function updatePaymentAttemptByServerOrder(
  serverOrderId: string,
  values: Partial<Pick<typeof paymentAttempts.$inferInsert, 'status' | 'failureCode'>>,
): Promise<void> {
  await db.update(paymentAttempts).set({ ...values, updatedAt: new Date().toISOString() })
    .where(eq(paymentAttempts.serverOrderId, serverOrderId));
}

export async function getPaymentAttempt(id: string) {
  return db.select().from(paymentAttempts).where(eq(paymentAttempts.id, id)).get();
}

export async function getPaymentAttemptByServerOrder(serverOrderId: string) {
  return db.select().from(paymentAttempts)
    .where(eq(paymentAttempts.serverOrderId, serverOrderId)).get();
}
