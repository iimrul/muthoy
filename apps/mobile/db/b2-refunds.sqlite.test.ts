import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ZERO_PAISA, asPaisa } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

vi.mock('../native/prescriptionAttachment', () => ({
  preparePrescriptionAttachment: vi.fn(),
  removePreparedPrescriptionAttachment: vi.fn(),
}));

const { db } = await import('./client');
const schema = await import('./schema');
const { createSaleTransaction } = await import('./sales');
const { createFullSaleRefund, getRefundEligibility } = await import('./refunds');
const { refundChildId } = await import('../domain/deterministicId');
const {
  collectPayment,
  getCustomerCreditDetail,
  getCustomerListTotals,
  listCustomersWithBalance,
} = await import('./customers');

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql', '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql', '0010_known_ares.sql', '0011_black_zarda.sql', '0012_small_meltdown.sql',
    '0013_owner_dashboard_credit_period.sql', '0014_owner_dashboard_credit_period_guard.sql',
    '0015_b3_shop_settings.sql', '0016_payment_note.sql', '0017_cash_reconcile.sql', '0018_expense_category_taxonomy.sql',
    '0019_supplier_archive.sql', '0020_purchase_item_status.sql', '0021_purchase_void.sql',
    '0022_supplier_profile_fields.sql', '0023_purchase_invoice_metadata.sql',
    '0024_b3_report_indexes.sql', '0025_b3_sale_tax_snapshot.sql',
    // H-7: users.access_locked_at, the device-local revocation marker.
    '0027_h7_local_access_lock.sql',
    '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql'
  ]) applyMigration(name);
  const now = new Date().toISOString();
  db.insert(schema.shops).values({ id: 'shop', ownerId: 'owner', name: 'B2', phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'owner-role', shopId: 'shop', name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'owner', shopId: 'shop', name: 'Owner', pinHash: 'hash', pinSetAt: now, roleId: 'owner-role', isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.medicines).values({ id: 'medicine', shopId: 'shop', name: 'Napa', createdAt: now, updatedAt: now }).run();
  db.insert(schema.batches).values({ id: 'batch', shopId: 'shop', medicineId: 'medicine', batchNo: 'B1',
    expiryDate: null, stock: 0, purchasePrice: asPaisa(500), salePrice: asPaisa(1000), createdAt: now, updatedAt: now }).run();
  db.insert(schema.inventoryMovements).values({ id: 'opening', shopId: 'shop', batchId: 'batch', changeQty: 5,
    reason: 'purchase', createdBy: 'owner', createdAt: now, updatedAt: now }).run();
});

describe('B2 full-sale refund', () => {
  it('requires authority before mutation, restores archived expired stock once, and replays idempotently', async () => {
    const sale = await createSaleTransaction({
      shopId: 'shop', staffId: 'owner', isStillActive: ALWAYS_LIVE,
      payment: { type: 'cash', tendered: asPaisa(5000) },
      lines: [{ medicineId: 'medicine', quantity: 5 }],
    });
    expect(db.select({ stock: schema.batches.stock }).from(schema.batches).where(eq(schema.batches.id, 'batch')).get()?.stock).toBe(0);
    const movementsBefore = db.select().from(schema.inventoryMovements).all().length;

    await expect(createFullSaleRefund({
      shopId: 'shop', actorUserId: 'owner', saleId: sale.saleId, reason: 'Customer request',
      claim: { claimId: '', claimToken: '', operationId: 'wrong', deviceId: 'device-a' },
      currentDeviceId: 'device-a', isStillActive: ALWAYS_LIVE,
    })).rejects.toThrow('Valid online refund authority is required');
    expect(db.select().from(schema.saleRefunds).all()).toHaveLength(0);
    expect(db.select().from(schema.inventoryMovements).all()).toHaveLength(movementsBefore);
    expect(db.select({ stock: schema.batches.stock }).from(schema.batches).where(eq(schema.batches.id, 'batch')).get()?.stock).toBe(0);

    const archivedAt = new Date().toISOString();
    db.update(schema.batches).set({ expiryDate: '2000-01-01', isDeleted: true, deletedAt: archivedAt, deletedBy: 'owner' })
      .where(eq(schema.batches.id, 'batch')).run();
    db.update(schema.medicines).set({ isDeleted: true, deletedAt: archivedAt, deletedBy: 'owner' })
      .where(eq(schema.medicines.id, 'medicine')).run();

    const eligibility = await getRefundEligibility('shop', 'owner', sale.saleId);
    expect(eligibility.eligible).toBe(true);
    const claim = {
      claimId: 'claim-a', claimToken: 'token-a', operationId: eligibility.operationId, deviceId: 'device-a',
    };
    const first = await createFullSaleRefund({
      shopId: 'shop', actorUserId: 'owner', saleId: sale.saleId, reason: 'Customer request',
      claim, currentDeviceId: 'device-a', isStillActive: ALWAYS_LIVE,
    });
    const replay = await createFullSaleRefund({
      shopId: 'shop', actorUserId: 'owner', saleId: sale.saleId, reason: 'Customer request',
      claim, currentDeviceId: 'device-a', isStillActive: ALWAYS_LIVE,
    });
    expect(replay).toEqual(first);
    expect(first.total).toBe(asPaisa(5000));
    expect(db.select().from(schema.saleRefunds).all()).toHaveLength(1);
    expect(db.select().from(schema.salesReturns).all()).toHaveLength(1);
    expect(db.select().from(schema.refundTenders).all()).toHaveLength(1);
    expect(db.select().from(schema.inventoryMovements).all()).toHaveLength(movementsBefore + 1);
    expect(db.select({ stock: schema.batches.stock, isDeleted: schema.batches.isDeleted }).from(schema.batches)
      .where(eq(schema.batches.id, 'batch')).get()).toMatchObject({ stock: 5, isDeleted: false });
    expect(db.select({ isDeleted: schema.medicines.isDeleted }).from(schema.medicines)
      .where(eq(schema.medicines.id, 'medicine')).get()?.isDeleted).toBe(false);
    const item = db.select({ id: schema.saleItems.id }).from(schema.saleItems).where(eq(schema.saleItems.saleId, sale.saleId)).get();
    expect(db.select({ id: schema.inventoryMovements.id }).from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.id, refundChildId(first.refundId, `movement:${item?.id}`))).get()).toBeTruthy();
  });
});

