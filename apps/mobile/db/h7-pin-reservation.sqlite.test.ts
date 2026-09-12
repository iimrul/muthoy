import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, sqliteConnection } from './test/client';
import { users } from './schema';
import {
  createShopAndOwner,
  lockLocalUserAccess,
  setOwnerPin,
  verifyPin,
} from './auth';
import { createStaff, deactivateStaff, removeStaff } from './staff';
import { ALWAYS_LIVE, DuplicatePinError } from './errors';

// H-7. Which PINs are SPOKEN FOR, against a real SQLite engine.
//
// The defect: uniqueness scanned active rows only, so deactivating a staff
// member released their PIN. Somebody else took it, and reactivation — which
// only flips is_active and never re-checks — produced two live rows in one shop
// sharing a PIN. verifyPin fails closed on an ambiguous match, so reactivation
// locked out BOTH of them.
//
// Reservation and login eligibility are asserted separately here on purpose,
// because collapsing them is what caused the bug: a deactivated or locked user
// must KEEP their PIN and still be REFUSED at the pad.

const MIGRATIONS = resolve('apps/mobile/db/migrations');

function applyMigration(fileName: string): void {
  sqliteConnection.execSync(readFileSync(resolve(MIGRATIONS, fileName), 'utf8'));
}

// Distinct per call, so a leaked row surfaces as a duplicate rather than as a
// silently wrong assertion.
let credentialCounter = 0;
function nextPhone(): string {
  credentialCounter += 1;
  return `0173${String(credentialCounter).padStart(7, '0')}`;
}

const OWNER_PIN = '1111';
const STAFF_PIN = '2468';

beforeAll(() => {
  applyMigration('0000_open_senator_kelly.sql');
  applyMigration('0001_medicines_fts.sql');
  applyMigration('0002_furry_celestials.sql');
  applyMigration('0003_curious_wild_pack.sql');
  applyMigration('0004_deep_boomer.sql');
  applyMigration('0005_eminent_legion.sql');
  applyMigration('0006_inventory_movement_ledger.sql');
  applyMigration('0007_staff_device_login.sql');
  applyMigration('0008_native_pin_lookup.sql');
  applyMigration('0009_strong_gargoyle.sql');
  applyMigration('0010_known_ares.sql');
  applyMigration('0013_owner_dashboard_credit_period.sql');
  applyMigration('0014_owner_dashboard_credit_period_guard.sql');
  applyMigration('0015_b3_shop_settings.sql');
  applyMigration('0027_h7_local_access_lock.sql');
  applyMigration('0028_shop_scoped_pin_lookup.sql');
  applyMigration('0029_pin_reserved_while_inactive.sql');
});

beforeEach(() => {
  sqliteConnection.execSync('PRAGMA foreign_keys = OFF');
  for (const table of ['user_permissions', 'audit_logs', 'sync_queue', 'users', 'roles', 'shops']) {
    sqliteConnection.execSync(`DELETE FROM ${table}`);
  }
  sqliteConnection.execSync('PRAGMA foreign_keys = ON');
});

async function ownerFixture(pin = OWNER_PIN) {
  const registration = await createShopAndOwner({
    shopName: 'Reservation Shop',
    phone: nextPhone(),
  });
  await setOwnerPin(registration.userId, pin);
  return registration;
}

function claiming(
  owner: { shopId: string; userId: string },
  rawPin: string,
  role?: 'manager' | 'staff',
) {
  return createStaff(
    owner.shopId,
    owner.userId,
    {
      name: role === 'manager' ? 'Manager' : 'Staff',
      phone: nextPhone(),
      rawPin,
      permissions: {},
      role,
    },
    ALWAYS_LIVE,
  );
}

/** What hydration leaves behind after the server's staff-reactivate RPC. */
function reactivateLocally(staffId: string): void {
  db.update(users).set({ isActive: true }).where(eq(users.id, staffId)).run();
}

