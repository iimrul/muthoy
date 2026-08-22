// Volume 0 Day 11's permission enforcement, proven on a real SQLite engine
// (node:sqlite) — the same harness Day 2, the sync helpers and the closed-day
// guard use.
//
// The point of this file is the DIRECT-NAVIGATION BYPASS. Route guards
// (state/usePermission.ts) only decide what renders; calling a db/ action
// straight out is exactly what a Staff login achieves by deep-linking past a
// hidden screen, and it is what these tests do. Every guard re-derives the
// actor's role from SQLite via db/auth.ts's requirePermission, so the session
// store cannot be the thing that grants access.
//
// Each test gets its own shop, so denials never depend on ordering.

import { readFileSync } from 'node:fs';
import { ALWAYS_LIVE } from './errors';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
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

// PIN became unique-per-live-user too, for the same reason phone did: PIN Login
// has no "who are you" step, so two users sharing one would make verifyPin
// return whichever row it reached first. Suites stack several shops into one
// database, and the check is device-wide, so the counter is too.
let staffPinCounter = 1000;
function nextStaffPin(): string {
  staffPinCounter += 1;
  return String(staffPinCounter);
}


const { db } = await import('./client');
const schema = await import('./schema');
const { batches, inventoryMovements, customers, medicines, roles, shops, suppliers, users } = schema;
const {
  closeDay,
  currentBusinessDate,
  getCashSummary,
  getEndOfDaySummary,
  listExpenses,
  recordExpense,
  setOpeningCash,
} = await import('./cash');
const { createMedicineWithBatch, listMedicines } = await import('./inventory');
const { createSaleTransaction } = await import('./sales');
const { createStaff, deactivateStaff, listStaff, resetStaffPin } = await import('./staff');
const { changeOwnPin, getShopName, getShopProfile, updateShopProfile } = await import('./settings');
const { createSupplier, getSupplierDetail, listSuppliers } = await import('./suppliers');
const { createPurchase, listPurchasesForSupplier } = await import('./purchases');
const { collectPayment, createCustomer, getCustomerCreditLedger } = await import('./customers');
const { requirePermission, verifyPin } = await import('./auth');
const { hashPin, verifyPinHash } = await import('../native/crypto');

const BUSINESS_DATE = currentBusinessDate();

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

interface Fixture {
  shopId: string;
  ownerId: string;
  staffId: string;
  managerId: string;
  medicineId: string;
  batchId: string;
  supplierId: string;
  customerId: string;
}

let shopCounter = 0;

function fixtureId(shop: number, slot: number): string {
  return `5${String(shop).padStart(7, '0')}-0000-4000-8000-${String(slot).padStart(12, '0')}`;
}

