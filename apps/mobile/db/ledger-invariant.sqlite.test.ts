// The ledger invariant itself, enforced by migration 0006's triggers rather
// than by convention:
//
//     batches.stock == SUM(inventory_movements.change_qty) for that batch
//
// The other ledger file (inventory-ledger.sqlite.test.ts) proves the ARITHMETIC
// is right when deltas combine. This one proves the invariant cannot be broken
// in the first place — most tests here are negative controls, asserting that a
// specific wrong way of changing stock is rejected outright rather than
// quietly accepted.
//
// Why that matters more than it sounds. Before these guards existed, SQLite
// happily let any caller assign an absolute; only Postgres refused. So a path
// that forgot its movement — a return, a write-off, a recount — worked
// perfectly on the device, passed its tests, and diverged from the cloud the
// moment it synced. The two stores now agree on what is legal.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';
import { withoutLedgerDeleteGuard } from './test/ledger';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const { batches, medicines, roles, shops, suppliers, users } = await import('./schema');
const { adjustStock, addStock, deductStock, ledgerSum } = await import('./stockLedger');
const { applyRemoteRows } = await import('./sync-helpers');
const { createMedicineWithBatch, addBatchToMedicine } = await import('./inventory');
const { createPurchase } = await import('./purchases');
const { eq } = await import('drizzle-orm');

const SHOP_ID = '40000000-0000-4000-8000-000000000001';
const ROLE_ID = '40000000-0000-4000-8000-000000000002';
const OWNER_ID = '40000000-0000-4000-8000-000000000003';
const MEDICINE_ID = '40000000-0000-4000-8000-000000000004';
const BATCH_ID = '40000000-0000-4000-8000-000000000005';
const SUPPLIER_ID = '40000000-0000-4000-8000-000000000006';
const NOW = '2026-08-18T09:00:00.000Z';

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

function stockOf(batchId: string): number {
  return (sqlite.prepare('SELECT stock FROM batches WHERE id = ?').all(batchId) as { stock: number }[])[0]!.stock;
}

function sumOf(batchId: string): number {
  return db.transaction((tx) => ledgerSum(tx, batchId));
}

/** The invariant, asserted directly rather than inferred from a quantity. */
function expectProjectionMatchesLedger(batchId: string): void {
  expect(stockOf(batchId)).toBe(sumOf(batchId));
}

/**
 * Rewinds the shared batch between tests. It clears the ledger and the
 * projection together — the one place that is allowed to sidestep the
 * append-only rule, because a fixture is not a business path.
 */
