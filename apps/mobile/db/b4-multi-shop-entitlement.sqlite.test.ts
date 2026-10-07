import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { DAY_MS, MAX_OFFLINE_VERIFICATION_DAYS } from '../domain/entitlements';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const { shops, roles, users, billingAccounts, entitlementCache, shopDirectory } = await import('./schema');
const {
  PlanAccessError,
  getEffectiveEntitlementForShop,
  readMultiShopContext,
  requireMultiShopAccess,
  requireShopSwitchAccess,
} = await import('./commercial');

const PRIMARY_SHOP = '91111111-1111-4111-8111-111111111111';
const SECOND_SHOP = '91111111-1111-4111-8111-111111111112';
const OWNER_ID = '92222222-2222-4222-8222-222222222222';
const ROLE_ID = '94444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '96666666-6666-4666-8666-666666666666';
/** When the cached entitlement was last verified by the server. */
const T0 = '2026-09-01T06:00:00.000Z';
/**
 * The clock every test reads, frozen: nine days after T0 — inside the 30-day
 * offline verification ceiling, and after EXPIRED_TRIAL ended. Resolution reads
 * `new Date()`, so with a live clock these fixtures meant something different
 * every day, and from 2026-10-01T06:00Z (T0 + 30 days) every one of them read
 * as a stale verification.
 */
const NOW = '2026-09-10T06:00:00.000Z';

/** Rewrites the single cached entitlement row to a given commercial state. */
function setEntitlement(values: {
  tier: 'free' | 'pro' | 'ultra';
  status: 'trialing' | 'active' | 'expired' | 'canceled';
  trialEndsAt?: string | null;
  paidThrough?: string | null;
}) {
  db.update(entitlementCache).set({
    tier: values.tier,
    status: values.status,
    trialEndsAt: values.trialEndsAt ?? null,
    paidThrough: values.paidThrough ?? null,
    graceEndsAt: null,
    verifiedAt: T0,
    lastObservedAt: T0,
    version: 1,
    updatedAt: T0,
  }).where(eq(entitlementCache.billingAccountId, ACCOUNT_ID)).run();
}

beforeAll(() => {
  // Date only — no timer is faked, and nothing in this file schedules one.
  vi.setSystemTime(new Date(NOW));
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrationDir = resolve('apps/mobile/db/migrations');
  for (const file of readdirSync(migrationDir).filter((name) => /^00(?:0\d|1\d|2[0-9])_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(resolve(migrationDir, file), 'utf8'));
  }
  db.insert(shops).values({ id: PRIMARY_SHOP, ownerId: OWNER_ID, name: 'Primary', phone: '01700000031', createdAt: T0, updatedAt: T0 }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: PRIMARY_SHOP, name: 'owner', isSystem: true, createdAt: T0, updatedAt: T0 }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: PRIMARY_SHOP, name: 'Owner', phone: '01700000031', pinHash: 'hash', pinSetAt: T0, roleId: ROLE_ID, isActive: true, createdAt: T0, updatedAt: T0 }).run();
  db.insert(billingAccounts).values({ id: ACCOUNT_ID, principalOwnerUserId: OWNER_ID, primaryShopId: PRIMARY_SHOP, launchTrialGrantedAt: T0, createdAt: T0, updatedAt: T0 }).run();
  db.insert(entitlementCache).values({ billingAccountId: ACCOUNT_ID, tier: 'free', status: 'trialing', trialEndsAt: '2026-09-15T06:00:00.000Z', verifiedAt: T0, lastObservedAt: T0, version: 1, updatedAt: T0 }).run();
  for (const [shopId, name] of [[PRIMARY_SHOP, 'Primary'], [SECOND_SHOP, 'Second']] as const) {
    db.insert(shopDirectory).values({ shopId, billingAccountId: ACCOUNT_ID, name, commercialStatus: 'active', createdAt: T0, updatedAt: T0 }).run();
  }
});

afterAll(() => {
  vi.useRealTimers();
});

const LIVE_TRIAL = { tier: 'free', status: 'trialing', trialEndsAt: '2999-01-01T00:00:00.000Z' } as const;
const EXPIRED_TRIAL = { tier: 'free', status: 'trialing', trialEndsAt: '2026-09-02T00:00:00.000Z' } as const;
const FREE = { tier: 'free', status: 'expired', trialEndsAt: null } as const;
const PAID_PRO = { tier: 'pro', status: 'active', paidThrough: '2999-01-01T00:00:00.000Z' } as const;