// One self-contained shop: an owner, a staff member, and a MANAGER — the P1
// role whose rows every real shop already has (db/auth.ts's createShopAndOwner
// creates all three system roles up front), plus stock to sell.
function seedShop(): Fixture {
  const shop = ++shopCounter;
  const now = new Date().toISOString();
  const fixture: Fixture = {
    shopId: fixtureId(shop, 1),
    ownerId: fixtureId(shop, 2),
    staffId: fixtureId(shop, 3),
    managerId: fixtureId(shop, 4),
    medicineId: fixtureId(shop, 5),
    batchId: fixtureId(shop, 6),
    supplierId: fixtureId(shop, 10),
    customerId: fixtureId(shop, 11),
  };
  const ownerRoleId = fixtureId(shop, 7);
  const staffRoleId = fixtureId(shop, 8);
  const managerRoleId = fixtureId(shop, 9);

  db.insert(shops).values({ id: fixture.shopId, ownerId: fixture.ownerId, name: `Perm Shop ${shop}`, phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(roles).values({ id: ownerRoleId, shopId: fixture.shopId, name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(roles).values({ id: staffRoleId, shopId: fixture.shopId, name: 'staff', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(roles).values({ id: managerRoleId, shopId: fixture.shopId, name: 'manager', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: fixture.ownerId, shopId: fixture.shopId, name: `Owner ${shop}`, pinHash: 'hash', pinSetAt: now, roleId: ownerRoleId, isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: fixture.staffId, shopId: fixture.shopId, name: `Staff ${shop}`, pinHash: 'hash', pinSetAt: now, roleId: staffRoleId, isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: fixture.managerId, shopId: fixture.shopId, name: `Manager ${shop}`, pinHash: 'hash', pinSetAt: now, roleId: managerRoleId, isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(medicines).values({ id: fixture.medicineId, shopId: fixture.shopId, name: 'Napa', createdAt: now, updatedAt: now }).run();
  db.insert(batches).values({ id: fixture.batchId, shopId: fixture.shopId, medicineId: fixture.medicineId, batchNo: 'B1', expiryDate: '2027-01-31', stock: 0, purchasePrice: asPaisa(600), salePrice: asPaisa(1000), createdAt: now, updatedAt: now }).run();
  // Opening quantity is a movement, never a directly-written absolute —
  // the ledger triggers in migration 0006 reject the latter outright.
  db.insert(inventoryMovements).values({ id: fixtureId(shop, 12), shopId: fixture.shopId, batchId: fixture.batchId, changeQty: 100, reason: 'purchase', createdBy: fixture.ownerId, createdAt: now, updatedAt: now }).run();
  db.insert(suppliers).values({ id: fixture.supplierId, shopId: fixture.shopId, name: `Supplier ${shop}`, createdAt: now, updatedAt: now }).run();
  db.insert(customers).values({ id: fixture.customerId, shopId: fixture.shopId, name: `Customer ${shop}`, createdAt: now, updatedAt: now }).run();
  return fixture;
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

function pinHashOf(userId: string): string {
  return (sqlite.prepare('SELECT pin_hash FROM users WHERE id = ?').get(userId) as unknown as { pin_hash: string }).pin_hash;
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
  applyMigration('0010_known_ares.sql');
});

describe('owner — full access', () => {
  it('may manage cash: opening cash, an expense, and closing the day', async () => {
    const fixture = seedShop();

    await setOpeningCash({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE, openingCash: asPaisa(50000),
    });
    await recordExpense({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      category: 'rent', amount: asPaisa(2000),
    });
    await closeDay({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, businessDate: BUSINESS_DATE,
      countedCash: asPaisa(48000), closedBy: fixture.ownerId,
    });

    expect(countRows('expenses', fixture.shopId)).toBe(1);
    expect(countRows('cash_drawer', fixture.shopId)).toBe(1);
  });

  it('may manage staff: create, list, reset a PIN, and deactivate', async () => {
    const fixture = seedShop();

    const created = await createStaff(fixture.shopId, fixture.ownerId, { name: 'Arif', phone: nextStaffPhone(), rawPin: nextStaffPin(), permissions: {} }, ALWAYS_LIVE);
    await expect(listStaff(fixture.shopId, fixture.ownerId)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.id, name: 'Arif', isActive: true })]),
    );

    await resetStaffPin(created.id, '9876', fixture.ownerId, ALWAYS_LIVE);
    await deactivateStaff(created.id, fixture.ownerId, ALWAYS_LIVE);

    // CLAUDE.md rule 8 / Day 11 checklist: audit rows record WHAT happened and
    // to whom, never a PIN value — and never the hash either.
    const auditRows = sqlite
      .prepare('SELECT action, actor_id, target, meta FROM audit_logs WHERE shop_id = ? ORDER BY created_at')
      .all(fixture.shopId) as unknown as { action: string; actor_id: string; target: string; meta: string | null }[];
    expect(auditRows.map((row) => row.action)).toEqual(['pin_reset', 'staff_deactivated']);
    expect(auditRows.every((row) => row.actor_id === fixture.ownerId && row.target === created.id)).toBe(true);
    expect(auditRows.every((row) => row.meta === null)).toBe(true);
  });

  it('may write inventory', async () => {
    const fixture = seedShop();

    const result = await createMedicineWithBatch({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, actorUserId: fixture.ownerId,
      name: 'Seclo', unitOfMeasure: 'piece', requiresPrescription: false, threshold: 10,
      firstBatch: { batchNo: 'OB1', expiryDate: '2028-01-01', quantity: 20, purchasePrice: asPaisa(500), salePrice: asPaisa(900) },
    });

    expect(result.medicineId).toEqual(expect.any(String));
  });

  // Gating the reads must not change a single figure for the owner —
  // CLAUDE.md rule 4: the formula is fixed and is not re-derived by the guard.
  it('reads the same cash figures through the gated APIs as the ledger holds', async () => {
    const fixture = seedShop();
    await setOpeningCash({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      businessDate: BUSINESS_DATE, openingCash: asPaisa(50000),
    });
    await recordExpense({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId,
      category: 'transport', amount: asPaisa(7000),
    });

    const summary = await getCashSummary(fixture.shopId, fixture.ownerId, BUSINESS_DATE);
    const expenses = await listExpenses(fixture.shopId, fixture.ownerId, BUSINESS_DATE);
    const endOfDay = await getEndOfDaySummary(fixture.shopId, fixture.ownerId, BUSINESS_DATE);

    expect(summary.openingCash).toBe(50000);
    expect(summary.expenses).toBe(7000);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.amount).toBe(7000);
    // 50000 opening − 7000 expense, no sales.
    expect(endOfDay.expectedCash).toBe(43000);
  });

  it('may change their own PIN from Settings', async () => {
    const fixture = seedShop();
    // A real hash, so the current-PIN verification is exercised rather than
    // short-circuited by the fixture's placeholder.
    sqlite.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPin('1234'), fixture.ownerId);

    await changeOwnPin(fixture.ownerId, '1234', '5678', ALWAYS_LIVE);

    const stored = (sqlite.prepare('SELECT pin_hash FROM users WHERE id = ?').get(fixture.ownerId) as unknown as { pin_hash: string }).pin_hash;
    await expect(verifyPinHash('5678', stored)).resolves.toBe(true);
    // CLAUDE.md rule 8: the audit row records the change, never the value.
    const audit = sqlite
      .prepare("SELECT action, meta FROM audit_logs WHERE shop_id = ? AND action = 'pin_changed'")
      .get(fixture.shopId) as unknown as { action: string; meta: string | null };
    expect(audit).toEqual({ action: 'pin_changed', meta: null });
  });

  it('may manage suppliers and purchases', async () => {
    const fixture = seedShop();

    const supplier = await createSupplier(fixture.shopId, fixture.ownerId, { name: 'Beximco' }, ALWAYS_LIVE);
    await expect(listSuppliers(fixture.shopId, fixture.ownerId)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: supplier.id })]),
    );
    await expect(getSupplierDetail(fixture.shopId, fixture.ownerId, supplier.id)).resolves.toEqual(
      expect.objectContaining({ supplier: expect.objectContaining({ id: supplier.id }) }),
    );

    const purchase = await createPurchase({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, supplierId: fixture.supplierId, staffId: fixture.ownerId, paymentType: 'cod',
      lineItems: [{ medicineId: fixture.medicineId, batchNo: 'PB1', expiryDate: '2028-01-01', quantity: 10, purchasePrice: asPaisa(500), salePrice: asPaisa(900) }],
    });

    expect(purchase.total).toBe(5000);
    await expect(listPurchasesForSupplier(fixture.shopId, fixture.ownerId, fixture.supplierId)).resolves.toHaveLength(1);
  });

  // Standalone credit management (app/credit/*) is separate from a Staff-made
  // credit SALE at checkout — this proves the owner path still works end to
  // end: create a customer, sell to them on credit, then collect a payment.
  it('may manage standalone customer credit: create a customer and collect a payment', async () => {
    const fixture = seedShop();

    const customer = await createCustomer({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, actorUserId: fixture.ownerId, name: 'Rina' });

    await createSaleTransaction({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId, paymentType: 'credit', customerId: customer.id,
      lines: [{ medicineId: fixture.medicineId, deductions: [{ batchId: fixture.batchId, quantityDeducted: 1 }], unitPrice: asPaisa(1000) }],
    });
    await collectPayment({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.ownerId, customerId: customer.id, amount: asPaisa(400),
    });

    const ledger = await getCustomerCreditLedger(fixture.shopId, fixture.ownerId, customer.id);
    expect(ledger).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'credit_sale', amount: 1000 }),
      expect.objectContaining({ type: 'collection', amount: 400 }),
    ]));
    expect(countRows('payments', fixture.shopId)).toBe(1);
  });
});