function resetBatchTo(quantity: number): void {
  withoutLedgerDeleteGuard(() => {
    sqlite.prepare('DELETE FROM inventory_movements WHERE batch_id = ?').run(BATCH_ID);
  });
  sqlite.exec('DELETE FROM sync_queue');
  sqlite.prepare('UPDATE batches SET stock = 0, oversold_at = NULL WHERE id = ?').run(BATCH_ID);
  if (quantity !== 0) {
    db.transaction((tx) => {
      addStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, quantity, reason: 'purchase', createdBy: OWNER_ID });
    });
  }
}

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

  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Invariant Shop', phone: '01700000902', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000902', pinHash: 'hash', pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(medicines).values({ id: MEDICINE_ID, shopId: SHOP_ID, name: 'Napa', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(suppliers).values({ id: SUPPLIER_ID, shopId: SHOP_ID, name: 'Beximco', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(batches).values({ id: BATCH_ID, shopId: SHOP_ID, medicineId: MEDICINE_ID, batchNo: 'B1', expiryDate: '2027-01-01', stock: 0, purchasePrice: asPaisa(500), salePrice: asPaisa(800), createdAt: NOW, updatedAt: NOW }).run();
});

beforeEach(() => {
  resetBatchTo(5);
});

describe('negative control: replacing a delta with an absolute', () => {
  it('rejects the absolute write a pre-ledger sale would have made', () => {
    // Verbatim the old shape: read 5, compute 5 - 2, assign it. The arithmetic
    // is fine; the ASSIGNMENT is the bug, because two devices doing it
    // concurrently both write 3 and one sale's stock effect disappears.
    expect(() =>
      sqlite.prepare('UPDATE batches SET stock = ? WHERE id = ?').run(3, BATCH_ID),
    ).toThrow(/derived from inventory_movements/);

    expect(stockOf(BATCH_ID)).toBe(5);
    expectProjectionMatchesLedger(BATCH_ID);
  });

  it('rejects an absolute even when it is arithmetically plausible', () => {
    // 7 would be right if a +2 movement existed. It does not, so the write is
    // refused: the guard tracks the LEDGER, not plausibility.
    expect(() =>
      sqlite.prepare('UPDATE batches SET stock = ? WHERE id = ?').run(7, BATCH_ID),
    ).toThrow(/derived from inventory_movements/);
  });

  it('still allows metadata to be updated, which sync depends on', () => {
    sqlite.prepare('UPDATE batches SET sale_price = ? WHERE id = ?').run(950, BATCH_ID);
    expect(db.select().from(batches).where(eq(batches.id, BATCH_ID)).get()!.salePrice).toBe(950);
    expect(stockOf(BATCH_ID)).toBe(5);
  });
});

describe('negative control: a new batch opening with positive stock', () => {
  it('refuses a batch row seeded with a quantity the ledger has no record of', () => {
    expect(() =>
      db.insert(batches).values({
        id: '40000000-0000-4000-8000-0000000000ff', shopId: SHOP_ID, medicineId: MEDICINE_ID,
        batchNo: 'DIRECT', expiryDate: '2028-01-01', stock: 20,
        purchasePrice: asPaisa(500), salePrice: asPaisa(900), createdAt: NOW, updatedAt: NOW,
      }).run(),
    ).toThrow(/must open at stock 0/);
  });

  it('accepts stock 0, and the opening movement is what makes it 20', () => {
    const id = '40000000-0000-4000-8000-0000000000fe';
    db.transaction((tx) => {
      tx.insert(batches).values({
        id, shopId: SHOP_ID, medicineId: MEDICINE_ID, batchNo: 'SEEDED',
        expiryDate: '2028-01-01', stock: 0,
        purchasePrice: asPaisa(500), salePrice: asPaisa(900), createdAt: NOW, updatedAt: NOW,
      }).run();
      addStock(tx, { shopId: SHOP_ID, batchId: id, quantity: 20, reason: 'purchase', createdBy: OWNER_ID });
    });

    expect(stockOf(id)).toBe(20);
    expectProjectionMatchesLedger(id);
  });
});

describe('negative control: remote batch stock is never authoritative', () => {
  it('discards a remote absolute and keeps the locally-projected quantity', () => {
    // The cloud says 999 with a newer timestamp, so plain LWW would take it.
    applyRemoteRows([{
      tableName: 'batches',
      row: {
        id: BATCH_ID, shop_id: SHOP_ID, medicine_id: MEDICINE_ID,
        batch_no: 'B1', expiry_date: '2027-01-01', stock: 999, oversold_at: null,
        purchase_price: 500, sale_price: 1234, is_discounted: false, original_price: null,
        created_at: NOW, updated_at: '2027-01-01T00:00:00.000Z',
        is_deleted: false, deleted_at: null, deleted_by: null,
      },
    }]);

    expect(stockOf(BATCH_ID)).toBe(5);
    expectProjectionMatchesLedger(BATCH_ID);
    // Metadata still lands — this is not a blanket rejection of the row.
    expect(db.select().from(batches).where(eq(batches.id, BATCH_ID)).get()!.salePrice).toBe(1234);
  });

  it('seeds an unseen remote batch at 0 so its movements are not double-counted', () => {
    const id = '40000000-0000-4000-8000-0000000000fd';
    applyRemoteRows([{
      tableName: 'batches',
      row: {
        id, shop_id: SHOP_ID, medicine_id: MEDICINE_ID,
        batch_no: 'REMOTE', expiry_date: '2028-01-01', stock: 40, oversold_at: null,
        purchase_price: 500, sale_price: 900, is_discounted: false, original_price: null,
        created_at: NOW, updated_at: NOW, is_deleted: false, deleted_at: null, deleted_by: null,
      },
    }]);
    // The server's 40 is the SUM of movements this device is about to receive.
    // Taking it now and replaying them after would land on 80.
    expect(stockOf(id)).toBe(0);

    applyRemoteRows([{
      tableName: 'inventory_movements',
      row: {
        id: 'remote-opening', shop_id: SHOP_ID, batch_id: id, change_qty: 40,
        reason: 'purchase', ref_id: null, created_by: OWNER_ID,
        created_at: NOW, updated_at: NOW, is_deleted: false, deleted_at: null, deleted_by: null,
      },
    }]);

    expect(stockOf(id)).toBe(40);
    expectProjectionMatchesLedger(id);
  });
});

describe('negative control: a quantity change that skips its movement', () => {
  it('cannot put a return back on the shelf without a ledger row', () => {
    expect(() =>
      sqlite.prepare('UPDATE batches SET stock = stock + 3 WHERE id = ?').run(BATCH_ID),
    ).toThrow(/derived from inventory_movements/);
    expect(stockOf(BATCH_ID)).toBe(5);
  });

  it('cannot write off expired stock without a ledger row', () => {
    expect(() =>
      sqlite.prepare('UPDATE batches SET stock = 0 WHERE id = ?').run(BATCH_ID),
    ).toThrow(/derived from inventory_movements/);
    expect(stockOf(BATCH_ID)).toBe(5);
  });

  it('accepts both once they go through the ledger', () => {
    db.transaction((tx) => {
      addStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, quantity: 3, reason: 'return', createdBy: OWNER_ID });
    });
    expect(stockOf(BATCH_ID)).toBe(8);

    db.transaction((tx) => {
      adjustStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, changeQty: -8, reason: 'adjustment', createdBy: OWNER_ID });
    });
    expect(stockOf(BATCH_ID)).toBe(0);
    expectProjectionMatchesLedger(BATCH_ID);
  });
});

