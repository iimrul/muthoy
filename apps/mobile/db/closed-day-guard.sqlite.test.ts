// Post-Day-10 fix (Codex finding): after End of Day closes a business date,
// sales, customer credit collections, and purchases could still write against
// that same date and silently invalidate the locked closing_expected/counted/
// variance snapshot. This file proves the centralized guard
// (db/cash.ts's assertBusinessDateOpen) actually blocks all three paths, that
// a blocked write leaves zero partial rows/outbox entries (the existing
// db.transaction rollback-on-throw), and that normal pre-close writes are
// unaffected.

import { readFileSync } from 'node:fs';
import { ALWAYS_LIVE } from './errors';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const schema = await import('./schema');
const { batches, inventoryMovements, customers, medicines, roles, shops, suppliers, users } = schema;
const { closeDay, currentBusinessDate } = await import('./cash');
const { createSaleTransaction } = await import('./sales');
const { collectPayment } = await import('./customers');
const { createPurchase } = await import('./purchases');

const BUSINESS_DATE = currentBusinessDate();

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

interface Fixture {
  shopId: string;
  ownerId: string;
  staffId: string;
  medicineId: string;
  batchId: string;
  customerId: string;
  supplierId: string;
}

let shopCounter = 0;

function fixtureId(shop: number, slot: number): string {
  return `3${String(shop).padStart(7, '0')}-0000-4000-8000-${String(slot).padStart(12, '0')}`;
}

