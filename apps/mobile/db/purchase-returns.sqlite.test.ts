// B3 Group 7 — Purchase Returns. Proves createPurchaseReturn's local
// transaction (negative ledger movement only, exact batch resolution, the
// dual received-minus-returned/current-stock cap, required reason,
// closed-day guard, audit row) and its downstream effect on the canonical
// supplier position (Supplier Credit creation, no negative payable, no
// cash_drawer mutation) — all through the real db/ functions on real SQLite.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import { dhakaBusinessDate } from '@muthoy/utils';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const { batches, medicines, roles, shops, users } = await import('./schema');
const { createSupplier, getSupplierDetail, archiveSupplier } = await import('./suppliers');
const { createPurchase, getPurchaseDetail } = await import('./purchases');
const { closeDay } = await import('./cash');
const {
  createPurchaseReturn,
  getPurchaseReturnLineContext,
  listPurchaseReturnsForPurchase,
  listPurchaseReturnsForSupplier,
  previewPurchaseReturn,
} = await import('./purchaseReturns');
const { ledgerSum, deductStock } = await import('./stockLedger');

const SHOP_ID = '90000000-0000-4000-8000-000000000001';
const ROLE_ID = '90000000-0000-4000-8000-000000000002';
const OWNER_ID = '90000000-0000-4000-8000-000000000003';
const MEDICINE_ID = '90000000-0000-4000-8000-000000000004';
const NOW = '2026-08-24T09:00:00.000Z';
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
    '0024_b3_report_indexes.sql', '0025_b3_sale_tax_snapshot.sql',
    // H-7: users.access_locked_at, the device-local revocation marker.
    '0027_h7_local_access_lock.sql',
    '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql'
  ];
  for (const migration of migrations) applyMigration(migration);

  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Return Shop', phone: '01700000801', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000801', pinHash: 'hash', pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(medicines).values({ id: MEDICINE_ID, shopId: SHOP_ID, name: 'Napa Return', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(batches).values({ id: '90000000-0000-4000-8000-000000000005', shopId: SHOP_ID, medicineId: MEDICINE_ID, batchNo: 'SEED-RET', expiryDate: '2027-01-01', stock: 0, purchasePrice: asPaisa(500), salePrice: asPaisa(800), createdAt: NOW, updatedAt: NOW }).run();
});

async function makeReceivedPurchase(supplierId: string, batchNo: string, qty: number, priceTaka: number, paymentType: 'cod' | 'credit' = 'credit') {
  return createPurchase({
    isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId, staffId: OWNER_ID,
    paymentType,
    lineItems: [{ medicineId: MEDICINE_ID, batchNo, expiryDate: '2028-01-01', quantity: qty, purchasePrice: asPaisa(priceTaka * 100), salePrice: asPaisa(priceTaka * 150) }],
  });
}

describe('normal partial return', () => {
  it('restores exactly the returned quantity via a negative ledger movement and writes the correct credit', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Partial Return Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'PARTIAL-1', 10, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    const batchRowBefore = sqlite.prepare('SELECT id, stock FROM batches WHERE shop_id = ? AND batch_no = ?').get(SHOP_ID, 'PARTIAL-1') as { id: string; stock: number };
    expect(batchRowBefore.stock).toBe(10);

    const result = await createPurchaseReturn({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 3, reason: 'damaged',
    });
    expect(result.creditAmount).toBe(asPaisa(30000)); // 3 * ৳100

    const batchRowAfter = sqlite.prepare('SELECT stock FROM batches WHERE id = ?').get(batchRowBefore.id) as { stock: number };
    expect(batchRowAfter.stock).toBe(7);
    expect(db.transaction((tx) => ledgerSum(tx, batchRowBefore.id))).toBe(7);

    const movement = sqlite.prepare(`SELECT change_qty, reason, ref_id FROM inventory_movements WHERE ref_id = ?`).get(result.returnId) as { change_qty: number; reason: string; ref_id: string };
    expect(movement.change_qty).toBe(-3);
    expect(movement.reason).toBe('return');

    const audit = sqlite.prepare(`SELECT action, target FROM audit_logs WHERE shop_id = ? AND action = 'purchase_return_created'`).get(SHOP_ID) as { action: string; target: string };
    expect(audit.target).toBe(result.returnId);

    const detail = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(detail.lines[0]?.alreadyReturnedQty).toBe(3);
    expect(detail.lines[0]?.returnStatus).toBe('partially_returned');
  });
});

