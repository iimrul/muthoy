import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const { shops, roles, users, billingAccounts, entitlementCache } = await import('./schema');
const { cacheCommercialSnapshot, getEffectiveEntitlementForShop } = await import('./commercial');

const SHOP_ID = '81111111-1111-4111-8111-111111111111';
const OWNER_ID = '82222222-2222-4222-8222-222222222222';
const ROLE_ID = '84444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '86666666-6666-4666-8666-666666666666';
const MEMBERSHIP_ID = '87777777-7777-4777-8777-777777777777';
const GRANTED_AT = '2026-09-01T06:00:00.000Z';
const TRIAL_END = '2026-09-15T06:00:00.000Z';

beforeAll(() => {
  sqlite.exec('PRAGMA foreign_keys=ON');
  const migrationDir = resolve('apps/mobile/db/migrations');
  for (const file of readdirSync(migrationDir).filter((name) => /^00(?:0\d|1\d|2[0-9])_.*\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(resolve(migrationDir, file), 'utf8'));
  }
  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Trial Shop', phone: '01700000011', createdAt: GRANTED_AT, updatedAt: GRANTED_AT }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: GRANTED_AT, updatedAt: GRANTED_AT }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000011', pinHash: 'hash', pinSetAt: GRANTED_AT, roleId: ROLE_ID, isActive: true, createdAt: GRANTED_AT, updatedAt: GRANTED_AT }).run();
});

describe('B4 verified trial cache hydration', () => {
  it('hydrates Trial state idempotently and reinstall/login replay cannot restart it', async () => {
    const snapshot = {
      directory_complete: true,
      account: {
        id: ACCOUNT_ID, principal_owner_user_id: OWNER_ID, primary_shop_id: SHOP_ID,
        launch_trial_granted_at: GRANTED_AT, created_at: GRANTED_AT, updated_at: GRANTED_AT,
      },
      entitlement: {
        billing_account_id: ACCOUNT_ID, tier: 'free' as const, status: 'trialing' as const,
        trial_ends_at: TRIAL_END, paid_through: null, grace_ends_at: null,
        verified_at: GRANTED_AT, version: 1, updated_at: GRANTED_AT,
      },
      memberships: [{
        id: MEMBERSHIP_ID, billing_account_id: ACCOUNT_ID, principal_user_id: OWNER_ID,
        shop_id: SHOP_ID, actor_user_id: OWNER_ID, role: 'owner' as const, is_active: true,
        created_at: GRANTED_AT, updated_at: GRANTED_AT,
      }],
      shops: [{
        id: SHOP_ID, name: 'Trial Shop', name_en: null, commercial_status: 'active' as const,
        commercial_reason: null, archived_at: null, created_at: GRANTED_AT, updated_at: GRANTED_AT,
      }],
    };

    await cacheCommercialSnapshot(snapshot);
    await cacheCommercialSnapshot(snapshot);

    const entitlement = await getEffectiveEntitlementForShop(SHOP_ID, new Date('2026-09-02T06:00:00.000Z'));
    expect(entitlement).toMatchObject({ commercialTier: 'free', effectiveTier: 'ultra', reason: 'trial', premium: true, accessEndsAt: TRIAL_END });
    expect(await db.select({ grantedAt: billingAccounts.launchTrialGrantedAt }).from(billingAccounts).where(eq(billingAccounts.id, ACCOUNT_ID)).get()).toEqual({ grantedAt: GRANTED_AT });
    expect(await db.select({ trialEndsAt: entitlementCache.trialEndsAt, graceEndsAt: entitlementCache.graceEndsAt }).from(entitlementCache).where(eq(entitlementCache.billingAccountId, ACCOUNT_ID)).get()).toEqual({ trialEndsAt: TRIAL_END, graceEndsAt: null });
    expect(db.select().from(billingAccounts).all()).toHaveLength(1);
    expect(db.select().from(entitlementCache).all()).toHaveLength(1);
  });
});