describe('every reason moves the projection the same way', () => {
  it('sale, purchase, return and adjustment all sum into one figure', () => {
    db.transaction((tx) => {
      deductStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, quantity: 2, reason: 'sale', createdBy: OWNER_ID });
      addStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, quantity: 10, reason: 'purchase', createdBy: OWNER_ID });
      addStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, quantity: 1, reason: 'return', createdBy: OWNER_ID });
      adjustStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, changeQty: -4, reason: 'adjustment', createdBy: OWNER_ID });
    });

    expect(stockOf(BATCH_ID)).toBe(10); // 5 - 2 + 10 + 1 - 4
    expectProjectionMatchesLedger(BATCH_ID);

    const reasons = (sqlite
      .prepare('SELECT reason FROM inventory_movements WHERE batch_id = ? ORDER BY reason')
      .all(BATCH_ID) as { reason: string }[]).map((r) => r.reason);
    expect(reasons).toEqual(['adjustment', 'purchase', 'purchase', 'return', 'sale']);
  });

  it('a purchase return leaving the shelf is a negative movement, not an edit', () => {
    db.transaction((tx) => {
      deductStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, quantity: 2, reason: 'return', createdBy: OWNER_ID });
    });
    expect(stockOf(BATCH_ID)).toBe(3);
    expectProjectionMatchesLedger(BATCH_ID);
  });
});

describe('the real business paths open batches through the ledger', () => {
  it('createMedicineWithBatch: 20 = seed 0 + one +20 movement', async () => {
    const created = await createMedicineWithBatch({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, actorUserId: OWNER_ID,
      name: 'Seclo', unitOfMeasure: 'piece', threshold: 5, requiresPrescription: false,
      firstBatch: { batchNo: 'S1', expiryDate: '2028-06-01', quantity: 20, purchasePrice: asPaisa(400), salePrice: asPaisa(700) },
    });

    const batchId = (sqlite.prepare('SELECT id FROM batches WHERE medicine_id = ?').all(created.medicineId) as { id: string }[])[0]!.id;
    const movements = sqlite.prepare('SELECT change_qty, reason FROM inventory_movements WHERE batch_id = ?').all(batchId) as { change_qty: number; reason: string }[];

    expect(movements).toEqual([{ change_qty: 20, reason: 'purchase' }]);
    expect(stockOf(batchId)).toBe(20);
    expectProjectionMatchesLedger(batchId);
  });

  it('addBatchToMedicine: same shape, on an existing medicine', async () => {
    const { batchId } = await addBatchToMedicine({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, actorUserId: OWNER_ID,
      medicineId: MEDICINE_ID, batchNo: 'B-EXTRA', expiryDate: '2029-01-01',
      quantity: 20, purchasePrice: asPaisa(400), salePrice: asPaisa(700),
    });

    const movements = sqlite.prepare('SELECT change_qty FROM inventory_movements WHERE batch_id = ?').all(batchId) as { change_qty: number }[];
    expect(movements).toEqual([{ change_qty: 20 }]);
    expect(stockOf(batchId)).toBe(20);
    expectProjectionMatchesLedger(batchId);
  });

  it('createPurchase into a new batch: same shape again', async () => {
    await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: SUPPLIER_ID, staffId: OWNER_ID,
      paymentType: 'cod',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'PUR-NEW', expiryDate: '2029-06-01', quantity: 20, purchasePrice: asPaisa(500), salePrice: asPaisa(900) }],
    });

    const batchId = (sqlite.prepare("SELECT id FROM batches WHERE batch_no = 'PUR-NEW'").all() as { id: string }[])[0]!.id;
    const movements = sqlite.prepare('SELECT change_qty, reason FROM inventory_movements WHERE batch_id = ?').all(batchId) as { change_qty: number; reason: string }[];

    expect(movements).toEqual([{ change_qty: 20, reason: 'purchase' }]);
    expect(stockOf(batchId)).toBe(20);
    expectProjectionMatchesLedger(batchId);
  });

  it('createPurchase into an EXISTING batch appends a delta, never an absolute', async () => {
    await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: SUPPLIER_ID, staffId: OWNER_ID,
      paymentType: 'cod',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'B1', expiryDate: '2027-01-01', quantity: 10, purchasePrice: asPaisa(500), salePrice: asPaisa(800) }],
    });

    expect(stockOf(BATCH_ID)).toBe(15); // 5 + 10, and nothing recomputed
    expectProjectionMatchesLedger(BATCH_ID);
  });
});