describe('H-7: a PIN stays reserved while the account is away', () => {
  it('keeps an INACTIVE staff PIN reserved', async () => {
    const owner = await ownerFixture();
    const staff = await claiming(owner, STAFF_PIN);
    await deactivateStaff(staff.id, owner.userId, ALWAYS_LIVE);

    // Precondition: the row really is inactive, so this is not passing for
    // some unrelated reason.
    expect(
      db.select({ isActive: users.isActive }).from(users).where(eq(users.id, staff.id)).get(),
    ).toEqual({ isActive: false });

    await expect(claiming(owner, STAFF_PIN)).rejects.toBeInstanceOf(DuplicatePinError);
  });

  it('keeps a LOCALLY LOCKED staff PIN reserved', async () => {
    const owner = await ownerFixture();
    const staff = await claiming(owner, STAFF_PIN);
    await lockLocalUserAccess(owner.shopId, staff.id);

    expect(
      db.select({ lockedAt: users.accessLockedAt }).from(users)
        .where(eq(users.id, staff.id)).get()?.lockedAt,
    ).toBeTruthy();

    await expect(claiming(owner, STAFF_PIN)).rejects.toBeInstanceOf(DuplicatePinError);
  });

  it('refuses a MANAGER the PIN of a revoked staff member', async () => {
    // The reported path: the owner revokes a cashier, then promotes somebody
    // and reuses the familiar PIN. Role is irrelevant to reservation.
    const owner = await ownerFixture();
    const staff = await claiming(owner, STAFF_PIN);
    await lockLocalUserAccess(owner.shopId, staff.id);
    await deactivateStaff(staff.id, owner.userId, ALWAYS_LIVE);

    await expect(claiming(owner, STAFF_PIN, 'manager')).rejects.toBeInstanceOf(DuplicatePinError);
  });

  it('lets a REACTIVATED staff member log in with their original PIN, unambiguously', async () => {
    const owner = await ownerFixture();
    const staff = await claiming(owner, STAFF_PIN);
    await deactivateStaff(staff.id, owner.userId, ALWAYS_LIVE);

    // While away, the PIN is refused to everyone else...
    await expect(claiming(owner, STAFF_PIN)).rejects.toBeInstanceOf(DuplicatePinError);
    // ...and refused to the absent member too, at the pad.
    await expect(verifyPin(STAFF_PIN)).resolves.toBeNull();

    reactivateLocally(staff.id);

    // Exactly one row can answer for this PIN, so the fail-closed
    // `verified.length !== 1` branch is never reached.
    await expect(verifyPin(STAFF_PIN)).resolves.toMatchObject({
      userId: staff.id,
      shopId: owner.shopId,
      role: 'staff',
    });
  });

  it('still allows the same PIN in a DIFFERENT shop', async () => {
    const first = await ownerFixture();
    const second = await createShopAndOwner({ shopName: 'Second Shop', phone: nextPhone() });
    await setOwnerPin(second.userId, STAFF_PIN);

    // Widening the scan to inactive rows must not have widened it back across
    // shops — that was migration 0028's fix and it still holds.
    const staff = await claiming(first, STAFF_PIN);

    expect(
      db.select({ shopId: users.shopId }).from(users).where(eq(users.id, staff.id)).get(),
    ).toEqual({ shopId: first.shopId });
  });

  it('still refuses a duplicate between two ACTIVE users in one shop', async () => {
    const owner = await ownerFixture();
    await claiming(owner, STAFF_PIN);

    await expect(claiming(owner, STAFF_PIN)).rejects.toBeInstanceOf(DuplicatePinError);
    // And against the owner's own PIN, which is the escalation case.
    await expect(claiming(owner, OWNER_PIN)).rejects.toBeInstanceOf(DuplicatePinError);
  });

  it('RELEASES a deleted user PIN — the chosen policy, stated', async () => {
    // Deletion is terminal: removeStaff sets is_deleted and nothing un-sets it
    // (reactivation only flips is_active, and isStaffAuthoritativelyActive
    // still requires !is_deleted). So no returning account can collide with the
    // reissued PIN, and holding it would burn a 4-digit space as staff turn
    // over. Deactivation is the reversible case, and it does NOT release.
    const owner = await ownerFixture();
    const staff = await claiming(owner, STAFF_PIN);
    await removeStaff(staff.id, owner.userId, ALWAYS_LIVE);

    const replacement = await claiming(owner, STAFF_PIN);
    expect(replacement.id).toBeTruthy();
    expect(replacement.id).not.toBe(staff.id);

    // The tombstone is still there — the PIN was released, not the history.
    expect(
      db.select({ isDeleted: users.isDeleted }).from(users).where(eq(users.id, staff.id)).get(),
    ).toEqual({ isDeleted: true });

    // And the replacement is the only one who can use it.
    await expect(verifyPin(STAFF_PIN)).resolves.toMatchObject({ userId: replacement.id });
  });

  it('does not change who may log in: owner, manager and staff all still do', async () => {
    const owner = await ownerFixture();
    const manager = await claiming(owner, '3333', 'manager');
    const staff = await claiming(owner, '4444');

    await expect(verifyPin(OWNER_PIN)).resolves.toMatchObject({ userId: owner.userId, role: 'owner' });
    await expect(verifyPin('3333')).resolves.toMatchObject({ userId: manager.id, role: 'manager' });
    await expect(verifyPin('4444')).resolves.toMatchObject({ userId: staff.id, role: 'staff' });

    // Reservation widened; eligibility did not. Both remain refused at the pad.
    await deactivateStaff(staff.id, owner.userId, ALWAYS_LIVE);
    await lockLocalUserAccess(owner.shopId, manager.id);
    await expect(verifyPin('4444')).resolves.toBeNull();
    await expect(verifyPin('3333')).resolves.toBeNull();
    // The owner is untouched by either.
    await expect(verifyPin(OWNER_PIN)).resolves.toMatchObject({ userId: owner.userId });
  });

  it('has an index whose predicate agrees with the application check', async () => {
    // The DB backstop and assertPinUnique must not drift apart: an is_active
    // clause here would re-open the hole at the storage layer, where a sync
    // hydration that flips is_active could resurrect an ambiguous pair.
    const row = sqliteConnection.getFirstSync<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'users_live_pin_lookup_unique'",
    );
    expect(row?.sql).toBeTruthy();
    const normalized = row!.sql.replace(/`/g, '').replace(/\s+/g, ' ');
    expect(normalized).toContain('(shop_id, pin_lookup_tag)');
    expect(normalized).toContain('is_deleted = 0');
    expect(normalized).not.toContain('is_active');
  });
});
