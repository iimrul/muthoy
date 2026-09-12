import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { sqlite } from './test/expo-sqlite';

// The RECEIVING half of two-device convergence, on real SQLite through the real
// apply path.
//
// Device A rings up a sale; device B pulls it. The stock effect of that is
// already covered by inventory-ledger.sqlite.test.ts. What was NOT covered is
// the sale RECORD: whether B's own read models — sale history, EOD and monthly
// reports, the cash drawer, a customer's credit balance — agree with what A
// actually sold. Those read models are what the shop owner looks at, so a sale
// that hydrates into the tables but not into the totals is invisible to the
// tests and obvious to the user.
//
// Nothing here is a placeholder row. Every row is the full graph the server
// sends, applied through applyRemoteRows, and every figure is read back through
// the production function the screen calls.

const { db } = await import('./client');
const schema = await import('./schema');
const { applyRemoteRows } = await import('./sync-helpers');
const { getEndOfDayReportSnapshot, getMonthlyReport, getReportSnapshot } = await import('./reports');
const { getSaleDetail, listSalesHistory } = await import('./saleHistory');
const { getCashSummarySync } = await import('./cash');
const { getCustomerBalanceSync } = await import('./customers');

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

const migrations = [
  '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
  '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
  '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql', '0008_native_pin_lookup.sql',
  '0009_strong_gargoyle.sql', '0010_known_ares.sql', '0011_black_zarda.sql',
  '0012_small_meltdown.sql', '0013_owner_dashboard_credit_period.sql',
  '0014_owner_dashboard_credit_period_guard.sql', '0015_b3_shop_settings.sql',
  '0016_payment_note.sql', '0017_cash_reconcile.sql', '0018_expense_category_taxonomy.sql',
  '0019_supplier_archive.sql', '0020_purchase_item_status.sql', '0021_purchase_void.sql',
  '0022_supplier_profile_fields.sql', '0023_purchase_invoice_metadata.sql',
  '0024_b3_report_indexes.sql', '0025_b3_sale_tax_snapshot.sql',
  '0027_h7_local_access_lock.sql',
  '0028_shop_scoped_pin_lookup.sql',
  '0029_pin_reserved_while_inactive.sql',
];

const SHOP = 'shop-b';
const OWNER = 'owner-b';
const CASHIER = 'cashier-a';
const MEDICINE = 'med-1';
const MEDICINE_2 = 'med-2';
const BATCH = 'batch-1';
const BATCH_2 = 'batch-2';
const CUSTOMER = 'cust-1';

const SETUP_AT = '2026-01-05T20:00:00.000Z';
/** 12:00Z on Jan 6 is 18:00 in Dhaka — still Jan 6, well inside the day. */
const SOLD_AT = '2026-01-06T12:00:00.000Z';
const BUSINESS_DATE = '2026-01-06';
const RANGE = { startDate: BUSINESS_DATE, endDate: BUSINESS_DATE };

/** A row exactly as the server sends it: snake_case, every column present. */
function remote(extra: Record<string, unknown>): Record<string, unknown> {
  return { created_at: SOLD_AT, updated_at: SOLD_AT, is_deleted: false, ...extra };
}

