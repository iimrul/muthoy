// W3-11 — the core workflows run IN SEQUENCE against shared state.
//
// Every workflow here already has its own suite. What none of them can see is
// the interaction: a sale, then an expense, then the day's totals, all against
// the same drawer and the same batch. The defects this catches are the ones
// where each step is individually correct and the composition is not.
//
// Two invariants are asserted after EVERY step rather than once at the end,
// because "it balanced at the end" hides a step that broke and a later step
// that happened to compensate:
//
//   LEDGER     batches.stock == SUM(inventory_movements.change_qty)
//   ACCOUNTING netSales == saleTotal - refundTotal, and the same subtraction
//              for tax (db/reports.ts holds the one definition)
//
// Plus: every money column stays an integer (CLAUDE.md rule 4 — paisa, never a
// float), and the offline half proves the outbox carries COMPLETE operation
// groups so a reconnect cannot apply half a sale.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';

vi.mock('../native/prescriptionAttachment', () => ({
  preparePrescriptionAttachment: vi.fn(),
  prepareDraftPrescriptionAttachment: vi.fn(),
  removePreparedPrescriptionAttachment: vi.fn(),
}));

const { db } = await import('./client');
const schema = await import('./schema');
const { ALWAYS_LIVE } = await import('./errors');
const { createSaleTransaction } = await import('./sales');
const { createMedicineWithBatch } = await import('./inventory');
const { recordExpense, setOpeningCash, getCashSummary, closeDay } = await import('./cash');
const {
  listPendingSyncRows,
  markSyncRowSent,
  markSyncRowTransientFailure,
  countFailedSyncRows,
} = await import('./sync-helpers');
const { createSupplier } = await import('./suppliers');
const { createPurchase, markPurchaseLineReceived } = await import('./purchases');
const { createPurchaseReturn } = await import('./purchaseReturns');
const { collectPayment } = await import('./customers');
const { createFullSaleRefund, getRefundEligibility } = await import('./refunds');

const SHOP = 'w311-shop';
const ROLE = 'w311-owner-role';
const OWNER = 'w311-owner';
const CUSTOMER = 'w311-customer';
const ACCOUNT = 'w311-account';

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

