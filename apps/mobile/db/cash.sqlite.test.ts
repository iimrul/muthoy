// Volume 0 Day 10 verification on a real SQLite engine (node:sqlite), the
// same harness Day 2 and the sync helpers use. Covers the two things the
// roadmap's Day 10 checklist demands proof of: "an expense reduces expected
// cash by exactly its amount" and "End of Day's numbers match a hand
// calculation for a full test day".
//
// Every test gets its OWN shop. All Day 10 reads are shop-scoped, so this
// isolates the arithmetic without needing to fake the local business date.

import { readFileSync } from 'node:fs';
import { ALWAYS_LIVE } from './errors';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const schema = await import('./schema');
const { batches, inventoryMovements, credits, customers, medicines, roles, saleItems, sales, shops, users } = schema;
const {
  closeDay,
  currentBusinessDate,
  getCashSummarySync,
  getEndOfDaySummary,
  listExpenses,
  recordExpense,
  setOpeningCash,
} = await import('./cash');
const { collectPayment } = await import('./customers');
const { expectedCash } = await import('../domain/cashFormula');

const BUSINESS_DATE = currentBusinessDate();

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

interface Fixture {
  shopId: string;
  ownerId: string;
  /** A SECOND owner, so opened_by/closed_by attribution can differ while both
   *  actors hold `cash_management` (Volume 0 Day 11: cash is owner-only). */
  ownerTwoId: string;
  staffId: string;
  medicineId: string;
  batchId: string;
  customerId: string;
}

let shopCounter = 0;

function fixtureId(shop: number, slot: number): string {
  return `2${String(shop).padStart(7, '0')}-0000-4000-8000-${String(slot).padStart(12, '0')}`;
}

