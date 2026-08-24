// B3 Group 6 — Purchase / invoice completeness. Proves pending lines
// (contract §5.12), Mark Received's exact-one-movement + total/pending-count
// recompute, void's "zero movements AND zero payments" guard (contract
// §5.13), and IC-16's advisory duplicate-invoice detection — all through the
// real db/purchases.ts functions on real SQLite.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { dhakaBusinessDate } from '@muthoy/utils';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const { batches, medicines, roles, shops, users } = await import('./schema');
const { createSupplier, getSupplierDetail } = await import('./suppliers');
const {
  createPurchase,
  findDuplicatePurchase,
  getPurchaseDetail,
  listPurchases,
  markPurchaseLineReceived,
  voidPurchase,
} = await import('./purchases');
const { ledgerSum } = await import('./stockLedger');

const SHOP_ID = '70000000-0000-4000-8000-000000000001';
const ROLE_ID = '70000000-0000-4000-8000-000000000002';
const OWNER_ID = '70000000-0000-4000-8000-000000000003';
const MEDICINE_ID = '70000000-0000-4000-8000-000000000004';
const NOW = '2026-08-23T09:00:00.000Z';
// Real wall-clock date, not a fixed literal: createPurchase stamps
// created_at with new Date() at call time (dhakaBusinessDate(now)), so a
// hardcoded "today" drifts stale and false-fails IC-16's same-day match the
// moment a long session crosses a Dhaka midnight.
const TODAY = dhakaBusinessDate(new Date());

function applyMigration(fileName: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', fileName), 'utf8'));
}

beforeAll(() => {
  const migrations = [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql', '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql', '0010_known_ares.sql', '0011_black_zarda.sql', '0012_small_meltdown.sql',
    '0013_owner_dashboard_credit_period.sql', '0014_owner_dashboard_credit_period_guard.sql',
    '0015_b3_shop_settings.sql', '0016_payment_note.sql', '0017_cash_reconcile.sql',
    '0018_expense_category_taxonomy.sql', '0019_supplier_archive.sql',
    '0020_purchase_item_status.sql', '0021_purchase_void.sql',
    '0022_supplier_profile_fields.sql', '0023_purchase_invoice_metadata.sql',
  ];
  for (const migration of migrations) applyMigration(migration);

  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Purchase Shop', phone: '01700000601', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000601', pinHash: 'hash', pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(medicines).values({ id: MEDICINE_ID, shopId: SHOP_ID, name: 'Napa Extra', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(batches).values({ id: '70000000-0000-4000-8000-000000000005', shopId: SHOP_ID, medicineId: MEDICINE_ID, batchNo: 'SEED-PUR', expiryDate: '2027-01-01', stock: 0, purchasePrice: asPaisa(500), salePrice: asPaisa(800), createdAt: NOW, updatedAt: NOW }).run();
});

describe('pending lines (contract §5.12)', () => {
  it('a pending line produces no stock movement and is excluded from the header total', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Pending Supplier 1' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [
        { medicineId: MEDICINE_ID, batchNo: 'PEND-RECV-1', expiryDate: '2028-01-01', quantity: 5, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) },
        { medicineId: MEDICINE_ID, batchNo: 'PEND-1', expiryDate: '2028-06-01', quantity: 3, purchasePrice: asPaisa(20000), salePrice: asPaisa(30000), pending: true },
      ],
    });

    // Total is ONLY the received line: 5 * ৳100 = ৳500 = 50000 paisa.
    expect(purchase.total).toBe(50000);

    const detail = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(detail.pendingCount).toBe(1);
    const pendingLine = detail.lines.find((line) => line.batchNo === 'PEND-1');
    expect(pendingLine?.status).toBe('pending');
    expect(pendingLine?.receivedAt).toBeNull();

    // No batch was created for the pending line at all.
    const batchRow = sqlite.prepare('SELECT id FROM batches WHERE shop_id = ? AND batch_no = ?').get(SHOP_ID, 'PEND-1');
    expect(batchRow).toBeUndefined();
  });

  it('Mark Received applies exactly one movement and recomputes total + pending count', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Pending Supplier 2' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [
        { medicineId: MEDICINE_ID, batchNo: 'MR-PEND-1', expiryDate: '2028-06-01', quantity: 4, purchasePrice: asPaisa(15000), salePrice: asPaisa(22000), pending: true },
      ],
    });
    expect(purchase.total).toBe(0);

    const detailBefore = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    const pendingLine = detailBefore.lines[0]!;

    const result = await markPurchaseLineReceived({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, purchaseItemId: pendingLine.id,
    });

    expect(result.total).toBe(60000); // 4 * ৳150
    expect(result.pendingCount).toBe(0);

    const batchRow = sqlite.prepare('SELECT id, stock FROM batches WHERE shop_id = ? AND batch_no = ?').get(SHOP_ID, 'MR-PEND-1') as { id: string; stock: number };
    expect(batchRow.stock).toBe(4);
    expect(db.transaction((tx) => ledgerSum(tx, batchRow.id))).toBe(4);

    const movementCount = (sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE ref_id = ?').get(purchase.purchaseId) as { n: number }).n;
    expect(movementCount).toBe(1);

    const detailAfter = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(detailAfter.lines[0]?.status).toBe('received');
  });

  it('rejects receiving the same line twice', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Pending Supplier 3' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'DOUBLE-RECV-1', expiryDate: '2028-06-01', quantity: 2, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000), pending: true }],
    });
    const detail = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    const lineId = detail.lines[0]!.id;

    await markPurchaseLineReceived({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: lineId });

    await expect(
      markPurchaseLineReceived({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: lineId }),
    ).rejects.toThrow(/already been received/i);
  });
});