// Device A's work, as one pull page. Sale 1 is plain cash. Sale 2 is a split
// tender against a customer A created during the sale, so the page carries a
// parent (customers) that arrives AFTER its child (credits) on the wire.
// Tax is INCLUSIVE here, and exact: `sale_payment_validate_insert` requires
// total = subtotal - discount_amount with cash_applied + credit_amount = total,
// and `sales_tax_snapshot_insert_guard` recomputes tax_amount from total and
// tax_rate_bp. A hydrated sale has to satisfy both or the row is refused.
const SALE_1 = remote({
  id: 'sale-a1', shop_id: SHOP, invoice_no: 'INV-A1', business_date: BUSINESS_DATE,
  subtotal: 20_000, discount_amount: 0, total: 20_000, paid: 20_000, change: 0,
  payment_type: 'cash', cash_applied: 20_000, credit_amount: 0,
  tax_amount: 1_818, tax_rate_bp: 1_000, tax_label: 'VAT', staff_id: CASHIER,
});
const SALE_2 = remote({
  id: 'sale-a2', shop_id: SHOP, invoice_no: 'INV-A2', business_date: BUSINESS_DATE,
  subtotal: 15_000, discount_type: 'amount', discount_value: 1_000, discount_amount: 1_000,
  total: 14_000, paid: 8_000, change: 0,
  payment_type: 'split', cash_applied: 8_000, credit_amount: 6_000,
  tax_amount: 1_273, tax_rate_bp: 1_000, tax_label: 'VAT', staff_id: CASHIER,
  customer_id: CUSTOMER,
});
const ITEM_1A = remote({
  id: 'item-a1a', shop_id: SHOP, sale_id: 'sale-a1', medicine_id: MEDICINE, batch_id: BATCH,
  qty: 1, unit_price: 12_000, discount_amount: 0, line_total: 12_000, cogs: 7_000,
  medicine_name_snapshot: 'Napa',
});
const ITEM_1B = remote({
  id: 'item-a1b', shop_id: SHOP, sale_id: 'sale-a1', medicine_id: MEDICINE_2, batch_id: BATCH_2,
  qty: 2, unit_price: 4_000, discount_amount: 0, line_total: 8_000, cogs: 5_000,
  medicine_name_snapshot: 'Seclo',
});
const ITEM_2A = remote({
  id: 'item-a2a', shop_id: SHOP, sale_id: 'sale-a2', medicine_id: MEDICINE, batch_id: BATCH,
  qty: 1, unit_price: 15_000, discount_amount: 0, line_total: 15_000, cogs: 9_000,
  medicine_name_snapshot: 'Napa',
});
const CUSTOMER_ROW = remote({ id: CUSTOMER, shop_id: SHOP, name: 'Karim Mia', phone: '01811111111' });
const CREDIT_SALE = remote({
  id: 'credit-a2', shop_id: SHOP, customer_id: CUSTOMER, sale_id: 'sale-a2',
  amount: 6_000, balance: 6_000,
});
/** An older standalone credit, partly collected by the payment below. */
const CREDIT_OLD = remote({
  id: 'credit-old', shop_id: SHOP, customer_id: CUSTOMER, sale_id: null,
  amount: 5_000, balance: 3_000,
});
const COLLECTION = remote({
  id: 'pay-a1', shop_id: SHOP, type: 'customer_payment', party_id: CUSTOMER,
  amount: 2_000, method: 'cash', created_by: CASHIER,
});

/**
 * Deliberately hostile wire order: every child before its parent, and the two
 * sales last. The server pages `order by updated_at, table_name, row_id`, and
 * these rows share one timestamp, so "sale_items" genuinely does sort ahead of
 * "sales" — this is the real order, not a contrived one.
 */
const PAGE = [
  { tableName: 'sale_items' as const, row: ITEM_2A },
  { tableName: 'credits' as const, row: CREDIT_SALE },
  { tableName: 'payments' as const, row: COLLECTION },
  { tableName: 'sale_items' as const, row: ITEM_1A },
  { tableName: 'credits' as const, row: CREDIT_OLD },
  { tableName: 'sale_items' as const, row: ITEM_1B },
  { tableName: 'customers' as const, row: CUSTOMER_ROW },
  { tableName: 'sales' as const, row: SALE_1 },
  { tableName: 'sales' as const, row: SALE_2 },
];

function rowCount(table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).all() as { n: number }[])[0]!.n;
}

beforeAll(() => {
  for (const migration of migrations) applyMigration(migration);
});

beforeEach(() => {
  sqlite.exec('PRAGMA foreign_keys=OFF');
  for (const table of [
    'payments', 'credits', 'sale_items', 'sales', 'customers',
    'batches', 'medicines', 'users', 'roles', 'shops', 'sync_queue',
  ]) sqlite.exec(`DELETE FROM ${table}`);
  sqlite.exec('PRAGMA foreign_keys=ON');

  // Device B as it stands BEFORE the pull: the shop, its staff, and the stock
  // it already knows about. Everything the sale itself introduces arrives with
  // the page.
  db.insert(schema.shops).values({ id: SHOP, ownerId: OWNER, name: 'Receiving Shop', phone: '01700000001', createdAt: SETUP_AT, updatedAt: SETUP_AT }).run();
  db.insert(schema.roles).values([
    { id: 'role-owner', shopId: SHOP, name: 'owner', isSystem: true, createdAt: SETUP_AT, updatedAt: SETUP_AT },
    { id: 'role-staff', shopId: SHOP, name: 'staff', isSystem: true, createdAt: SETUP_AT, updatedAt: SETUP_AT },
  ]).run();
  db.insert(schema.users).values([
    { id: OWNER, shopId: SHOP, name: 'Owner', pinHash: 'hash-owner', pinSetAt: SETUP_AT, roleId: 'role-owner', createdAt: SETUP_AT, updatedAt: SETUP_AT },
    { id: CASHIER, shopId: SHOP, name: 'Rahim', pinHash: 'hash-cashier', pinSetAt: SETUP_AT, roleId: 'role-staff', createdAt: SETUP_AT, updatedAt: SETUP_AT },
  ]).run();
  db.insert(schema.medicines).values([
    { id: MEDICINE, shopId: SHOP, name: 'Napa', createdAt: SETUP_AT, updatedAt: SETUP_AT },
    { id: MEDICINE_2, shopId: SHOP, name: 'Seclo', createdAt: SETUP_AT, updatedAt: SETUP_AT },
  ]).run();
  db.insert(schema.batches).values([
    { id: BATCH, shopId: SHOP, medicineId: MEDICINE, batchNo: 'B1', purchasePrice: asPaisa(7_000), salePrice: asPaisa(12_000), createdAt: SETUP_AT, updatedAt: SETUP_AT },
    { id: BATCH_2, shopId: SHOP, medicineId: MEDICINE_2, batchNo: 'B2', purchasePrice: asPaisa(2_500), salePrice: asPaisa(4_000), createdAt: SETUP_AT, updatedAt: SETUP_AT },
  ]).run();
});

