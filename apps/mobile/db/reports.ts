import { asPaisa, type Paisa } from '@muthoy/types';
import { requireOwner, requirePermission } from './auth';
import { sqliteConnection } from './client';
import { permissionForDataGate } from './dataAccessGates';
import { assertDateRange, dhakaUtcBounds, monthKey, monthRange, percentChangeBp, previousRange, type DateRange } from '../domain/reporting';

export interface ReportTotals {
  grossSales: Paisa; discounts: Paisa; refunds: Paisa; netSales: Paisa; taxCollected: Paisa;
  netRevenue: Paisa; cogs: Paisa; grossProfit: Paisa; expenses: Paisa; netProfit: Paisa;
  cashSales: Paisa; creditSales: Paisa; transactions: number; refundsCount: number; averageSale: Paisa;
  isCogsPartial: boolean; missingCogsMedicines: string[];
}
export interface DailyTrendPoint { date: string; sales: Paisa; transactions: number; }
export interface TopMedicineRow { medicineId: string; name: string; qty: number; sales: Paisa; }
export interface ExpenseCategoryRow { category: string; amount: Paisa; previousAmount: Paisa; }
export interface ReportSnapshot {
  range: DateRange; totals: ReportTotals; previousNetSales: Paisa; changeBp: number | null;
  trend: DailyTrendPoint[]; topMedicines: TopMedicineRow[]; expensesByCategory: ExpenseCategoryRow[];
}

interface RawTotals {
  grossSales: number; discounts: number; saleTotal: number; saleTax: number; saleCogs: number;
  cashSales: number; creditSales: number; transactions: number; refundTotal: number; refundTax: number;
  refundCogs: number; refundCash: number; refundCredit: number; refundsCount: number; expenses: number;
}

const RANGE_TOTALS_SQL = `
WITH period_sales AS (
  SELECT id,subtotal,discount_amount,total,tax_amount,cash_applied,credit_amount FROM sales
   WHERE shop_id=$shopId AND is_deleted=0 AND business_date BETWEEN $startDate AND $endDate
), sale_costs AS (
  SELECT COALESCE(SUM(si.cogs),0) AS cogs
    FROM sale_items si JOIN period_sales s ON s.id=si.sale_id WHERE si.shop_id=$shopId AND si.is_deleted=0
), period_refunds AS (
  SELECT r.id,r.sale_id,r.total_amount,s.tax_amount,s.cash_applied,s.credit_amount
    FROM sale_refunds r JOIN sales s ON s.id=r.sale_id AND s.shop_id=r.shop_id
   WHERE r.shop_id=$shopId AND r.is_deleted=0 AND r.business_date BETWEEN $startDate AND $endDate
), refund_costs AS (
  SELECT COALESCE(SUM(si.cogs),0) AS cogs FROM sale_items si JOIN period_refunds r ON r.sale_id=si.sale_id
   WHERE si.shop_id=$shopId AND si.is_deleted=0
), period_expenses AS (
  SELECT COALESCE(SUM(amount),0) AS amount FROM expenses
   WHERE shop_id=$shopId AND is_deleted=0 AND created_at >= $startUtc AND created_at < $endExclusiveUtc
)
SELECT COALESCE((SELECT SUM(subtotal) FROM period_sales),0) AS grossSales,
  COALESCE((SELECT SUM(discount_amount) FROM period_sales),0) AS discounts,
  COALESCE((SELECT SUM(total) FROM period_sales),0) AS saleTotal,
  COALESCE((SELECT SUM(tax_amount) FROM period_sales),0) AS saleTax,
  (SELECT cogs FROM sale_costs) AS saleCogs,
  COALESCE((SELECT SUM(cash_applied) FROM period_sales),0) AS cashSales,
  COALESCE((SELECT SUM(credit_amount) FROM period_sales),0) AS creditSales,
  COALESCE((SELECT COUNT(*) FROM period_sales),0) AS transactions,
  COALESCE((SELECT SUM(total_amount) FROM period_refunds),0) AS refundTotal,
  COALESCE((SELECT SUM(tax_amount) FROM period_refunds),0) AS refundTax,
  (SELECT cogs FROM refund_costs) AS refundCogs,
  COALESCE((SELECT SUM(cash_applied) FROM period_refunds),0) AS refundCash,
  COALESCE((SELECT SUM(credit_amount) FROM period_refunds),0) AS refundCredit,
  COALESCE((SELECT COUNT(*) FROM period_refunds),0) AS refundsCount,
  (SELECT amount FROM period_expenses) AS expenses`;

