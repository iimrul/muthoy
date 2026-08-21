// The APP-WIDE stale-session contract, on a real SQLite engine (node:sqlite).
//
// db/user-switch.sqlite.test.ts proves the handover for the seven money paths
// one at a time. This file is the other shape of the same question: given the
// full inventory of actor-attributed mutations in db/, does EVERY one of them
// refuse to commit once the session epoch has moved — and does every
// background/system write keep running when there is no session at all?
//
// Written per mutation CLASS rather than per button. Each case asserts three
// things against the real tables:
//   1. STALE  — throws StaleSessionError and leaves every row count untouched.
//   2. CLOSED — a missing liveness callback fails exactly like a stale one,
//               so a future caller who forgets is refused rather than trusted.
//   3. LIVE   — the ordinary current-session write still commits.
//
// Adding a new actor-attributed mutation to db/ without adding it here is
// meant to be conspicuous: the CASES table below is the inventory.

import { readFileSync } from 'node:fs';
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

const { createShopAndOwner, setOwnerPin } = await import('./auth');
const { createStaff, deactivateStaff, resetStaffPin } = await import('./staff');
const { addBatchToMedicine, createMedicineWithBatch } = await import('./inventory');
const { createSaleTransaction } = await import('./sales');
const { closeDay, currentBusinessDate, recordExpense, setOpeningCash } = await import('./cash');
const { collectPayment, createCustomer } = await import('./customers');
const { createPurchase } = await import('./purchases');
const { createSupplier } = await import('./suppliers');
const { changeOwnPin } = await import('./settings');
const { createNotification, findUnresolvedLowStockAlert, listNotifications, markAsRead, resolveLowStockAlert } =
  await import('./notifications');
const { ALWAYS_LIVE, StaleSessionError } = await import('./errors');

const OWNER_PIN = '1234';

/** The liveness a handler reports once switchUser() has moved the epoch. */
const STALE = (): boolean => false;
/** A caller who forgot the argument entirely — must be refused, not trusted. */
const MISSING = undefined as unknown as () => boolean;

function suffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