describe('the receiving device hydrates a whole sale graph', () => {
  it('applies every row despite children arriving before their parents', () => {
    // FK/dependency ordering. applyRemoteRows re-ranks by HYDRATION_TABLE_ORDER
    // before touching the database, so the wire order cannot matter. Without
    // that, `sale_items` ahead of `sales` is a foreign-key failure.
    const results = applyRemoteRows(PAGE);

    expect(results).toEqual(Array(PAGE.length).fill('applied'));
    expect(rowCount('sales')).toBe(2);
    expect(rowCount('sale_items')).toBe(3);
    expect(rowCount('credits')).toBe(2);
    expect(rowCount('payments')).toBe(1);
    expect(rowCount('customers')).toBe(1);
  });

  it('shows both sales in the history read model, attributed to A cashier', async () => {
    applyRemoteRows(PAGE);

    const history = await listSalesHistory(SHOP, OWNER, {});
    expect(history.map((row) => row.invoiceNo).sort()).toEqual(['INV-A1', 'INV-A2']);
    expect(history.find((row) => row.invoiceNo === 'INV-A1')).toMatchObject({
      total: 20_000, paymentType: 'cash', sellerName: 'Rahim', businessDate: BUSINESS_DATE,
    });
    expect(history.find((row) => row.invoiceNo === 'INV-A2')).toMatchObject({
      total: 14_000, discountAmount: 1_000, paymentType: 'split',
      sellerName: 'Rahim', customerName: 'Karim Mia',
    });
  });

  it('reconstructs the full line detail of a sale it never rang up', async () => {
    applyRemoteRows(PAGE);

    const detail = await getSaleDetail(SHOP, OWNER, 'sale-a1');
    expect(detail).toBeTruthy();
    expect(detail!.items).toHaveLength(2);
    expect(detail!.items.map((item) => ({ name: item.medicineName, qty: item.quantity, lineTotal: item.lineTotal })))
      .toEqual(expect.arrayContaining([
        { name: 'Napa', qty: 1, lineTotal: 12_000 },
        { name: 'Seclo', qty: 2, lineTotal: 8_000 },
      ]));
  });

  it('reaches the same EOD and monthly totals the selling device would report', async () => {
    applyRemoteRows(PAGE);

    // gross 35,000 · discounts 1,000 · net 34,000 · tax 3,091 (inclusive)
    // revenue 30,909 · cogs 21,000 · gross profit 9,909 · no expenses
    const expected = {
      grossSales: 35_000, discounts: 1_000, netSales: 34_000, taxCollected: 3_091,
      netRevenue: 30_909, cogs: 21_000, grossProfit: 9_909, expenses: 0, netProfit: 9_909,
      cashSales: 28_000, creditSales: 6_000, transactions: 2, refunds: 0, refundsCount: 0,
    };

    const report = await getReportSnapshot(SHOP, OWNER, RANGE);
    expect(report.totals).toMatchObject(expected);
    // COGS came across with the items; a partial flag here would mean the
    // hydrated lines lost their cost and every profit figure is fiction.
    expect(report.totals.isCogsPartial).toBe(false);

    const eod = await getEndOfDayReportSnapshot(SHOP, OWNER, RANGE);
    expect(eod.totals).toEqual(report.totals);

    const monthly = await getMonthlyReport(SHOP, OWNER, '2026-01');
    expect(monthly.totals).toMatchObject(expected);
  });

  it('puts the remote cash and the remote collection into the drawer', () => {
    applyRemoteRows(PAGE);

    // Volume 3's formula is fixed; this asserts its INPUTS, which is what
    // hydration can get wrong. 20,000 + 8,000 cash tendered, 2,000 collected.
    expect(getCashSummarySync(SHOP, BUSINESS_DATE)).toEqual({
      openingCash: 0, cashSales: 28_000, creditCollections: 2_000,
      expenses: 0, refunds: 0, supplierPayments: 0, withdrawals: 0,
    });
  });

  it('carries the customer outstanding credit across', () => {
    applyRemoteRows(PAGE);

    // 6,000 from this sale plus 3,000 still open on the older credit.
    expect(getCustomerBalanceSync(SHOP, CUSTOMER)).toBe(9_000);
  });

  it('keeps the tax snapshot the selling device stamped', () => {
    applyRemoteRows(PAGE);

    expect(sqlite.prepare("SELECT tax_amount,tax_rate_bp,tax_label FROM sales WHERE id='sale-a2'").get())
      .toMatchObject({ tax_amount: 1_273, tax_rate_bp: 1_000, tax_label: 'VAT' });
  });
});