describe('staff — what Volume 0 Day 11 still allows', () => {
  it('may make a sale', async () => {
    const fixture = seedShop();

    const result = await createSaleTransaction({ isStillActive: ALWAYS_LIVE,
      shopId: fixture.shopId, staffId: fixture.staffId, paymentType: 'cash',
      lines: [{ medicineId: fixture.medicineId, deductions: [{ batchId: fixture.batchId, quantityDeducted: 2 }], unitPrice: asPaisa(1000) }],
    });

    expect(result.total).toBe(2000);
    expect(countRows('sales', fixture.shopId)).toBe(1);
    // Attribution is unchanged by the permission work: the sale still belongs
    // to whoever was logged in.
    const sale = sqlite
      .prepare('SELECT staff_id FROM sales WHERE shop_id = ?')
      .get(fixture.shopId) as unknown as { staff_id: string };
    expect(sale.staff_id).toBe(fixture.staffId);
  });

  it('may view inventory', async () => {
    const fixture = seedShop();

    const rows = await listMedicines(fixture.shopId);

    expect(rows.map((row) => row.name)).toContain('Napa');
  });
});

// These call the db/ actions directly — no screen involved. That IS the
// direct-navigation bypass: whatever a Staff login manages to reach, the
// action still refuses, and refuses BEFORE writing anything.
describe('staff — owner-only actions denied by direct navigation', () => {
  it('cannot set opening cash', async () => {
    const fixture = seedShop();

    await expect(
      setOpeningCash({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, staffId: fixture.staffId,
        businessDate: BUSINESS_DATE, openingCash: asPaisa(50000),
      }),
    ).rejects.toThrow(/Owner access only/);

    expect(countRows('cash_drawer', fixture.shopId)).toBe(0);
    expect(queuedCount(fixture.shopId)).toBe(0);
  });

  it('cannot record an expense, and leaves no partial rows or outbox entries', async () => {
    const fixture = seedShop();

    await expect(
      recordExpense({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, staffId: fixture.staffId,
        category: 'transport', amount: asPaisa(7000),
      }),
    ).rejects.toThrow(/Owner access only/);

    expect(countRows('expenses', fixture.shopId)).toBe(0);
    expect(countRows('payments', fixture.shopId)).toBe(0);
    expect(countRows('cash_drawer', fixture.shopId)).toBe(0);
    expect(queuedCount(fixture.shopId)).toBe(0);
  });

  it('cannot close the day', async () => {
    const fixture = seedShop();

    await expect(
      closeDay({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, businessDate: BUSINESS_DATE,
        countedCash: ZERO_PAISA, closedBy: fixture.staffId,
      }),
    ).rejects.toThrow(/Owner access only/);

    expect(countRows('cash_drawer', fixture.shopId)).toBe(0);
  });

  it('cannot create another staff login', async () => {
    const fixture = seedShop();
    const usersBefore = countRows('users', fixture.shopId);

    await expect(createStaff(fixture.shopId, fixture.staffId, { name: 'Imposter', phone: nextStaffPhone(), rawPin: nextStaffPin(), permissions: {} }, ALWAYS_LIVE)).rejects.toThrow(/Owner access only/);

    expect(countRows('users', fixture.shopId)).toBe(usersBefore);
  });

  it('cannot list the staff roster', async () => {
    const fixture = seedShop();

    await expect(listStaff(fixture.shopId, fixture.staffId)).rejects.toThrow(/Owner access only/);
  });

  it("cannot reset another user's PIN — the hash is untouched and nothing is audited", async () => {
    const fixture = seedShop();
    const target = await createStaff(fixture.shopId, fixture.ownerId, { name: 'Arif', phone: nextStaffPhone(), rawPin: nextStaffPin(), permissions: {} }, ALWAYS_LIVE);
    const hashBefore = pinHashOf(target.id);

    await expect(resetStaffPin(target.id, '0000', fixture.staffId, ALWAYS_LIVE)).rejects.toThrow(/Owner access only/);

    expect(pinHashOf(target.id)).toBe(hashBefore);
    expect(countRows('audit_logs', fixture.shopId)).toBe(0);
  });

  it('cannot deactivate another staff member', async () => {
    const fixture = seedShop();
    const target = await createStaff(fixture.shopId, fixture.ownerId, { name: 'Arif', phone: nextStaffPhone(), rawPin: nextStaffPin(), permissions: {} }, ALWAYS_LIVE);

    await expect(deactivateStaff(target.id, fixture.staffId, ALWAYS_LIVE)).rejects.toThrow(/Owner access only/);

    const row = sqlite.prepare('SELECT is_active FROM users WHERE id = ?').get(target.id) as unknown as { is_active: number };
    expect(row.is_active).toBe(1);
  });

  it('cannot write inventory', async () => {
    const fixture = seedShop();

    await expect(
      createMedicineWithBatch({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, actorUserId: fixture.staffId,
        name: 'Sneaky', unitOfMeasure: 'piece', requiresPrescription: false, threshold: 10,
        firstBatch: { batchNo: 'SB1', expiryDate: '2028-01-01', quantity: 5, purchasePrice: asPaisa(500), salePrice: asPaisa(900) },
      }),
    ).rejects.toThrow(/Owner access only/);

    const sneaky = sqlite
      .prepare("SELECT COUNT(*) AS value FROM medicines WHERE shop_id = ? AND name = 'Sneaky'")
      .get(fixture.shopId) as unknown as { value: number };
    expect(sneaky.value).toBe(0);
  });

  it('cannot manage suppliers or purchases', async () => {
    const fixture = seedShop();
    const suppliersBefore = countRows('suppliers', fixture.shopId);

    await expect(listSuppliers(fixture.shopId, fixture.staffId)).rejects.toThrow(/Owner access only/);
    await expect(getSupplierDetail(fixture.shopId, fixture.staffId, fixture.supplierId)).rejects.toThrow(/Owner access only/);
    await expect(createSupplier(fixture.shopId, fixture.staffId, { name: 'Backdoor' }, ALWAYS_LIVE)).rejects.toThrow(/Owner access only/);
    await expect(listPurchasesForSupplier(fixture.shopId, fixture.staffId, fixture.supplierId)).rejects.toThrow(/Owner access only/);
    await expect(
      createPurchase({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, supplierId: fixture.supplierId, staffId: fixture.staffId, paymentType: 'cod',
        lineItems: [{ medicineId: fixture.medicineId, batchNo: 'SP1', expiryDate: '2028-01-01', quantity: 10, purchasePrice: asPaisa(500), salePrice: asPaisa(900) }],
      }),
    ).rejects.toThrow(/Owner access only/);

    expect(countRows('suppliers', fixture.shopId)).toBe(suppliersBefore);
    expect(countRows('purchases', fixture.shopId)).toBe(0);
    expect(countRows('payments', fixture.shopId)).toBe(0);
  });

  // The blocker this fix closes: app/credit/* and db/customers.ts's
  // collectPayment were reachable by direct navigation with no gate at all.
  it('cannot create a standalone customer or collect a payment, leaving no rows or outbox entries', async () => {
    const fixture = seedShop();
    const customersBefore = countRows('customers', fixture.shopId);
    const queueBefore = queuedCount(fixture.shopId);

    await expect(
      createCustomer({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, actorUserId: fixture.staffId, name: 'Backdoor customer' }),
    ).rejects.toThrow(/Owner access only/);
    await expect(
      collectPayment({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, staffId: fixture.staffId, customerId: fixture.customerId, amount: asPaisa(100),
      }),
    ).rejects.toThrow(/Owner access only/);

    expect(countRows('customers', fixture.shopId)).toBe(customersBefore);
    expect(countRows('payments', fixture.shopId)).toBe(0);
    expect(countRows('cash_drawer', fixture.shopId)).toBe(0);
    expect(queuedCount(fixture.shopId)).toBe(queueBefore);
  });
});

