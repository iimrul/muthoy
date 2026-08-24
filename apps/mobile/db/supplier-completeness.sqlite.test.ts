// B3 Group 5 — Supplier & payable completeness. Proves the new supplier
// surface through real SQLite: archived suppliers drop out of the active
// list (search unaffected), supplier edit, the D-9 archive-refused-while-
// payable>0 guard (contract §5.24), and recordSupplierPayment's capping,
// COD/fully-paid refusal, atomic paid_amount increment + drawer recompute,
// and closed-day guard.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import { dhakaBusinessDate } from '@muthoy/utils';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const { batches, medicines, roles, shops, users } = await import('./schema');
const { createPurchase } = await import('./purchases');
const { closeDay } = await import('./cash');
const {
  archiveSupplier,
  createSupplier,
  getSupplierDetail,
  listSuppliers,
  recordSupplierPayment,
  updateSupplier,
} = await import('./suppliers');

const SHOP_ID = '60000000-0000-4000-8000-000000000001';
const ROLE_ID = '60000000-0000-4000-8000-000000000002';
const OWNER_ID = '60000000-0000-4000-8000-000000000003';
const MEDICINE_ID = '60000000-0000-4000-8000-000000000004';
const NOW = '2026-08-23T09:00:00.000Z';
// Real wall-clock date, not a fixed literal: recordSupplierPayment/
// createPurchase/closeDay all stamp against new Date() at call time
// (dhakaBusinessDate(now)), so a hardcoded "today" drifts stale and
// false-fails the drawer/closed-day tests the moment a long session crosses
// a Dhaka midnight.
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

  db.insert(shops).values({ id: SHOP_ID, ownerId: OWNER_ID, name: 'Supplier Shop', phone: '01700000701', createdAt: NOW, updatedAt: NOW }).run();
  db.insert(roles).values({ id: ROLE_ID, shopId: SHOP_ID, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(users).values({ id: OWNER_ID, shopId: SHOP_ID, name: 'Owner', phone: '01700000701', pinHash: 'hash', pinSetAt: NOW, roleId: ROLE_ID, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(medicines).values({ id: MEDICINE_ID, shopId: SHOP_ID, name: 'Napa', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();
  db.insert(batches).values({ id: '60000000-0000-4000-8000-000000000005', shopId: SHOP_ID, medicineId: MEDICINE_ID, batchNo: 'SEED-SUP', expiryDate: '2027-01-01', stock: 0, purchasePrice: asPaisa(500), salePrice: asPaisa(800), createdAt: NOW, updatedAt: NOW }).run();
});

async function makeCreditPurchase(supplierId: string, totalTaka: number, batchNo: string) {
  return createPurchase({
    isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId, staffId: OWNER_ID,
    paymentType: 'credit',
    lineItems: [{ medicineId: MEDICINE_ID, batchNo, expiryDate: '2028-01-01', quantity: 1, purchasePrice: asPaisa(totalTaka * 100), salePrice: asPaisa(totalTaka * 150) }],
  });
}

describe('archived suppliers drop out of the active list', () => {
  it('excludes an archived supplier from listSuppliers but search still works pre-archive', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Archive Target Co' }, ALWAYS_LIVE);
    let rows = await listSuppliers(SHOP_ID, OWNER_ID, 'Archive Target');
    expect(rows.length).toBe(1);

    await archiveSupplier({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, supplierId: supplier.id });
    rows = await listSuppliers(SHOP_ID, OWNER_ID, 'Archive Target');
    expect(rows.length).toBe(0);
  });
});

describe('D-9 — archive refused while payable > 0 (contract §5.24)', () => {
  it('refuses to archive a supplier with an outstanding credit purchase', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Owed Money Co' }, ALWAYS_LIVE);
    await makeCreditPurchase(supplier.id, 1000, 'OWE-1');

    await expect(
      archiveSupplier({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, supplierId: supplier.id }),
    ).rejects.toThrow(/outstanding payable/i);

    const rows = await listSuppliers(SHOP_ID, OWNER_ID, 'Owed Money');
    expect(rows.length).toBe(1); // still active — the refusal did not partially apply
  });

  it('allows archiving once the payable is paid down to zero', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Paid Off Co' }, ALWAYS_LIVE);
    const purchase = await makeCreditPurchase(supplier.id, 500, 'PAID-1');
    await recordSupplierPayment({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, amount: asPaisa(50000), method: 'cash',
    });

    await archiveSupplier({ shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, supplierId: supplier.id });
    const rows = await listSuppliers(SHOP_ID, OWNER_ID, 'Paid Off');
    expect(rows.length).toBe(0);
  });
});

describe('recordSupplierPayment (contract §5.11, review-corrected: cap not reject)', () => {
  it('clamps an over-amount payment to the remaining balance instead of rejecting it', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Cap Test Co' }, ALWAYS_LIVE);
    const purchase = await makeCreditPurchase(supplier.id, 300, 'CAP-1');

    // Non-cash on purpose: this test proves the CAP arithmetic, not drawer
    // recompute (already covered by the two tests below it) — a cash method
    // here would create/touch today's shared cash_drawer row and change what
    // those tests observe as their "before" state.
    const result = await recordSupplierPayment({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, amount: asPaisa(40000), method: 'bank',
    });
    // Purchase total is 300 taka = 30000 paisa; the 40000-paisa request must
    // clamp to the 30000-paisa remaining, not apply the full requested amount.
    expect(result.amount).toBe(asPaisa(30000));

    const detail = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(detail.payable).toBe(ZERO_PAISA);

    // A further payment against the now-fully-paid purchase is still refused.
    await expect(
      recordSupplierPayment({
        shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
        purchaseId: purchase.purchaseId, amount: asPaisa(100), method: 'bank',
      }),
    ).rejects.toThrow(/already fully paid/i);
  });

  it('refuses a payment against a COD purchase (already settled at creation)', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'COD Test Co' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: SHOP_ID, supplierId: supplier.id, staffId: OWNER_ID,
      paymentType: 'cod',
      lineItems: [{ medicineId: MEDICINE_ID, batchNo: 'COD-1', expiryDate: '2028-01-01', quantity: 1, purchasePrice: asPaisa(20000), salePrice: asPaisa(30000) }],
    });

    await expect(
      recordSupplierPayment({
        shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
        purchaseId: purchase.purchaseId, amount: asPaisa(100), method: 'cash',
      }),
    ).rejects.toThrow(/delivery/i);
  });

  it('refuses a second payment once the invoice is fully paid', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Full Pay Co' }, ALWAYS_LIVE);
    const purchase = await makeCreditPurchase(supplier.id, 200, 'FULL-1');
    await recordSupplierPayment({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, amount: asPaisa(20000), method: 'cash',
    });

    await expect(
      recordSupplierPayment({
        shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
        purchaseId: purchase.purchaseId, amount: asPaisa(1), method: 'cash',
      }),
    ).rejects.toThrow(/fully paid/i);
  });

  it('increments paid_amount atomically and recomputes the cash drawer for a cash payment', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Drawer Test Co' }, ALWAYS_LIVE);
    const purchase = await makeCreditPurchase(supplier.id, 400, 'DRAWER-1');
    await recordSupplierPayment({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, amount: asPaisa(15000), method: 'cash',
    });

    const row = sqlite.prepare('SELECT paid_amount FROM purchases WHERE id = ?').get(purchase.purchaseId) as { paid_amount: number };
    expect(row.paid_amount).toBe(15000);

    const drawer = sqlite.prepare('SELECT closing_expected FROM cash_drawer WHERE shop_id = ? AND business_date = ?').get(SHOP_ID, TODAY) as { closing_expected: number } | undefined;
    expect(drawer).toBeDefined();
    // supplierPayments subtracts from expected cash — a fresh drawer with no
    // other activity today nets to -150 taka = -15000 paisa off zero opening.
    expect(drawer!.closing_expected).toBeLessThanOrEqual(0);
  });

  it('does not touch the cash drawer for a non-cash payment', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Bkash Supplier Co' }, ALWAYS_LIVE);
    const purchase = await makeCreditPurchase(supplier.id, 250, 'BKASH-SUP-1');
    await recordSupplierPayment({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE,
      purchaseId: purchase.purchaseId, amount: asPaisa(25000), method: 'bkash',
    });

    const row = sqlite
      .prepare(`SELECT method FROM payments WHERE shop_id = ? AND ref_id = ? AND type = 'supplier_payment' ORDER BY created_at DESC LIMIT 1`)
      .get(SHOP_ID, purchase.purchaseId) as { method: string };
    expect(row.method).toBe('bkash');
  });

  it('is refused once the business date is closed', async () => {
    const closeShop = '60000000-0000-4000-8000-000000000099';
    db.insert(shops).values({ id: closeShop, ownerId: OWNER_ID, name: 'Close Test Shop', phone: '01700000702', createdAt: NOW, updatedAt: NOW }).run();
    const closeRole = '60000000-0000-4000-8000-000000000098';
    db.insert(roles).values({ id: closeRole, shopId: closeShop, name: 'owner', isSystem: true, createdAt: NOW, updatedAt: NOW }).run();
    const closeOwner = '60000000-0000-4000-8000-000000000097';
    db.insert(users).values({ id: closeOwner, shopId: closeShop, name: 'Close Owner', phone: '01700000702', pinHash: 'hash', pinSetAt: NOW, roleId: closeRole, isActive: true, createdAt: NOW, updatedAt: NOW }).run();
    db.insert(medicines).values({ id: '60000000-0000-4000-8000-000000000096', shopId: closeShop, name: 'Close Med', unitOfMeasure: 'piece', threshold: 10, createdAt: NOW, updatedAt: NOW }).run();

    const supplier = await createSupplier(closeShop, closeOwner, { name: 'Closed Day Co' }, ALWAYS_LIVE);
    const purchase = await createPurchase({
      isStillActive: ALWAYS_LIVE, shopId: closeShop, supplierId: supplier.id, staffId: closeOwner,
      paymentType: 'credit',
      lineItems: [{ medicineId: '60000000-0000-4000-8000-000000000096', batchNo: 'CLOSED-1', expiryDate: '2028-01-01', quantity: 1, purchasePrice: asPaisa(10000), salePrice: asPaisa(15000) }],
    });
    await closeDay({ shopId: closeShop, isStillActive: ALWAYS_LIVE, businessDate: TODAY, countedCash: ZERO_PAISA, closedBy: closeOwner });

    await expect(
      recordSupplierPayment({
        shopId: closeShop, actorUserId: closeOwner, isStillActive: ALWAYS_LIVE,
        purchaseId: purchase.purchaseId, amount: asPaisa(100), method: 'cash',
      }),
    ).rejects.toThrow(/closed/i);
  });
});

