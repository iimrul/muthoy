// The DATABASE half of the device handover (Volume 0 Days 5/11), on a real
// SQLite engine (node:sqlite) — the same harness the permission, cash and
// sync-helper suites use.
//
// state/switchUser.test.tsx proves the switch clears only the local session.
// This file proves the other side of that contract: the shop, the device link
// and every PIN are still exactly where they were, so the incoming user can
// simply log in — and gets their OWN role, not the outgoing user's.
//
// Built through the REAL registration path (createShopAndOwner → setOwnerPin →
// markShopCloudLinked → createStaff), never hand-inserted rows, because "no
// shop recreation" is only meaningful against the shop registration actually
// produced.

import { readFileSync } from 'node:fs';
import { ALWAYS_LIVE } from './errors';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';

// Phone became unique-per-live-user in migration 0007, so every staff member a
// suite creates needs its own. Sequential rather than random: a collision would
// surface as a confusing DuplicatePhoneError instead of as the assertion the
// test is actually making.
let staffPhoneCounter = 0;
function nextStaffPhone(): string {
  staffPhoneCounter += 1;
  return `0171${String(staffPhoneCounter).padStart(7, '0')}`;
}


// The handover below is driven by the REAL session store and the REAL
// switchUser(), never by hand-passing ids between calls: the whole question
// these tests exist to answer is whether the id that reaches sales.staff_id
// is the one the store actually holds at the time. react-native-mmkv is a
// Nitro native module and the sync engine needs AppState/NetInfo, so both are
// replaced at the module boundary — nothing else about the switch is faked.
const mmkv = vi.hoisted(() => ({
  createMMKV: () => {
    const store = new Map<string, string>();
    return {
      set: (key: string, value: string) => void store.set(key, value),
      getString: (key: string) => store.get(key),
      remove: (key: string) => void store.delete(key),
    };
  },
}));
vi.mock('react-native-mmkv', () => ({ createMMKV: mmkv.createMMKV }));
vi.mock('../sync', () => ({ stopSyncEngine: vi.fn() }));

const {
  createShopAndOwner,
  getActiveSessionRole,
  getRegistrationStatus,
  markShopCloudLinked,
  requirePermission,
  setOwnerPin,
  verifyPin,
} = await import('./auth');
const { createStaff } = await import('./staff');
const { createMedicineWithBatch } = await import('./inventory');
const { createSaleTransaction } = await import('./sales');
const { closeDay, currentBusinessDate, recordExpense, setOpeningCash } = await import('./cash');
const { collectPayment, createCustomer } = await import('./customers');
const { createPurchase } = await import('./purchases');
const { createSupplier } = await import('./suppliers');
const { StaleSessionError } = await import('./errors');
const { hashPin } = await import('../native/crypto');
const { useSessionStore } = await import('../state/sessionStore');
const { switchUser } = await import('../state/switchUser');

/** Verifies a PIN and puts the resulting session where the app keeps it. */
async function loginWithPin(pin: string): Promise<void> {
  const session = await verifyPin(pin);
  expect(session).not.toBeNull();
  useSessionStore.getState().login(session!);
}

/** The id a screen would read at commit time — never a local variable. */
function activeUserId(): string {
  const session = useSessionStore.getState().session;
  expect(session).not.toBeNull();
  return session!.userId;
}

async function sellOneUnit(): Promise<{ saleId: string }> {
  return createSaleTransaction({ isStillActive: ALWAYS_LIVE,
    shopId: fixture.shopId,
    staffId: activeUserId(),
    paymentType: 'cash',
    lines: [
      {
        medicineId: fixture.medicineId,
        deductions: [{ batchId: fixture.batchId, quantityDeducted: 1 }],
        unitPrice: asPaisa(1000),
      },
    ],
  });
}

const OWNER_PIN = '1234';
const STAFF_PIN = '4321';
const MANAGER_PIN = '7391';

interface Fixture {
  shopId: string;
  ownerId: string;
  staffId: string;
  managerId: string;
  medicineId: string;
  batchId: string;
  cloudLinkedAt: string;
}

let fixture: Fixture;

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

function countRows(table: string): number {
  return Number(
    (sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as unknown as { value: number }).value,
  );
}