// Route hiding is not the protection: the day's cash position, the expense
// list and the End-of-Day close-out (profit, COGS, variance) are owner-only to
// READ, checked at the API itself.
describe('cash-sensitive reads — denied for unauthorized roles', () => {
  it('denies staff the cash summary, expense list, and end-of-day summary', async () => {
    const fixture = seedShop();

    await expect(getCashSummary(fixture.shopId, fixture.staffId, BUSINESS_DATE)).rejects.toThrow(/Owner access only/);
    await expect(listExpenses(fixture.shopId, fixture.staffId, BUSINESS_DATE)).rejects.toThrow(/Owner access only/);
    await expect(getEndOfDaySummary(fixture.shopId, fixture.staffId, BUSINESS_DATE)).rejects.toThrow(/Owner access only/);
  });

  it('grants manager cash reads but denies a cross-shop owner', async () => {
    const fixture = seedShop();
    const other = seedShop();

    await expect(getCashSummary(fixture.shopId, fixture.managerId, BUSINESS_DATE)).resolves.toBeDefined();
    await expect(getEndOfDaySummary(fixture.shopId, fixture.managerId, BUSINESS_DATE)).resolves.toBeDefined();
    await expect(listExpenses(fixture.shopId, other.ownerId, BUSINESS_DATE)).rejects.toThrow(/Owner access only/);
  });

  it('denies a deactivated owner mid-session', async () => {
    const fixture = seedShop();
    sqlite.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(fixture.ownerId);

    await expect(getCashSummary(fixture.shopId, fixture.ownerId, BUSINESS_DATE)).rejects.toThrow(/Owner access only/);
  });
});