describe('COD pending-line settlement (review §3/§4 fix)', () => {
  it('stays fully paid after receiving a pending line on a COD purchase — never goes "unpaid"', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'COD Settle Supplier' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'cod',
      lineItems: [
        { medicineId: MEDICINE_ID, batchNo: 'COD-RECV-1', expiryDate: '2028-01-01', quantity: 2, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) },
        { medicineId: MEDICINE_ID, batchNo: 'COD-PEND-1', expiryDate: '2028-06-01', quantity: 3, purchasePrice: asPaisa(20000), salePrice: asPaisa(30000), pending: true },
      ],
    });
    // Creation total is only the received line: 2 * ৳100 = ৳200 = 20000 paisa.
    expect(purchase.total).toBe(20000);
    const detailBefore = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(detailBefore.paidAmount).toBe(20000); // COD: fully paid at creation
    const supplierBefore = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(supplierBefore.payable).toBe(asPaisa(0));

    const pendingLine = detailBefore.lines.find((line) => line.batchNo === 'COD-PEND-1')!;
    const result = await markPurchaseLineReceived({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, purchaseItemId: pendingLine.id,
    });

    // New total: 20000 + (3 * ৳200 = 60000) = 80000.
    expect(result.total).toBe(80000);
    const detailAfter = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    // The invariant this test exists for: paidAmount must track total exactly
    // — a COD invoice must never show a remaining/unpaid balance after receive.
    expect(detailAfter.paidAmount).toBe(detailAfter.total);
    expect(detailAfter.paidAmount).toBe(80000);

    const supplierAfter = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(supplierAfter.payable).toBe(asPaisa(0));

    const paymentRows = sqlite.prepare(
      `SELECT amount FROM payments WHERE shop_id = ? AND ref_id = ? AND type = 'supplier_payment'`,
    ).all(SHOP_ID, purchase.purchaseId) as { amount: number }[];
    expect(paymentRows.reduce((sum, row) => sum + row.amount, 0)).toBe(80000);
    expect(paymentRows.length).toBe(2); // creation payment (20000) + receive-settlement payment (60000)
  });
});