describe('full line return', () => {
  it('allows returning exactly the full received quantity', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Full Return Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'FULL-1', 4, 50);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    await createPurchaseReturn({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 4, reason: 'wrong_item',
    });

    const detail = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(detail.lines[0]?.returnStatus).toBe('fully_returned');
    expect(detail.lines[0]?.alreadyReturnedQty).toBe(4);
  });
});

describe('multiple partial returns', () => {
  it('accumulates across sequential returns and rejects once the remainder is exhausted', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Multi Return Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'MULTI-1', 10, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 4, reason: 'expired' });
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 3, reason: 'expired' });

    const midDetail = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(midDetail.lines[0]?.alreadyReturnedQty).toBe(7);
    expect(midDetail.lines[0]?.returnStatus).toBe('partially_returned');

    // 3 remain; a 4th unit exceeds the remainder.
    await expect(
      createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 4, reason: 'expired' }),
    ).rejects.toThrow(/exceeds/i);

    // Exactly the remainder still succeeds.
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 3, reason: 'expired' });
    const finalDetail = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(finalDetail.lines[0]?.returnStatus).toBe('fully_returned');
  });
});

describe('over-return rejection', () => {
  it('rejects a single return larger than the received quantity, writing nothing', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Over Return Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'OVER-1', 5, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    await expect(
      createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 6, reason: 'expired' }),
    ).rejects.toThrow(/exceeds/i);

    const returnCount = (sqlite.prepare(`SELECT COUNT(*) AS n FROM purchase_returns WHERE purchase_item_id = ?`).get(line.id) as { n: number }).n;
    expect(returnCount).toBe(0);
    const movementCount = (sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_movements WHERE ref_id IN (SELECT id FROM purchase_returns WHERE purchase_item_id = ?)`).get(line.id) as { n: number }).n;
    expect(movementCount).toBe(0);
  });
});

describe('stock-lower-than-purchased max cap (decision 5)', () => {
  it('caps the returnable quantity at current batch stock when stock has sold down below received-minus-returned', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Sold Down Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'SOLDDOWN-1', 10, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    const batchRow = sqlite.prepare('SELECT id FROM batches WHERE shop_id = ? AND batch_no = ?').get(SHOP_ID, 'SOLDDOWN-1') as { id: string };

    // Simulate 7 units sold — only 3 remain physically in stock, even though
    // received-minus-returned is still 10.
    db.transaction((tx) => {
      deductStock(tx, { shopId: SHOP_ID, batchId: batchRow.id, quantity: 7, reason: 'sale', createdBy: OWNER_ID });
    });

    const context = await getPurchaseReturnLineContext(SHOP_ID, OWNER_ID, purchase.purchaseId, line.id);
    expect(context?.maxReturnable).toBe(3);
    expect(context?.currentBatchStock).toBe(3);

    await expect(
      createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 4, reason: 'expired' }),
    ).rejects.toThrow(/exceeds/i);

    // Exactly the physical stock still succeeds and never drives stock negative.
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 3, reason: 'expired' });
    const batchAfter = sqlite.prepare('SELECT stock FROM batches WHERE id = ?').get(batchRow.id) as { stock: number };
    expect(batchAfter.stock).toBe(0);
  });
});

describe('zero available stock', () => {
  it('the Return action has nothing to offer once the batch is fully sold', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Zero Stock Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'ZEROSTOCK-1', 2, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    const batchRow = sqlite.prepare('SELECT id FROM batches WHERE shop_id = ? AND batch_no = ?').get(SHOP_ID, 'ZEROSTOCK-1') as { id: string };
    db.transaction((tx) => {
      deductStock(tx, { shopId: SHOP_ID, batchId: batchRow.id, quantity: 2, reason: 'sale', createdBy: OWNER_ID });
    });

    const context = await getPurchaseReturnLineContext(SHOP_ID, OWNER_ID, purchase.purchaseId, line.id);
    expect(context?.maxReturnable).toBe(0);

    await expect(
      createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 1, reason: 'expired' }),
    ).rejects.toThrow(/exceeds/i);
  });
});

describe('pending-line rejection', () => {
  it('refuses to return a line that has not been received yet', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Pending Return Co' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'PEND-RET-1', expiryDate: '2028-06-01', quantity: 3, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000), pending: true }],
    });
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    expect(line.status).toBe('pending');

    const context = await getPurchaseReturnLineContext(SHOP_ID, OWNER_ID, purchase.purchaseId, line.id);
    expect(context).toBeNull();

    await expect(
      createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 1, reason: 'expired' }),
    ).rejects.toThrow(/not been received/i);
  });
});

describe('wrong purchase_item relationship', () => {
  it('rejects a purchaseItemId that belongs to a DIFFERENT purchase', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Mismatch Co' }, ALWAYS_LIVE);
    const purchaseA = await makeReceivedPurchase(supplier.id, 'MISMATCH-A-1', 5, 100);
    const purchaseB = await makeReceivedPurchase(supplier.id, 'MISMATCH-B-1', 5, 100);
    const lineB = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchaseB.purchaseId)).lines[0]!;

    await expect(
      createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchaseA.purchaseId, purchaseItemId: lineB.id, qty: 1, reason: 'expired' }),
    ).rejects.toThrow(/does not belong to this purchase/i);
  });
});

describe('wrong shop', () => {
  it('rejects a purchaseId from a different shop', async () => {
    const otherShop = '90000000-0000-4000-8000-000000000099';
    const otherOwner = '90000000-0000-4000-8000-000000000098';
    const otherRole = '90000000-0000-4000-8000-000000000097';
    db.insert(shops).values({ id: otherShop, ownerId: otherOwner, name: 'Other Shop', phone: '01700000802', createdAt: NOW, updatedAt: NOW }).run();
    db.insert(roles).values({ id: otherRole, shopId: otherShop, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
    db.insert(users).values({ id: otherOwner, shopId: otherShop, name: 'Other Owner', phone: '01700000802', pinHash: 'hash', pinSetAt: NOW, roleId: otherRole, isActive: true, createdAt: NOW, updatedAt: NOW }).run();

    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Wrong Shop Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'WRONGSHOP-1', 3, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    await expect(
      createPurchaseReturn({ shopId: otherShop, actorUserId: otherOwner, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 1, reason: 'expired' }),
    ).rejects.toThrow(/does not belong to this shop/i);
  });
});

describe('stale session', () => {
  it('refuses to commit under a stale session', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Stale Session Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'STALE-1', 3, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    await expect(
      createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: () => false, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 1, reason: 'expired' }),
    ).rejects.toThrow(/changed/i);
  });

  it('rechecks owner authority inside the return transaction', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Revoked Owner Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'REVOKED-1', 3, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    const before = (sqlite.prepare('SELECT COUNT(*) AS n FROM purchase_returns').get() as { n: number }).n;

    await expect(createPurchaseReturn({
      shopId: SHOP_ID,
      actorUserId: OWNER_ID,
      isStillActive: () => {
        sqlite.prepare('UPDATE roles SET name = ? WHERE id = ?').run('staff', ROLE_ID);
        return true;
      },
      purchaseId: purchase.purchaseId,
      purchaseItemId: line.id,
      qty: 1,
      reason: 'expired',
    })).rejects.toThrow(/owner access/i);

    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM purchase_returns').get() as { n: number }).n).toBe(before);
    expect((sqlite.prepare('SELECT name FROM roles WHERE id = ?').get(ROLE_ID) as { name: string }).name).toBe('owner');
  });
});

describe('required reason (decision 4)', () => {
  it('rejects an empty or whitespace-only reason', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'No Reason Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'NOREASON-1', 3, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    await expect(
      createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 1, reason: '   ' }),
    ).rejects.toThrow(/reason is required/i);
  });
});

describe('closed day', () => {
  it('rejects a return on a closed business date', async () => {
    const closeShop = '90000000-0000-4000-8000-000000000199';
    const closeOwner = '90000000-0000-4000-8000-000000000198';
    const closeRole = '90000000-0000-4000-8000-000000000197';
    const closeMedicine = '90000000-0000-4000-8000-000000000196';
    db.insert(shops).values({ id: closeShop, ownerId: closeOwner, name: 'Close Return Shop', phone: '01700000803', createdAt: NOW, updatedAt: NOW }).run();
    db.insert(roles).values({ id: closeRole, shopId: closeShop, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
    db.insert(users).values({ id: closeOwner, shopId: closeShop, name: 'Close Owner', phone: '01700000803', pinHash: 'hash', pinSetAt: NOW, roleId: closeRole, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
    db.insert(medicines).values({ id: closeMedicine, shopId: closeShop, name: 'Close Med', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();

    const supplier = await createSupplier(closeShop, closeOwner, { name: 'Closed Day Return Co' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: closeShop, supplierId: supplier.id, staffId: closeOwner,
      paymentType: 'credit',
      lineItems: [{ medicineId: closeMedicine, batchNo: 'CLOSED-RET-1', expiryDate: '2028-01-01', quantity: 3, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) }],
    });
    const line = (await getPurchaseDetail(closeShop, closeOwner, purchase.purchaseId)).lines[0]!;
    await closeDay({ shopId: closeShop, isStillActive: ALWAYS_LIVE, businessDate: TODAY, countedCash: ZERO_PAISA, closedBy: closeOwner });

    await expect(
      createPurchaseReturn({ shopId: closeShop, actorUserId: closeOwner, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 1, reason: 'expired' }),
    ).rejects.toThrow(/closed/i);
  });
});

describe('payable reduction / Supplier Credit creation / no negative payable', () => {
  it('reduces payable on a credit-terms purchase and never goes negative', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Credit Payable Reduction Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'PAYREDUCE-1', 10, 100); // ৳1000 total, unpaid
    const before = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(before.payable).toBe(asPaisa(100000));

    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 4, reason: 'expired' });

    const after = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(after.payable).toBe(asPaisa(60000)); // 100000 - 40000 credit
    expect(after.supplierCredit).toBe(ZERO_PAISA);
  });

  it('a return on a fully-paid COD purchase surfaces as Supplier Credit, never a negative payable', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'COD Credit Surface Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'CODCREDIT-1', 5, 100, 'cod'); // fully paid at creation
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 2, reason: 'damaged' });

    const after = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(after.payable).toBe(ZERO_PAISA); // never negative
    expect(after.supplierCredit).toBe(asPaisa(20000)); // 2 * ৳100
  });
});

describe('no cash_drawer mutation on return (founder decision 3)', () => {
  it('a return never writes or updates a cash_drawer row', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'No Drawer Touch Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'NODRAWER-1', 5, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    const drawerBefore = sqlite.prepare('SELECT closing_expected FROM cash_drawer WHERE shop_id = ? AND business_date = ?').get(SHOP_ID, TODAY) as { closing_expected: number } | undefined;

    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 2, reason: 'expired' });

    const drawerAfter = sqlite.prepare('SELECT closing_expected FROM cash_drawer WHERE shop_id = ? AND business_date = ?').get(SHOP_ID, TODAY) as { closing_expected: number } | undefined;
    expect(drawerAfter?.closing_expected).toBe(drawerBefore?.closing_expected);

    const paymentCount = (sqlite.prepare(`SELECT COUNT(*) AS n FROM payments WHERE shop_id = ? AND ref_id = ?`).get(SHOP_ID, purchase.purchaseId) as { n: number }).n;
    expect(paymentCount).toBe(0);
  });
});

describe('archive guard after returns (D-9, extended)', () => {
  it('a supplier whose payable reaches zero via return credit can now be archived', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Archive After Return Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'ARCHIVE-RET-1', 5, 100); // ৳500 payable
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 5, reason: 'expired' });

    const detail = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(detail.payable).toBe(ZERO_PAISA);
    expect(detail.supplierCredit).toBe(ZERO_PAISA);

    await archiveSupplier({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, supplierId: supplier.id });
  });

  it('archive is blocked by an OPEN Supplier Credit, not just an open payable', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Blocked By Credit Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'BLOCK-CREDIT-1', 3, 100, 'cod'); // fully paid
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 3, reason: 'expired' });

    const detail = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(detail.payable).toBe(ZERO_PAISA);
    expect(detail.supplierCredit).toBeGreaterThan(0);

    await expect(
      archiveSupplier({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, supplierId: supplier.id }),
    ).rejects.toThrow(/outstanding/i);
  });
});

describe('previewPurchaseReturn — the sheet\'s current-to-resulting preview', () => {
  it("matches the founder's exact worked example before any write happens", async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Preview Worked Example Co' }, ALWAYS_LIVE);
    // P1: COD, fully paid, 5 units @ ৳2,000 total.
    const p1 = await makeReceivedPurchase(supplier.id, 'PREVIEW-P1-1', 5, 2000, 'cod');
    const p1Line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, p1.purchaseId)).lines[0]!;
    // Return all 5 units -> ৳10,000 credit, nothing else open yet -> pure Supplier Credit.
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: p1.purchaseId, purchaseItemId: p1Line.id, qty: 5, reason: 'expired' });

    // P2: credit-terms, ৳5,000 remaining, created after the return exists.
    const p2 = await makeReceivedPurchase(supplier.id, 'PREVIEW-P2-1', 5, 1000);
    const p2Line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, p2.purchaseId)).lines[0]!;

    // Preview a NEW ৳2,000-worth return against ANOTHER line of P2 is not
    // needed here — instead confirm the current position already reflects
    // P1's return netting against P2 (৳10,000 credit vs ৳5,000 owed -> ৳0
    // payable, ৳5,000 supplier credit), then preview a small additional
    // return on P2 itself and confirm it only reports what's really left.
    const before = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(before.payable).toBe(ZERO_PAISA);
    expect(before.supplierCredit).toBe(asPaisa(500000)); // ৳5,000

    const preview = await previewPurchaseReturn(SHOP_ID, OWNER_ID, p2.purchaseId, p2Line.id, 1);
    expect(preview?.creditAmount).toBe(asPaisa(100000)); // ৳1,000 (1 unit)
    expect(preview?.currentPayable).toBe(ZERO_PAISA);
    expect(preview?.currentSupplierCredit).toBe(asPaisa(500000));
    // P2's own remaining is already fully absorbed by the existing credit
    // pool, so an additional return on it only grows the standalone credit
    // further — payable stays zero, credit grows by the new return's amount.
    expect(preview?.resultingPayable).toBe(ZERO_PAISA);
    expect(preview?.resultingSupplierCredit).toBe(asPaisa(600000));
  });

  it('previews a partial return reducing payable, without writing anything', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Preview No Write Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'PREVIEW-NOWRITE-1', 10, 100); // ৳1000 payable
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;

    const preview = await previewPurchaseReturn(SHOP_ID, OWNER_ID, purchase.purchaseId, line.id, 4);
    expect(preview?.creditAmount).toBe(asPaisa(40000));
    expect(preview?.currentPayable).toBe(asPaisa(100000));
    expect(preview?.resultingPayable).toBe(asPaisa(60000));
    expect(preview?.resultingSupplierCredit).toBe(ZERO_PAISA);

    // Nothing was actually written.
    const returnCount = (sqlite.prepare(`SELECT COUNT(*) AS n FROM purchase_returns WHERE purchase_item_id = ?`).get(line.id) as { n: number }).n;
    expect(returnCount).toBe(0);
    const after = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(after.payable).toBe(asPaisa(100000)); // unchanged
  });

  it('returns null for a pending line, and caps the preview at maxReturnable', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Preview Cap Co' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'credit',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'PREVIEW-PEND-1', expiryDate: '2028-06-01', quantity: 3, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000), pending: true }],
    });
    const pendingLine = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    expect(await previewPurchaseReturn(SHOP_ID, OWNER_ID, purchase.purchaseId, pendingLine.id, 1)).toBeNull();

    const received = await makeReceivedPurchase(supplier.id, 'PREVIEW-CAP-1', 5, 100);
    const receivedLine = (await getPurchaseDetail(SHOP_ID, OWNER_ID, received.purchaseId)).lines[0]!;
    // Requesting more than maxReturnable still previews (for live UI
    // feedback before submit) but the credit amount is capped at the max,
    // never inflated by an over-request.
    const overPreview = await previewPurchaseReturn(SHOP_ID, OWNER_ID, received.purchaseId, receivedLine.id, 99);
    expect(overPreview?.creditAmount).toBe(asPaisa(50000)); // capped at 5 units * ৳100
  });
});

describe('return history reads', () => {
  it('lists returns per purchase and per supplier, ordered, shop-isolated', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'History Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'HISTORY-1', 10, 100);
    const line = (await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId)).lines[0]!;
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 2, reason: 'near_expiry' });
    await createPurchaseReturn({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, purchaseId: purchase.purchaseId, purchaseItemId: line.id, qty: 1, reason: 'slow_moving' });

    const perPurchase = await listPurchaseReturnsForPurchase(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(perPurchase.length).toBe(2);
    expect(perPurchase[0]?.reason).toBe('near_expiry');
    expect(perPurchase.reduce((sum, r) => sum + r.creditAmount, 0)).toBe(30000);

    const perSupplier = await listPurchaseReturnsForSupplier(SHOP_ID, OWNER_ID, supplier.id);
    expect(perSupplier.length).toBe(2);
  });

  it('rejects corrupted cross-shop parent joins from context and history', async () => {
    const otherShop = '90000000-0000-4000-8000-000000000299';
    const otherSupplier = '90000000-0000-4000-8000-000000000298';
    const otherPurchase = '90000000-0000-4000-8000-000000000297';
    const corruptItem = '90000000-0000-4000-8000-000000000296';
    const corruptReturn = '90000000-0000-4000-8000-000000000295';
    sqlite.exec(
      `INSERT INTO shops (id, owner_id, name, phone, created_at, updated_at)
       VALUES ('${otherShop}', '${OWNER_ID}', 'Cross Shop', '01700000804', '${NOW}', '${NOW}');
       INSERT INTO suppliers (id, shop_id, name, created_at, updated_at)
       VALUES ('${otherSupplier}', '${otherShop}', 'Cross Supplier', '${NOW}', '${NOW}');
       INSERT INTO purchases (id, shop_id, invoice_no, supplier_id, total, payment_terms, paid_amount, created_at, updated_at)
       VALUES ('${otherPurchase}', '${otherShop}', 'CROSS-INV', '${otherSupplier}', 10000, 'credit', 0, '${NOW}', '${NOW}');
       INSERT INTO purchase_items (id, shop_id, purchase_id, medicine_id, batch_no, expiry_date, qty, purchase_price, sale_price, status, received_at, created_at, updated_at)
       VALUES ('${corruptItem}', '${SHOP_ID}', '${otherPurchase}', '${MEDICINE_ID}', 'CROSS-BATCH', '2028-01-01', 1, 10000, 15000, 'received', '${NOW}', '${NOW}', '${NOW}');
       INSERT INTO purchase_returns (id, shop_id, purchase_id, purchase_item_id, qty, reason, credit_amount, created_by, created_at, updated_at)
       VALUES ('${corruptReturn}', '${SHOP_ID}', '${otherPurchase}', '${corruptItem}', 1, 'damaged', 10000, '${OWNER_ID}', '${NOW}', '${NOW}');`,
    );

    await expect(getPurchaseReturnLineContext(SHOP_ID, OWNER_ID, otherPurchase, corruptItem)).resolves.toBeNull();
    await expect(listPurchaseReturnsForPurchase(SHOP_ID, OWNER_ID, otherPurchase)).resolves.toEqual([]);
    await expect(listPurchaseReturnsForSupplier(SHOP_ID, OWNER_ID, otherSupplier)).resolves.toEqual([]);
  });

  it('excludes a corrupted cross-shop return from canonical money and line status', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Scoped Aggregate Co' }, ALWAYS_LIVE);
    const purchase = await makeReceivedPurchase(supplier.id, 'SCOPED-AGG-1', 5, 100);
    const before = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    const line = before.lines[0]!;
    const otherShop = '90000000-0000-4000-8000-000000000399';
    sqlite.exec(
      `INSERT INTO shops (id, owner_id, name, phone, created_at, updated_at)
       VALUES ('${otherShop}', '${OWNER_ID}', 'Aggregate Cross Shop', '01700000805', '${NOW}', '${NOW}');
       INSERT INTO purchase_returns (id, shop_id, purchase_id, purchase_item_id, qty, reason, credit_amount, created_by, created_at, updated_at)
       VALUES ('90000000-0000-4000-8000-000000000395', '${otherShop}', '${purchase.purchaseId}', '${line.id}', 5, 'damaged', 50000, '${OWNER_ID}', '${NOW}', '${NOW}');`,
    );

    const supplierDetail = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(supplierDetail.payable).toBe(asPaisa(50000));
    expect(supplierDetail.supplierCredit).toBe(ZERO_PAISA);
    const purchaseDetail = await getPurchaseDetail(SHOP_ID, OWNER_ID, purchase.purchaseId);
    expect(purchaseDetail.lines[0]?.returnStatus).toBe('received');
  });
});
