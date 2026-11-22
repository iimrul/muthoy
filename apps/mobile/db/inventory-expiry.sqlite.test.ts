// Expiry Management (Volume 0 Day 9; windowed read founder-approved
// 2026-11-22). Proves listExpiringBatches (db/inventory.ts) returns only
// batches with stock whose REAL expiry date is past or inside the shop's Far
// window, nearest first, with the band derived by the shared domain helpers —
// and that shop isolation (rule 7) holds on every join it makes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';

const { db } = await import('./client');
const schema = await import('./schema');
const {
  batchPromotions, batches, inventoryMovements, medicines, purchaseItems, purchases,
  roles, shopB2Settings, shops, suppliers, users,
} = schema;
const { listExpiringBatches } = await import('./inventory');
const { sqlite } = await import('./test/expo-sqlite');

const MIGRATIONS_DIR = 'apps/mobile/db/migrations';

function applyAllMigrations(): void {
  const journal = JSON.parse(
    readFileSync(resolve(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    sqlite.exec(readFileSync(resolve(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8'));
  }
}

const NOW = new Date('2027-01-15T09:00:00');
const SHOP_ID = '40000001-0000-4000-8000-000000000001';
const OTHER_SHOP_ID = '40000002-0000-4000-8000-000000000001';
const TIGHT_SHOP_ID = '40000003-0000-4000-8000-000000000001';

function iso(offsetDays: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function stamp(): { createdAt: string; updatedAt: string } {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
}

function seedShop(id: string, name: string): void {
  db.insert(shops).values({ id, ownerId: `${id}-owner`, name, phone: '01700000000', ...stamp() }).run();
  // An owner row so opening-stock movements have a real created_by to point
  // at — inventory_movements.created_by is a restricted FK.
  db.insert(roles).values({ id: `${id}-role`, shopId: id, name: 'owner', isSystem: true, ...stamp() }).run();
  db.insert(users).values({ id: `${id}-owner`, shopId: id, name: 'Owner', pinHash: 'hash', pinSetAt: stamp().createdAt, roleId: `${id}-role`, isActive: true, ...stamp() }).run();
  db.insert(suppliers).values({ id: `${id}-supplier`, shopId: id, name: 'Supplier', ...stamp() }).run();
}

function seedMedicine(
  id: string,
  shopId: string,
  name: string,
  extra: { generic?: string; manufacturer?: string; type?: string } = {},
): void {
  db.insert(medicines).values({ id, shopId, name, ...extra, ...stamp() }).run();
}

function seedBatch(id: string, shopId: string, medicineId: string, batchNo: string, expiryDate: string | null, stock: number, isDeleted = false): void {
  db.insert(batches).values({
    id, shopId, medicineId, batchNo, expiryDate, stock: 0,
    purchasePrice: asPaisa(100), salePrice: asPaisa(200), isDeleted,
    ...stamp(),
  }).run();
  // Opening quantity arrives as a movement, never as a directly-written
  // absolute — migration 0006's triggers reject the latter outright.
  if (stock !== 0) {
    db.insert(inventoryMovements).values({
      id: `${id}-opening`, shopId, batchId: id, changeQty: stock,
      reason: 'purchase', createdBy: `${shopId}-owner`,
      ...stamp(),
    }).run();
  }
}

function seedPurchase(
  id: string,
  shopId: string,
  createdAt: string,
  line: { medicineId: string; batchNo: string; status?: 'received' | 'pending' },
  voided = false,
): void {
  db.insert(purchases).values({
    id, shopId, invoiceNo: `INV-${id}`, supplierId: `${shopId}-supplier`,
    total: asPaisa(1000), paymentTerms: 'cod',
    voidedAt: voided ? createdAt : null, voidedBy: voided ? `${shopId}-owner` : null,
    createdAt, updatedAt: createdAt,
  }).run();
  db.insert(purchaseItems).values({
    id: `${id}-line`, shopId, purchaseId: id, medicineId: line.medicineId, batchNo: line.batchNo,
    qty: 10, purchasePrice: asPaisa(100), salePrice: asPaisa(200), status: line.status ?? 'received',
    createdAt, updatedAt: createdAt,
  }).run();
}

beforeAll(() => {
  applyAllMigrations();

  seedShop(SHOP_ID, 'Expiry Test Shop');
  seedShop(OTHER_SHOP_ID, 'Other Shop');
  seedShop(TIGHT_SHOP_ID, 'Tight Window Shop');

  seedMedicine('med-1', SHOP_ID, 'Napa', { generic: 'Paracetamol', manufacturer: 'Beximco', type: 'tablet' });
  seedMedicine('med-2', SHOP_ID, 'Amoxicillin');
  seedMedicine('med-other', OTHER_SHOP_ID, 'Not Visible');
  seedMedicine('med-tight', TIGHT_SHOP_ID, 'Tight');

  // Deliberately inserted out of expiry order to prove the read re-sorts.
  seedBatch('batch-near', SHOP_ID, 'med-2', 'W1', iso(20), 40); // inside Near (30)
  seedBatch('batch-expired', SHOP_ID, 'med-1', 'E1', iso(-3), 10); // already past
  seedBatch('batch-null', SHOP_ID, 'med-1', 'N1', null, 5); // no expiry recorded
  seedBatch('batch-later', SHOP_ID, 'med-2', 'O1', iso(90), 25); // outside Far (60)
  seedBatch('batch-far-edge', SHOP_ID, 'med-2', 'F60', iso(60), 3); // exactly Far: included
  seedBatch('batch-past-edge', SHOP_ID, 'med-2', 'F61', iso(61), 3); // one day past Far
  seedBatch('batch-far', SHOP_ID, 'med-1', 'F1', iso(45), 8); // inside Far
  seedBatch('batch-critical', SHOP_ID, 'med-1', 'C1', iso(2), 15);
  seedBatch('batch-empty', SHOP_ID, 'med-1', 'Z1', iso(5), 0); // nothing on the shelf
  seedBatch('batch-deleted', SHOP_ID, 'med-1', 'D1', iso(1), 1, true); // soft-deleted
  seedBatch('batch-other-shop', OTHER_SHOP_ID, 'med-other', 'X1', iso(1), 1);
  // ADVERSARIAL: a batch stamped with THIS shop's shop_id whose medicine_id
  // points at ANOTHER shop's medicine. The FK constrains only medicines.id, so
  // a corrupted or hostile sync payload can produce exactly this row. Dated
  // earliest of all, so a leak would also break the ordering assertion.
  seedBatch('batch-cross-shop-medicine', SHOP_ID, 'med-other', 'XS1', iso(-10), 7);

  // A live promotion on C1, a reversed one on W1.
  db.insert(batchPromotions).values({
    id: 'promo-live', shopId: SHOP_ID, batchId: 'batch-critical', discountBps: 2000,
    isActive: true, createdBy: `${SHOP_ID}-owner`, ...stamp(),
  }).run();
  db.insert(batchPromotions).values({
    id: 'promo-reversed', shopId: SHOP_ID, batchId: 'batch-near', discountBps: 1500,
    isActive: false, createdBy: `${SHOP_ID}-owner`, ...stamp(),
  }).run();

  // C1 arrived on two invoices; the newer one is the link.
  seedPurchase('pur-old', SHOP_ID, '2026-10-01T00:00:00.000Z', { medicineId: 'med-1', batchNo: 'C1' });
  seedPurchase('pur-new', SHOP_ID, '2026-11-01T00:00:00.000Z', { medicineId: 'med-1', batchNo: 'C1' });
  // W1's only line is still pending: nothing to return against.
  seedPurchase('pur-pending', SHOP_ID, '2026-11-02T00:00:00.000Z', { medicineId: 'med-2', batchNo: 'W1', status: 'pending' });
  // E1's only invoice was voided.
  seedPurchase('pur-void', SHOP_ID, '2026-11-03T00:00:00.000Z', { medicineId: 'med-1', batchNo: 'E1' }, true);
  // Another shop received a batch with F1's number for a medicine id it
  // does not own — must never link.
  seedPurchase('pur-foreign', OTHER_SHOP_ID, '2026-11-04T00:00:00.000Z', { medicineId: 'med-other', batchNo: 'F1' });

  // A shop with its own, tighter window.
  db.insert(shopB2Settings).values({
    id: 'tight-settings', shopId: TIGHT_SHOP_ID, expiryNearDays: 5, expiryFarDays: 10, ...stamp(),
  }).run();
  seedBatch('tight-near', TIGHT_SHOP_ID, 'med-tight', 'T5', iso(5), 1);
  seedBatch('tight-far', TIGHT_SHOP_ID, 'med-tight', 'T8', iso(8), 1);
  seedBatch('tight-out', TIGHT_SHOP_ID, 'med-tight', 'T12', iso(12), 1);
});

describe('listExpiringBatches', () => {
  it('returns only stocked batches past or inside the Far window, nearest real expiry first', async () => {
    const { rows } = await listExpiringBatches(SHOP_ID, { now: NOW });
    expect(rows.map((r) => r.id)).toEqual([
      'batch-expired', 'batch-critical', 'batch-near', 'batch-far', 'batch-far-edge',
    ]);
  });

  it('bands each row from its real date with the shop default 30/60', async () => {
    const { rows, nearDays, farDays } = await listExpiringBatches(SHOP_ID, { now: NOW });
    expect({ nearDays, farDays }).toEqual({ nearDays: 30, farDays: 60 });
    const band = (id: string) => rows.find((r) => r.id === id);
    expect(band('batch-expired')).toMatchObject({ band: 'expired', daysUntilExpiry: -3 });
    expect(band('batch-critical')).toMatchObject({ band: 'near', daysUntilExpiry: 2 });
    expect(band('batch-near')).toMatchObject({ band: 'near', daysUntilExpiry: 20 });
    expect(band('batch-far')).toMatchObject({ band: 'far', daysUntilExpiry: 45 });
    expect(band('batch-far-edge')).toMatchObject({ band: 'far', daysUntilExpiry: 60 });
  });

  it('leaves out the empty, the far-dated, the undated and the deleted', async () => {
    const ids = (await listExpiringBatches(SHOP_ID, { now: NOW })).rows.map((r) => r.id);
    for (const absent of ['batch-empty', 'batch-later', 'batch-past-edge', 'batch-null', 'batch-deleted']) {
      expect(ids, absent).not.toContain(absent);
    }
  });

  it("uses the shop's own Near/Far settings", async () => {
    const result = await listExpiringBatches(TIGHT_SHOP_ID, { now: NOW });
    expect({ near: result.nearDays, far: result.farDays }).toEqual({ near: 5, far: 10 });
    expect(result.rows.map((r) => [r.id, r.band])).toEqual([['tight-near', 'near'], ['tight-far', 'far']]);
  });

  it('carries what the card shows: names, batch, stock and the live promotion only', async () => {
    const { rows } = await listExpiringBatches(SHOP_ID, { now: NOW });
    expect(rows.find((r) => r.id === 'batch-critical')).toMatchObject({
      medicineName: 'Napa', generic: 'Paracetamol', manufacturer: 'Beximco', form: 'tablet',
      batchNo: 'C1', quantityAvailable: 15, expiryDate: iso(2), promotionBps: 2000,
    });
    expect(rows.find((r) => r.id === 'batch-near')).toMatchObject({
      generic: null, manufacturer: null, form: null, promotionBps: 0,
    });
  });

  it('links a batch to the newest invoice that received it, only when asked', async () => {
    const plain = await listExpiringBatches(SHOP_ID, { now: NOW });
    expect(plain.rows.every((r) => r.purchaseId === null)).toBe(true);

    const { rows } = await listExpiringBatches(SHOP_ID, { now: NOW, includePurchaseLinks: true });
    const link = (id: string) => rows.find((r) => r.id === id)?.purchaseId;
    expect(link('batch-critical')).toBe('pur-new');
    expect(link('batch-near'), 'a pending line cannot be returned').toBeNull();
    expect(link('batch-expired'), 'a voided invoice cannot be returned against').toBeNull();
    expect(link('batch-far'), "another shop's invoice never links").toBeNull();
  });

  it("preserves shop isolation — never returns another shop's batches", async () => {
    const { rows } = await listExpiringBatches(SHOP_ID, { now: NOW });
    expect(rows.some((r) => r.id === 'batch-other-shop')).toBe(false);
    const other = await listExpiringBatches(OTHER_SHOP_ID, { now: NOW });
    expect(other.rows.map((r) => r.id)).toEqual(['batch-other-shop']);
  });

  it('never exposes a cross-shop medicine through a dangling batch reference', async () => {
    const { rows } = await listExpiringBatches(SHOP_ID, { now: NOW, includePurchaseLinks: true });
    expect(rows.some((r) => r.id === 'batch-cross-shop-medicine')).toBe(false);
    expect(rows.some((r) => r.medicineName === 'Not Visible')).toBe(false);
    expect(rows.some((r) => r.medicineId === 'med-other')).toBe(false);
    const other = await listExpiringBatches(OTHER_SHOP_ID, { now: NOW });
    expect(other.rows.some((r) => r.id === 'batch-cross-shop-medicine')).toBe(false);
  });
});