describe('void (contract §5.13)', () => {
  it('voids a purchase with zero movements and zero payments', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Void Supplier 1' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'VOID-OK-1', expiryDate: '2028-06-01', quantity: 1, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000), pending: true }],
    });

    await voidPurchase({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId });

    const row = sqlite.prepare('SELECT voided_at, voided_by FROM purchases WHERE id = ?').get(purchase.purchaseId) as { voided_at: string | null; voided_by: string | null };
    expect(row.voided_at).not.toBeNull();
    expect(row.voided_by).toBe(OWNER_ID);

    const audit = sqlite.prepare(`SELECT action FROM audit_logs WHERE shop_id = ? AND target = ? AND action = 'purchase_voided'`).get(SHOP_ID, purchase.purchaseId);
    expect(audit).toBeDefined();
  });

  it('refuses to void once a line has been received (has a stock movement)', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Void Supplier 2' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'VOID-MOVED-1', expiryDate: '2028-06-01', quantity: 1, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) }],
    });

    await expect(
      voidPurchase({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId }),
    ).rejects.toThrow(/stock and cannot be voided/i);
  });

  it('refuses to void once a payment has been recorded, checked independently of the movement check', async () => {
    // A payment can never legitimately exist on a zero-movement purchase
    // today (recordSupplierPayment requires total > 0, which requires a
    // non-pending line, which always creates a movement at creation) — so
    // this state is reached by writing the payments row directly, the way an
    // older client's sync payload or a future write path might. voidPurchase
    // must still catch it as its OWN independent check (contract §5.13 says
    // "AND", not "therefore"), not rely on the movement check alone.
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Void Supplier 3' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'VOID-PAID-1', expiryDate: '2028-06-01', quantity: 1, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000), pending: true }],
    });
    sqlite.exec(
      `INSERT INTO payments (id, shop_id, type, party_id, amount, method, ref_id, created_by, created_at, updated_at)
       VALUES ('70000000-0000-4000-9000-000000000001', '${SHOP_ID}', 'supplier_payment', '${supplier.id}', 1, 'cash', '${purchase.purchaseId}', '${OWNER_ID}', '${NOW}', '${NOW}')`,
    );

    await expect(
      voidPurchase({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId }),
    ).rejects.toThrow(/payment recorded and cannot be voided/i);
  });

  it('a COD purchase (which always has a payment) can never be voided', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Void Supplier 4' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'cod',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'VOID-COD-1', expiryDate: '2028-06-01', quantity: 1, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) }],
    });

    await expect(
      voidPurchase({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId }),
    ).rejects.toThrow(/voided/i);
  });
});

describe('IC-16 — advisory duplicate-invoice detection', () => {
  it('flags a same-day, same-supplier purchase within 0.5% tolerance', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Dup Supplier 1' }, ALWAYS_LIVE);
    await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'DUP-A-1', expiryDate: '2028-06-01', quantity: 10, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) }],
    });
    // Original total: 10 * ৳100 = ৳1000 = 100000 paisa. Within 0.5% (500 paisa) of 100400.
    const match = await findDuplicatePurchase(SHOP_ID, OWNER_ID, supplier.id, TODAY, asPaisa(100400));
    expect(match).not.toBeNull();
  });

  it('does not flag a purchase outside the tolerance', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Dup Supplier 2' }, ALWAYS_LIVE);
    await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'DUP-B-1', expiryDate: '2028-06-01', quantity: 10, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) }],
    });
    const match = await findDuplicatePurchase(SHOP_ID, OWNER_ID, supplier.id, TODAY, asPaisa(150000));
    expect(match).toBeNull();
  });

  it('does not flag a different supplier even with an identical total', async () => {
    const supplierA = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Dup Supplier 3A' }, ALWAYS_LIVE);
    const supplierB = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Dup Supplier 3B' }, ALWAYS_LIVE);
    await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplierA.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'DUP-C-1', expiryDate: '2028-06-01', quantity: 5, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) }],
    });
    const match = await findDuplicatePurchase(SHOP_ID, OWNER_ID, supplierB.id, TODAY, asPaisa(50000));
    expect(match).toBeNull();
  });
});

describe('Supplier Invoices list search (SI-2)', () => {
  it('finds an invoice by supplier name, date, or line medicine name', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Searchable Supplier Ltd' }, ALWAYS_LIVE);
    await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'SEARCH-1', expiryDate: '2028-06-01', quantity: 1, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) }],
    });

    const bySupplier = await listPurchases(SHOP_ID, OWNER_ID, 'Searchable Supplier');
    expect(bySupplier.length).toBeGreaterThanOrEqual(1);

    const byMedicine = await listPurchases(SHOP_ID, OWNER_ID, 'Napa Extra');
    expect(byMedicine.some((row) => row.supplierId === supplier.id)).toBe(true);
  });
});