describe('the same page delivered again changes nothing', () => {
  it('skips every row as stale and leaves the totals identical', async () => {
    applyRemoteRows(PAGE);
    const before = (await getReportSnapshot(SHOP, OWNER, RANGE)).totals;

    const replay = applyRemoteRows(PAGE);
    const second = applyRemoteRows(PAGE);

    expect(replay).toEqual(Array(PAGE.length).fill('skipped_stale'));
    expect(second).toEqual(Array(PAGE.length).fill('skipped_stale'));
    expect(rowCount('sales')).toBe(2);
    expect(rowCount('sale_items')).toBe(3);
    expect(rowCount('credits')).toBe(2);
    expect(rowCount('payments')).toBe(1);
    expect((await getReportSnapshot(SHOP, OWNER, RANGE)).totals).toEqual(before);
    expect(getCashSummarySync(SHOP, BUSINESS_DATE).cashSales).toBe(28_000);
    expect(getCustomerBalanceSync(SHOP, CUSTOMER)).toBe(9_000);
  });

  it('does not double-count when the server re-sends with a NEWER timestamp', async () => {
    applyRemoteRows(PAGE);
    const before = (await getReportSnapshot(SHOP, OWNER, RANGE)).totals;

    // A genuine later edit, not a replay: LWW must overwrite the row in place
    // rather than add a second one.
    const touched = PAGE.map(({ tableName, row }) => ({
      tableName, row: { ...row, updated_at: '2026-01-06T13:00:00.000Z' },
    }));
    expect(applyRemoteRows(touched)).toEqual(Array(PAGE.length).fill('applied'));

    expect(rowCount('sales')).toBe(2);
    expect(rowCount('sale_items')).toBe(3);
    expect(rowCount('credits')).toBe(2);
    expect((await getReportSnapshot(SHOP, OWNER, RANGE)).totals).toEqual(before);
    expect(getCashSummarySync(SHOP, BUSINESS_DATE).cashSales).toBe(28_000);
  });
});

describe('a page boundary that splits the sale from its lines', () => {
  it('commits nothing rather than a line without its sale', () => {
    // The hazard is real, not hypothetical: the server pages
    // `order by updated_at, table_name, row_id`, and a sale and its items are
    // written in one transaction with the same timestamp — where "sale_items"
    // sorts BEFORE "sales". So the split lands the children first.
    //
    // inventory_movements and user_permissions defer in this situation.
    // sale_items has no such path, so the chunk fails and rolls back.
    // Fail-closed either way: what must never happen is a half-committed sale.
    expect(() => applyRemoteRows([{ tableName: 'sale_items', row: ITEM_1A }], { moreToCome: true }))
      .toThrow();

    expect(rowCount('sale_items')).toBe(0);
    expect(rowCount('sales')).toBe(0);
  });

  it('lands the complete graph once the page carrying the sale arrives', async () => {
    // The recovery path: the cursor is not advanced past a failed chunk, so the
    // same rows come back — this time alongside their parent.
    expect(applyRemoteRows(PAGE)).toEqual(Array(PAGE.length).fill('applied'));
    expect((await getReportSnapshot(SHOP, OWNER, RANGE)).totals).toMatchObject({
      netSales: 34_000, netProfit: 9_909, transactions: 2,
    });
  });
});