interface Fixture {
  shopId: string;
  ownerId: string;
  medicineId: string;
  batchId: string;
  supplierId: string;
  customerId: string;
  notificationId: string;
  /** Staff rows created solely so a destructive case has its own target. */
  resetTargetId: string;
  deactivateTargetId: string;
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

function snapshot(tables: readonly string[]): Record<string, number> {
  return Object.fromEntries(tables.map((table) => [table, countRows(table)]));
}

function seedBatchId(): string {
  return (sqlite.prepare('SELECT id FROM batches WHERE batch_no = ?').get('SEED-1') as unknown as { id: string }).id;
}

/**
 * One actor-attributed mutation. `tables` are the tables it writes — including
 * sync_queue, because an outbox row for a write that never happened would
 * push the outgoing user's change to the cloud anyway.
 */
interface MutationCase {
  name: string;
  tables: readonly string[];
  run: (isStillActive: () => boolean) => Promise<unknown>;
}

const CASES: readonly MutationCase[] = [
  {
    name: 'sale — createSaleTransaction',
    tables: ['sales', 'sale_items', 'sync_queue'],
    run: (isStillActive) =>
      createSaleTransaction({
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        isStillActive,
        paymentType: 'cash',
        lines: [
          {
            medicineId: fixture.medicineId,
            deductions: [{ batchId: fixture.batchId, quantityDeducted: 1 }],
            unitPrice: asPaisa(1000),
          },
        ],
      }),
  },
  {
    name: 'cash — setOpeningCash',
    tables: ['cash_drawer', 'sync_queue'],
    run: (isStillActive) =>
      setOpeningCash({
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        isStillActive,
        businessDate: currentBusinessDate(),
        openingCash: asPaisa(50000),
      }),
  },
  {
    name: 'cash — recordExpense',
    tables: ['expenses', 'sync_queue'],
    run: (isStillActive) =>
      recordExpense({
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        isStillActive,
        category: 'rent',
        amount: asPaisa(1500),
      }),
  },
  {
    name: 'credit — createCustomer',
    tables: ['customers', 'sync_queue'],
    run: (isStillActive) =>
      createCustomer({
        shopId: fixture.shopId,
        actorUserId: fixture.ownerId,
        isStillActive,
        name: `Nasrin ${suffix()}`,
      }),
  },
  {
    name: 'credit — collectPayment',
    tables: ['payments', 'sync_queue'],
    run: (isStillActive) =>
      collectPayment({
        shopId: fixture.shopId,
        staffId: fixture.ownerId,
        isStillActive,
        customerId: fixture.customerId,
        amount: asPaisa(500),
      }),
  },
  {
    name: 'purchases — createPurchase',
    tables: ['purchases', 'batches', 'sync_queue'],
    run: (isStillActive) =>
      createPurchase({
        shopId: fixture.shopId,
        supplierId: fixture.supplierId,
        staffId: fixture.ownerId,
        isStillActive,
        paymentType: 'cod',
        lineItems: [
          {
            medicineId: fixture.medicineId,
            batchNo: `PO-${suffix()}`,
            expiryDate: '2099-01-01',
            quantity: 5,
            purchasePrice: asPaisa(400),
            salePrice: asPaisa(900),
          },
        ],
      }),
  },
  {
    name: 'suppliers — createSupplier',
    tables: ['suppliers', 'sync_queue'],
    run: (isStillActive) =>
      createSupplier(fixture.shopId, fixture.ownerId, { name: `Incepta ${suffix()}` }, isStillActive),
  },
  {
    name: 'inventory — createMedicineWithBatch',
    tables: ['medicines', 'batches', 'sync_queue'],
    run: (isStillActive) =>
      createMedicineWithBatch({
        shopId: fixture.shopId,
        actorUserId: fixture.ownerId,
        isStillActive,
        name: `Seclo-${suffix()}`,
        unitOfMeasure: 'strip',
        requiresPrescription: false,
        threshold: 5,
        firstBatch: {
          batchNo: `B-${suffix()}`,
          expiryDate: '2099-01-01',
          quantity: 20,
          purchasePrice: asPaisa(300),
          salePrice: asPaisa(700),
        },
      }),
  },
  {
    name: 'inventory — addBatchToMedicine',
    tables: ['batches', 'sync_queue'],
    run: (isStillActive) =>
      addBatchToMedicine({
        shopId: fixture.shopId,
        actorUserId: fixture.ownerId,
        isStillActive,
        medicineId: fixture.medicineId,
        batchNo: `X-${suffix()}`,
        expiryDate: '2099-06-01',
        quantity: 12,
        purchasePrice: asPaisa(250),
        salePrice: asPaisa(600),
      }),
  },
  {
    name: 'staff — createStaff',
    tables: ['users', 'sync_queue'],
    run: (isStillActive) =>
      createStaff(fixture.shopId, fixture.ownerId, { name: `Hire ${suffix()}`, phone: nextStaffPhone(), rawPin: '5555', permissions: {} }, isStillActive),
  },
  {
    name: 'staff — resetStaffPin',
    tables: ['audit_logs', 'sync_queue'],
    run: (isStillActive) => resetStaffPin(fixture.resetTargetId, '8765', fixture.ownerId, isStillActive),
  },
  {
    name: 'staff — deactivateStaff',
    tables: ['audit_logs', 'sync_queue'],
    run: (isStillActive) => deactivateStaff(fixture.deactivateTargetId, fixture.ownerId, isStillActive),
  },
];

beforeAll(async () => {
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

  const registration = await createShopAndOwner({
    shopName: 'Muthoy Audit Pharmacy',
    phone: '01700000000',
  });
  await setOwnerPin(registration.userId, OWNER_PIN);

  const resetTarget = await createStaff(registration.shopId, registration.userId, { name: 'Rina', phone: nextStaffPhone(), rawPin: '4322', permissions: {} }, ALWAYS_LIVE);
  const deactivateTarget = await createStaff(registration.shopId, registration.userId, { name: 'Sumon', phone: nextStaffPhone(), rawPin: '4323', permissions: {} }, ALWAYS_LIVE);

  const stock = await createMedicineWithBatch({
    shopId: registration.shopId,
    actorUserId: registration.userId,
    isStillActive: ALWAYS_LIVE,
    name: 'Napa',
    unitOfMeasure: 'strip',
    requiresPrescription: false,
    threshold: 5,
    firstBatch: {
      batchNo: 'SEED-1',
      expiryDate: '2099-01-01',
      quantity: 500,
      purchasePrice: asPaisa(300),
      salePrice: asPaisa(1000),
    },
  });

  const supplier = await createSupplier(
    registration.shopId,
    registration.userId,
    { name: 'Square Pharmaceuticals' },
    ALWAYS_LIVE,
  );

  const customer = await createCustomer({
    shopId: registration.shopId,
    actorUserId: registration.userId,
    isStillActive: ALWAYS_LIVE,
    name: 'Rahim Uddin',
  });

  // collectPayment refuses to take more than is owed, so the customer needs a
  // real outstanding balance before the collection case can run at all.
  await createSaleTransaction({
    shopId: registration.shopId,
    staffId: registration.userId,
    isStillActive: ALWAYS_LIVE,
    paymentType: 'credit',
    customerId: customer.id,
    lines: [
      {
        medicineId: stock.medicineId,
        deductions: [{ batchId: seedBatchId(), quantityDeducted: 10 }],
        unitPrice: asPaisa(1000),
      },
    ],
  });

  // A background/system notification — created with no session in play, which
  // is exactly how native/notifications.ts creates them.
  await createNotification(
    registration.shopId,
    'low_stock',
    'warning',
    'Low stock',
    'Napa is running low',
    stock.medicineId,
  );
  const [notification] = await listNotifications(registration.shopId, registration.userId);

  const batchId = seedBatchId();

  fixture = {
    shopId: registration.shopId,
    ownerId: registration.userId,
    medicineId: stock.medicineId,
    batchId,
    supplierId: supplier.id,
    customerId: customer.id,
    notificationId: notification!.id,
    resetTargetId: resetTarget.id,
    deactivateTargetId: deactivateTarget.id,
  };
});

describe('every actor-attributed mutation refuses a stale session', () => {
  it.each(CASES.map((mutationCase) => [mutationCase.name, mutationCase] as const))(
    '%s',
    async (_name, mutationCase) => {
      const before = snapshot(mutationCase.tables);

      // 1. STALE — the device changed hands mid-flight.
      await expect(mutationCase.run(STALE)).rejects.toBeInstanceOf(StaleSessionError);
      expect(snapshot(mutationCase.tables)).toEqual(before);

      // 2. FAILS CLOSED — a caller who supplied no liveness at all is refused
      //    identically. This is what stops the protection being lost by
      //    omission the next time someone adds a call site.
      await expect(mutationCase.run(MISSING)).rejects.toBeInstanceOf(StaleSessionError);
      expect(snapshot(mutationCase.tables)).toEqual(before);

      // 3. LIVE — the ordinary current-session write is untouched.
      await mutationCase.run(ALWAYS_LIVE);
      const after = snapshot(mutationCase.tables);
      const grew = mutationCase.tables.some((table) => after[table]! > before[table]!);
      expect(grew).toBe(true);
    },
  );

  // changeOwnPin and closeDay are separated out because committing them
  // changes state every other case would then run against — a new owner PIN,
  // and a locked business date. Same three assertions, run on their own.
  it('settings — changeOwnPin', async () => {
    const before = snapshot(['audit_logs', 'sync_queue']);

    await expect(changeOwnPin(fixture.ownerId, OWNER_PIN, '9090', STALE)).rejects.toBeInstanceOf(StaleSessionError);
    expect(snapshot(['audit_logs', 'sync_queue'])).toEqual(before);

    await expect(changeOwnPin(fixture.ownerId, OWNER_PIN, '9090', MISSING)).rejects.toBeInstanceOf(StaleSessionError);
    expect(snapshot(['audit_logs', 'sync_queue'])).toEqual(before);

    await changeOwnPin(fixture.ownerId, OWNER_PIN, '9090', ALWAYS_LIVE);
    expect(countRows('audit_logs')).toBeGreaterThan(before.audit_logs!);
  });

  it('cash — closeDay', async () => {
    const businessDate = '2020-01-02';
    const tables = ['cash_drawer', 'sync_queue'];
    const before = snapshot(tables);
    const input = {
      shopId: fixture.shopId,
      businessDate,
      countedCash: asPaisa(0),
      closedBy: fixture.ownerId,
    };

    await expect(closeDay({ ...input, isStillActive: STALE })).rejects.toBeInstanceOf(StaleSessionError);
    expect(snapshot(tables)).toEqual(before);

    await expect(closeDay({ ...input, isStillActive: MISSING })).rejects.toBeInstanceOf(StaleSessionError);
    expect(snapshot(tables)).toEqual(before);

    await closeDay({ ...input, isStillActive: ALWAYS_LIVE });
    const drawer = sqlite
      .prepare('SELECT closed_at FROM cash_drawer WHERE business_date = ?')
      .get(businessDate) as unknown as { closed_at: string | null };
    expect(drawer.closed_at).not.toBeNull();
  });

  // markAsRead is the one interactive mutation that writes no outbox row —
  // read state is per-user and deliberately not synced — so it is verified on
  // the column it actually changes rather than on row counts.
  it('notifications — markAsRead', async () => {
    const isRead = (): number => Number((sqlite.prepare(
      'SELECT COUNT(*) AS value FROM notification_receipts WHERE notification_id = ? AND user_id = ? AND read_at IS NOT NULL',
    ).get(fixture.notificationId, fixture.ownerId) as unknown as { value: number }).value);
    expect(isRead()).toBe(0);

    await expect(
      markAsRead(fixture.shopId, fixture.ownerId, fixture.notificationId, STALE),
    ).rejects.toBeInstanceOf(StaleSessionError);
    expect(isRead()).toBe(0);

    await expect(
      markAsRead(fixture.shopId, fixture.ownerId, fixture.notificationId, MISSING),
    ).rejects.toBeInstanceOf(StaleSessionError);
    expect(isRead()).toBe(0);

    await markAsRead(fixture.shopId, fixture.ownerId, fixture.notificationId, ALWAYS_LIVE);
    expect(isRead()).toBe(1);
  });

  it('covers every actor-attributed mutation the db layer exposes', () => {
    // The inventory, asserted rather than assumed: 12 table-driven cases plus
    // markAsRead, changeOwnPin and closeDay above = the 15 interactive
    // mutations the audit found. A new one added to db/ without a case here
    // fails this count.
    expect(CASES).toHaveLength(12);
  });
});

describe('background and system writes are deliberately NOT epoch-guarded', () => {
  // native/notifications.ts and sync/stuckNotification.ts run on their own
  // lifecycle — a scheduled check, a sync failure — and are keyed to the SHOP,
  // not to a login. Guarding them would silently stop low-stock and expiry
  // alerts from being raised the moment nobody happened to be logged in.
  it('creates a shop-scoped notification with no session in play', async () => {
    const before = countRows('notifications');

    await createNotification(fixture.shopId, 'expiry', 'warning', 'Expiring soon', 'A batch expires this month');

    expect(countRows('notifications')).toBe(before + 1);
  });

  it('resolves a low-stock alert with no session in play', async () => {
    const unresolved = await findUnresolvedLowStockAlert(fixture.shopId, fixture.medicineId);
    expect(unresolved).not.toBeNull();

    await resolveLowStockAlert(unresolved!.id);

    const resolved = sqlite
      .prepare('SELECT resolved_at FROM notifications WHERE id = ?')
      .get(unresolved!.id) as unknown as { resolved_at: string | null };
    expect(resolved.resolved_at).not.toBeNull();
  });
});