// One self-contained shop: owner + staff, a medicine/batch for sale_items'
// restrict FKs, and a customer for the credit ledger.
function seedShop(): Fixture {
  const shop = ++shopCounter;
  const now = new Date().toISOString();
  const fixture: Fixture = {
    shopId: fixtureId(shop, 1),
    ownerId: fixtureId(shop, 3),
    ownerTwoId: fixtureId(shop, 10),
    staffId: fixtureId(shop, 4),
    medicineId: fixtureId(shop, 5),
    batchId: fixtureId(shop, 6),
    customerId: fixtureId(shop, 7),
  };
  const ownerRoleId = fixtureId(shop, 8);
  const staffRoleId = fixtureId(shop, 9);

  db.insert(shops).values({ id: fixture.shopId, ownerId: fixture.ownerId, name: `Shop ${shop}`, phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(roles).values({ id: ownerRoleId, shopId: fixture.shopId, name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(roles).values({ id: staffRoleId, shopId: fixture.shopId, name: 'staff', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: fixture.ownerId, shopId: fixture.shopId, name: `Owner ${shop}`, pinHash: 'hash', pinSetAt: now, roleId: ownerRoleId, isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: fixture.ownerTwoId, shopId: fixture.shopId, name: `Owner2 ${shop}`, pinHash: 'hash', pinSetAt: now, roleId: ownerRoleId, isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: fixture.staffId, shopId: fixture.shopId, name: `Staff ${shop}`, pinHash: 'hash', pinSetAt: now, roleId: staffRoleId, isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(medicines).values({ id: fixture.medicineId, shopId: fixture.shopId, name: 'Napa', createdAt: now, updatedAt: now }).run();
  db.insert(batches).values({ id: fixture.batchId, shopId: fixture.shopId, medicineId: fixture.medicineId, batchNo: 'B1', expiryDate: '2027-01-31', stock: 0, purchasePrice: asPaisa(600), salePrice: asPaisa(1000), createdAt: now, updatedAt: now }).run();
  // Opening quantity is a movement, never a directly-written absolute —
  // the ledger triggers in migration 0006 reject the latter outright.
  db.insert(inventoryMovements).values({ id: fixtureId(shop, 12), shopId: fixture.shopId, batchId: fixture.batchId, changeQty: 100, reason: 'purchase', createdBy: fixture.ownerId, createdAt: now, updatedAt: now }).run();
  db.insert(customers).values({ id: fixture.customerId, shopId: fixture.shopId, name: `Customer ${shop}`, createdAt: now, updatedAt: now }).run();
  return fixture;
}

// A completed sale as checkout would have left it: the sale, one line with its
// COGS, and (for credit) the credit row. Written directly so this file tests
// Day 10's derivations, not Day 7's FEFO path.
function seedSale(
  fixture: Fixture,
  suffix: string,
  paymentType: 'cash' | 'credit',
  total: number,
  cogs: number,
): void {
  const now = new Date().toISOString();
  const prefix = fixture.shopId.slice(0, 8);
  const saleId = `${prefix}-0000-4000-9000-${suffix.padStart(12, '0')}`;
  db.insert(sales).values({
    id: saleId, shopId: fixture.shopId, invoiceNo: `INV-TEST-${suffix}`, total: asPaisa(total),
    paid: paymentType === 'cash' ? asPaisa(total) : ZERO_PAISA, change: ZERO_PAISA,
    paymentType, customerId: paymentType === 'credit' ? fixture.customerId : null,
    staffId: fixture.ownerId, createdAt: now, updatedAt: now,
  }).run();
  db.insert(saleItems).values({
    id: `${prefix}-0000-4000-a000-${suffix.padStart(12, '0')}`,
    shopId: fixture.shopId, saleId, medicineId: fixture.medicineId, batchId: fixture.batchId,
    qty: 1, unitPrice: asPaisa(total), discountAmount: ZERO_PAISA,
    lineTotal: asPaisa(total), cogs: asPaisa(cogs), createdAt: now, updatedAt: now,
  }).run();
  if (paymentType === 'credit') {
    db.insert(credits).values({
      id: `${prefix}-0000-4000-b000-${suffix.padStart(12, '0')}`,
      shopId: fixture.shopId, customerId: fixture.customerId, saleId,
      amount: asPaisa(total), balance: asPaisa(total), createdAt: now, updatedAt: now,
    }).run();
  }
}

function queuedTables(shopId: string): string[] {
  return (sqlite
    .prepare('SELECT table_name FROM sync_queue WHERE shop_id = ? ORDER BY seq')
    .all(shopId) as unknown as { table_name: string }[]).map((row) => row.table_name);
}

function countRows(table: string, shopId: string): number {
  return Number((sqlite
    .prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE shop_id = ?`)
    .get(shopId) as unknown as { value: number }).value);
}

interface DrawerAssertionRow {
  opening_cash: number;
  closing_expected: number | null;
  closing_counted: number | null;
  opened_by: string;
  closed_by: string | null;
  closed_at: string | null;
}

function drawerRow(shopId: string): DrawerAssertionRow | undefined {
  return sqlite
    .prepare('SELECT opening_cash, closing_expected, closing_counted, opened_by, closed_by, closed_at FROM cash_drawer WHERE shop_id = ? AND business_date = ?')
    .get(shopId, BUSINESS_DATE) as unknown as DrawerAssertionRow | undefined;
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
});

describe('expense recording and its cash impact', () => {
  it('writes the expense and its expense payment atomically, and enqueues both for sync', async () => {
    const fixture = seedShop();

    // Recorded by an owner: Volume 0 Day 11 makes cash owner-only, and
    // db/permissions.sqlite.test.ts proves a Staff actor is rejected here.
    // What this test still pins is the created_by attribution itself.
    const { expenseId } = await recordExpense({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId,
      staffId: fixture.ownerId,
      category: 'electricity',
      amount: asPaisa(12550),
      description: 'August bill',
    });

    const expense = sqlite
      .prepare('SELECT category, amount, description, created_by FROM expenses WHERE id = ?')
      .get(expenseId) as unknown as { category: string; amount: number; description: string; created_by: string };
    expect(expense).toEqual({
      category: 'electricity',
      amount: 12550,
      description: 'August bill',
      created_by: fixture.ownerId,
    });

    // Volume 0 Day 10: the payments row is what makes the expense a cash EVENT,
    // and ref_id is what ties it back to the expense's detail.
    const payment = sqlite
      .prepare('SELECT type, amount, method, ref_id, party_id, created_by FROM payments WHERE shop_id = ?')
      .get(fixture.shopId) as unknown as { type: string; amount: number; method: string; ref_id: string; party_id: string | null; created_by: string };
    expect(payment).toEqual({
      type: 'expense',
      amount: 12550,
      method: 'cash',
      ref_id: expenseId,
      party_id: null,
      created_by: fixture.ownerId,
    });

    expect(queuedTables(fixture.shopId)).toEqual([
      'cash_drawer', 'expenses', 'payments', 'cash_drawer',
    ]);
    await expect(listExpenses(fixture.shopId, fixture.ownerId, BUSINESS_DATE)).resolves.toEqual([
      { id: expenseId, category: 'electricity', amount: 12550, description: 'August bill', createdAt: expect.any(String) },
    ]);
  });

  it('reduces expected cash by exactly the expense amount', async () => {
    const fixture = seedShop();
    seedSale(fixture, '11', 'cash', 30000, 18000);
    await setOpeningCash({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE, openingCash: asPaisa(50000),
    });

    const before = expectedCash(getCashSummarySync(fixture.shopId, BUSINESS_DATE));
    expect(before).toBe(80000);

    await recordExpense({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      category: 'transport', amount: asPaisa(7000),
    });

    const after = expectedCash(getCashSummarySync(fixture.shopId, BUSINESS_DATE));
    expect(after).toBe(before - 7000);
    // The persisted drawer figure must not lag the ledger it summarises.
    expect(drawerRow(fixture.shopId)?.closing_expected).toBe(after);
  });

  it('rejects a non-positive amount without writing anything', async () => {
    const fixture = seedShop();

    await expect(
      recordExpense({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, staffId: fixture.ownerId, category: 'rent', amount: asPaisa(0) }),
    ).rejects.toThrow(/positive whole number of paisa/);

    expect(countRows('expenses', fixture.shopId)).toBe(0);
    expect(countRows('payments', fixture.shopId)).toBe(0);
    expect(countRows('cash_drawer', fixture.shopId)).toBe(0);
  });

  it('refuses to record an expense into an already-closed day', async () => {
    const fixture = seedShop();
    await closeDay({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, businessDate: BUSINESS_DATE,
      countedCash: ZERO_PAISA, closedBy: fixture.ownerId,
    });

    await expect(
      recordExpense({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, staffId: fixture.ownerId, category: 'supplies', amount: asPaisa(500) }),
    ).rejects.toThrow(/already closed/);
    expect(countRows('expenses', fixture.shopId)).toBe(0);
  });
});

describe('opening cash', () => {
  it("defaults to 0 and never inherits another day's value", async () => {
    const fixture = seedShop();
    // CLAUDE.md rule 5: yesterday's drawer must not seed today's.
    await setOpeningCash({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      businessDate: '2020-01-01', openingCash: asPaisa(99900),
    });

    expect(getCashSummarySync(fixture.shopId, BUSINESS_DATE).openingCash).toBe(0);
    expect(getCashSummarySync(fixture.shopId, '2020-01-01').openingCash).toBe(99900);
  });
});

describe('end-of-day close', () => {
  it('derives every Day 10 line from the ledger for a full simulated day', async () => {
    const fixture = seedShop();
    const shopLabel = shopCounter;
    await setOpeningCash({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE, openingCash: asPaisa(50000),
    });
    seedSale(fixture, '21', 'cash', 30000, 18000);
    seedSale(fixture, '22', 'credit', 20000, 12000);
    seedSale(fixture, '23', 'cash', 10000, 6000);
    await collectPayment({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      customerId: fixture.customerId, amount: asPaisa(5000),
    });
    await recordExpense({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      category: 'staff_salary', amount: asPaisa(7000),
    });

    const summary = await getEndOfDaySummary(fixture.shopId, fixture.ownerId, BUSINESS_DATE);

    // Hand calculation, in paisa:
    //   total sales      30000 + 20000 + 10000 = 60000
    //   cash / credit    40000 / 20000
    //   COGS             18000 + 12000 + 6000  = 36000
    //   gross profit     60000 - 36000         = 24000
    //   expected cash    50000 + 40000 + 5000 - 7000 = 88000
    expect(summary.totalSales).toBe(60000);
    expect(summary.cashSales).toBe(40000);
    expect(summary.creditSales).toBe(20000);
    expect(summary.cogs).toBe(36000);
    expect(summary.grossProfit).toBe(24000);
    expect(summary.expenses).toBe(7000);
    expect(summary.newCreditGiven).toBe(20000);
    expect(summary.creditCollected).toBe(5000);
    expect(summary.expectedCash).toBe(88000);
    expect(summary.isClosed).toBe(false);
    expect(summary.countedCash).toBeNull();
    expect(summary.variance).toBeNull();
    expect(summary.openedByName).toBe(`Owner ${shopLabel}`);
    expect(summary.closedByName).toBeNull();
  });

  it('locks the day with counted vs expected, closed_by and closed_at, and rejects a second close', async () => {
    const fixture = seedShop();
    const shopLabel = shopCounter;
    await setOpeningCash({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE, openingCash: asPaisa(50000),
    });
    seedSale(fixture, '31', 'cash', 30000, 18000);
    await recordExpense({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      category: 'rent', amount: asPaisa(2000),
    });

    // Closed by a DIFFERENT owner than the one who opened the drawer, so
    // opened_by/closed_by attribution is still proven to be two distinct
    // users — both of whom hold `cash_management` (Volume 0 Day 11).
    await closeDay({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, businessDate: BUSINESS_DATE,
      countedCash: asPaisa(77500), closedBy: fixture.ownerTwoId,
    });

    const summary = await getEndOfDaySummary(fixture.shopId, fixture.ownerId, BUSINESS_DATE);
    expect(summary.expectedCash).toBe(78000); // 50000 + 30000 - 2000
    expect(summary.countedCash).toBe(77500);
    expect(summary.variance).toBe(-500); // a 500-paisa shortfall
    expect(summary.isClosed).toBe(true);
    expect(summary.openedByName).toBe(`Owner ${shopLabel}`);
    expect(summary.closedByName).toBe(`Owner2 ${shopLabel}`);

    const drawer = drawerRow(fixture.shopId);
    expect(drawer?.closing_expected).toBe(78000);
    expect(drawer?.closing_counted).toBe(77500);
    expect(drawer?.opened_by).toBe(fixture.ownerId);
    expect(drawer?.closed_by).toBe(fixture.ownerTwoId);
    expect(drawer?.closed_at).toEqual(expect.any(String));

    await expect(
      closeDay({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, businessDate: BUSINESS_DATE,
        countedCash: asPaisa(1), closedBy: fixture.ownerId,
      }),
    ).rejects.toThrow(/already closed/);
    expect(drawerRow(fixture.shopId)?.closing_counted).toBe(77500);
  });

  it('closes a day that has no drawer row yet, recording the closer as opener', async () => {
    const fixture = seedShop();
    seedSale(fixture, '41', 'credit', 15000, 9000);

    await closeDay({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, businessDate: BUSINESS_DATE,
      countedCash: ZERO_PAISA, closedBy: fixture.ownerId,
    });

    const summary = await getEndOfDaySummary(fixture.shopId, fixture.ownerId, BUSINESS_DATE);
    expect(summary.totalSales).toBe(15000);
    expect(summary.cashSales).toBe(0);
    expect(summary.creditSales).toBe(15000);
    expect(summary.expectedCash).toBe(0);
    expect(summary.variance).toBe(0);
    expect(summary.isClosed).toBe(true);
    expect(queuedTables(fixture.shopId)).toEqual(['cash_drawer', 'cash_drawer']);
  });

  it('rejects a closer who is not an active user of the shop', async () => {
    const fixture = seedShop();
    const other = seedShop();

    // Since Volume 0 Day 11, requirePermission catches this one layer earlier
    // than closeDay's in-transaction requireActiveUser — an actor from another
    // shop has no role IN THIS shop, so the friendly denial is what surfaces.
    // requireActiveUser is still there as the in-transaction backstop.
    await expect(
      closeDay({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, businessDate: BUSINESS_DATE,
        countedCash: ZERO_PAISA, closedBy: other.ownerId,
      }),
    ).rejects.toThrow(/Owner access only/);
    expect(countRows('cash_drawer', fixture.shopId)).toBe(0);
  });
});