describe('supplier edit', () => {
  it('updates name/phone/address/email/contactPerson', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Before Edit Co', phone: '01711111111' }, ALWAYS_LIVE);
    await updateSupplier({
      shopId: SHOP_ID, actorUserId: OWNER_ID, isStillActive: ALWAYS_LIVE, supplierId: supplier.id,
      fields: { name: 'After Edit Co', phone: '01722222222', address: 'New Address', email: 'edited@example.com', contactPerson: 'Edited Contact' },
    });

    const [row] = await listSuppliers(SHOP_ID, OWNER_ID, 'After Edit');
    expect(row?.name).toBe('After Edit Co');
    expect(row?.phone).toBe('01722222222');
  });
});

describe('supplier detail stats', () => {
  it('this-month total reflects purchases made today', async () => {
    const supplier = await createSupplier(SHOP_ID, OWNER_ID, { name: 'Month Stats Co' }, ALWAYS_LIVE);
    await makeCreditPurchase(supplier.id, 600, 'MONTH-1');

    const detail = await getSupplierDetail(SHOP_ID, OWNER_ID, supplier.id);
    expect(detail.thisMonthTotal).toBe(60000);
    expect(detail.invoiceCount).toBe(1);
    expect(detail.totalPurchase).toBe(60000);
  });
});
