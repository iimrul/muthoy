import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { normalizeBdPhone } from '@muthoy/validation';
import { db, sqliteConnection } from './test/client';
import { syncQueue, users } from './schema';
import { createShopAndOwner, requirePermission, setOwnerPin, verifyPin } from './auth';
import {
  createStaff,
  deactivateStaff,
  listStaff,
  resetStaffPin,
  setStaffPermissions,
} from './staff';
import {
  ALWAYS_LIVE,
  DuplicatePhoneError,
  DuplicatePinError,
  NotAuthorizedError,
} from './errors';

// Per-staff permissions and the phone credential, against a REAL SQLite engine
// with migration 0007 applied — not mocks. The point of the feature is that a
// staff member can be given or denied one capability, and that the local guard
// and the login path agree about it; asserting that against a stub would prove
// nothing.
//
// The server half of the same rules (user_has_permission / sync_row_permitted)
// is Postgres and cannot execute here; it is asserted structurally in
// backend/supabase/functions/sync/device-login.test.ts.

const MIGRATIONS = resolve('apps/mobile/db/migrations');
const OWNER_PIN = '1234';

function applyMigration(fileName: string): void {
  sqliteConnection.execSync(readFileSync(resolve(MIGRATIONS, fileName), 'utf8'));
}

// Phones and PINs are unique across the whole suite anyway, so a leaked row
// would surface as a duplicate rather than as a silently wrong assertion.
let credentialCounter = 0;
function nextPhone(): string {
  credentialCounter += 1;
  return `0172${String(credentialCounter).padStart(7, '0')}`;
}
function nextPin(): string {
  credentialCounter += 1;
  return String(1000 + credentialCounter);
}

/**
 * Empties the auth tables between tests.
 *
 * Not tidiness — correctness AND speed. verifyPin deliberately checks a PIN
 * against EVERY active local user (Volume 0 scopes Beta to one shop per device,
 * so there is no "who are you" step before PIN entry). Letting shops accumulate
 * would mean each verifyPin call runs one bcrypt comparison per user ever
 * created here: the assertions would start resolving to an earlier test's staff
 * member, and the suite would slow to a timeout at ~300ms per hash.
 */
function resetAuthTables(): void {
  sqliteConnection.execSync('PRAGMA foreign_keys = OFF');
  for (const table of ['user_permissions', 'audit_logs', 'sync_queue', 'users', 'roles', 'shops']) {
    sqliteConnection.execSync(`DELETE FROM ${table}`);
  }
  sqliteConnection.execSync('PRAGMA foreign_keys = ON');
}

interface Fixture {
  shopId: string;
  ownerId: string;
  ownerPhone: string;
}

function permissionVersionOf(userId: string): number {
  return (
    db
      .select({ value: users.permissionVersion })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.value ?? -1
  );
}

let fixture: Fixture;

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
});

beforeEach(async () => {
  resetAuthTables();
  const ownerPhone = nextPhone();
  const { shopId, userId } = await createShopAndOwner({
    shopName: 'Permission Pharmacy',
    phone: ownerPhone,
  });
  await setOwnerPin(userId, OWNER_PIN);
  fixture = { shopId, ownerId: userId, ownerPhone };
});

describe('phone as a login credential', () => {
  it('creates a staff login and its users outbox row with a unique PIN', async () => {
    const pin = nextPin();
    const staff = await createStaff(
      fixture.shopId,
      fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: pin, permissions: {} },
      ALWAYS_LIVE,
    );

    await expect(verifyPin(pin)).resolves.toMatchObject({
      shopId: fixture.shopId,
      userId: staff.id,
      role: 'staff',
    });
    const queued = db
      .select({ op: syncQueue.op, payload: syncQueue.payload, status: syncQueue.status })
      .from(syncQueue)
      .where(and(eq(syncQueue.tableName, 'users'), eq(syncQueue.rowId, staff.id)))
      .get();
    expect(queued).toMatchObject({ op: 'insert', status: 'pending' });
    expect(JSON.parse(queued!.payload)).not.toMatchObject({ pin: pin, pin_hash: pin });
  });

  it('stores the phone the owner assigned, so a fresh device can name the account', async () => {
    const phone = nextPhone();
    const staff = await createStaff(
      fixture.shopId,
      fixture.ownerId,
      { name: 'Arif', phone, rawPin: '4321', permissions: {} },
      ALWAYS_LIVE,
    );

    // Stored CANONICAL, not as typed. Phone is a credential: the login lookup,
    // the unique index and the server's lockout key all compare this string, so
    // '01720000002' and '+8801720000002' must not become two accounts.
    expect(staff.phone).toBe(normalizeBdPhone(phone));
    const roster = await listStaff(fixture.shopId, fixture.ownerId);
    expect(roster.map((member) => member.phone)).toEqual([normalizeBdPhone(phone)]);
  });

  it('refuses a phone already used by a live user, because a login must resolve to one account', async () => {
    const phone = nextPhone();
    await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone, rawPin: '4321', permissions: {} }, ALWAYS_LIVE,
    );

    await expect(
      createStaff(
        fixture.shopId, fixture.ownerId,
        { name: 'Rina', phone, rawPin: '4322', permissions: {} }, ALWAYS_LIVE,
      ),
    ).rejects.toBeInstanceOf(DuplicatePhoneError);

    // And the rejected attempt left nothing partial behind.
    const roster = await listStaff(fixture.shopId, fixture.ownerId);
    expect(roster).toHaveLength(1);
  });

  it("refuses the owner's own number too — one number, one account", async () => {
    await expect(
      createStaff(
        fixture.shopId, fixture.ownerId,
        { name: 'Impostor', phone: fixture.ownerPhone, rawPin: '4321', permissions: {} }, ALWAYS_LIVE,
      ),
    ).rejects.toBeInstanceOf(DuplicatePhoneError);
  });
});