// W-1 fix proof: createFullSaleRefund zeroes credits.balance directly without
// touching credits.amount or inserting an offsetting payments row. Before the
// canonicalization fix, a ledger-sum read (SUM(credits.amount) -
// SUM(customer_payment)) would overstate this customer's balance by the
// refunded outstanding amount after a partial-collection-then-refund
// sequence, while balance-column reads (SUM(credits.balance)) stayed
// correct. Every balance read in db/customers.ts now derives from
// balance-column, so all three must agree here.
describe('credit balance canonicalization — refund consistency (W-1)', () => {
  it('keeps list/list-totals/detail balance reads consistent after a credit-sale refund with a prior partial collection', async () => {
    // Dedicated medicine/batch: the shared 'batch' fixture is left expired by
    // the test above (it archives/expires it to test refund's un-archive
    // path), so it has zero sellable stock afterward.
    const now = new Date().toISOString();
    db.insert(schema.medicines).values({ id: 'medicine-credit-w1', shopId: 'shop', name: 'Paracetamol', createdAt: now, updatedAt: now }).run();
    db.insert(schema.batches).values({ id: 'batch-credit-w1', shopId: 'shop', medicineId: 'medicine-credit-w1', batchNo: 'B2',
      expiryDate: null, stock: 0, purchasePrice: asPaisa(500), salePrice: asPaisa(1000), createdAt: now, updatedAt: now }).run();
    db.insert(schema.inventoryMovements).values({ id: 'opening-credit-w1', shopId: 'shop', batchId: 'batch-credit-w1', changeQty: 5,
      reason: 'purchase', createdBy: 'owner', createdAt: now, updatedAt: now }).run();

    const sale = await createSaleTransaction({
      shopId: 'shop', staffId: 'owner', isStillActive: ALWAYS_LIVE,
      payment: { type: 'credit' },
      newCustomer: { name: 'Credit Customer', phone: '01700000900' },
      lines: [{ medicineId: 'medicine-credit-w1', quantity: 2 }],
    });
    const credit = db.select().from(schema.credits).where(eq(schema.credits.saleId, sale.saleId)).get();
    expect(credit).toBeTruthy();
    const customerId = credit!.customerId;
    expect(credit!.amount).toBe(asPaisa(2000));

    await collectPayment({
      shopId: 'shop', staffId: 'owner', isStillActive: ALWAYS_LIVE,
      customerId, amount: asPaisa(800), method: 'cash',
    });

    const eligibility = await getRefundEligibility('shop', 'owner', sale.saleId);
    expect(eligibility.eligible).toBe(true);
    await createFullSaleRefund({
      shopId: 'shop', actorUserId: 'owner', saleId: sale.saleId, reason: 'Customer request',
      claim: { claimId: 'claim-credit', claimToken: 'token-credit', operationId: eligibility.operationId, deviceId: 'device-b' },
      currentDeviceId: 'device-b', isStillActive: ALWAYS_LIVE,
    });

    const [listRow] = await listCustomersWithBalance('shop', 'owner', 'Credit Customer');
    const totals = await getCustomerListTotals('shop', 'owner', 'Credit Customer');
    const detail = await getCustomerCreditDetail('shop', 'owner', customerId);

    expect(listRow?.balance).toBe(ZERO_PAISA);
    expect(totals.totalOutstanding).toBe(ZERO_PAISA);
    expect(detail.totalDue).toBe(ZERO_PAISA);
  });
});