describe('B4 multi-shop entitlement enforcement (SQLite layer)', () => {
  it('grants a live trial owner full multi-shop access', async () => {
    setEntitlement(LIVE_TRIAL);
    const context = await readMultiShopContext(PRIMARY_SHOP);
    expect(context).toMatchObject({ entitled: true, primaryShopId: PRIMARY_SHOP, liveShopCount: 2 });
    await expect(requireMultiShopAccess(PRIMARY_SHOP)).resolves.toBeUndefined();
    await expect(requireShopSwitchAccess(PRIMARY_SHOP, SECOND_SHOP)).resolves.toBeUndefined();
  });

  it('grants a paid Pro owner the same access', async () => {
    setEntitlement(PAID_PRO);
    await expect(requireMultiShopAccess(PRIMARY_SHOP)).resolves.toBeUndefined();
    await expect(requireShopSwitchAccess(PRIMARY_SHOP, SECOND_SHOP)).resolves.toBeUndefined();
  });

  it.each([
    ['a Free owner', FREE, 'free'],
    ['an owner whose trial expired', EXPIRED_TRIAL, 'trial_ended'],
  ])('denies %s every multi-shop operation and the switch to another shop', async (_label, state, reason) => {
    setEntitlement(state);
    // Denied for the plan itself — never merely because the cached
    // verification went stale, which would deny every state alike.
    expect((await getEffectiveEntitlementForShop(PRIMARY_SHOP))?.reason).toBe(reason);
    expect(await readMultiShopContext(PRIMARY_SHOP)).toMatchObject({ entitled: false });
    await expect(requireMultiShopAccess(PRIMARY_SHOP)).rejects.toBeInstanceOf(PlanAccessError);
    await expect(requireShopSwitchAccess(PRIMARY_SHOP, SECOND_SHOP)).rejects.toBeInstanceOf(PlanAccessError);
  });

  it.each([
    ['a Free owner', FREE],
    ['an expired trial', EXPIRED_TRIAL],
  ])('still lets %s return to the account primary shop', async (_label, state) => {
    setEntitlement(state);
    // Free covers exactly one shop. Refusing the way back would strand a
    // downgraded owner on a shop their plan no longer includes.
    await expect(requireShopSwitchAccess(SECOND_SHOP, PRIMARY_SHOP)).resolves.toBeUndefined();
  });

  it('honours the cached verification for exactly 30 days, and not a millisecond longer', async () => {
    setEntitlement(LIVE_TRIAL);
    const ceiling = Date.parse(T0) + MAX_OFFLINE_VERIFICATION_DAYS * DAY_MS;
    try {
      vi.setSystemTime(new Date(ceiling));
      expect(await readMultiShopContext(PRIMARY_SHOP)).toMatchObject({ entitled: true });
      await expect(requireMultiShopAccess(PRIMARY_SHOP)).resolves.toBeUndefined();

      vi.setSystemTime(new Date(ceiling + 1));
      expect(await readMultiShopContext(PRIMARY_SHOP)).toMatchObject({ entitled: false });
      await expect(requireMultiShopAccess(PRIMARY_SHOP)).rejects.toBeInstanceOf(PlanAccessError);
      await expect(requireShopSwitchAccess(PRIMARY_SHOP, SECOND_SHOP)).rejects.toBeInstanceOf(PlanAccessError);
      expect((await getEffectiveEntitlementForShop(PRIMARY_SHOP))?.reason).toBe('verification_stale');
    } finally {
      vi.setSystemTime(new Date(NOW));
    }
  });

  it('fails closed for a shop with no directory row at all', async () => {
    setEntitlement(LIVE_TRIAL);
    const unknownShop = '99999999-9999-4999-8999-999999999999';
    expect(await readMultiShopContext(unknownShop)).toEqual({ entitled: false, primaryShopId: null, liveShopCount: 0 });
    await expect(requireMultiShopAccess(unknownShop)).rejects.toBeInstanceOf(PlanAccessError);
    await expect(requireShopSwitchAccess(unknownShop, PRIMARY_SHOP)).rejects.toBeInstanceOf(PlanAccessError);
  });
});
