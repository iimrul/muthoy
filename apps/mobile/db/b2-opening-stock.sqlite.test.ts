// Item 12 (founder, 2026-11-27): a supplier is optional when adding a medicine.
// Stock added without one is OPENING stock: no purchase, no supplier due, no
// cash out of the drawer — the Owner's one-row inventory_import graph, which
// the server already validates. Real SQLite, real ledger trigger.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { asPaisa } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const schema = await import('./schema');
const { createOpeningStock } = await import('./inventoryImport');

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

function count(table: string): number {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return 0;
  return (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql', '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql', '0010_known_ares.sql', '0011_black_zarda.sql', '0012_small_meltdown.sql',
    '0013_owner_dashboard_credit_period.sql', '0014_owner_dashboard_credit_period_guard.sql',
    '0015_b3_shop_settings.sql', '0016_payment_note.sql', '0017_cash_reconcile.sql',
    '0018_expense_category_taxonomy.sql', '0019_supplier_archive.sql', '0020_purchase_item_status.sql',
    '0021_purchase_void.sql', '0022_supplier_profile_fields.sql', '0023_purchase_invoice_metadata.sql',
    '0024_b3_report_indexes.sql', '0025_b3_sale_tax_snapshot.sql',
    '0027_h7_local_access_lock.sql', '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql', '0033_medicine_search_key.sql',
  ]) applyMigration(name);
  applyMigration('0034_recovery_journal.sql');
  const now = new Date().toISOString();
  db.insert(schema.shops).values({ id: 'shop', ownerId: 'owner', name: 'Opening', phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'owner-role', shopId: 'shop', name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'staff-role', shopId: 'shop', name: 'staff', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'owner', shopId: 'shop', name: 'Owner', pinHash: 'hash', pinSetAt: now, roleId: 'owner-role', isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'staff', shopId: 'shop', name: 'Staff', pinHash: 'hash2', pinSetAt: now, roleId: 'staff-role', isActive: true, createdAt: now, updatedAt: now }).run();
});

const BATCH = { batchNo: 'OPN-1', expiryDate: '2027-06-30', quantity: 12, purchasePrice: asPaisa(250), salePrice: asPaisa(400) };

