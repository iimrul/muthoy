import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { eq } from 'drizzle-orm';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const s = await import('./schema');
const { addBatchWithPurchase, createMedicineWithPurchase, listBatchesForMedicine, searchRestockMedicines } = await import('./inventory');
const { createSaleTransaction } = await import('./sales');
const { currentBusinessDate, getCashSummarySync } = await import('./cash');
const { expectedCash } = await import('../domain/cashFormula');
const { ledgerSum } = await import('./stockLedger');
const { getSupplierPositionSync } = await import('./suppliers');
const { createPurchaseReturn } = await import('./purchaseReturns');
const { createFullSaleRefund, getRefundEligibility } = await import('./refunds');
const { activeSellableBatch, deductSellable } = await import('../domain/fefo');

beforeAll(() => {
  const directory = resolve('apps/mobile/db/migrations');
  const journal = JSON.parse(readFileSync(resolve(directory, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  for (const entry of journal.entries) sqlite.exec(readFileSync(resolve(directory, `${entry.tag}.sql`), 'utf8'));
});
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-01T06:00:00Z')); });
afterEach(() => vi.useRealTimers());

let serial = 0;
async function fixture(openingPayment: 'cod' | 'credit' = 'credit') {
  const number = ++serial;
  const id = (slot: number) => `74000000-0000-4000-8000-${String(number * 100 + slot).padStart(12, '0')}`;
  const shopId = id(1), actorUserId = id(2), staffId = id(3), supplierId = id(4);
  const now = new Date().toISOString();
  db.insert(s.shops).values({ id: shopId, ownerId: actorUserId, name: 'Restock test', phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(s.roles).values([
    { id: id(5), shopId, name: 'owner', isSystem: true, createdAt: now, updatedAt: now },
    { id: id(6), shopId, name: 'staff', isSystem: true, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(s.users).values([
    { id: actorUserId, shopId, name: 'Owner', roleId: id(5), pinHash: 'hash', pinSetAt: now, isActive: true, createdAt: now, updatedAt: now },
    { id: staffId, shopId, name: 'Staff', roleId: id(6), pinHash: 'hash', pinSetAt: now, isActive: true, createdAt: now, updatedAt: now },
  ]).run();
  db.insert(s.userPermissions).values({ id: id(7), shopId, userId: staffId, key: 'inventory_add', allowed: true, createdAt: now, updatedAt: now }).run();
  db.insert(s.suppliers).values({ id: supplierId, shopId, name: 'Supplier', createdAt: now, updatedAt: now }).run();
  // Real premium state for supplier-return tests; keep the production gate active.
  db.insert(s.billingAccounts).values({ id: id(8), principalOwnerUserId: actorUserId,
    primaryShopId: shopId, createdAt: now, updatedAt: now }).run();
  db.insert(s.shopDirectory).values({ shopId, billingAccountId: id(8), name: 'Restock test',
    commercialStatus: 'active', createdAt: now, updatedAt: now }).run();
  db.insert(s.entitlementCache).values({ billingAccountId: id(8), tier: 'pro', status: 'active',
    paidThrough: '2027-01-01T00:00:00.000Z', verifiedAt: now, lastObservedAt: now,
    version: 1, updatedAt: now }).run();
  const base = { shopId, actorUserId, isStillActive: ALWAYS_LIVE, supplierId, paymentType: 'credit' as const };
  const original = await createMedicineWithPurchase({ ...base, paymentType: openingPayment, name: 'Progut MUPS', generic: 'Esomeprazole', manufacturer: 'Popular', strength: '20mg', type: 'Tablet', unitOfMeasure: 'piece', requiresPrescription: true,
    firstBatch: { batchNo: 'Baban', expiryDate: '2027-12-12', quantity: 200, purchasePrice: asPaisa(500), salePrice: asPaisa(1000) } });
  const input = { ...base, medicineId: original.medicineId,
    batch: { batchNo: 'FEFO-EARLY', expiryDate: '2027-01-15', quantity: 50, purchasePrice: asPaisa(400), salePrice: asPaisa(700) } };
  return { ...base, staffId, billingAccountId: id(8), original, input };
}

function counts(shopId: string) {
  return ['medicines', 'batches', 'purchases', 'purchase_items', 'inventory_movements', 'payments', 'cash_drawer', 'sync_queue']
    .map((table) => sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE shop_id=?`).get(shopId));
}

describe('Batch 3 existing medicine receipt and ledger reconciliation', () => {
  it('refunds a spillover sale into its original batches exactly once and reconciles cash', async () => {
    const f = await fixture();
    await addBatchWithPurchase({ ...f.input, paymentType: 'cod' });
    const sale = await createSaleTransaction({
      shopId: f.shopId, staffId: f.actorUserId, isStillActive: ALWAYS_LIVE,
      paymentType: 'cash', amountTendered: asPaisa(40000),
      lines: [{ medicineId: f.original.medicineId, quantity: 55 }],
    });
    expect(sale.total).toBe(40000);
    const { createFullSaleRefund, getRefundEligibility } = await import('./refunds');
    const eligibility = await getRefundEligibility(f.shopId, f.actorUserId, sale.saleId);
    expect(eligibility.eligible).toBe(true);
    const refundInput = {
      shopId: f.shopId, actorUserId: f.actorUserId, isStillActive: ALWAYS_LIVE,
      saleId: sale.saleId, reason: 'Customer return', currentDeviceId: 'restock-device',
      claim: { claimId: 'restock-claim', claimToken: 'test-authority',
        operationId: eligibility.operationId, deviceId: 'restock-device' },
    };
    const refund = await createFullSaleRefund(refundInput);
    expect(await createFullSaleRefund(refundInput)).toEqual(refund);
    expect(refund.total).toBe(40000);
    const restored = await listBatchesForMedicine(f.shopId, f.original.medicineId);
    expect(restored.map((row) => [row.batchNo, row.quantityAvailable])).toEqual([
      ['FEFO-EARLY', 50], ['Baban', 200],
    ]);
    for (const batch of restored) expect(ledgerSum(db as never, batch.id)).toBe(batch.quantityAvailable);
    expect(getSupplierPositionSync(f.shopId, f.supplierId).outstandingPayable).toBe(100000);
    const summary = getCashSummarySync(f.shopId, currentBusinessDate());
    expect(expectedCash(summary)).toBe(-20000);
    expect(db.select().from(s.cashDrawer).where(eq(s.cashDrawer.shopId, f.shopId)).get()?.closingExpected).toBe(-20000);
    expect(db.select().from(s.saleItems).where(eq(s.saleItems.saleId, sale.saleId)).all()).toHaveLength(2);
    expect(db.select().from(s.salesReturns).where(eq(s.salesReturns.refundId, refund.refundId)).all()).toHaveLength(2);
  });

  it('keeps one medicine and its metadata, and selects the earlier new batch explicitly', async () => {
    const f = await fixture();
    const before = db.select().from(s.medicines).where(eq(s.medicines.id, f.original.medicineId)).get();
    await addBatchWithPurchase(f.input);
    expect(db.select().from(s.medicines).where(eq(s.medicines.shopId, f.shopId)).all()).toHaveLength(1);
    expect(db.select().from(s.medicines).where(eq(s.medicines.id, f.original.medicineId)).get()).toEqual(before);
    const rows = await listBatchesForMedicine(f.shopId, f.original.medicineId);
    expect(rows.map((row) => [row.batchNo, row.quantityAvailable])).toEqual([['FEFO-EARLY', 50], ['Baban', 200]]);
    expect(activeSellableBatch(f.original.medicineId, rows, currentBusinessDate())?.id).toBe(rows[0]!.id);
    expect(deductSellable(f.original.medicineId, 55, rows, currentBusinessDate())).toEqual([
      { batchId: rows[0]!.id, quantityDeducted: 50 }, { batchId: rows[1]!.id, quantityDeducted: 5 },
    ]);
    for (const batch of rows) expect(ledgerSum(db as never, batch.id)).toBe(batch.quantityAvailable);
  });

  it('books COD cash outflow and supplier payment exactly like a new-medicine purchase', async () => {
    const f = await fixture();
    const result = await addBatchWithPurchase({ ...f.input, paymentType: 'cod' });
    const payment = db.select().from(s.payments).where(eq(s.payments.refId, result.purchaseId)).get();
    expect(payment).toMatchObject({ type: 'supplier_payment', amount: 20000, partyId: f.supplierId, method: 'cash' });
    const summary = getCashSummarySync(f.shopId, currentBusinessDate());
    expect(summary.supplierPayments).toBe(20000);
    expect(summary.openingCash).toBe(0);
    const drawer = db.select().from(s.cashDrawer).where(eq(s.cashDrawer.shopId, f.shopId)).get();
    expect(drawer?.closingExpected).toBe(expectedCash(summary));
    expect(drawer?.closingExpected).toBe(-20000);
    expect(getSupplierPositionSync(f.shopId, f.supplierId).outstandingPayable).toBe(100000);
    const outbox = db.select().from(s.syncQueue).where(eq(s.syncQueue.operationGroupId, result.purchaseId)).all();
    expect(outbox).toHaveLength(outbox[0]!.operationExpectedCount!);
    expect(outbox.map((row) => row.operationSequence)).toEqual(outbox.map((_, index) => index));
    expect(outbox.some((row) => row.tableName === 'medicines')).toBe(false);
  });

  // REGRESSION (independent review, 2026-11-01). The first cut of this feature
  // staged restocks as `inventory_add_purchase`. DEV refuses that on two
  // independent grounds:
  //   1. the row-count constraint `expected_row_count in (5,7,8)`
  //      (20260825000000_inventory_add_purchase_sync.sql:25). A restock carries
  //      no medicines row, so it counts 4 (credit), 6 (COD onto an existing
  //      drawer) or 7 (COD creating one). 4 and 6 fail; **7 passes**, so the
  //      count alone does not close it -- the assertion below demonstrates the
  //      credit shape only, and deliberately claims no more than that.
  //   2. the graph validator (same file, ~line 179) requires EXACTLY ONE
  //      `medicines` row. A restock has none, so 4, 6 and 7 are all refused.
  //      That is the decisive mechanism.
  // The widening plus a restock-shaped graph exists only in
  // backend/supabase/held-migrations/, and the hosted chain is HELD. These tests
  // pin the shipped contract to what DEV accepts today, so flipping
  // `inventoryRestock` back on without applying that migration fails here rather
  // than in a pharmacy's outbox.
  const LIVE_INVENTORY_ADD_PURCHASE_COUNTS = [5, 7, 8];

  it('stages a restock as purchase_create, with a row count the live constraint would reject under the held kind', async () => {
    const f = await fixture();
    const restock = await addBatchWithPurchase(f.input);
    const outbox = db.select().from(s.syncQueue).where(eq(s.syncQueue.operationGroupId, restock.purchaseId)).all();
    expect(new Set(outbox.map((row) => row.operationKind).filter(Boolean))).toEqual(new Set(['purchase_create']));
    expect(outbox.some((row) => row.tableName === 'medicines')).toBe(false);
    // The count is outside the live allow-list: proof the kind above is load-bearing.
    expect(LIVE_INVENTORY_ADD_PURCHASE_COUNTS).not.toContain(outbox[0]!.operationExpectedCount!);

    // A genuinely new medicine still uses the staff-eligible kind, and its count
    // IS inside the live allow-list -- so the two paths stay distinguishable.
    const created = await createMedicineWithPurchase({
      shopId: f.shopId, actorUserId: f.actorUserId, isStillActive: ALWAYS_LIVE,
      supplierId: f.supplierId, paymentType: 'credit',
      name: 'Distinct Product', unitOfMeasure: 'piece', requiresPrescription: false,
      firstBatch: { batchNo: 'NEW-1', expiryDate: '2027-06-01', quantity: 10, purchasePrice: asPaisa(100), salePrice: asPaisa(200) },
    });
    const createdOutbox = db.select().from(s.syncQueue).where(eq(s.syncQueue.operationGroupId, created.purchaseId)).all();
    expect(new Set(createdOutbox.map((row) => row.operationKind).filter(Boolean))).toEqual(new Set(['inventory_add_purchase']));
    expect(LIVE_INVENTORY_ADD_PURCHASE_COUNTS).toContain(createdOutbox[0]!.operationExpectedCount!);
  });

  // REGRESSION (Codex re-review, 2026-11-01). Moving restocks onto
  // `purchase_create` pulled them under B4 row authorization, which requires
  // premium for `purchases` and `purchase_items` -- the exemption is enabled
  // only for `inventory_add_purchase`
  // (20260831000000_b4_commercial_platform.sql:429). Without a client-side gate
  // a FREE owner commits locally and DEV answers MU010: offline success, online
  // failure. The fixture seeds Pro, which is exactly what hid this.
  it('refuses a Free owner restock before any write, and still allows a Free new medicine', async () => {
    const f = await fixture();
    db.update(s.entitlementCache).set({ tier: 'free' })
      .where(eq(s.entitlementCache.billingAccountId, f.billingAccountId)).run();
    const before = counts(f.shopId);
    await expect(addBatchWithPurchase(f.input)).rejects.toThrow(/Upgrade to Pro or Ultra/);
    expect(counts(f.shopId)).toEqual(before);

    // The gate is scoped to restocking. Creating a NEW medicine stages under
    // the exempt `inventory_add_purchase` kind, so Free must still work -- if
    // this ever starts throwing, the gate has been put in the wrong place.
    const created = await createMedicineWithPurchase({
      shopId: f.shopId, actorUserId: f.actorUserId, isStillActive: ALWAYS_LIVE,
      supplierId: f.supplierId, paymentType: 'credit',
      name: 'Free Plan Product', unitOfMeasure: 'piece', requiresPrescription: false,
      firstBatch: { batchNo: 'FREE-1', expiryDate: '2027-06-01', quantity: 5, purchasePrice: asPaisa(100), salePrice: asPaisa(200) },
    });
    expect(created.medicineId).toBeTruthy();

    // And a premium owner restocks normally, so the gate is plan-scoped rather
    // than a disabled feature.
    db.update(s.entitlementCache).set({ tier: 'pro' })
      .where(eq(s.entitlementCache.billingAccountId, f.billingAccountId)).run();
    await addBatchWithPurchase(f.input);
    expect(await listBatchesForMedicine(f.shopId, f.original.medicineId)).toHaveLength(2);
  });

  it('refuses a restock from inventory_add staff, because purchase_create is owner-only server-side', async () => {
    const f = await fixture();
    const before = counts(f.shopId);
    await expect(addBatchWithPurchase({ ...f.input, actorUserId: f.staffId })).rejects.toThrow();
    // Nothing partial was written. Scoped by shop: this file shares one
    // in-memory database across cases, so a bare batchNo lookup would match
    // rows other tests created.
    expect(counts(f.shopId)).toEqual(before);
  });

  it('partially depletes early stock, spills across batches at their own prices, then rejects exhausted stock', async () => {
    const f = await fixture();
    await addBatchWithPurchase(f.input);
    const rows = await listBatchesForMedicine(f.shopId, f.original.medicineId);
    const sell = (quantity: number) => createSaleTransaction({ shopId: f.shopId, staffId: f.actorUserId, isStillActive: ALWAYS_LIVE,
      paymentType: 'cash', amountTendered: asPaisa(1000000), lines: [{ medicineId: f.original.medicineId, quantity }] });
    await sell(20);
    expect((await listBatchesForMedicine(f.shopId, f.original.medicineId)).map((row) => row.quantityAvailable)).toEqual([30, 200]);
    const sale = await sell(40);
    const items = db.select().from(s.saleItems).where(eq(s.saleItems.saleId, sale.saleId)).all();
    expect(items.map((item) => [item.batchId, item.qty, item.unitPrice])).toEqual([[rows[0]!.id, 30, 700], [rows[1]!.id, 10, 1000]]);
    await sell(190);
    const empty = await listBatchesForMedicine(f.shopId, f.original.medicineId);
    expect(activeSellableBatch(f.original.medicineId, empty, currentBusinessDate())).toBeUndefined();
    const before = counts(f.shopId);
    await expect(sell(1)).rejects.toThrow();
    expect(counts(f.shopId)).toEqual(before);
    for (const batch of empty) expect(ledgerSum(db as never, batch.id)).toBe(0);
    const summary = getCashSummarySync(f.shopId, currentBusinessDate());
    expect(summary.cashSales).toBe(235000);
    expect(db.select().from(s.cashDrawer).where(eq(s.cashDrawer.shopId, f.shopId)).get()?.closingExpected).toBe(expectedCash(summary));
  });

  it.each([[10, 15000, 0], [50, 0, 5000]])('uses supplier return credit from %i units before paying residual COD cash', async (qty, cash, remainingCredit) => {
    const f = await fixture('cod');
    const item = db.select().from(s.purchaseItems).where(eq(s.purchaseItems.purchaseId, f.original.purchaseId)).get()!;
    await createPurchaseReturn({ shopId: f.shopId, actorUserId: f.actorUserId, isStillActive: ALWAYS_LIVE,
      purchaseId: f.original.purchaseId, purchaseItemId: item.id, qty: qty!, reason: 'damaged' });
    const result = await addBatchWithPurchase({ ...f.input, paymentType: 'cod' });
    const payment = db.select().from(s.payments).where(eq(s.payments.refId, result.purchaseId)).get();
    if (cash) expect(payment?.amount).toBe(cash);
    else expect(payment).toBeUndefined();
    expect(getSupplierPositionSync(f.shopId, f.supplierId)).toMatchObject({ outstandingPayable: 0, supplierCredit: remainingCredit });
    const summary = getCashSummarySync(f.shopId, currentBusinessDate());
    expect(summary.supplierPayments).toBe(100000 + cash!);
    expect(db.select().from(s.cashDrawer).where(eq(s.cashDrawer.shopId, f.shopId)).get()?.closingExpected).toBe(expectedCash(summary));
    for (const batch of await listBatchesForMedicine(f.shopId, f.original.medicineId)) expect(ledgerSum(db as never, batch.id)).toBe(batch.quantityAvailable);
  });

  it('skips expired stock and keeps expiry day sellable at read time', async () => {
    const f = await fixture();
    await addBatchWithPurchase({ ...f.input, batch: { ...f.input.batch, expiryDate: '2026-11-01' } });
    const rows = await listBatchesForMedicine(f.shopId, f.original.medicineId);
    expect(activeSellableBatch(f.original.medicineId, rows, '2026-11-01')?.id).toBe(rows[0]!.id);
    expect(activeSellableBatch(f.original.medicineId, rows, '2026-11-02')?.id).toBe(rows[1]!.id);
    expect(deductSellable(f.original.medicineId, 5, rows, '2026-11-02')).toEqual([{ batchId: rows[1]!.id, quantityDeducted: 5 }]);
  });

  it('refunds a spillover sale to its original two batches and reconciles cash', async () => {
    const f = await fixture();
    await addBatchWithPurchase(f.input);
    const sale = await createSaleTransaction({ shopId: f.shopId, staffId: f.actorUserId, isStillActive: ALWAYS_LIVE,
      paymentType: 'cash', amountTendered: asPaisa(100000), lines: [{ medicineId: f.original.medicineId, quantity: 55 }] });
    const eligibility = await getRefundEligibility(f.shopId, f.actorUserId, sale.saleId);
    expect(eligibility.eligible).toBe(true);
    await createFullSaleRefund({ shopId: f.shopId, actorUserId: f.actorUserId, saleId: sale.saleId, reason: 'Customer request',
      claim: { claimId: 'restock-claim', claimToken: 'restock-token', operationId: eligibility.operationId, deviceId: 'restock-device' },
      currentDeviceId: 'restock-device', isStillActive: ALWAYS_LIVE });
    const rows = await listBatchesForMedicine(f.shopId, f.original.medicineId);
    expect(rows.map((row) => row.quantityAvailable)).toEqual([50, 200]);
    for (const batch of rows) expect(ledgerSum(db as never, batch.id)).toBe(batch.quantityAvailable);
    const summary = getCashSummarySync(f.shopId, currentBusinessDate());
    expect(summary.cashSales).toBe(40000);
    expect(summary.refunds).toBe(40000);
    expect(db.select().from(s.cashDrawer).where(eq(s.cashDrawer.shopId, f.shopId)).get()?.closingExpected).toBe(expectedCash(summary));
    expect(expectedCash(summary)).toBe(0);
  });

  // Was 'allows granted inventory_add staff ...'. Changed during independent
  // review, and the reason matters: a restock stages as `purchase_create`, and
  // 20260823050000_b3_groups456_sync_completion.sql:211-213 enforces
  //   and r.name='owner' ... raise exception '% is Owner-only' ... errcode='MU015'
  // server-side. Letting an inventory_add staff member restock locally would
  // queue a graph DEV answers with MU015 and strand their outbox -- offline
  // success, online failure, which CLAUDE.md rule 12 does not allow. The staff
  // path returns with the held sync-contract extension, not before.
  it('refuses inventory_add staff while purchase_create is Owner-only, and rechecks revocation, session and shop identity', async () => {
    const f = await fixture();
    const before = counts(f.shopId);
    await expect(addBatchWithPurchase({ ...f.input, actorUserId: f.staffId })).rejects.toThrow();
    db.update(s.userPermissions).set({ allowed: false }).where(eq(s.userPermissions.userId, f.staffId)).run();
    await expect(addBatchWithPurchase({ ...f.input, actorUserId: f.staffId, batch: { ...f.input.batch, batchNo: 'DENIED' } })).rejects.toThrow();
    await expect(addBatchWithPurchase({ ...f.input, isStillActive: () => false })).rejects.toThrow();
    const other = await fixture();
    await expect(addBatchWithPurchase({ ...f.input, medicineId: other.original.medicineId })).rejects.toThrow();
    expect(counts(f.shopId)).toEqual(before);
    // The gate is role-scoped, not a dead feature: the owner still restocks.
    await addBatchWithPurchase({ ...f.input, actorUserId: f.actorUserId });
    expect(await listBatchesForMedicine(f.shopId, f.original.medicineId)).toHaveLength(2);
  });

  // Codex re-review, 2026-11-01: with staff now categorically denied for
  // restocking, the revocation assertion in the test above no longer proves
  // revocation on its own -- the owner guard throws first, so a broken
  // permission recheck would still look green there. Revocation therefore has to
  // stay proven on the path staff can still use: new-medicine creation.
  it('still enforces inventory_add revocation on the staff-eligible new-medicine path', async () => {
    const f = await fixture();
    const newMedicine = (batchNo: string) => createMedicineWithPurchase({
      shopId: f.shopId, actorUserId: f.staffId, isStillActive: ALWAYS_LIVE,
      supplierId: f.supplierId, paymentType: 'credit',
      name: `Staff Product ${batchNo}`, unitOfMeasure: 'piece', requiresPrescription: false,
      firstBatch: { batchNo, expiryDate: '2027-06-01', quantity: 5, purchasePrice: asPaisa(100), salePrice: asPaisa(200) },
    });
    await newMedicine('STAFF-OK');
    const before = counts(f.shopId);
    db.update(s.userPermissions).set({ allowed: false })
      .where(eq(s.userPermissions.userId, f.staffId)).run();
    await expect(newMedicine('STAFF-DENIED')).rejects.toThrow();
    expect(counts(f.shopId)).toEqual(before);
  });

  it('rolls back duplicate batch, conflicting expiry, deleted medicine and invalid supplier', async () => {
    const f = await fixture();
    await addBatchWithPurchase(f.input);
    const before = counts(f.shopId);
    await expect(addBatchWithPurchase({ ...f.input, medicineId: '' })).rejects.toThrow(/selection/);
    await expect(addBatchWithPurchase(f.input)).rejects.toThrow();
    await expect(addBatchWithPurchase({ ...f.input, batch: { ...f.input.batch, expiryDate: '2028-01-01' } })).rejects.toThrow();
    await expect(addBatchWithPurchase({ ...f.input, supplierId: 'missing', batch: { ...f.input.batch, batchNo: 'INVALID' } })).rejects.toThrow();
    db.update(s.medicines).set({ isDeleted: true }).where(eq(s.medicines.id, f.original.medicineId)).run();
    await expect(addBatchWithPurchase({ ...f.input, batch: { ...f.input.batch, batchNo: 'DELETED' } })).rejects.toThrow();
    expect(counts(f.shopId)).toEqual(before);
  });

  it('warns about same names, preserves deliberate distinct medicines, and isolates picker results', async () => {
    const f = await fixture();
    const duplicate = { ...f, name: 'Progut MUPS', generic: 'Other generic', manufacturer: 'Other maker', strength: '40mg', unitOfMeasure: 'piece', requiresPrescription: false,
      firstBatch: { ...f.input.batch, batchNo: 'DISTINCT' } };
    await expect(createMedicineWithPurchase(duplicate)).rejects.toThrow();
    const distinct = await createMedicineWithPurchase({ ...duplicate, confirmDistinctMedicine: true });
    expect(distinct.medicineId).not.toBe(f.original.medicineId);
    const other = await fixture();
    const choices = await searchRestockMedicines(f.shopId, 'Progut');
    expect(choices.map((row) => row.id).sort()).toEqual([f.original.medicineId, distinct.medicineId].sort());
    expect(choices.some((row) => row.id === other.original.medicineId)).toBe(false);
    expect(choices.find((row) => row.id === f.original.medicineId)).toMatchObject({ strength: '20mg', type: 'Tablet' });
  });
});