function params(shopId: string, range: DateRange) {
  assertDateRange(range);
  const bounds = dhakaUtcBounds(range);
  return { $shopId: shopId, $startDate: range.startDate, $endDate: range.endDate,
    $startUtc: bounds.startUtc, $endExclusiveUtc: bounds.endExclusiveUtc };
}
function dateParams(shopId: string, range: DateRange) {
  assertDateRange(range);
  return { $shopId: shopId, $startDate: range.startDate, $endDate: range.endDate };
}
function utcParams(shopId: string, range: DateRange) {
  const bounds = dhakaUtcBounds(range);
  return { $shopId: shopId, $startUtc: bounds.startUtc, $endExclusiveUtc: bounds.endExclusiveUtc };
}
function difference(left: number, right: number): number {
  const value = left - right;
  if (!Number.isSafeInteger(value)) throw new Error('Report amount exceeds safe integer paisa');
  return value;
}
function signedRoundDivide(value: number, divisor: number): number {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(divisor) || divisor <= 0) throw new Error('Invalid report average');
  const negative = value < 0; const numerator = BigInt(negative ? -value : value); const denominator = BigInt(divisor);
  const rounded = (numerator + denominator / 2n) / denominator;
  const result = Number(negative ? -rounded : rounded);
  if (!Number.isSafeInteger(result)) throw new Error('Report average exceeds safe integer paisa');
  return result;
}
function totalsFromRaw(row: RawTotals, missingCogsMedicines: string[]): ReportTotals {
  const netSales = difference(row.saleTotal, row.refundTotal);
  const taxCollected = difference(row.saleTax, row.refundTax);
  const netRevenue = difference(netSales, taxCollected);
  const cogs = difference(row.saleCogs, row.refundCogs);
  const grossProfit = difference(netRevenue, cogs);
  return {
    grossSales: asPaisa(row.grossSales), discounts: asPaisa(row.discounts), refunds: asPaisa(row.refundTotal),
    netSales: asPaisa(netSales), taxCollected: asPaisa(taxCollected), netRevenue: asPaisa(netRevenue),
    cogs: asPaisa(cogs), grossProfit: asPaisa(grossProfit), expenses: asPaisa(row.expenses),
    netProfit: asPaisa(difference(grossProfit, row.expenses)), cashSales: asPaisa(difference(row.cashSales, row.refundCash)),
    creditSales: asPaisa(difference(row.creditSales, row.refundCredit)), transactions: row.transactions,
    refundsCount: row.refundsCount, averageSale: asPaisa(row.transactions > 0 ? signedRoundDivide(netSales, row.transactions) : 0),
    isCogsPartial: missingCogsMedicines.length > 0, missingCogsMedicines,
  };
}
function readTotals(shopId: string, range: DateRange): ReportTotals {
  const bound = params(shopId, range);
  const row = sqliteConnection.getFirstSync<RawTotals>(RANGE_TOTALS_SQL, bound);
  if (!row) throw new Error('Report totals query returned no row');
  const missing = sqliteConnection.getAllSync<{ name: string }>(`
    WITH missing_events AS (
      SELECT si.id AS itemId,COALESCE(si.medicine_name_snapshot,m.name,'Unknown medicine') AS name,1 AS effect
        FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN medicines m ON m.id=si.medicine_id
       WHERE si.shop_id=$shopId AND si.is_deleted=0 AND s.is_deleted=0 AND si.line_total>0 AND si.cogs=0
         AND s.business_date BETWEEN $startDate AND $endDate
      UNION ALL
      SELECT si.id,COALESCE(si.medicine_name_snapshot,m.name,'Unknown medicine'),-1
        FROM sale_items si JOIN sale_refunds r ON r.sale_id=si.sale_id LEFT JOIN medicines m ON m.id=si.medicine_id
       WHERE si.shop_id=$shopId AND si.is_deleted=0 AND r.is_deleted=0 AND si.line_total>0 AND si.cogs=0
         AND r.business_date BETWEEN $startDate AND $endDate
    ), unresolved AS (
      SELECT itemId,name FROM missing_events GROUP BY itemId,name HAVING SUM(effect)<>0
    ) SELECT DISTINCT name FROM unresolved ORDER BY name LIMIT 20`, dateParams(shopId, range));
  return totalsFromRaw(row, missing.map((item) => item.name));
}
function readTrend(shopId: string, range: DateRange): DailyTrendPoint[] {
  return sqliteConnection.getAllSync<{ date: string; sales: number; transactions: number }>(`
    WITH events AS (
      SELECT business_date AS date,total AS amount,1 AS txns FROM sales
       WHERE shop_id=$shopId AND is_deleted=0 AND business_date BETWEEN $startDate AND $endDate
      UNION ALL SELECT business_date,-total_amount,0 FROM sale_refunds
       WHERE shop_id=$shopId AND is_deleted=0 AND business_date BETWEEN $startDate AND $endDate
    ) SELECT date,COALESCE(SUM(amount),0) AS sales,SUM(txns) AS transactions FROM events GROUP BY date ORDER BY date`, dateParams(shopId, range))
    .map((row) => ({ ...row, sales: asPaisa(row.sales) }));
}
function readTopMedicines(shopId: string, range: DateRange): TopMedicineRow[] {
  return sqliteConnection.getAllSync<{ medicineId: string; name: string; qty: number; sales: number }>(`
    WITH medicine_events AS (
      SELECT si.medicine_id AS medicineId,COALESCE(si.medicine_name_snapshot,m.name,'Unknown medicine') AS name,
             si.qty AS qty,si.line_total AS sales
        FROM sale_items si JOIN sales s ON s.id=si.sale_id LEFT JOIN medicines m ON m.id=si.medicine_id
       WHERE si.shop_id=$shopId AND si.is_deleted=0 AND s.is_deleted=0 AND s.business_date BETWEEN $startDate AND $endDate
      UNION ALL
      SELECT si.medicine_id,COALESCE(si.medicine_name_snapshot,m.name,'Unknown medicine'),-sr.qty,-sr.refund_amount
        FROM sales_returns sr JOIN sale_refunds r ON r.id=sr.refund_id JOIN sale_items si ON si.id=sr.sale_item_id
        LEFT JOIN medicines m ON m.id=si.medicine_id
       WHERE sr.shop_id=$shopId AND sr.is_deleted=0 AND r.is_deleted=0 AND r.business_date BETWEEN $startDate AND $endDate
    ) SELECT medicineId,name,SUM(qty) AS qty,SUM(sales) AS sales FROM medicine_events
      GROUP BY medicineId,name HAVING SUM(qty)>0 ORDER BY sales DESC,qty DESC,name LIMIT 5`, dateParams(shopId, range))
    .map((row) => ({ ...row, sales: asPaisa(row.sales) }));
}
function readExpensesByCategory(shopId: string, range: DateRange, previous: DateRange): ExpenseCategoryRow[] {
  const previousBounds = dhakaUtcBounds(previous);
  return sqliteConnection.getAllSync<{ category: string; currentAmount: number; previousAmount: number }>(`
    SELECT category,
      SUM(CASE WHEN created_at >= $startUtc AND created_at < $endExclusiveUtc THEN amount ELSE 0 END) AS currentAmount,
      SUM(CASE WHEN created_at >= $previousStartUtc AND created_at < $startUtc THEN amount ELSE 0 END) AS previousAmount
    FROM expenses WHERE shop_id=$shopId AND is_deleted=0 AND created_at >= $previousStartUtc AND created_at < $endExclusiveUtc
    GROUP BY category ORDER BY currentAmount DESC,category`, {
      ...utcParams(shopId, range), $previousStartUtc: previousBounds.startUtc,
    }).map((row) => ({ category: row.category, amount: asPaisa(row.currentAmount), previousAmount: asPaisa(row.previousAmount) }));
}