describe('opening stock: a medicine added without a supplier (item 12)', () => {
  it('creates the medicine and its stock with no purchase, payment or drawer effect', async () => {
    const created = await createOpeningStock({
      shopId: 'shop', actorUserId: 'owner', isStillActive: ALWAYS_LIVE,
      medicine: { name: 'Telmepress 20', generic: 'Telmisartan', manufacturer: 'Square', strength: '20mg', type: 'tablet', unitOfMeasure: 'piece', requiresPrescription: true, threshold: 5 },
      batch: BATCH,
    });

    expect(db.select().from(schema.medicines).where(eq(schema.medicines.id, created.medicineId)).get())
      .toMatchObject({ name: 'Telmepress 20', strength: '20mg', type: 'tablet', requiresPrescription: true, lowStockThresholdOverride: 5 });
    expect(db.select().from(schema.batches).where(eq(schema.batches.id, created.batchId)).get())
      .toMatchObject({ stock: 12, batchNo: 'OPN-1', purchasePrice: 250, salePrice: 400 });
    expect(db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.batchId, created.batchId)).all())
      .toEqual([expect.objectContaining({ reason: 'csv_import', changeQty: 12, refId: created.importId, createdBy: 'owner' })]);
    // Opening stock is not a purchase: nothing owed, nothing paid, drawer untouched.
    expect(count('purchases')).toBe(0);
    expect(count('purchase_items')).toBe(0);
    expect(count('payments')).toBe(0);
    expect(count('cash_drawer')).toBe(0);

    // One complete inventory_import group, exactly what the server validates.
    const group = db.select().from(schema.syncQueue).where(eq(schema.syncQueue.operationGroupId, created.importId)).all();
    expect(group.map((row) => row.operationKind)).toEqual(Array(5).fill('inventory_import'));
    expect(group).toHaveLength(group[0]?.operationExpectedCount ?? -1);
    expect(group.map((row) => row.tableName).sort()).toEqual(
      ['audit_logs', 'batches', 'inventory_imports', 'inventory_movements', 'medicines'],
    );
    expect(db.select().from(schema.inventoryImports).where(eq(schema.inventoryImports.id, created.importId)).get())
      .toMatchObject({ rowCount: 1, status: 'committed', createdBy: 'owner' });
  });

  it('adds a batch to an existing medicine without a supplier (4 rows, no new medicine)', async () => {
    const medicine = db.select().from(schema.medicines).get();
    if (!medicine) throw new Error('fixture missing');
    const added = await createOpeningStock({
      shopId: 'shop', actorUserId: 'owner', isStillActive: ALWAYS_LIVE,
      existingMedicineId: medicine.id,
      batch: { ...BATCH, batchNo: 'OPN-2', quantity: 3 },
    });
    expect(added.medicineId).toBe(medicine.id);
    const group = db.select().from(schema.syncQueue).where(eq(schema.syncQueue.operationGroupId, added.importId)).all();
    expect(group).toHaveLength(4);
    expect(group.some((row) => row.tableName === 'medicines')).toBe(false);
    expect(db.select({ stock: schema.batches.stock }).from(schema.batches).where(eq(schema.batches.id, added.batchId)).get()?.stock).toBe(3);
  });

  it('refuses a repeated batch, an unreviewed same-name medicine, and a non-owner', async () => {
    const medicine = db.select().from(schema.medicines).get();
    if (!medicine) throw new Error('fixture missing');
    const before = db.select().from(schema.syncQueue).all().length;
    await expect(createOpeningStock({
      shopId: 'shop', actorUserId: 'owner', isStillActive: ALWAYS_LIVE, existingMedicineId: medicine.id, batch: BATCH,
    })).rejects.toThrow('already exists');
    await expect(createOpeningStock({
      shopId: 'shop', actorUserId: 'owner', isStillActive: ALWAYS_LIVE,
      medicine: { name: '  telmepress 20 ', unitOfMeasure: 'piece', requiresPrescription: false }, batch: { ...BATCH, batchNo: 'X' },
    })).rejects.toThrow('Review existing medicines');
    await expect(createOpeningStock({
      shopId: 'shop', actorUserId: 'staff', isStillActive: ALWAYS_LIVE,
      medicine: { name: 'Staff Med', unitOfMeasure: 'piece', requiresPrescription: false }, batch: { ...BATCH, batchNo: 'S' },
    })).rejects.toThrow();
    await expect(createOpeningStock({
      shopId: 'shop', actorUserId: 'owner', isStillActive: ALWAYS_LIVE,
      medicine: { name: 'Zero', unitOfMeasure: 'piece', requiresPrescription: false }, batch: { ...BATCH, batchNo: 'Z', quantity: 0 },
    })).rejects.toThrow('positive whole number');
    expect(db.select().from(schema.syncQueue).all()).toHaveLength(before);
  });

  it('lets a staff member WITH inventory_add add opening stock, attributed to them (decision B2, migration 45)', async () => {
    const now = new Date().toISOString();
    db.insert(schema.userPermissions).values({
      id: 'staff-inventory-add', shopId: 'shop', userId: 'staff', key: 'inventory_add', allowed: true, createdAt: now, updatedAt: now,
    }).run();
    const added = await createOpeningStock({
      shopId: 'shop', actorUserId: 'staff', isStillActive: ALWAYS_LIVE,
      medicine: { name: 'Staff Opening Med', unitOfMeasure: 'piece', requiresPrescription: false }, batch: { ...BATCH, batchNo: 'STF-1' },
    });
    // The exact graph migration 45 accepts from staff: header, medicine, batch,
    // csv_import movement and audit row, every one attributed to the staff member.
    expect(db.select().from(schema.inventoryImports).where(eq(schema.inventoryImports.id, added.importId)).get())
      .toMatchObject({ rowCount: 1, createdBy: 'staff', fileFingerprint: `opening:${added.importId}` });
    expect(db.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.batchId, added.batchId)).all())
      .toEqual([expect.objectContaining({ reason: 'csv_import', refId: added.importId, createdBy: 'staff' })]);
    expect(db.select().from(schema.auditLogs).where(eq(schema.auditLogs.target, added.importId)).all())
      .toEqual([expect.objectContaining({ actorId: 'staff', action: 'inventory_opening_stock_added' })]);
    expect(db.select().from(schema.syncQueue).where(eq(schema.syncQueue.operationGroupId, added.importId)).all()).toHaveLength(5);

    // An explicit deny takes it away again, and writes nothing.
    db.update(schema.userPermissions).set({ allowed: false }).where(eq(schema.userPermissions.id, 'staff-inventory-add')).run();
    const before = db.select().from(schema.syncQueue).all().length;
    await expect(createOpeningStock({
      shopId: 'shop', actorUserId: 'staff', isStillActive: ALWAYS_LIVE,
      medicine: { name: 'Denied Med', unitOfMeasure: 'piece', requiresPrescription: false }, batch: { ...BATCH, batchNo: 'STF-2' },
    })).rejects.toThrow();
    expect(db.select().from(schema.syncQueue).all()).toHaveLength(before);

    // Revoked AFTER the guard but before the write (the race the in-transaction
    // recheck exists for): the grant flips inside the transaction itself.
    db.update(schema.userPermissions).set({ allowed: true }).where(eq(schema.userPermissions.id, 'staff-inventory-add')).run();
    const revokeMidWrite = () => {
      sqlite.prepare("UPDATE user_permissions SET allowed = 0 WHERE id = 'staff-inventory-add'").run();
      return true;
    };
    await expect(createOpeningStock({
      shopId: 'shop', actorUserId: 'staff', isStillActive: revokeMidWrite,
      medicine: { name: 'Raced Med', unitOfMeasure: 'piece', requiresPrescription: false }, batch: { ...BATCH, batchNo: 'STF-3' },
    })).rejects.toThrow();
    expect(db.select().from(schema.syncQueue).all()).toHaveLength(before);
  });

  it('a capsule with the same name is allowed once the owner confirms it is a different product', async () => {
    const capsule = await createOpeningStock({
      shopId: 'shop', actorUserId: 'owner', isStillActive: ALWAYS_LIVE, confirmDistinctMedicine: true,
      medicine: { name: 'Telmepress 20', generic: 'Telmisartan', type: 'capsule', unitOfMeasure: 'piece', requiresPrescription: true },
      batch: { ...BATCH, batchNo: 'CAP-1' },
    });
    const rows = db.select({ id: schema.medicines.id, type: schema.medicines.type }).from(schema.medicines)
      .where(eq(schema.medicines.name, 'Telmepress 20')).all();
    expect(rows.map((row) => row.type).sort()).toEqual(['capsule', 'tablet']);
    expect(rows.some((row) => row.id === capsule.medicineId)).toBe(true);
  });
});