describe('the ledger is append-only', () => {
  it('refuses to rewrite an applied delta', () => {
    const id = (sqlite.prepare('SELECT id FROM inventory_movements WHERE batch_id = ?').all(BATCH_ID) as { id: string }[])[0]!.id;
    expect(() =>
      sqlite.prepare('UPDATE inventory_movements SET change_qty = ? WHERE id = ?').run(999, id),
    ).toThrow(/append-only/);
    expect(stockOf(BATCH_ID)).toBe(5);
  });

  it('refuses to move a delta to a different batch', () => {
    const id = (sqlite.prepare('SELECT id FROM inventory_movements WHERE batch_id = ?').all(BATCH_ID) as { id: string }[])[0]!.id;
    expect(() =>
      sqlite.prepare('UPDATE inventory_movements SET batch_id = ? WHERE id = ?').run('40000000-0000-4000-8000-0000000000fe', id),
    ).toThrow(/append-only/);
  });
});

describe('inventory movements are enqueued, batch quantities are not', () => {
  it('a sale pushes its delta and never a batches row', () => {
    sqlite.exec('DELETE FROM sync_queue');
    db.transaction((tx) => {
      deductStock(tx, { shopId: SHOP_ID, batchId: BATCH_ID, quantity: 2, reason: 'sale', createdBy: OWNER_ID });
    });

    const queued = sqlite.prepare('SELECT table_name, payload FROM sync_queue').all() as { table_name: string; payload: string }[];
    expect(queued.map((r) => r.table_name)).toEqual(['inventory_movements']);
    // What crosses the wire is -2, not "the stock is now 3". Snake-cased,
    // because that is the shape sync-helpers pushes.
    expect((JSON.parse(queued[0]!.payload) as { change_qty: number }).change_qty).toBe(-2);
  });
});

describe('negative control: a movement whose batch does not exist', () => {
  // The foreign key already refuses this — but only while
  // `PRAGMA foreign_keys` is ON, and that is a per-CONNECTION setting that
  // resets to OFF every time the file is opened. With it off, SQLite's
  // `UPDATE batches ... WHERE id = NEW.batch_id` matches no rows and reports
  // success: the delta is recorded in the ledger and lands on no projection
  // at all, breaking the invariant with no error anywhere. Postgres refuses it
  // outright (MU005); the trigger added in migration 0006 makes SQLite agree,
  // whichever way the database was opened.
  const GHOST_BATCH = '40000000-0000-4000-8000-00000000dead';

  it('is refused by the trigger even with foreign keys switched off', () => {
    sqlite.exec('PRAGMA foreign_keys = OFF');
    console.log('SQLOF', JSON.stringify(sqlite.prepare("SELECT sql FROM sqlite_master WHERE name='inventory_movement_requires_its_batch'").all()));
    try {
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO inventory_movements
               (id, shop_id, batch_id, change_qty, reason, ref_id, created_by, created_at, updated_at, is_dirty, is_deleted)
             VALUES (?, ?, ?, ?, 'sale', NULL, ?, ?, ?, 1, 0)`,
          )
          .run('40000000-0000-4000-8000-0000000000fc', SHOP_ID, GHOST_BATCH, -5, OWNER_ID, NOW, NOW),
      ).toThrow(/unknown batch/);
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }
  });

  it('leaves the ledger with nothing to account for', () => {
    const orphans = sqlite
      .prepare('SELECT count(*) AS n FROM inventory_movements WHERE batch_id = ?')
      .all(GHOST_BATCH) as { n: number }[];
    expect(orphans[0]!.n).toBe(0);
  });
});
