import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const schema = await import('./schema');
const { importInventoryCsv, previewInventoryCsv } = await import('./inventoryImport');
const { adjustBatchStock, archiveBatch, reverseBatchPromotion, setBatchPromotion } = await import('./inventory');
const { cancelSaleDraft, holdSaleDraft, listSaleDrafts } = await import('./saleDrafts');

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql', '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql', '0010_known_ares.sql',
  ]) applyMigration(name);
  const now = new Date().toISOString();
  db.insert(schema.shops).values({ id: 'shop', ownerId: 'owner', name: 'B2', phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'owner-role', shopId: 'shop', name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'owner', shopId: 'shop', name: 'Owner', pinHash: 'hash', pinSetAt: now, roleId: 'owner-role', isActive: true, createdAt: now, updatedAt: now }).run();
});

describe('B2 inventory, import, and holds', () => {
  it('imports one atomic owner CSV group and rejects duplicate replay', async () => {
    const expiry = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const csv = `name,generic,manufacturer,batch_no,stock,purchase_price,sale_price,expiry_date,barcode\n"Napa, Extra",Paracetamol,Beximco,B-1,4,5.25,10.50,${expiry},123`;
    const preview = await previewInventoryCsv('shop', 'owner', csv);
    expect(preview.rows).toMatchObject([{ action: 'create_medicine', stock: 4, purchasePrice: 525, salePrice: 1050 }]);
    const imported = await importInventoryCsv('shop', 'owner', csv, preview.fingerprint, ALWAYS_LIVE);
    expect(imported.rowCount).toBe(1);
    const batch = db.select().from(schema.batches).get();
    expect(batch).toMatchObject({ stock: 4, expiryDate: expiry, salePrice: 1050 });
    expect(db.select().from(schema.inventoryMovements).get()).toMatchObject({ reason: 'csv_import', changeQty: 4 });
    const group = db.select().from(schema.syncQueue).where(eq(schema.syncQueue.operationGroupId, imported.importId)).all();
    expect(group).toHaveLength(group[0]?.operationExpectedCount ?? -1);
    expect(group.map((row) => row.operationSequence).sort((a, b) => (a ?? -1) - (b ?? -1)))
      .toEqual(group.map((_, index) => index));
    await expect(importInventoryCsv('shop', 'owner', csv, preview.fingerprint, ALWAYS_LIVE))
      .rejects.toThrow('already imported');
    expect(db.select().from(schema.inventoryImports).all()).toHaveLength(1);
  });

  it('holds without reserving stock and enforces promotion/archive invariants', async () => {
    const medicine = db.select().from(schema.medicines).get();
    const batch = db.select().from(schema.batches).get();
    if (!medicine || !batch) throw new Error('CSV fixture missing');
    const held = await holdSaleDraft({
      shopId: 'shop', actorUserId: 'owner', originDeviceId: 'device-a', isStillActive: ALWAYS_LIVE,
      items: [{ medicineId: medicine.id, quantity: 3 }],
    });
    expect(db.select({ stock: schema.batches.stock }).from(schema.batches).where(eq(schema.batches.id, batch.id)).get()?.stock).toBe(4);
    expect((await listSaleDrafts('shop', 'owner', 'device-b'))[0]).toMatchObject({ id: held.draftId, canMutate: false, itemCount: 3 });
    await cancelSaleDraft('shop', 'owner', held.draftId, 'device-a', ALWAYS_LIVE);
    expect(db.select({ status: schema.saleDrafts.status }).from(schema.saleDrafts).where(eq(schema.saleDrafts.id, held.draftId)).get()?.status).toBe('cancelled');

    await setBatchPromotion({
      shopId: 'shop', actorUserId: 'owner', batchId: batch.id, discountBps: 1000, isStillActive: ALWAYS_LIVE,
    });
    await expect(archiveBatch('shop', 'owner', batch.id, ALWAYS_LIVE)).rejects.toThrow('zero stock');
    await adjustBatchStock({ shopId: 'shop', actorUserId: 'owner', batchId: batch.id, changeQty: -4,
      reason: 'Physical count', isStillActive: ALWAYS_LIVE });
    await expect(archiveBatch('shop', 'owner', batch.id, ALWAYS_LIVE)).rejects.toThrow('active promotion');
    await reverseBatchPromotion('shop', 'owner', batch.id, ALWAYS_LIVE);
    await archiveBatch('shop', 'owner', batch.id, ALWAYS_LIVE);
    expect(db.select({ isDeleted: schema.batches.isDeleted }).from(schema.batches).where(eq(schema.batches.id, batch.id)).get()?.isDeleted).toBe(true);
  });
});