function buildSnapshotWithPrevious(shopId: string, range: DateRange, previous = previousRange(range)): {
  snapshot: ReportSnapshot; previousTotals: ReportTotals;
} {
  const totals = readTotals(shopId, range);
  const previousTotals = readTotals(shopId, previous);
  return { previousTotals, snapshot: { range, totals, previousNetSales: previousTotals.netSales,
    changeBp: percentChangeBp(totals.netSales, previousTotals.netSales), trend: readTrend(shopId, range),
    topMedicines: readTopMedicines(shopId, range), expensesByCategory: readExpensesByCategory(shopId, range, previous) } };
}
function buildSnapshot(shopId: string, range: DateRange): ReportSnapshot {
  return buildSnapshotWithPrevious(shopId, range).snapshot;
}
export async function getReportSnapshot(shopId: string, actorUserId: string, range: DateRange): Promise<ReportSnapshot> {
  await requirePermission(shopId, actorUserId, permissionForDataGate('reports'));
  return buildSnapshot(shopId, range);
}
export async function getEndOfDayReportSnapshot(shopId: string, actorUserId: string, range: DateRange): Promise<ReportSnapshot> {
  await requirePermission(shopId, actorUserId, permissionForDataGate('cashDrawer'));
  return buildSnapshot(shopId, range);
}