// Volume 0 Day 11 keeps PIN handling with the owner: their own PIN, and
// resetting a staff PIN. A Staff login direct-navigating to Settings must
// change nothing — no hash, no audit row, no outbox entry.
describe('settings — owner-sensitive actions denied', () => {
  it('denies staff changing a PIN from Settings, with zero side effects', async () => {
    const fixture = seedShop();
    sqlite.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPin('1234'), fixture.staffId);
    const hashBefore = pinHashOf(fixture.staffId);
    const queueBefore = queuedCount(fixture.shopId);

    await expect(changeOwnPin(fixture.staffId, '1234', '5678', ALWAYS_LIVE)).rejects.toThrow(/Owner access only/);

    expect(pinHashOf(fixture.staffId)).toBe(hashBefore);
    expect(countRows('audit_logs', fixture.shopId)).toBe(0);
    expect(queuedCount(fixture.shopId)).toBe(queueBefore);
  });

  it('denies staff the shop-profile read and update', async () => {
    const fixture = seedShop();

    await expect(getShopProfile(fixture.shopId, fixture.staffId)).rejects.toThrow(/Owner access only/);
    await expect(updateShopProfile(fixture.shopId, fixture.staffId, { name: 'Renamed' }, ALWAYS_LIVE)).rejects.toThrow(/Owner access only/);

    await expect(getShopProfile(fixture.shopId, fixture.ownerId)).resolves.toMatchObject({ id: fixture.ownerId });
  });

  it('denies the P1 manager role the same Settings actions', async () => {
    const fixture = seedShop();
    sqlite.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPin('1234'), fixture.managerId);

    await expect(changeOwnPin(fixture.managerId, '1234', '5678', ALWAYS_LIVE)).rejects.toThrow(/Owner access only/);
    await expect(updateShopProfile(fixture.shopId, fixture.managerId, { name: 'Renamed' }, ALWAYS_LIVE)).rejects.toThrow(/Owner access only/);
    expect(countRows('audit_logs', fixture.shopId)).toBe(0);
  });

  // getShopName is the dashboard shell's read (Volume 0 Day 5) and stays open
  // to every role — it is a label, not a financial figure.
  it('leaves the dashboard shop-name read open to staff', async () => {
    const fixture = seedShop();

    await expect(getShopName(fixture.shopId)).resolves.toEqual(expect.stringContaining('Perm Shop'));
  });
});