describe('per-staff permission overrides', () => {
  it('denies a capability the staff default does not include', async () => {
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: '4321', permissions: {} }, ALWAYS_LIVE,
    );

    await expect(
      requirePermission(fixture.shopId, staff.id, 'cash_management'),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('grants a capability the owner explicitly allowed, without promoting the role', async () => {
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: '4321', permissions: { cash_management: true } },
      ALWAYS_LIVE,
    );

    await expect(
      requirePermission(fixture.shopId, staff.id, 'cash_management'),
    ).resolves.toBeUndefined();
    // Everything NOT granted stays denied — an override is one key, not a
    // promotion to owner.
    await expect(
      requirePermission(fixture.shopId, staff.id, 'staff_management'),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('revokes a capability the staff default DOES include', async () => {
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: '4321', permissions: { sales: false } },
      ALWAYS_LIVE,
    );

    await expect(
      requirePermission(fixture.shopId, staff.id, 'sales'),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('carries the overrides into the session verifyPin builds', async () => {
    const pin = nextPin();
    await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: pin, permissions: { cash_management: true } },
      ALWAYS_LIVE,
    );

    await expect(verifyPin(pin)).resolves.toMatchObject({
      role: 'staff',
      permissions: { cash_management: true },
    });
  });

  it('lets the owner change them later, and clears one back to the default', async () => {
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: '4321', permissions: { cash_management: true } },
      ALWAYS_LIVE,
    );

    await setStaffPermissions(fixture.shopId, fixture.ownerId, staff.id, {}, ALWAYS_LIVE);

    await expect(
      requirePermission(fixture.shopId, staff.id, 'cash_management'),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    // Back to "no overrides at all", not to "an override that says false" —
    // absence is what the whole system reads as "use the role default".
    const roster = await listStaff(fixture.shopId, fixture.ownerId);
    expect(roster[0]?.permissions).toEqual({});
  });

  it('is owner-only: a staff member cannot grant themselves anything', async () => {
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: '4321', permissions: {} }, ALWAYS_LIVE,
    );

    await expect(
      setStaffPermissions(
        fixture.shopId, staff.id, staff.id, { staff_management: true }, ALWAYS_LIVE,
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('ignores an override that would deny an OWNER their own administration', async () => {
    // The owner is the only account that can edit permissions, so honouring a
    // stored denial against them would lock a shop out of itself with no way
    // back in. Owner stays "everything, as a rule".
    await setStaffPermissions(
      fixture.shopId, fixture.ownerId, fixture.ownerId, { staff_management: false }, ALWAYS_LIVE,
    );

    await expect(
      requirePermission(fixture.shopId, fixture.ownerId, 'staff_management'),
    ).resolves.toBeUndefined();
  });
});

describe('permission_version is a read-only server mirror', () => {
  it('does not generate a client version when the owner changes permissions', async () => {
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: '4321', permissions: {} }, ALWAYS_LIVE,
    );
    const before = permissionVersionOf(staff.id);

    await setStaffPermissions(
      fixture.shopId, fixture.ownerId, staff.id, { cash_management: true }, ALWAYS_LIVE,
    );

    expect(permissionVersionOf(staff.id)).toBe(before);
  });

  it('does not generate a client version on deactivation, while local access still stops', async () => {
    const pin = nextPin();
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: pin, permissions: {} }, ALWAYS_LIVE,
    );
    const before = permissionVersionOf(staff.id);

    await deactivateStaff(staff.id, fixture.ownerId, ALWAYS_LIVE);

    expect(permissionVersionOf(staff.id)).toBe(before);
    await expect(
      requirePermission(fixture.shopId, staff.id, 'sales'),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    // The offline half of the same revocation: their PIN stops minting a
    // session on this device too, not only at the server.
    await expect(verifyPin(pin)).resolves.toBeNull();
  });

  it('does not generate a client version on a PIN reset', async () => {
    const oldPin = nextPin();
    const newPin = nextPin();
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: oldPin, permissions: {} }, ALWAYS_LIVE,
    );
    const before = permissionVersionOf(staff.id);

    await resetStaffPin(staff.id, newPin, fixture.ownerId, ALWAYS_LIVE);

    expect(permissionVersionOf(staff.id)).toBe(before);
    await expect(verifyPin(oldPin)).resolves.toBeNull();
    await expect(verifyPin(newPin)).resolves.toMatchObject({ userId: staff.id });
  });

  it('omits permission_version from every queued users payload', async () => {
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: nextPin(), permissions: {} }, ALWAYS_LIVE,
    );
    await deactivateStaff(staff.id, fixture.ownerId, ALWAYS_LIVE);

    const queued = db
      .select({ payload: syncQueue.payload })
      .from(syncQueue)
      .where(eq(syncQueue.tableName, 'users'))
      .all();
    expect(queued.length).toBeGreaterThan(0);
    for (const row of queued) {
      expect(JSON.parse(row.payload) as Record<string, unknown>).not.toHaveProperty('permission_version');
    }
  });
});