export interface MonthlyReportSnapshot extends ReportSnapshot {
  yearMonth: string; sixMonthTrend: { yearMonth: string; sales: Paisa; profit: Paisa }[];
}
export async function getMonthlyReport(shopId: string, actorUserId: string, yearMonth: string): Promise<MonthlyReportSnapshot> {
  await requirePermission(shopId, actorUserId, permissionForDataGate('reports'));
  const previousMonth = monthKey(yearMonth, -1);
  const { snapshot: report, previousTotals } = buildSnapshotWithPrevious(shopId, monthRange(yearMonth), monthRange(previousMonth));
  const sixMonthTrend = Array.from({ length: 6 }, (_, index) => monthKey(yearMonth, index - 5)).map((key) => {
    const totals = key === yearMonth ? report.totals : key === previousMonth ? previousTotals : readTotals(shopId, monthRange(key));
    return { yearMonth: key, sales: totals.netSales, profit: totals.netProfit };
  });
  return { ...report, yearMonth, sixMonthTrend };
}

export interface ReportSaleRow {
  invoiceNo: string; businessDate: string; createdAt: string; subtotal: Paisa; discount: Paisa; tax: Paisa;
  taxRateBp: number; taxLabel: string; total: Paisa; paymentType: string; cash: Paisa; credit: Paisa; items: string;
}
export interface ReportExpenseRow { date: string; category: string; description: string; amount: Paisa; }
export interface ReportRefundRow {
  invoiceNo: string; refundDate: string; reason: string; tax: Paisa; taxRateBp: number; taxLabel: string; total: Paisa;
}
export interface InventoryExportRow {
  medicineId: string; name: string; generic: string; barcode: string; requiresPrescription: boolean;
  stock: number; purchaseValue: Paisa; minimumSalePrice: Paisa; nearestExpiry: string;
}
export interface CreditExportRow { customerName: string; phone: string; outstanding: Paisa; }