describe('roles the session store cannot vouch for', () => {
  // A session is remembered in MMKV, but every guard re-reads the role from
  // SQLite — so deactivating a user takes effect immediately, mid-session.
  it('denies a deactivated owner', async () => {
    const fixture = seedShop();
    sqlite.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(fixture.ownerId);

    await expect(
      recordExpense({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, staffId: fixture.ownerId, category: 'rent', amount: asPaisa(100) }),
    ).rejects.toThrow(/Owner access only/);
  });

  it('denies a user from another shop', async () => {
    const fixture = seedShop();
    const other = seedShop();

    await expect(
      recordExpense({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, staffId: other.ownerId, category: 'rent', amount: asPaisa(100) }),
    ).rejects.toThrow(/Owner access only/);
  });

  it('logs both manager and staff into their assigned operational roles', async () => {
    const fixture = seedShop();
    sqlite.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPin('7391'), fixture.managerId);
    sqlite.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(await hashPin('7392'), fixture.staffId);

    await expect(verifyPin('7391')).resolves.toEqual({
      shopId: fixture.shopId, userId: fixture.managerId, role: 'manager', permissions: {},
    });
    await expect(verifyPin('7392')).resolves.toEqual({
      shopId: fixture.shopId, userId: fixture.staffId, role: 'staff',
      // No overrides configured, so the staff role default applies unchanged.
      permissions: {},
    });
    // Two bcrypt hashes plus two exhaustive verifyPin scans, over every staff
    // member this suite has created. That is inherent to what is being proven —
    // verifyPin has no "who are you" step, so it MUST compare against everyone —
    // and the suite deliberately stacks many shops into one database.
  }, 30_000);

  it('grants manager expense and sales operations by default', async () => {
    const fixture = seedShop();

    await expect(
      recordExpense({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, staffId: fixture.managerId, category: 'rent', amount: asPaisa(100) }),
    ).resolves.toBeDefined();

    await expect(
      createSaleTransaction({ isStillActive: ALWAYS_LIVE,
        shopId: fixture.shopId, staffId: fixture.managerId, paymentType: 'cash',
        lines: [{ medicineId: fixture.medicineId, deductions: [{ batchId: fixture.batchId, quantityDeducted: 1 }], unitPrice: asPaisa(1000) }],
      }),
    ).resolves.toBeDefined();

    expect(countRows('sales', fixture.shopId)).toBe(1);
  });

  it('grants manager standalone credit management by default', async () => {
    const fixture = seedShop();
    const queueBefore = queuedCount(fixture.shopId);

    await expect(requirePermission(fixture.shopId, fixture.managerId, 'credit_management')).resolves.toBeUndefined();
    await expect(
      createCustomer({ isStillActive: ALWAYS_LIVE, shopId: fixture.shopId, actorUserId: fixture.managerId, name: 'Manager customer' }),
    ).resolves.toBeDefined();

    expect(countRows('customers', fixture.shopId)).toBe(2);
    expect(queuedCount(fixture.shopId)).toBeGreaterThan(queueBefore);
  });
});