// One self-contained shop per test: owner + staff, a medicine/batch with real
// stock (so createSaleTransaction's FEFO deduction path has something to
// deduct), a customer, and a supplier.
function seedShop(): Fixture {
  const shop = ++shopCounter;
  const now = new Date().toISOString();
  const fixture: Fixture = {
    shopId: fixtureId(shop, 1),
    ownerId: fixtureId(shop, 3),
    staffId: fixtureId(shop, 4),
    medicineId: fixtureId(shop, 5),
    batchId: fixtureId(shop, 6),
    customerId: fixtureId(shop, 7),
    supplierId: fixtureId(shop, 8),
  };
  const ownerRoleId = fixtureId(shop, 9);
  const staffRoleId = fixtureId(shop, 10);

  db.insert(shops).values({ id: fixture.shopId, ownerId: fixture.ownerId, name: `Guard Shop ${shop}`, phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(roles).values({ id: ownerRoleId, shopId: fixture.shopId, name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(roles).values({ id: staffRoleId, shopId: fixture.shopId, name: 'staff', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: fixture.ownerId, shopId: fixture.shopId, name: `Owner ${shop}`, pinHash: 'hash', pinSetAt: now, roleId: ownerRoleId, isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: fixture.staffId, shopId: fixture.shopId, name: `Staff ${shop}`, pinHash: 'hash', pinSetAt: now, roleId: staffRoleId, isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(medicines).values({ id: fixture.medicineId, shopId: fixture.shopId, name: 'Napa', createdAt: now, updatedAt: now }).run();
  db.insert(batches).values({ id: fixture.batchId, shopId: fixture.shopId, medicineId: fixture.medicineId, batchNo: 'B1', expiryDate: '2027-01-31', stock: 0, purchasePrice: asPaisa(600), salePrice: asPaisa(1000), createdAt: now, updatedAt: now }).run();
  // Opening quantity is a movement, never a directly-written absolute —
  // the ledger triggers in migration 0006 reject the latter outright.
  db.insert(inventoryMovements).values({ id: fixtureId(shop, 12), shopId: fixture.shopId, batchId: fixture.batchId, changeQty: 100, reason: 'purchase', createdBy: fixture.ownerId, createdAt: now, updatedAt: now }).run();
  db.insert(customers).values({ id: fixture.customerId, shopId: fixture.shopId, name: `Customer ${shop}`, createdAt: now, updatedAt: now }).run();
  db.insert(suppliers).values({ id: fixture.supplierId, shopId: fixture.shopId, name: `Supplier ${shop}`, createdAt: now, updatedAt: now }).run();
  return fixture;
}

async function closeToday(fixture: Fixture): Promise<void> {
  await closeDay({ isStillActive: ALWAYS_LIVE,
    shopId: fixture.shopId, businessDate: BUSINESS_DATE,
    countedCash: ZERO_PAISA, closedBy: fixture.ownerId,
  });
}

function countRows(table: string, shopId: string): number {
  return Number((sqlite
    .prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE shop_id = ?`)
    .get(shopId) as unknown as { value: number }).value);
}

function queuedCount(shopId: string): number {
  return Number((sqlite
    .prepare('SELECT COUNT(*) AS value FROM sync_queue WHERE shop_id = ?')
    .get(shopId) as unknown as { value: number }).value);
}

function batchStock(batchId: string): number {
  return (sqlite
    .prepare('SELECT stock FROM batches WHERE id = ?')
    .get(batchId) as unknown as { stock: number }).stock;
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
  applyMigration('0009_strong_gargoyle.sql');
});

describe('closed-day mutation guard', () => {
  describe('sales', () => {
    it('still succeeds before the day is closed', async () => {
      const fixture = seedShop();

      const result = await createSaleTransaction({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, staffId: fixture.staffId, paymentType: 'cash',
        lines: [{ medicineId: fixture.medicineId, deductions: [{ batchId: fixture.batchId, quantityDeducted: 2 }], unitPrice: asPaisa(1000) }],
      });

      expect(result.total).toBe(2000);
      expect(countRows('sales', fixture.shopId)).toBe(1);
      expect(batchStock(fixture.batchId)).toBe(98);
    });

    it('rejects a cash sale after close, leaving no partial rows or outbox entries', async () => {
      const fixture = seedShop();
      await closeToday(fixture);
      const queueBefore = queuedCount(fixture.shopId);

      await expect(
        createSaleTransaction({ isStillActive: ALWAYS_LIVE,
          shopId: fixture.shopId, staffId: fixture.staffId, paymentType: 'cash',
          lines: [{ medicineId: fixture.medicineId, deductions: [{ batchId: fixture.batchId, quantityDeducted: 2 }], unitPrice: asPaisa(1000) }],
        }),
      ).rejects.toThrow(/already closed/);

      expect(countRows('sales', fixture.shopId)).toBe(0);
      expect(countRows('sale_items', fixture.shopId)).toBe(0);
      // 1, not 0: the fixture's opening-stock movement. The rejected sale
      // must not have appended a second one.
      expect(countRows('inventory_movements', fixture.shopId)).toBe(1);
      expect(batchStock(fixture.batchId)).toBe(100);
      expect(queuedCount(fixture.shopId)).toBe(queueBefore);
    });

    it('also rejects a credit sale after close — credit sales still feed the locked EOD snapshot', async () => {
      const fixture = seedShop();
      await closeToday(fixture);

      await expect(
        createSaleTransaction({ isStillActive: ALWAYS_LIVE,
          shopId: fixture.shopId, staffId: fixture.staffId, paymentType: 'credit', customerId: fixture.customerId,
          lines: [{ medicineId: fixture.medicineId, deductions: [{ batchId: fixture.batchId, quantityDeducted: 1 }], unitPrice: asPaisa(1000) }],
        }),
      ).rejects.toThrow(/already closed/);

      expect(countRows('sales', fixture.shopId)).toBe(0);
      expect(countRows('credits', fixture.shopId)).toBe(0);
    });
  });

  describe('customer credit collections', () => {
    it('still succeeds before the day is closed', async () => {
      const fixture = seedShop();
      await createSaleTransaction({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, staffId: fixture.staffId, paymentType: 'credit', customerId: fixture.customerId,
        lines: [{ medicineId: fixture.medicineId, deductions: [{ batchId: fixture.batchId, quantityDeducted: 1 }], unitPrice: asPaisa(1000) }],
      });

      // collectPayment is owner-only (credit_management) — the staff actor
      // above only exercises the credit SALE half of this flow.
      await collectPayment({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, staffId: fixture.ownerId, customerId: fixture.customerId, amount: asPaisa(500),
      });

      expect(countRows('payments', fixture.shopId)).toBe(1);
    });

    it('rejects a collection after close — including non-cash methods — leaving no partial rows', async () => {
      const fixture = seedShop();
      await createSaleTransaction({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, staffId: fixture.staffId, paymentType: 'credit', customerId: fixture.customerId,
        lines: [{ medicineId: fixture.medicineId, deductions: [{ batchId: fixture.batchId, quantityDeducted: 1 }], unitPrice: asPaisa(1000) }],
      });
      await closeToday(fixture);
      const queueBefore = queuedCount(fixture.shopId);

      await expect(
        collectPayment({ isStillActive: ALWAYS_LIVE,
          shopId: fixture.shopId, staffId: fixture.ownerId, customerId: fixture.customerId,
          amount: asPaisa(500), method: 'bkash',
        }),
      ).rejects.toThrow(/already closed/);

      expect(countRows('payments', fixture.shopId)).toBe(0);
      expect(queuedCount(fixture.shopId)).toBe(queueBefore);
    });
  });

  describe('purchases', () => {
    it('still succeeds before the day is closed (COD)', async () => {
      const fixture = seedShop();

      const result = await createPurchase({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, supplierId: fixture.supplierId, staffId: fixture.ownerId, paymentType: 'cod',
        lineItems: [{ medicineId: fixture.medicineId, batchNo: 'PB1', expiryDate: '2028-01-01', quantity: 10, purchasePrice: asPaisa(500), salePrice: asPaisa(900) }],
      });

      expect(result.total).toBe(5000);
      expect(countRows('purchases', fixture.shopId)).toBe(1);
      expect(countRows('payments', fixture.shopId)).toBe(1);
    });

    it('rejects a COD purchase after close, leaving no partial rows or outbox entries', async () => {
      const fixture = seedShop();
      await closeToday(fixture);
      const queueBefore = queuedCount(fixture.shopId);

      await expect(
        createPurchase({ isStillActive: ALWAYS_LIVE,
          shopId: fixture.shopId, supplierId: fixture.supplierId, staffId: fixture.ownerId, paymentType: 'cod',
          lineItems: [{ medicineId: fixture.medicineId, batchNo: 'PB2', expiryDate: '2028-01-01', quantity: 10, purchasePrice: asPaisa(500), salePrice: asPaisa(900) }],
        }),
      ).rejects.toThrow(/already closed/);

      expect(countRows('purchases', fixture.shopId)).toBe(0);
      expect(countRows('purchase_items', fixture.shopId)).toBe(0);
      expect(countRows('payments', fixture.shopId)).toBe(0);
      expect(queuedCount(fixture.shopId)).toBe(queueBefore);
      const newBatch = sqlite
        .prepare("SELECT COUNT(*) AS value FROM batches WHERE shop_id = ? AND batch_no = 'PB2'")
        .get(fixture.shopId) as unknown as { value: number };
      expect(newBatch.value).toBe(0);
    });

    it('also rejects a credit-terms purchase after close — stock writes for a locked day are blocked too', async () => {
      const fixture = seedShop();
      await closeToday(fixture);

      await expect(
        createPurchase({ isStillActive: ALWAYS_LIVE,
          shopId: fixture.shopId, supplierId: fixture.supplierId, staffId: fixture.ownerId, paymentType: 'credit',
          lineItems: [{ medicineId: fixture.medicineId, batchNo: 'PB3', expiryDate: '2028-01-01', quantity: 5, purchasePrice: asPaisa(500), salePrice: asPaisa(900) }],
        }),
      ).rejects.toThrow(/already closed/);

      expect(countRows('purchases', fixture.shopId)).toBe(0);
    });
  });
});