export async function getReportSaleRows(shopId: string, actorUserId: string, range: DateRange, limit = 500, offset = 0): Promise<ReportSaleRow[]> {
  await requirePermission(shopId, actorUserId, permissionForDataGate('reports'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid export page');
  return sqliteConnection.getAllSync<{ invoiceNo: string; businessDate: string; createdAt: string; subtotal: number; discount: number; tax: number; taxRateBp: number; taxLabel: string; total: number; paymentType: string; cash: number; credit: number; items: string }>(`
    SELECT s.invoice_no AS invoiceNo,s.business_date AS businessDate,s.created_at AS createdAt,s.subtotal,
      s.discount_amount AS discount,s.tax_amount AS tax,s.tax_rate_bp AS taxRateBp,s.tax_label AS taxLabel,
      s.total,s.payment_type AS paymentType,s.cash_applied AS cash,
      s.credit_amount AS credit,COALESCE(GROUP_CONCAT(COALESCE(si.medicine_name_snapshot,m.name,'Unknown') || ' (' || si.qty || ')','; '),'') AS items
    FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id AND si.is_deleted=0 LEFT JOIN medicines m ON m.id=si.medicine_id
    WHERE s.shop_id=$shopId AND s.is_deleted=0 AND s.business_date BETWEEN $startDate AND $endDate
    GROUP BY s.id ORDER BY s.business_date,s.created_at,s.id LIMIT $limit OFFSET $offset`, {
      ...dateParams(shopId, range), $limit: limit, $offset: offset,
    }).map((row) => ({ ...row, subtotal: asPaisa(row.subtotal), discount: asPaisa(row.discount), tax: asPaisa(row.tax),
      total: asPaisa(row.total), cash: asPaisa(row.cash), credit: asPaisa(row.credit) }));
}
export async function getReportExpenseRows(shopId: string, actorUserId: string, range: DateRange, limit = 500, offset = 0): Promise<ReportExpenseRow[]> {
  await requirePermission(shopId, actorUserId, permissionForDataGate('reports'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid export page');
  return sqliteConnection.getAllSync<{ date: string; category: string; description: string | null; amount: number }>(`
    SELECT date(created_at,'+06:00') AS date,category,description,amount FROM expenses WHERE shop_id=$shopId AND is_deleted=0
      AND created_at >= $startUtc AND created_at < $endExclusiveUtc ORDER BY created_at,id LIMIT $limit OFFSET $offset`,
    { ...utcParams(shopId, range), $limit: limit, $offset: offset })
    .map((row) => ({ ...row, description: row.description ?? '', amount: asPaisa(row.amount) }));
}

export async function getReportRefundRows(shopId: string, actorUserId: string, range: DateRange, limit = 500, offset = 0): Promise<ReportRefundRow[]> {
  await requirePermission(shopId, actorUserId, permissionForDataGate('reports'));
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid export page');
  return sqliteConnection.getAllSync<{ invoiceNo: string; refundDate: string; reason: string; tax: number; taxRateBp: number; taxLabel: string; total: number }>(`
    SELECT s.invoice_no AS invoiceNo,r.business_date AS refundDate,r.reason,s.tax_amount AS tax,
      s.tax_rate_bp AS taxRateBp,s.tax_label AS taxLabel,r.total_amount AS total
      FROM sale_refunds r JOIN sales s ON s.id=r.sale_id AND s.shop_id=r.shop_id
     WHERE r.shop_id=$shopId AND r.is_deleted=0 AND r.business_date BETWEEN $startDate AND $endDate
     ORDER BY r.business_date,r.created_at,r.id LIMIT $limit OFFSET $offset`,
    { ...dateParams(shopId, range), $limit: limit, $offset: offset })
    .map((row) => ({ ...row, tax: asPaisa(row.tax), total: asPaisa(row.total) }));
}

export async function getInventoryExportRows(shopId: string, actorUserId: string, limit = 500, offset = 0): Promise<InventoryExportRow[]> {
  await requireOwner(shopId, actorUserId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid export page');
  return sqliteConnection.getAllSync<{ medicineId: string; name: string; generic: string | null; barcode: string | null; requiresPrescription: number; stock: number; purchaseValue: number; minimumSalePrice: number; nearestExpiry: string | null }>(`
    SELECT m.id AS medicineId,m.name,m.generic,m.barcode,m.requires_prescription AS requiresPrescription,
      COALESCE(SUM(CASE WHEN b.is_deleted=0 THEN b.stock ELSE 0 END),0) AS stock,
      COALESCE(SUM(CASE WHEN b.is_deleted=0 THEN b.stock*b.purchase_price ELSE 0 END),0) AS purchaseValue,
      COALESCE(MIN(CASE WHEN b.is_deleted=0 AND b.stock>0 THEN b.sale_price END),0) AS minimumSalePrice,
      MIN(CASE WHEN b.is_deleted=0 AND b.stock>0 THEN b.expiry_date END) AS nearestExpiry
    FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id AND b.shop_id=m.shop_id
    WHERE m.shop_id=$shopId AND m.is_deleted=0 GROUP BY m.id ORDER BY m.name,m.id LIMIT $limit OFFSET $offset`,
    { $shopId: shopId, $limit: limit, $offset: offset })
    .map((row) => ({ ...row, generic: row.generic ?? '', barcode: row.barcode ?? '', requiresPrescription: Boolean(row.requiresPrescription),
      purchaseValue: asPaisa(row.purchaseValue), minimumSalePrice: asPaisa(row.minimumSalePrice), nearestExpiry: row.nearestExpiry ?? '' }));
}

export async function getCreditExportRows(shopId: string, actorUserId: string, limit = 500, offset = 0): Promise<CreditExportRow[]> {
  await requireOwner(shopId, actorUserId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid export page');
  return sqliteConnection.getAllSync<{ customerName: string; phone: string | null; outstanding: number }>(`
    SELECT c.name AS customerName,c.phone,COALESCE(SUM(cr.balance),0) AS outstanding
      FROM customers c JOIN credits cr ON cr.customer_id=c.id AND cr.shop_id=c.shop_id AND cr.is_deleted=0
     WHERE c.shop_id=$shopId AND c.is_deleted=0 GROUP BY c.id HAVING SUM(cr.balance)>0
     ORDER BY outstanding DESC,c.name LIMIT $limit OFFSET $offset`, { $shopId: shopId, $limit: limit, $offset: offset })
    .map((row) => ({ customerName: row.customerName, phone: row.phone ?? '', outstanding: asPaisa(row.outstanding) }));
}
