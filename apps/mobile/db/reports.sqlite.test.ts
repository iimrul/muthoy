import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { eq } from 'drizzle-orm';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const schema = await import('./schema');
const { getEndOfDayReportSnapshot, getMonthlyReport, getReportRefundRows, getReportSaleRows, getReportSnapshot } = await import('./reports');
const { applyRemoteRow, toSnakeCasePayload } = await import('./sync-helpers');

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
    // H-7: users.access_locked_at, the device-local revocation marker.
    '0027_h7_local_access_lock.sql',
    '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql'
];

const now = '2026-01-05T20:00:00.000Z'; // Jan 6 in Dhaka.

beforeAll(() => {
  for (const migration of migrations) applyMigration(migration);
  db.insert(schema.shops).values({ id: 'shop', ownerId: 'owner', name: 'Reports', phone: '01700000001', createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'owner-role', shopId: 'shop', name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'staff-role', shopId: 'shop', name: 'staff', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'owner', shopId: 'shop', name: 'Owner', pinHash: 'hash', pinSetAt: now, roleId: 'owner-role', createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'staff', shopId: 'shop', name: 'Staff', pinHash: 'hash', pinSetAt: now, roleId: 'staff-role', createdAt: now, updatedAt: now }).run();
  db.insert(schema.medicines).values({ id: 'med', shopId: 'shop', name: 'Napa', createdAt: now, updatedAt: now }).run();
  db.insert(schema.batches).values({ id: 'batch', shopId: 'shop', medicineId: 'med', batchNo: 'B1', purchasePrice: asPaisa(6_000), salePrice: asPaisa(11_000), createdAt: now, updatedAt: now }).run();

  db.insert(schema.sales).values({
    id: 'sale-1', shopId: 'shop', invoiceNo: 'INV-1', businessDate: '2026-01-05', subtotal: asPaisa(11_000),
    total: asPaisa(11_000), paid: asPaisa(11_000), paymentType: 'cash', cashApplied: asPaisa(11_000),
    taxAmount: asPaisa(1_000), taxRateBp: 1_000, taxLabel: 'VAT', staffId: 'owner', createdAt: '2026-01-05T12:00:00.000Z', updatedAt: now,
  }).run();
  db.insert(schema.saleItems).values({
    id: 'item-1', shopId: 'shop', saleId: 'sale-1', medicineId: 'med', batchId: 'batch', qty: 1,
    unitPrice: asPaisa(11_000), lineTotal: asPaisa(11_000), cogs: asPaisa(6_000), medicineNameSnapshot: 'Napa', createdAt: now, updatedAt: now,
  }).run();

  db.insert(schema.sales).values({
    id: 'sale-2', shopId: 'shop', invoiceNo: 'INV-2', businessDate: '2026-01-06', subtotal: asPaisa(23_000),
    discountType: 'amount', discountValue: 1_000, discountAmount: asPaisa(1_000), total: asPaisa(22_000),
    paid: asPaisa(17_000), paymentType: 'split', cashApplied: asPaisa(17_000), creditAmount: asPaisa(5_000),
    taxAmount: asPaisa(2_000), taxRateBp: 1_000, taxLabel: 'VAT', staffId: 'owner', createdAt: '2026-01-06T12:00:00.000Z', updatedAt: now,
  }).run();
  db.insert(schema.saleItems).values({
    id: 'item-2', shopId: 'shop', saleId: 'sale-2', medicineId: 'med', batchId: 'batch', qty: 2,
    unitPrice: asPaisa(11_500), discountType: 'flat', discountValue: 1_000, discountAmount: asPaisa(1_000),
    lineTotal: asPaisa(22_000), cogs: asPaisa(12_000), medicineNameSnapshot: 'Napa', createdAt: now, updatedAt: now,
  }).run();

  db.insert(schema.saleRefunds).values({
    id: 'refund-1', shopId: 'shop', saleId: 'sale-1', claimId: 'claim', claimToken: 'token', reason: 'Returned',
    totalAmount: asPaisa(11_000), businessDate: '2026-01-06', createdBy: 'owner', createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.salesReturns).values({
    id: 'return-1', shopId: 'shop', saleId: 'sale-1', saleItemId: 'item-1', refundId: 'refund-1', qty: 1,
    reason: 'Returned', refundAmount: asPaisa(11_000), refundMethod: 'cash', createdBy: 'owner', createdAt: now, updatedAt: now,
  }).run();
  db.insert(schema.expenses).values({
    id: 'expense-1', shopId: 'shop', category: 'rent', amount: asPaisa(1_000), description: 'Rent', createdBy: 'owner', createdAt: now, updatedAt: now,
  }).run();
});

describe('canonical report read model', () => {
  it('calculates refund-, tax-, expense-, and real-COGS-aware totals in paisa', async () => {
    const report = await getReportSnapshot('shop', 'owner', { startDate: '2026-01-05', endDate: '2026-01-06' });
    expect(report.totals).toMatchObject({
      grossSales: 34_000, discounts: 1_000, refunds: 11_000, netSales: 22_000,
      taxCollected: 2_000, netRevenue: 20_000, cogs: 12_000, grossProfit: 8_000,
      expenses: 1_000, netProfit: 7_000, cashSales: 17_000, creditSales: 5_000,
      transactions: 2, refundsCount: 1, averageSale: 11_000, isCogsPartial: false,
    });
    expect(report.topMedicines).toEqual([{ medicineId: 'med', name: 'Napa', qty: 2, sales: 22_000 }]);
    expect(report.trend).toEqual([
      { date: '2026-01-05', sales: 11_000, transactions: 1 },
      { date: '2026-01-06', sales: 11_000, transactions: 1 },
    ]);
    expect(report.expensesByCategory[0]).toMatchObject({ category: 'rent', amount: 1_000 });
  });

  it('uses the same canonical arithmetic for EOD and monthly P&L', async () => {
    const range = { startDate: '2026-01-06', endDate: '2026-01-06' };
    const report = await getReportSnapshot('shop', 'owner', range);
    const eod = await getEndOfDayReportSnapshot('shop', 'owner', range);
    expect(eod.totals).toEqual(report.totals);
    const monthly = await getMonthlyReport('shop', 'owner', '2026-01');
    expect(monthly.totals.netProfit).toBe(7_000);
    expect(monthly.sixMonthTrend).toHaveLength(6);
  });

  it('keeps sale tax snapshots immutable from later shop setting changes', () => {
    sqlite.prepare("UPDATE shop_b2_settings SET tax_rate_bp=500, tax_label='GST' WHERE shop_id='shop'").run();
    expect(sqlite.prepare("SELECT tax_amount,tax_rate_bp,tax_label,total FROM sales WHERE id='sale-1'").get()).toMatchObject({
      tax_amount: 1_000, tax_rate_bp: 1_000, tax_label: 'VAT', total: 11_000,
    });
    const oldClientPayload = toSnakeCasePayload(db.select().from(schema.sales).where(eq(schema.sales.id,'sale-1')).get() as Record<string,unknown>);
    delete oldClientPayload.tax_amount; delete oldClientPayload.tax_rate_bp; delete oldClientPayload.tax_label;
    oldClientPayload.invoice_no='INV-1-OLD-CLIENT'; oldClientPayload.updated_at='2026-01-06T21:00:00.000Z';
    expect(applyRemoteRow('sales',oldClientPayload)).toBe('applied');
    expect(sqlite.prepare("SELECT invoice_no,tax_amount,tax_rate_bp,tax_label,total FROM sales WHERE id='sale-1'").get()).toMatchObject({
      invoice_no:'INV-1-OLD-CLIENT',tax_amount:1_000,tax_rate_bp:1_000,tax_label:'VAT',total:11_000,
    });
    expect(() => sqlite.prepare("UPDATE sales SET tax_amount=999 WHERE id='sale-1'").run()).toThrow(/sale tax snapshot is immutable/);
    expect(() => sqlite.prepare("UPDATE sales SET tax_amount=524,tax_rate_bp=500,tax_label='GST' WHERE id='sale-1'").run())
      .toThrow(/sale tax snapshot is immutable/);
  });

  it('enforces report permissions at the data layer', async () => {
    await expect(getReportSnapshot('shop', 'staff', { startDate: '2026-01-05', endDate: '2026-01-06' })).rejects.toThrow();
  });

  it('uses indexed date-range reads', () => {
    const plans = [
      sqlite.prepare("EXPLAIN QUERY PLAN SELECT total FROM sales WHERE shop_id=? AND is_deleted=0 AND business_date BETWEEN ? AND ?").all('shop', '2026-01-01', '2026-01-31'),
      sqlite.prepare("EXPLAIN QUERY PLAN SELECT total_amount FROM sale_refunds WHERE shop_id=? AND is_deleted=0 AND business_date BETWEEN ? AND ?").all('shop', '2026-01-01', '2026-01-31'),
      sqlite.prepare("EXPLAIN QUERY PLAN SELECT amount FROM expenses WHERE shop_id=? AND is_deleted=0 AND created_at>=? AND created_at<?").all('shop', '2025-12-31T18:00:00.000Z', '2026-01-31T18:00:00.000Z'),
    ].flat().map((row) => String((row as { detail: string }).detail)).join('\n');
    expect(plans).toContain('sales_shop_business_date_idx');
    expect(plans).toContain('sale_refunds_shop_business_date_idx');
    expect(plans).toContain('expenses_shop_created_idx');
  });

  it('keeps refund-only and expense-only months financially visible', async () => {
    db.insert(schema.sales).values({
      id:'sale-3',shopId:'shop',invoiceNo:'INV-3',businessDate:'2026-01-31',subtotal:asPaisa(11_000),total:asPaisa(11_000),
      paid:asPaisa(11_000),paymentType:'cash',cashApplied:asPaisa(11_000),taxAmount:asPaisa(1_000),taxRateBp:1_000,
      taxLabel:'GST',staffId:'owner',createdAt:'2026-01-31T12:00:00.000Z',updatedAt:now,
    }).run();
    db.insert(schema.saleItems).values({
      id:'item-3',shopId:'shop',saleId:'sale-3',medicineId:'med',batchId:'batch',qty:1,unitPrice:asPaisa(11_000),
      lineTotal:asPaisa(11_000),cogs:asPaisa(6_000),medicineNameSnapshot:'Napa',createdAt:now,updatedAt:now,
    }).run();
    db.insert(schema.saleRefunds).values({
      id:'refund-3',shopId:'shop',saleId:'sale-3',claimId:'claim-3',claimToken:'token-3',reason:'Returned',
      totalAmount:asPaisa(11_000),businessDate:'2026-02-02',createdBy:'owner',createdAt:'2026-02-01T20:00:00.000Z',updatedAt:now,
    }).run();
    db.insert(schema.salesReturns).values({
      id:'return-3',shopId:'shop',saleId:'sale-3',saleItemId:'item-3',refundId:'refund-3',qty:1,reason:'Returned',
      refundAmount:asPaisa(11_000),refundMethod:'cash',createdBy:'owner',createdAt:now,updatedAt:now,
    }).run();
    db.insert(schema.expenses).values({
      id:'expense-2',shopId:'shop',category:'utilities',amount:asPaisa(1_000),description:'Power',createdBy:'owner',
      createdAt:'2026-02-03T06:00:00.000Z',updatedAt:now,
    }).run();

    const monthly = await getMonthlyReport('shop','owner','2026-02');
    expect(monthly.totals).toMatchObject({ transactions:0,refundsCount:1,refunds:11_000,netSales:-11_000,
      taxCollected:-1_000,netRevenue:-10_000,cogs:-6_000,grossProfit:-4_000,expenses:1_000,netProfit:-5_000 });
    const refunds = await getReportRefundRows('shop','owner',{ startDate:'2026-02-01',endDate:'2026-02-28' });
    expect(refunds[0]).toMatchObject({ tax:1_000,taxRateBp:1_000,taxLabel:'GST' });
    const sales = await getReportSaleRows('shop','owner',{ startDate:'2026-01-31',endDate:'2026-01-31' });
    expect(sales[0]).toMatchObject({ tax:1_000,taxRateBp:1_000,taxLabel:'GST' });
  });
});