describe('offline relogin after enrolment', () => {
  it('matches a staff PIN locally with no network and no phone re-entry', async () => {
    const pin = nextPin();
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: pin, permissions: {} }, ALWAYS_LIVE,
    );

    // verifyPin touches no network at all — it IS the offline path — and still
    // returns the shop, the user and the effective permissions.
    await expect(verifyPin(pin)).resolves.toEqual({
      shopId: fixture.shopId,
      userId: staff.id,
      role: 'staff',
      permissions: {},
    });
  });
});

describe('a PIN identifies exactly one person', () => {
  // PIN Login has no "who are you" step: verifyPin compares the typed PIN
  // against EVERY live user and returns the FIRST match. Two people sharing one
  // therefore does not produce a clash — it produces a silent impersonation,
  // and if the collision is with the owner it is a privilege escalation. These
  // are the guards that make that unreachable.

  it('refuses a staff PIN that equals the owner PIN — the escalation case', async () => {
    await expect(
      createStaff(
        fixture.shopId, fixture.ownerId,
        { name: 'Arif', phone: nextPhone(), rawPin: OWNER_PIN, permissions: {} }, ALWAYS_LIVE,
      ),
    ).rejects.toBeInstanceOf(DuplicatePinError);
  });

  it('refuses a PIN another staff member already has', async () => {
    const pin = nextPin();
    await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: pin, permissions: {} }, ALWAYS_LIVE,
    );

    await expect(
      createStaff(
        fixture.shopId, fixture.ownerId,
        { name: 'Rina', phone: nextPhone(), rawPin: pin, permissions: {} }, ALWAYS_LIVE,
      ),
    ).rejects.toBeInstanceOf(DuplicatePinError);
  });

  it('refuses a PIN RESET that would collide, leaving the old PIN working', async () => {
    const pin = nextPin();
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: pin, permissions: {} }, ALWAYS_LIVE,
    );

    await expect(
      resetStaffPin(staff.id, OWNER_PIN, fixture.ownerId, ALWAYS_LIVE),
    ).rejects.toBeInstanceOf(DuplicatePinError);

    // Refused BEFORE the hash was written, so they can still log in.
    await expect(verifyPin(pin)).resolves.toMatchObject({ userId: staff.id });
  });

  it('lets a staff member keep their own PIN on a reset', async () => {
    const pin = nextPin();
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: pin, permissions: {} }, ALWAYS_LIVE,
    );
    // Their own hash must not count as a collision with themselves.
    await expect(
      resetStaffPin(staff.id, pin, fixture.ownerId, ALWAYS_LIVE),
    ).resolves.toBeUndefined();
  });

  it('so every live PIN resolves to the user who owns it', async () => {
    const arifPin = nextPin();
    const rinaPin = nextPin();
    const arif = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: nextPhone(), rawPin: arifPin, permissions: {} }, ALWAYS_LIVE,
    );
    const rina = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Rina', phone: nextPhone(), rawPin: rinaPin, permissions: {} }, ALWAYS_LIVE,
    );

    await expect(verifyPin(arifPin)).resolves.toMatchObject({ userId: arif.id, role: 'staff' });
    await expect(verifyPin(rinaPin)).resolves.toMatchObject({ userId: rina.id, role: 'staff' });
    await expect(verifyPin(OWNER_PIN)).resolves.toMatchObject({
      userId: fixture.ownerId,
      role: 'owner',
    });
  });
});

describe('a phone identifies exactly one account, however it is typed', () => {
  it('refuses the same subscriber written in another format', async () => {
    // '01712345678' and '+8801712345678' are one person. Stored as typed they
    // were two accounts, and a fresh-device login could resolve to either.
    const local = nextPhone();
    const withCountryCode = `+88${local}`;

    await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: local, rawPin: nextPin(), permissions: {} }, ALWAYS_LIVE,
    );

    await expect(
      createStaff(
        fixture.shopId, fixture.ownerId,
        { name: 'Impostor', phone: withCountryCode, rawPin: nextPin(), permissions: {} },
        ALWAYS_LIVE,
      ),
    ).rejects.toBeInstanceOf(DuplicatePhoneError);
  });

  it('stores whichever form was typed as the one canonical string', async () => {
    const local = nextPhone();
    const staff = await createStaff(
      fixture.shopId, fixture.ownerId,
      { name: 'Arif', phone: `+88${local}`, rawPin: nextPin(), permissions: {} }, ALWAYS_LIVE,
    );
    expect(staff.phone).toBe(normalizeBdPhone(local));
  });
});
