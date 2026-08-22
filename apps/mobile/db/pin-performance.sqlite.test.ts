import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, sqliteConnection } from './test/client';
import { syncQueue, users } from './schema';
import { createShopAndOwner, setOwnerPin, verifyPin } from './auth';
import { createStaff } from './staff';
import { ALWAYS_LIVE, DuplicatePinError } from './errors';
import {
  getNativeCryptoTestCounters,
  resetNativeCryptoTestCounters,
} from './test/muthoy-pin-crypto';

const MIGRATIONS = resolve('apps/mobile/db/migrations');

function migrate(name: string): void {
  sqliteConnection.execSync(readFileSync(resolve(MIGRATIONS, name), 'utf8'));
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql',
    '0001_medicines_fts.sql',
    '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql',
    '0004_deep_boomer.sql',
    '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql',
    '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql',
    '0010_known_ares.sql',
    '0013_owner_dashboard_credit_period.sql',
    '0014_owner_dashboard_credit_period_guard.sql',
  ]) migrate(name);
});

beforeEach(() => {
  sqliteConnection.execSync('PRAGMA foreign_keys = OFF');
  for (const table of ['user_permissions', 'audit_logs', 'sync_queue', 'users', 'roles', 'shops']) {
    sqliteConnection.execSync(`DELETE FROM ${table}`);
  }
  sqliteConnection.execSync('PRAGMA foreign_keys = ON');
  resetNativeCryptoTestCounters();
});

async function ownerFixture() {
  const registration = await createShopAndOwner({
    shopName: 'Fast PIN Shop',
    phone: '01712000001',
  });
  await setOwnerPin(registration.userId, '1234');
  return registration;
}

describe('indexed local PIN paths', () => {
  it('uses O(1) uniqueness plus one hash for normal staff creation', async () => {
    const owner = await ownerFixture();
    resetNativeCryptoTestCounters();

    const staff = await createStaff(
      owner.shopId,
      owner.userId,
      { name: 'Arif', phone: '01712000002', rawPin: '5678', permissions: {} },
      ALWAYS_LIVE,
    );

    expect(getNativeCryptoTestCounters()).toEqual({ hash: 1, verify: 0, lookupTag: 1 });
    expect(staff.id).toBeTruthy();
  });

  it('uses one bcrypt compare for an indexed enrolled login and zero for a miss', async () => {
    const owner = await ownerFixture();
    await createStaff(
      owner.shopId,
      owner.userId,
      { name: 'Arif', phone: '01712000002', rawPin: '5678', permissions: {} },
      ALWAYS_LIVE,
    );

    resetNativeCryptoTestCounters();
    await expect(verifyPin('5678')).resolves.toMatchObject({ role: 'staff' });
    expect(getNativeCryptoTestCounters()).toEqual({ hash: 0, verify: 1, lookupTag: 1 });

    resetNativeCryptoTestCounters();
    await expect(verifyPin('9999')).resolves.toBeNull();
    expect(getNativeCryptoTestCounters()).toEqual({ hash: 0, verify: 0, lookupTag: 1 });
  });

  it('lazily indexes a standard legacy bcrypt hash and keeps it usable', async () => {
    const owner = await ownerFixture();
    db.update(users)
      .set({ pinLookupTag: null, pinLookupPinSetAt: null })
      .where(eq(users.id, owner.userId))
      .run();

    resetNativeCryptoTestCounters();
    await expect(verifyPin('1234')).resolves.toMatchObject({ userId: owner.userId });
    expect(getNativeCryptoTestCounters().verify).toBe(1);
    expect(
      db.select({ tag: users.pinLookupTag }).from(users).where(eq(users.id, owner.userId)).get()?.tag,
    ).toBeTruthy();
  });

  it('rejects an indexed duplicate without bcrypt scanning', async () => {
    const owner = await ownerFixture();
    resetNativeCryptoTestCounters();

    await expect(createStaff(
      owner.shopId,
      owner.userId,
      { name: 'Arif', phone: '01712000002', rawPin: '1234', permissions: {} },
      ALWAYS_LIVE,
    )).rejects.toBeInstanceOf(DuplicatePinError);
    expect(getNativeCryptoTestCounters()).toEqual({ hash: 0, verify: 0, lookupTag: 1 });
  });

  it('enforces device-wide uniqueness with one lookup even across shops', async () => {
    const first = await ownerFixture();
    const second = await createShopAndOwner({
      shopName: 'Second Shop',
      phone: '01712000003',
    });
    await setOwnerPin(second.userId, '9999');
    resetNativeCryptoTestCounters();

    await expect(createStaff(
      first.shopId,
      first.userId,
      { name: 'Arif', phone: '01712000002', rawPin: '9999', permissions: {} },
      ALWAYS_LIVE,
    )).rejects.toBeInstanceOf(DuplicatePinError);
    expect(getNativeCryptoTestCounters()).toEqual({ hash: 0, verify: 0, lookupTag: 1 });
  });

  it('never includes local lookup fields in a users outbox payload', async () => {
    const owner = await ownerFixture();
    const queued = db
      .select({ payload: syncQueue.payload })
      .from(syncQueue)
      .where(and(eq(syncQueue.tableName, 'users'), eq(syncQueue.rowId, owner.userId)))
      .all();
    expect(queued.length).toBeGreaterThan(0);
    for (const row of queued) {
      expect(row.payload).not.toContain('pin_lookup_tag');
      expect(row.payload).not.toContain('pin_lookup_pin_set_at');
    }
  });
});