/** Every migration, in journal order — so this suite sees the shipped schema. */
function allMigrations(): string[] {
  const journal = JSON.parse(
    readFileSync(resolve('apps/mobile/db/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => `${entry.tag}.sql`);
}

/** The ledger invariant, asserted directly rather than inferred from a total. */
function expectLedgerInvariant(step: string): void {
  const rows = sqlite
    .prepare(
      `SELECT b.id, b.stock,
              COALESCE((SELECT SUM(m.change_qty) FROM inventory_movements m
                         WHERE m.batch_id = b.id AND m.is_deleted = 0), 0) AS ledger
         FROM batches b WHERE b.shop_id = ? AND b.is_deleted = 0`,
    )
    .all(SHOP) as unknown as { id: string; stock: number; ledger: number }[];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(
      row.stock,
      `${step}: batches.stock must equal SUM(change_qty) for ${row.id}`,
    ).toBe(row.ledger);
  }
}

/** Every money column stays a whole number of paisa — never a float. */
function expectIntegerPaisa(step: string): void {
  const checks: [string, string][] = [
    ['sales', 'subtotal'], ['sales', 'discount_amount'], ['sales', 'total'],
    ['sales', 'tax_amount'], ['sales', 'cash_applied'], ['sales', 'credit_amount'],
    ['sale_items', 'unit_price'], ['sale_items', 'line_total'], ['sale_items', 'cogs'],
    ['expenses', 'amount'], ['cash_drawer', 'opening_cash'],
  ];
  for (const [table, column] of checks) {
    const bad = sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM ${table}
          WHERE ${column} IS NOT NULL AND CAST(${column} AS INTEGER) <> ${column}`,
      )
      .get() as { n: number };
    expect(bad.n, `${step}: ${table}.${column} must be integer paisa`).toBe(0);
  }
}

/** Local business date, matching db/cash.ts's currentBusinessDate. */
function businessDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The canonical accounting identity, recomputed from raw rows and compared
 * against what db/reports.ts answers — so a drift in either shows up here.
 */
async function expectAccountingIdentities(step: string): Promise<void> {
  const { getReportSnapshot } = await import('./reports');
  const date = businessDate();
  const { totals } = await getReportSnapshot(SHOP, OWNER, { startDate: date, endDate: date });
  const raw = sqlite
    .prepare(
      `SELECT
         COALESCE((SELECT SUM(total) FROM sales
                    WHERE shop_id=? AND is_deleted=0 AND business_date=?),0) AS saleTotal,
         COALESCE((SELECT SUM(tax_amount) FROM sales
                    WHERE shop_id=? AND is_deleted=0 AND business_date=?),0) AS saleTax,
         COALESCE((SELECT SUM(r.total_amount) FROM sale_refunds r
                    WHERE r.shop_id=? AND r.is_deleted=0 AND r.business_date=?),0) AS refundTotal,
         COALESCE((SELECT SUM(s.tax_amount) FROM sale_refunds r JOIN sales s ON s.id=r.sale_id
                    WHERE r.shop_id=? AND r.is_deleted=0 AND r.business_date=?),0) AS refundTax`,
    )
    .get(SHOP, date, SHOP, date, SHOP, date, SHOP, date) as unknown as {
      saleTotal: number; saleTax: number; refundTotal: number; refundTax: number;
    };

  expect(totals.netSales, `${step}: netSales == saleTotal - refundTotal`)
    .toBe(raw.saleTotal - raw.refundTotal);
  expect(totals.taxCollected, `${step}: taxCollected == saleTax - refundTax`)
    .toBe(raw.saleTax - raw.refundTax);
  expect(totals.refunds, `${step}: refunds == SUM(sale_refunds.total_amount)`)
    .toBe(raw.refundTotal);
  // Integer throughout — a float here is the bug rule 4 exists to prevent.
  for (const [name, value] of Object.entries(totals)) {
    if (typeof value === 'number') {
      expect(Number.isInteger(value), `${step}: ${name} must be an integer`).toBe(true);
    }
  }
}

async function checkpoint(step: string): Promise<void> {
  expectLedgerInvariant(step);
  expectIntegerPaisa(step);
  await expectAccountingIdentities(step);
}

let medicineId = '';
let batchId = '';
let firstSaleTotal = 0;
let secondSaleTotal = 0;
let supplierId = '';
let purchaseId = '';
let purchaseBatchId = '';
let secondSaleId = '';
let refundTotal = 0;
let creditSaleTotal = 0;

/** The one device this suite acts from; a refund claim is bound to it. */
const DEVICE = 'w311-device';

function oneRow<T>(sql: string, ...args: unknown[]): T {
  return sqlite.prepare(sql).get(...(args as never[])) as T;
}

function stockOf(id: string): number {
  return oneRow<{ stock: number }>('SELECT stock FROM batches WHERE id = ?', id).stock;
}

/**
 * Tendered well above any possible total.
 *
 * `quotedTotal` is deliberately NOT passed: it is the checkout screen's
 * optimistic-concurrency token, and supplying a figure this suite computed
 * itself would assert the fixture's arithmetic rather than the system's. The
 * total comes back in the result and every assertion is made against THAT, so
 * the shop's tax snapshot decides the money and the test only checks that the
 * day composes correctly.
 */
const GENEROUS_TENDER = asPaisa(1_000_000);

beforeAll(() => {
  for (const name of allMigrations()) applyMigration(name);
  const now = new Date().toISOString();
  db.insert(schema.shops).values({
    id: SHOP, ownerId: OWNER, name: 'Workflow Shop', phone: '01700000311',
    createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.roles).values({
    id: ROLE, shopId: SHOP, name: 'owner', isSystem: true, createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.users).values({
    id: OWNER, shopId: SHOP, name: 'Owner', phone: '01700000311', pinHash: 'hash',
    pinSetAt: now, roleId: ROLE, isActive: true, createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.customers).values({
    id: CUSTOMER, shopId: SHOP, name: 'Customer', createdAt: now, updatedAt: now,
  }).run();
  // A live trial. Expenses and purchases are B4-premium gated
  // (sync_row_permitted + db/commercial.ts), and a fresh shop on trial is the
  // normal state for a real pharmacy — not a special case worth skipping.
  db.insert(schema.billingAccounts).values({
    id: ACCOUNT, principalOwnerUserId: OWNER, primaryShopId: SHOP,
    launchTrialGrantedAt: now, createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.shopDirectory).values({
    shopId: SHOP, billingAccountId: ACCOUNT, name: 'Workflow Shop',
    commercialStatus: 'active', createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.entitlementCache).values({
    billingAccountId: ACCOUNT, tier: 'free', status: 'trialing',
    trialEndsAt: '2999-01-01T00:00:00.000Z',
    verifiedAt: now, lastObservedAt: now, version: 1, updatedAt: now,
  }).run();
});

describe('a full business day, in sequence', () => {
  it('step 1: opens the drawer at zero (CLAUDE.md rule 5 — never inherits yesterday)', async () => {
    await setOpeningCash({
      shopId: SHOP, staffId: OWNER, businessDate: businessDate(),
      openingCash: asPaisa(0), isStillActive: ALWAYS_LIVE,
    });
    const summary = await getCashSummary(SHOP, OWNER, businessDate());
    expect(summary.openingCash).toBe(0);
    expect(Number.isInteger(summary.openingCash)).toBe(true);
  });

  it('step 2: stocks a medicine, and the ledger explains every unit', async () => {
    const created = await createMedicineWithBatch({
      shopId: SHOP, actorUserId: OWNER, isStillActive: ALWAYS_LIVE,
      name: 'Napa', unitOfMeasure: 'tablet', requiresPrescription: false,
      firstBatch: {
        batchNo: 'B1',
        expiryDate: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10),
        quantity: 20, purchasePrice: asPaisa(1000), salePrice: asPaisa(1500),
      },
    });
    medicineId = created.medicineId;
    batchId = created.batchId;

    const batch = sqlite
      .prepare('SELECT stock FROM batches WHERE id = ?')
      .get(batchId) as { stock: number };
    expect(batch.stock).toBe(20);
    await checkpoint('after stocking');
  });

  it('step 3: rings up a cash sale and moves stock by exactly the quantity sold', async () => {
    // Tendered generously and the quote taken from the system's own arithmetic:
    // the shop's tax snapshot is what decides the total, and hardcoding it here
    // would make this suite assert the fixture rather than the workflow.
    const result = await createSaleTransaction({
      shopId: SHOP, staffId: OWNER, isStillActive: ALWAYS_LIVE,
      payment: { type: 'cash', tendered: GENEROUS_TENDER },
      lines: [{ medicineId, quantity: 3 }],
    });
    firstSaleTotal = result.total;

    expect(result.total).toBeGreaterThan(0);
    expect(Number.isInteger(result.total)).toBe(true);
    // Change is the exact complement of the tender — the cash identity.
    expect(result.change).toBe(GENEROUS_TENDER - result.total);
    const batch = sqlite
      .prepare('SELECT stock FROM batches WHERE id = ?')
      .get(batchId) as { stock: number };
    expect(batch.stock).toBe(17);
    await checkpoint('after the cash sale');
  });

  it('step 4: records an expense without touching stock', async () => {
    await recordExpense({
      shopId: SHOP, staffId: OWNER, isStillActive: ALWAYS_LIVE,
      category: 'utilities', amount: asPaisa(500), description: 'Electricity',
    });
    const batch = sqlite
      .prepare('SELECT stock FROM batches WHERE id = ?')
      .get(batchId) as { stock: number };
    expect(batch.stock).toBe(17);
    await checkpoint('after the expense');
  });

  it('step 5: the day reports the sale and the expense, with no refund', async () => {
    const { getReportSnapshot } = await import('./reports');
    const date = businessDate();
    const { totals } = await getReportSnapshot(SHOP, OWNER, { startDate: date, endDate: date });

    expect(totals.netSales).toBe(firstSaleTotal);
    expect(totals.refunds).toBe(0);
    expect(totals.refundsCount).toBe(0);
    expect(totals.transactions).toBe(1);
    expect(totals.expenses).toBe(500);
    await checkpoint('at close of the selling day');
  });

  it('step 6: a second sale compounds correctly rather than resetting anything', async () => {
    const result = await createSaleTransaction({
      shopId: SHOP, staffId: OWNER, isStillActive: ALWAYS_LIVE,
      payment: { type: 'cash', tendered: GENEROUS_TENDER },
      lines: [{ medicineId, quantity: 2 }],
    });
    secondSaleTotal = result.total;

    const batch = sqlite
      .prepare('SELECT stock FROM batches WHERE id = ?')
      .get(batchId) as { stock: number };
    expect(batch.stock).toBe(15);

    const { getReportSnapshot } = await import('./reports');
    const date = businessDate();
    const { totals } = await getReportSnapshot(SHOP, OWNER, { startDate: date, endDate: date });
    expect(totals.netSales).toBe(firstSaleTotal + secondSaleTotal);
    expect(totals.transactions).toBe(2);
    await checkpoint('after the second sale');
  });

  it('step 7: a supplier invoice adds stock, and a PENDING line adds none until it arrives', async () => {
    // IC-11: a line marked pending is on the invoice but not yet in the shop.
    // Counting it as stock is the defect this step exists to catch — the ledger
    // would claim units nobody can sell.
    const supplier = await createSupplier(SHOP, OWNER, { name: 'Dhaka Distributors' }, ALWAYS_LIVE);
    supplierId = supplier.id;

    const purchase = await createPurchase({
      shopId: SHOP, supplierId, staffId: OWNER, isStillActive: ALWAYS_LIVE,
      paymentType: 'cod',
      lineItems: [
        { medicineId, batchNo: 'W311-ARRIVED', expiryDate: '2029-01-01',
          quantity: 10, purchasePrice: asPaisa(400), salePrice: asPaisa(900) },
        { medicineId, batchNo: 'W311-PENDING', expiryDate: '2029-01-01',
          quantity: 25, purchasePrice: asPaisa(400), salePrice: asPaisa(900), pending: true },
      ],
    });
    purchaseId = purchase.purchaseId;

    // The received line is stock; the pending line is not.
    purchaseBatchId = oneRow<{ id: string }>(
      'SELECT id FROM batches WHERE shop_id = ? AND batch_no = ?', SHOP, 'W311-ARRIVED',
    ).id;
    expect(stockOf(purchaseBatchId)).toBe(10);
    const pendingBatch = sqlite
      .prepare('SELECT id FROM batches WHERE shop_id = ? AND batch_no = ?')
      .get(SHOP, 'W311-PENDING') as { id: string } | undefined;
    expect(pendingBatch === undefined || stockOf(pendingBatch.id) === 0).toBe(true);
    // And the invoice total excludes what has not arrived.
    expect(purchase.total).toBe(10 * 400);
    await checkpoint('after the supplier invoice');
  });

  it('step 8: receiving the pending line is what finally moves that stock', async () => {
    const item = oneRow<{ id: string }>(
      'SELECT id FROM purchase_items WHERE purchase_id = ? AND batch_no = ?',
      purchaseId, 'W311-PENDING',
    );
    const result = await markPurchaseLineReceived({
      shopId: SHOP, actorUserId: OWNER, isStillActive: ALWAYS_LIVE,
      purchaseId, purchaseItemId: item.id,
    });

    expect(result.pendingCount).toBe(0);
    // Now it is real stock, and the invoice total has grown to match.
    const arrived = oneRow<{ id: string }>(
      'SELECT id FROM batches WHERE shop_id = ? AND batch_no = ?', SHOP, 'W311-PENDING',
    );
    expect(stockOf(arrived.id)).toBe(25);
    expect(result.total).toBe(10 * 400 + 25 * 400);
    await checkpoint('after receiving the pending line');
  });

  it('step 9: a credit sale books a balance instead of cash, and a payment clears it', async () => {
    const result = await createSaleTransaction({
      shopId: SHOP, staffId: OWNER, isStillActive: ALWAYS_LIVE,
      payment: { type: 'credit' }, customerId: CUSTOMER,
      lines: [{ medicineId, quantity: 1 }],
    });
    creditSaleTotal = result.total;
    expect(creditSaleTotal).toBeGreaterThan(0);

    // Credit, not cash: the drawer must not move for this sale.
    const sale = oneRow<{ cashApplied: number; creditAmount: number }>(
      'SELECT cash_applied AS cashApplied, credit_amount AS creditAmount FROM sales WHERE id = ?',
      result.saleId,
    );
    expect(sale.cashApplied).toBe(0);
    expect(sale.creditAmount).toBe(creditSaleTotal);
    // credits.balance is the canonical outstanding figure (db/customers.ts).
    const owed = oneRow<{ balance: number }>(
      'SELECT COALESCE(SUM(balance), 0) AS balance FROM credits WHERE shop_id = ? AND customer_id = ?',
      SHOP, CUSTOMER,
    );
    expect(owed.balance).toBe(creditSaleTotal);
    await checkpoint('after the credit sale');

    await collectPayment({
      shopId: SHOP, staffId: OWNER, isStillActive: ALWAYS_LIVE,
      customerId: CUSTOMER, amount: asPaisa(creditSaleTotal),
    });
    const settled = oneRow<{ balance: number }>(
      'SELECT COALESCE(SUM(balance), 0) AS balance FROM credits WHERE shop_id = ? AND customer_id = ?',
      SHOP, CUSTOMER,
    );
    expect(settled.balance).toBe(0);
    await checkpoint('after the credit collection');
  });

  it('step 10: a refund returns the stock and is SUBTRACTED from revenue, never added', async () => {
    // The W4-04 defect in miniature: a refund that lands in the ledger but not
    // in the revenue figure makes a shop look like it kept money it gave back.
    secondSaleId = oneRow<{ id: string }>(
      'SELECT id FROM sales WHERE shop_id = ? AND is_deleted = 0 AND credit_amount = 0'
      + ' ORDER BY created_at DESC, rowid DESC LIMIT 1', SHOP,
    ).id;
    const before = stockOf(batchId);
    const grossBefore = oneRow<{ total: number }>(
      'SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE shop_id = ? AND is_deleted = 0', SHOP,
    ).total;

    const eligibility = await getRefundEligibility(SHOP, OWNER, secondSaleId);
    const result = await createFullSaleRefund({
      shopId: SHOP, actorUserId: OWNER, saleId: secondSaleId, reason: 'damaged',
      claim: {
        claimId: 'w311-claim', claimToken: 'w311-token',
        operationId: eligibility.operationId, deviceId: DEVICE,
      },
      currentDeviceId: DEVICE, isStillActive: ALWAYS_LIVE,
    });
    refundTotal = result.total;
    expect(refundTotal, 'a zero refund would make the next assertions vacuous').toBeGreaterThan(0);

    // Stock comes back through a movement, so the ledger still reconciles.
    expect(stockOf(batchId)).toBeGreaterThan(before);
    // Gross is unchanged by a refund; net is reduced by it. Both are checked,
    // because a report that quietly reduced GROSS would pass a net-only test.
    const grossAfter = oneRow<{ total: number }>(
      'SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE shop_id = ? AND is_deleted = 0', SHOP,
    ).total;
    expect(grossAfter).toBe(grossBefore);
    const { getReportSnapshot } = await import('./reports');
    const date = businessDate();
    const { totals } = await getReportSnapshot(SHOP, OWNER, { startDate: date, endDate: date });
    expect(totals.refunds).toBe(refundTotal);
    expect(totals.refundsCount).toBe(1);
    expect(totals.netSales).toBe(grossAfter - refundTotal);
    await checkpoint('after the refund');
  });

  it('step 11: a purchase return takes the stock back out, through the ledger', async () => {
    const item = oneRow<{ id: string }>(
      'SELECT id FROM purchase_items WHERE purchase_id = ? AND batch_no = ?',
      purchaseId, 'W311-ARRIVED',
    );
    const before = stockOf(purchaseBatchId);

    const result = await createPurchaseReturn({
      shopId: SHOP, actorUserId: OWNER, isStillActive: ALWAYS_LIVE,
      purchaseId, purchaseItemId: item.id, qty: 4, reason: 'expired_on_arrival',
    });

    expect(stockOf(purchaseBatchId)).toBe(before - 4);
    expect(result.creditAmount).toBe(4 * 400);
    await checkpoint('after the purchase return');
  });

  it('step 12: closing the day reconciles the drawer against the system expectation', async () => {
    // Closing is LAST on purpose: the closed-day guard rejects later writes, so
    // a step added after this one would fail for the wrong reason.
    const date = businessDate();
    const summary = await getCashSummary(SHOP, OWNER, date);

    // The drawer identity, asserted against the system's OWN figures rather
    // than a formula re-derived here (CLAUDE.md rule 4: never re-derive cash).
    const cashFromSales = oneRow<{ total: number }>(
      'SELECT COALESCE(SUM(cash_applied), 0) AS total FROM sales'
      + ' WHERE shop_id = ? AND is_deleted = 0 AND business_date = ?', SHOP, date,
    ).total;
    expect(summary.cashSales).toBe(cashFromSales);
    expect(summary.openingCash).toBe(0);
    expect(summary.creditCollections).toBe(creditSaleTotal);
    expect(summary.expenses).toBe(500);
    expect(summary.refunds).toBe(refundTotal);
    for (const [name, value] of Object.entries(summary)) {
      if (typeof value === 'number') {
        expect(Number.isInteger(value), 'cash summary must be integer paisa: ' + name).toBe(true);
      }
    }

    await closeDay({
      shopId: SHOP, isStillActive: ALWAYS_LIVE, businessDate: date,
      countedCash: asPaisa(cashFromSales), closedBy: OWNER,
    });

    const drawer = oneRow<{ counted: number; expected: number; closedBy: string }>(
      'SELECT closing_counted AS counted, closing_expected AS expected, closed_by AS closedBy'
      + ' FROM cash_drawer WHERE shop_id = ? AND business_date = ?', SHOP, date,
    );
    expect(drawer.counted).toBe(cashFromSales);
    expect(Number.isInteger(drawer.expected)).toBe(true);
    // Drawer identity: whoever closed it is recorded, so a variance has an owner.
    expect(drawer.closedBy).toBe(OWNER);
    await checkpoint('after closing the day');
  });

});

describe('the ledger invariant cannot be bypassed', () => {
  it('refuses a direct stock assignment — the guard the whole day relies on', () => {
    expect(() =>
      sqlite.prepare('UPDATE batches SET stock = 999 WHERE id = ?').run(batchId),
    ).toThrow();
    expectLedgerInvariant('after a refused direct write');
  });

  it('refuses deleting a movement, so stock history cannot be rewritten', () => {
    expect(() =>
      sqlite.prepare('DELETE FROM inventory_movements WHERE batch_id = ?').run(batchId),
    ).toThrow();
    expectLedgerInvariant('after a refused movement delete');
  });
});

describe('offline behaviour', () => {
  it('queues every workflow as COMPLETE operation groups', () => {
    const pending = listPendingSyncRows(SHOP, 10_000);
    expect(pending.length).toBeGreaterThan(0);

    // Every grouped row must belong to a group whose members are all present
    // and correctly sequenced — a reconnect that applied half a sale would
    // break both the ledger and the money.
    const groups = new Map<string, typeof pending>();
    for (const row of pending) {
      if (!row.operationGroupId) continue;
      const existing = groups.get(row.operationGroupId) ?? [];
      existing.push(row);
      groups.set(row.operationGroupId, existing);
    }
    expect(groups.size).toBeGreaterThan(0);

    for (const [groupId, rows] of groups) {
      const expected = rows[0]!.operationExpectedCount;
      expect(expected, `group ${groupId} declares no expected count`).toBeTruthy();
      expect(rows.length, `group ${groupId} is incomplete`).toBe(expected);
      const sequences = rows
        .map((row) => row.operationSequence)
        .sort((left, right) => (left ?? -1) - (right ?? -1));
      expect(sequences).toEqual(rows.map((_, index) => index));
      // One kind per group: a mixed group is a torn operation.
      expect(new Set(rows.map((row) => row.operationKind)).size).toBe(1);
    }
  });

  it('holds the whole day in the outbox with the books already balanced locally', async () => {
    // Nothing has synced — this is the offline shop at close of business, and
    // its books must already balance on the device alone (CLAUDE.md rule 1).
    await checkpoint('offline, nothing pushed');
    expect(listPendingSyncRows(SHOP, 10_000).every((row) => row.shopId === SHOP)).toBe(true);
  });
});

describe('the outbox bookkeeping around a retry', () => {
  // The queue STATE MACHINE only. These call the bookkeeping helpers directly,
  // so they prove what the outbox records about a retry — not that anything was
  // delivered. "Applied exactly once" is a claim about the server, and it is
  // proven by driving the real push loop in db/push-replay.sqlite.test.ts.
  // Conflating the two was a finding in the Gate 5 delta review.
  it('records a transient failure as still-queued, and a send as retired once', () => {
    const before = listPendingSyncRows(SHOP, 10_000);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0]!;

    markSyncRowTransientFailure(target.id, 'network unreachable');

    const afterFailure = listPendingSyncRows(SHOP, 10_000);
    const retried = afterFailure.find((row) => row.id === target.id);
    expect(retried, 'a transient failure must stay queued for retry').toBeDefined();
    expect(retried!.attempts).toBe(target.attempts + 1);
    // Transient is not permanent: nothing has been given up on.
    expect(countFailedSyncRows(SHOP)).toBe(0);
    // And the queue did not grow — a retry is the SAME row, not a new one.
    expect(afterFailure.length).toBe(before.length);

    markSyncRowSent(target.id);

    const afterSuccess = listPendingSyncRows(SHOP, 10_000);
    expect(afterSuccess.some((row) => row.id === target.id)).toBe(false);
    expect(afterSuccess.length).toBe(before.length - 1);
    // Replaying the success is idempotent: it cannot resurrect or re-queue.
    markSyncRowSent(target.id);
    expect(listPendingSyncRows(SHOP, 10_000).length).toBe(before.length - 1);
    expect(countFailedSyncRows(SHOP)).toBe(0);
  });

  it('retrying past the limit is what finally marks a row failed, not a single error', () => {
    const queued = listPendingSyncRows(SHOP, 10_000);
    expect(queued.length).toBeGreaterThan(0);
    const target = queued[0]!;

    // maxAttempts is a parameter so this does not depend on the default.
    markSyncRowTransientFailure(target.id, 'still unreachable', target.attempts + 1);

    expect(listPendingSyncRows(SHOP, 10_000).some((row) => row.id === target.id)).toBe(false);
    expect(countFailedSyncRows(SHOP)).toBe(1);
  });
});
