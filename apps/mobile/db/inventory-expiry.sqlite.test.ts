// Volume 0 Day 9: Expiry Management. Proves listBatchesByExpiry (db/inventory.ts)
// returns every non-deleted batch for the shop, nearest-real-expiry-first,
// with the correct status derived via the shared domain/notificationRules
// helpers — not a second hand-rolled calculation.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';

const { db } = await import('./client');
const schema = await import('./schema');
const { batches, inventoryMovements, medicines, roles, shops, users } = schema;
const { listBatchesByExpiry } = await import('./inventory');
const { sqlite } = await import('./test/expo-sqlite');

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

const NOW = new Date('2027-01-15T09:00:00');
const SHOP_ID = '40000001-0000-4000-8000-000000000001';
const OTHER_SHOP_ID = '40000002-0000-4000-8000-000000000001';

function iso(offsetDays: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function seedShop(id: string, name: string): void {
  const now = new Date().toISOString();
  db.insert(shops).values({ id, ownerId: `${id}-owner`, name, phone: '01700000000', createdAt: now, updatedAt: now }).run();
  // An owner row so opening-stock movements have a real created_by to point
  // at — inventory_movements.created_by is a restricted FK.
  db.insert(roles).values({ id: `${id}-role`, shopId: id, name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(users).values({ id: `${id}-owner`, shopId: id, name: 'Owner', pinHash: 'hash', pinSetAt: now, roleId: `${id}-role`, isActive: true, createdAt: now, updatedAt: now }).run();
}

function seedMedicine(id: string, shopId: string, name: string): void {
  const now = new Date().toISOString();
  db.insert(medicines).values({ id, shopId, name, createdAt: now, updatedAt: now }).run();
}

function seedBatch(id: string, shopId: string, medicineId: string, batchNo: string, expiryDate: string | null, stock: number, isDeleted = false): void {
  const now = new Date().toISOString();
  db.insert(batches).values({
    id, shopId, medicineId, batchNo, expiryDate, stock: 0,
    purchasePrice: asPaisa(100), salePrice: asPaisa(200), isDeleted,
    createdAt: now, updatedAt: now,
  }).run();
  // Opening quantity arrives as a movement, never as a directly-written
  // absolute — migration 0006's triggers reject the latter outright.
  if (stock !== 0) {
    db.insert(inventoryMovements).values({
      id: `${id}-opening`, shopId, batchId: id, changeQty: stock,
      reason: 'purchase', createdBy: `${shopId}-owner`,
      createdAt: now, updatedAt: now,
    }).run();
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

  seedShop(SHOP_ID, 'Expiry Test Shop');
  seedShop(OTHER_SHOP_ID, 'Other Shop');
  seedMedicine('med-1', SHOP_ID, 'Napa');
  seedMedicine('med-2', SHOP_ID, 'Amoxicillin');
  seedMedicine('med-other', OTHER_SHOP_ID, 'Not Visible');

  // Deliberately inserted out of expiry order to prove the query re-sorts.
  seedBatch('batch-warning', SHOP_ID, 'med-2', 'W1', iso(20), 40); // inside window, past critical cutoff
  seedBatch('batch-expired', SHOP_ID, 'med-1', 'E1', iso(-3), 10); // already past
  seedBatch('batch-null', SHOP_ID, 'med-1', 'N1', null, 5); // no expiry recorded
  seedBatch('batch-ok', SHOP_ID, 'med-2', 'O1', iso(90), 25); // outside the window
  seedBatch('batch-critical', SHOP_ID, 'med-1', 'C1', iso(2), 15); // inside critical sub-window
  seedBatch('batch-deleted', SHOP_ID, 'med-1', 'D1', iso(1), 1, true); // soft-deleted, must never appear
  seedBatch('batch-other-shop', OTHER_SHOP_ID, 'med-other', 'X1', iso(1), 1); // different shop, must never appear

  // ADVERSARIAL: a batch stamped with THIS shop's shop_id whose medicine_id
  // points at ANOTHER shop's medicine. The batches.medicine_id FK constrains
  // only medicines.id — never the shop — so a corrupted or hostile sync
  // payload can produce exactly this row. Filtering on batches.shop_id alone
  // would join it and render 'Not Visible', leaking the other shop's
  // medicine name (CLAUDE.md rule 7). Dated earliest of all, so a leak would
  // also break the nearest-first ordering assertion loudly.
  seedBatch('batch-cross-shop-medicine', SHOP_ID, 'med-other', 'XS1', iso(-10), 7);
});

describe('listBatchesByExpiry', () => {
  it('sorts nearest real expiry first, with null-expiry last', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    expect(rows.map((r) => r.id)).toEqual(['batch-expired', 'batch-critical', 'batch-warning', 'batch-ok', 'batch-null']);
  });

  it('marks a past expiry date as expired', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    const row = rows.find((r) => r.id === 'batch-expired');
    expect(row?.status).toBe('expired');
    expect(row?.daysUntilExpiry).toBe(-3);
  });

  it('marks a batch inside the critical sub-window as critical', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    const row = rows.find((r) => r.id === 'batch-critical');
    expect(row?.status).toBe('critical');
    expect(row?.daysUntilExpiry).toBe(2);
  });

  it('marks a batch inside the wider window but past the critical cutoff as warning', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    const row = rows.find((r) => r.id === 'batch-warning');
    expect(row?.status).toBe('warning');
    expect(row?.daysUntilExpiry).toBe(20);
  });

  it('marks a batch outside the configured window as ok', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    const row = rows.find((r) => r.id === 'batch-ok');
    expect(row?.status).toBe('ok');
    expect(row?.daysUntilExpiry).toBe(90);
  });

  it('marks a batch with no expiry date recorded as unknown, not a crash', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    const row = rows.find((r) => r.id === 'batch-null');
    expect(row?.status).toBe('unknown');
    expect(row?.daysUntilExpiry).toBeNull();
    expect(row?.expiryDate).toBeNull();
  });

  it('carries medicine name, batch number, and remaining stock for display', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    const row = rows.find((r) => r.id === 'batch-critical');
    expect(row?.medicineName).toBe('Napa');
    expect(row?.batchNo).toBe('C1');
    expect(row?.quantityAvailable).toBe(15);
  });

  it('never returns a soft-deleted batch', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    expect(rows.some((r) => r.id === 'batch-deleted')).toBe(false);
  });

  it('preserves shop isolation — never returns another shop\'s batches', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);
    expect(rows.some((r) => r.id === 'batch-other-shop')).toBe(false);

    const otherRows = await listBatchesByExpiry(OTHER_SHOP_ID, NOW);
    expect(otherRows.map((r) => r.id)).toEqual(['batch-other-shop']);
  });

  it('never exposes a cross-shop medicine through a dangling batch reference', async () => {
    const rows = await listBatchesByExpiry(SHOP_ID, NOW);

    // The batch itself is dropped — an inner join scoped to this shop's
    // medicines matches nothing for it.
    expect(rows.some((r) => r.id === 'batch-cross-shop-medicine')).toBe(false);
    // And the other shop's medicine name never reaches the caller by any route.
    expect(rows.some((r) => r.medicineName === 'Not Visible')).toBe(false);
    expect(rows.some((r) => r.medicineId === 'med-other')).toBe(false);
  });

  it('does not leak the victim shop\'s batch into the attacking shop either', async () => {
    // Same row viewed from the other side: OTHER_SHOP owns the medicine but
    // not the batch, so it must not inherit a batch stamped to another shop.
    const otherRows = await listBatchesByExpiry(OTHER_SHOP_ID, NOW);
    expect(otherRows.some((r) => r.id === 'batch-cross-shop-medicine')).toBe(false);
  });
});