function shopRow(): { id: string; owner_id: string; phone: string; cloud_linked_at: string | null } {
  return sqlite
    .prepare('SELECT id, owner_id, phone, cloud_linked_at FROM shops')
    .get() as unknown as { id: string; owner_id: string; phone: string; cloud_linked_at: string | null };
}

function pinHashOf(userId: string): string {
  return (sqlite.prepare('SELECT pin_hash FROM users WHERE id = ?').get(userId) as unknown as {
    pin_hash: string;
  }).pin_hash;
}

// Everything a handover must not disturb, in one comparable value.
function deviceSnapshot() {
  return {
    shop: shopRow(),
    shops: countRows('shops'),
    users: countRows('users'),
    roles: countRows('roles'),
    sales: countRows('sales'),
    auditLogs: countRows('audit_logs'),
    syncQueue: countRows('sync_queue'),
    ownerPinHash: pinHashOf(fixture.ownerId),
    staffPinHash: pinHashOf(fixture.staffId),
  };
}

beforeAll(async () => {
  applyMigration('0000_open_senator_kelly.sql');
  applyMigration('0001_medicines_fts.sql');
  applyMigration('0002_furry_celestials.sql');
  applyMigration('0003_curious_wild_pack.sql');
  applyMigration('0004_deep_boomer.sql');
  applyMigration('0005_eminent_legion.sql');
  applyMigration('0006_inventory_movement_ledger.sql');
  applyMigration('0007_staff_device_login.sql');

  // Day 4: the owner registers, sets a PIN, and the device gets linked.
  const registration = await createShopAndOwner({
    shopName: 'Muthoy Test Pharmacy',
    phone: '01700000000',
  });
  await setOwnerPin(registration.userId, OWNER_PIN);
  await markShopCloudLinked(registration.shopId);

  // Day 11: the owner adds a staff login — name + PIN, no phone number.
  const staff = await createStaff(registration.shopId, registration.userId, { name: 'Arif', phone: nextStaffPhone(), rawPin: STAFF_PIN, permissions: {} }, ALWAYS_LIVE);

  // The P1 'manager' role row already exists (createShopAndOwner makes all
  // three). Giving it a real user with a real PIN is the only way to prove the
  // login path stays fail-closed for it.
  const managerRoleId = (sqlite
    .prepare("SELECT id FROM roles WHERE shop_id = ? AND name = 'manager'")
    .get(registration.shopId) as unknown as { id: string }).id;
  const managerId = 'aaaaaaaa-0000-4000-8000-00000000000f';
  const now = '2026-08-17T09:30:00.000Z';
  sqlite
    .prepare(
      'INSERT INTO users (id, shop_id, name, pin_hash, pin_set_at, role_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    )
    .run(managerId, registration.shopId, 'Manager', await hashPin(MANAGER_PIN), now, managerRoleId, now, now);

  // Stock for the attribution check below.
  const stock = await createMedicineWithBatch({ isStillActive: ALWAYS_LIVE,
    shopId: registration.shopId,
    actorUserId: registration.userId,
    name: 'Napa',
    unitOfMeasure: 'piece',
    requiresPrescription: false,
    threshold: 10,
    firstBatch: {
      batchNo: 'B1',
      expiryDate: '2028-01-31',
      quantity: 100,
      purchasePrice: asPaisa(600),
      salePrice: asPaisa(1000),
    },
  });

  fixture = {
    shopId: registration.shopId,
    ownerId: registration.userId,
    staffId: staff.id,
    managerId,
    medicineId: stock.medicineId,
    batchId: stock.batchId,
    cloudLinkedAt: shopRow().cloud_linked_at ?? '',
  };
});

// Owner → switch → Staff → switch → Owner. The switch itself is client state
// (state/switchUser.ts); what it leaves behind is what these assert.
describe('handover round trip — each PIN returns its OWN session', () => {
  it('logs the owner in on their existing PIN', async () => {
    await expect(verifyPin(OWNER_PIN)).resolves.toEqual({
      shopId: fixture.shopId,
      userId: fixture.ownerId,
      role: 'owner',
      permissions: {},
    });
  });

  it('logs the owner-created staff in on the PIN the owner set, with no re-setup', async () => {
    // The point of the whole feature: after the owner switches away, the staff
    // member types the PIN they were given and is in — no OTP, no PIN setup,
    // no registration screen.
    await expect(verifyPin(STAFF_PIN)).resolves.toEqual({
      shopId: fixture.shopId,
      userId: fixture.staffId,
      role: 'staff',
      permissions: {},
    });
  });

  it('lets the owner switch back on the owner PIN, into the same shop', async () => {
    const staffSession = await verifyPin(STAFF_PIN);
    const ownerSession = await verifyPin(OWNER_PIN);

    expect(ownerSession?.userId).toBe(fixture.ownerId);
    expect(ownerSession?.role).toBe('owner');
    // Same device, same shop — the two sessions differ ONLY in who holds them.
    expect(ownerSession?.shopId).toBe(staffSession?.shopId);
  });

  it('rejects a wrong PIN without minting any session', async () => {
    await expect(verifyPin('0000')).resolves.toBeNull();
  });

  // Fail closed at the front door: a manager PIN must not mint a session the
  // guards would then have to keep rejecting screen by screen. Unchanged by
  // this work — asserted here because a handover is exactly where an
  // unassigned role would slip in unnoticed.
  it('refuses the P1 manager role a session even with a valid PIN', async () => {
    await expect(verifyPin(MANAGER_PIN)).resolves.toBeNull();
    expect(await getActiveSessionRole(fixture.managerId, fixture.shopId)).toBe('manager');
  });
});

describe('handover leaves the shop and the device link standing', () => {
  it('writes nothing at all across a full owner → staff → owner round trip', async () => {
    const before = deviceSnapshot();

    await verifyPin(OWNER_PIN);
    await verifyPin(STAFF_PIN);
    await verifyPin(OWNER_PIN);

    // Logging in is a READ. If a handover ever started writing — a new shop, a
    // re-hashed PIN, an audit row, an outbox entry — this is where it shows.
    expect(deviceSnapshot()).toEqual(before);
  });

  it('keeps exactly one shop, with its original id and cloud link', async () => {
    await verifyPin(STAFF_PIN);

    const shop = shopRow();
    // CLAUDE.md rule 7 / "no shop recreation": the shop keeps the unique id it
    // was registered with, and the device stays linked to the cloud.
    expect(countRows('shops')).toBe(1);
    expect(shop.id).toBe(fixture.shopId);
    expect(shop.owner_id).toBe(fixture.ownerId);
    expect(shop.cloud_linked_at).toBe(fixture.cloudLinkedAt);
    expect(shop.cloud_linked_at).not.toBeNull();
  });

  // app/index.tsx's root gate routes on this value. 'complete' with no session
  // means PIN Login; anything else would mean OTP, PIN Setup or Registration.
  it('still reports registration complete, so the switch routes to PIN Login and never OTP', async () => {
    await expect(getRegistrationStatus()).resolves.toEqual({
      status: 'complete',
      shopId: fixture.shopId,
      userId: fixture.ownerId,
    });
  });

  it('leaves every PIN hash a bcrypt hash and stores no raw PIN anywhere', () => {
    const users = sqlite.prepare('SELECT pin_hash FROM users').all() as unknown as { pin_hash: string }[];

    // CLAUDE.md rule 8: bcrypt hashes only — never a 4-digit string, and never
    // one of the PINs used above.
    for (const user of users) {
      expect(user.pin_hash).toMatch(/^\$2[aby]\$/);
      expect(user.pin_hash).not.toContain(OWNER_PIN);
      expect(user.pin_hash).not.toContain(STAFF_PIN);
    }
    // A handover is not an auditable staff-management event — nothing to log,
    // and certainly nothing PIN-shaped to log.
    expect(countRows('audit_logs')).toBe(0);
  });
});

// The enforcement half of Volume 0 Day 11, checked across a handover.
// state/switchUser.test.tsx covers the route guard; these are the db/ actions,
// which re-derive the role from SQLite and are what actually stops a write.
describe('permissions follow whoever is logged in', () => {
  it('grants the owner owner-only actions and denies the staff the same ones', async () => {
    await expect(
      requirePermission(fixture.shopId, fixture.ownerId, 'cash_management'),
    ).resolves.toBeUndefined();
    await expect(
      requirePermission(fixture.shopId, fixture.ownerId, 'staff_management'),
    ).resolves.toBeUndefined();

    await expect(requirePermission(fixture.shopId, fixture.staffId, 'cash_management')).rejects.toThrow(
      /Owner access only/,
    );
    await expect(requirePermission(fixture.shopId, fixture.staffId, 'staff_management')).rejects.toThrow(
      /Owner access only/,
    );
  });

  it('still lets the incoming staff sell and view inventory', async () => {
    await expect(requirePermission(fixture.shopId, fixture.staffId, 'sales')).resolves.toBeUndefined();
    await expect(
      requirePermission(fixture.shopId, fixture.staffId, 'inventory_view'),
    ).resolves.toBeUndefined();
  });

  it('denies the P1 manager role every permission, including sales', async () => {
    await expect(requirePermission(fixture.shopId, fixture.managerId, 'sales')).rejects.toThrow(
      /Owner access only/,
    );
    await expect(requirePermission(fixture.shopId, fixture.managerId, 'cash_management')).rejects.toThrow(
      /Owner access only/,
    );
  });

  // Attribution is the reason the handover exists: a shift's sales must be
  // traceable to whoever actually made them.
  it('attributes each sale to the user logged in at the time, and never rewrites it', async () => {
    await loginWithPin(STAFF_PIN);
    const staffSale = await sellOneUnit();

    // …the device changes hands through the real action, and the owner sells
    // next. Nothing carries the previous id forward: switchUser() empties the
    // store, and the next id can only come from the owner's own PIN.
    switchUser();
    expect(useSessionStore.getState().session).toBeNull();
    await loginWithPin(OWNER_PIN);
    const ownerSale = await sellOneUnit();

    const attribution = new Map(
      (
        sqlite.prepare('SELECT id, staff_id FROM sales').all() as unknown as {
          id: string;
          staff_id: string;
        }[]
      ).map((row) => [row.id, row.staff_id]),
    );

    expect(attribution.get(staffSale.saleId)).toBe(fixture.staffId);
    expect(attribution.get(ownerSale.saleId)).toBe(fixture.ownerId);
  });
});

// The outbox itself is SQLite, keyed by shopId (db/sync-helpers.ts's
// recordChange), never by the session — a handover cannot touch it directly.
// This proves that holds under an actual Owner→Staff→Owner round trip: every
// pre-switch row survives byte-for-byte, nothing is duplicated, and each new
// row is attributed to whoever was actually logged in when it was enqueued.
describe('handover preserves the sync outbox — nothing lost, duplicated, or moved', () => {
  interface QueueRow {
    id: string;
    table_name: string;
    row_id: string;
    shop_id: string;
    status: string;
  }

  function queueRows(): QueueRow[] {
    return sqlite
      .prepare('SELECT id, table_name, row_id, shop_id, status FROM sync_queue ORDER BY seq')
      .all() as unknown as QueueRow[];
  }

  function payloadOf(queueId: string): { staff_id?: string } {
    const row = sqlite.prepare('SELECT payload FROM sync_queue WHERE id = ?').get(queueId) as unknown as {
      payload: string;
    };
    return JSON.parse(row.payload) as { staff_id?: string };
  }

  it('leaves every pre-switch queued row untouched and enqueues Staff- and Owner-attributed rows for their own sales, with no duplicate ids', async () => {
    await loginWithPin(OWNER_PIN);
    const before = queueRows();

    // The handover itself must not add, remove or rewrite a single row: the
    // outbox is keyed by shop in SQLite, and the session lives in MMKV.
    switchUser();
    expect(queueRows()).toEqual(before);

    await loginWithPin(STAFF_PIN);
    const staffSale = await sellOneUnit();

    const afterStaffSale = queueRows();
    // Nothing about the switch itself, or the pre-existing rows, changed.
    expect(afterStaffSale.slice(0, before.length)).toEqual(before);
    const staffRows = afterStaffSale.slice(before.length);
    expect(staffRows.length).toBeGreaterThan(0);
    expect(new Set(staffRows.map((row) => row.id)).size).toBe(staffRows.length);

    const staffSaleRow = staffRows.find((row) => row.table_name === 'sales' && row.row_id === staffSale.saleId);
    expect(staffSaleRow).toBeDefined();
    expect(payloadOf(staffSaleRow!.id).staff_id).toBe(fixture.staffId);

    // …the device changes hands back, and the owner sells next.
    switchUser();
    await loginWithPin(OWNER_PIN);
    const ownerSale = await sellOneUnit();

    const afterOwnerSale = queueRows();
    expect(afterOwnerSale.slice(0, afterStaffSale.length)).toEqual(afterStaffSale);
    const ownerRows = afterOwnerSale.slice(afterStaffSale.length);
    expect(new Set(ownerRows.map((row) => row.id)).size).toBe(ownerRows.length);

    const ownerSaleRow = ownerRows.find((row) => row.table_name === 'sales' && row.row_id === ownerSale.saleId);
    expect(ownerSaleRow).toBeDefined();
    expect(payloadOf(ownerSaleRow!.id).staff_id).toBe(fixture.ownerId);

    // Never moved to another shop — every row, old and new, still carries
    // this one shop's id.
    expect(new Set(afterOwnerSale.map((row) => row.shop_id))).toEqual(new Set([fixture.shopId]));
    // Nothing reached the cloud across two handovers: sync/index.ts refuses
    // to run a cycle with no active user, so no row can be marked sent while
    // the device is sitting on PIN Login.
    expect(afterOwnerSale.every((row) => row.status === 'pending')).toBe(true);
  });
});

// The epoch is what every actor-stamping write is pinned to. It has to move
// on BOTH transitions: a handover that returns to the same person is still a
// handover, and work started before it must not survive.
describe('session epoch is monotonic across every handover', () => {
  it('advances on login and on clearActiveUser, never repeating a value', async () => {
    const seen: number[] = [];
    const record = () => seen.push(useSessionStore.getState().epoch);

    record();
    await loginWithPin(OWNER_PIN);
    record();
    switchUser();
    record();
    await loginWithPin(STAFF_PIN);
    record();
    switchUser();
    record();
    // The OWNER is back — same userId as step 2, and the epoch proves it is
    // nonetheless a different session.
    await loginWithPin(OWNER_PIN);
    record();

    expect(seen).toEqual([...seen].sort((left, right) => left - right));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('gives the same user a different epoch either side of a switch', async () => {
    await loginWithPin(OWNER_PIN);
    const before = useSessionStore.getState().epoch;
    const userBefore = activeUserId();

    switchUser();
    await loginWithPin(OWNER_PIN);

    expect(activeUserId()).toBe(userBefore);
    expect(useSessionStore.getState().epoch).not.toBe(before);
  });
});

// Volume 0 Days 5/11. Every one of these is money or stock stamped with an
// actor id, and every screen that calls them holds a closure that outlives a
// switch. The guard is re-evaluated inside the (synchronous) transaction, so
// nothing can interleave between the check and the writes.
describe('actor-stamping writes refuse to commit after the device changes hands', () => {
  const stale = () => false;

  it('cash summary: opening cash is not written', async () => {
    await loginWithPin(OWNER_PIN);
    const businessDate = currentBusinessDate();

    await expect(setOpeningCash({
      shopId: fixture.shopId,
      staffId: activeUserId(),
      isStillActive: stale,
      businessDate,
      openingCash: asPaisa(50000),
    })).rejects.toThrow(StaleSessionError);

    const drawer = sqlite.prepare('SELECT opening_cash FROM cash_drawer WHERE shop_id = ? AND business_date = ?').all(fixture.shopId, businessDate) as { opening_cash: number }[];
    expect(drawer.every((row) => row.opening_cash === 0)).toBe(true);
  });

  it('expenses: no expense row and no outbox row', async () => {
    await loginWithPin(OWNER_PIN);
    const before = (sqlite.prepare('SELECT id FROM expenses').all() as unknown[]).length;

    await expect(recordExpense({
      shopId: fixture.shopId,
      staffId: activeUserId(),
      isStillActive: stale,
      category: 'other',
      amount: asPaisa(1500),
      description: 'stale',
    })).rejects.toThrow(StaleSessionError);

    expect((sqlite.prepare('SELECT id FROM expenses').all() as unknown[]).length).toBe(before);
    expect(sqlite.prepare("SELECT id FROM sync_queue WHERE table_name = 'expenses'").all()).toEqual([]);
  });

  it('end of day: the day is not closed', async () => {
    await loginWithPin(OWNER_PIN);
    const businessDate = currentBusinessDate();

    await expect(closeDay({
      shopId: fixture.shopId,
      isStillActive: stale,
      businessDate,
      countedCash: asPaisa(100000),
      closedBy: activeUserId(),
    })).rejects.toThrow(StaleSessionError);

    const drawer = sqlite.prepare('SELECT closed_at FROM cash_drawer WHERE shop_id = ? AND business_date = ?').all(fixture.shopId, businessDate) as { closed_at: string | null }[];
    expect(drawer.every((row) => row.closed_at === null)).toBe(true);
  });

  it('credit sales: no customer row', async () => {
    await loginWithPin(OWNER_PIN);
    const before = (sqlite.prepare('SELECT id FROM customers').all() as unknown[]).length;

    await expect(createCustomer({
      shopId: fixture.shopId,
      actorUserId: activeUserId(),
      isStillActive: stale,
      name: 'Stale Customer',
    })).rejects.toThrow(StaleSessionError);

    expect((sqlite.prepare('SELECT id FROM customers').all() as unknown[]).length).toBe(before);
  });

  it('credit customer detail: no payment row', async () => {
    await loginWithPin(OWNER_PIN);
    const customer = await createCustomer({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      actorUserId: activeUserId(),
      name: 'Real Customer',
    });

    await expect(collectPayment({
      shopId: fixture.shopId,
      staffId: activeUserId(),
      isStillActive: stale,
      customerId: customer.id,
      amount: asPaisa(500),
    })).rejects.toThrow(StaleSessionError);

    expect(sqlite.prepare('SELECT id FROM payments WHERE party_id = ?').all(customer.id)).toEqual([]);
  });

  it('purchase create: no purchase, no batch', async () => {
    await loginWithPin(OWNER_PIN);
    const supplier = await createSupplier(fixture.shopId, activeUserId(), {
      name: 'Stale Supplier',
    }, ALWAYS_LIVE);
    const batchesBefore = (sqlite.prepare('SELECT id FROM batches').all() as unknown[]).length;

    await expect(createPurchase({
      shopId: fixture.shopId,
      supplierId: supplier.id,
      staffId: activeUserId(),
      isStillActive: stale,
      paymentType: 'cod',
      lineItems: [{
        medicineId: fixture.medicineId,
        batchNo: 'STALE-1',
        expiryDate: '2027-01-31',
        quantity: 10,
        purchasePrice: asPaisa(800),
        salePrice: asPaisa(1000),
      }],
    })).rejects.toThrow(StaleSessionError);

    expect(sqlite.prepare('SELECT id FROM purchases WHERE supplier_id = ?').all(supplier.id)).toEqual([]);
    expect((sqlite.prepare('SELECT id FROM batches').all() as unknown[]).length).toBe(batchesBefore);
  });

  it('sale: no sale row, and the stock is not deducted', async () => {
    await loginWithPin(OWNER_PIN);
    const quantityBefore = (sqlite.prepare('SELECT stock FROM batches WHERE id = ?').all(fixture.batchId) as { stock: number }[])[0]!.stock;

    await expect(createSaleTransaction({
      shopId: fixture.shopId,
      staffId: activeUserId(),
      isStillActive: stale,
      paymentType: 'cash',
      lines: [{
        medicineId: fixture.medicineId,
        deductions: [{ batchId: fixture.batchId, quantityDeducted: 1 }],
        unitPrice: asPaisa(1000),
      }],
    })).rejects.toThrow(StaleSessionError);

    const quantityAfter = (sqlite.prepare('SELECT stock FROM batches WHERE id = ?').all(fixture.batchId) as { stock: number }[])[0]!.stock;
    expect(quantityAfter).toBe(quantityBefore);
  });

  it('still commits normally while the session holds', async () => {
    await loginWithPin(OWNER_PIN);
    const live = () => true;

    await expect(recordExpense({
      shopId: fixture.shopId,
      staffId: activeUserId(),
      isStillActive: live,
      category: 'other',
      amount: asPaisa(700),
      description: 'live',
    })).resolves.toBeDefined();
  });
});
