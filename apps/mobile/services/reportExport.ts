import { asPaisa, type Paisa } from '@muthoy/types';
import {
  getCreditExportRows, getInventoryExportRows, getMonthlyReport, getReportExpenseRows,
  getReportRefundRows, getReportSaleRows, getReportSnapshot,
  type CreditExportRow, type InventoryExportRow, type ReportExpenseRow, type ReportRefundRow, type ReportSaleRow, type ReportSnapshot,
} from '../db/reports';
import { getShopName } from '../db/settings';
import { requireOwner } from '../db/auth';
import { requirePremiumFeature } from '../db/commercial';
import { NotAuthorizedError } from '../db/errors';
import { paisaToTakaText, type ExportCell } from '../domain/export';
import type { DateRange } from '../domain/reporting';
import { shareWrittenExport, writeReportExport, type ExportFormat, type ExportSheetStream, type WrittenExport } from '../native/reportExport';
import { shareReportText } from '../native/reportShare';

export type ExportDataset = 'sales' | 'inventory' | 'credit' | 'expenses';
export interface ExportRequest {
  shopId: string; actorUserId: string; range: DateRange; datasets: readonly ExportDataset[];
  format: ExportFormat; onProgress?: (progress: number) => void; monthly?: string;
}
const PAGE_SIZE = 500; const MAX_EXPORT_ROWS = 50_000;
const money = (value: Paisa) => paisaToTakaText(value);
function rate(value: number): string {
  const whole = Math.floor(value / 100); const fraction = String(value % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}
function dhakaTime(value: string): string {
  const timestamp = new Date(value); if (Number.isNaN(timestamp.getTime())) throw new Error('Invalid sale timestamp');
  return new Date(timestamp.getTime() + 6 * 60 * 60 * 1_000).toISOString().slice(11, 19);
}
async function* oneChunk(rows: ExportCell[][]): AsyncGenerator<ExportCell[][]> { yield rows; }
async function* paged<T>(header: ExportCell[], read: (limit: number, offset: number) => Promise<T[]>, map: (row: T) => ExportCell[]): AsyncGenerator<ExportCell[][]> {
  yield [header]; let offset = 0;
  while (offset < MAX_EXPORT_ROWS) {
    const page = await read(PAGE_SIZE, offset);
    if (page.length) yield page.map(map);
    offset += page.length;
    if (page.length < PAGE_SIZE) return;
    if (offset === MAX_EXPORT_ROWS) {
      if ((await read(1, offset)).length) throw new Error(`Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()} row safety limit`);
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
function taxSummaryRow(tax: Paisa): ExportCell[][] {
  return tax > 0 ? [['Tax/VAT Collected',money(tax)]] : tax < 0 ? [['Tax/VAT Reversed',money(asPaisa(-tax))]] : [];
}
function cogsSummaryRow(cogs: Paisa): ExportCell[] {
  return cogs >= 0 ? ['COGS',money(cogs)] : ['COGS Reversed',money(asPaisa(-cogs))];
}
function salesSource(request: ExportRequest): ExportSheetStream {
  return { name: 'Sales', chunks: paged(
    ['Date','Time (Asia/Dhaka)','Invoice','Subtotal','Discount','Tax','Tax Rate','Tax Label','Total','Payment Type','Cash','Credit','Items'],
    (limit,offset) => getReportSaleRows(request.shopId,request.actorUserId,request.range,limit,offset),
    (row: ReportSaleRow) => [row.businessDate,dhakaTime(row.createdAt),row.invoiceNo,money(row.subtotal),money(row.discount),money(row.tax),rate(row.taxRateBp),row.taxLabel,money(row.total),row.paymentType,money(row.cash),money(row.credit),row.items],
  ) };
}
function refundsSource(request: ExportRequest): ExportSheetStream {
  return { name: 'Refunds', chunks: paged(
    ['Refund Date','Invoice','Reason','Tax Reversed','Original Tax Rate','Original Tax Label','Total Refunded'],
    (limit,offset) => getReportRefundRows(request.shopId,request.actorUserId,request.range,limit,offset),
    (row: ReportRefundRow) => [row.refundDate,row.invoiceNo,row.reason,money(row.tax),rate(row.taxRateBp),row.taxLabel,money(row.total)],
  ) };
}
function expensesSource(request: ExportRequest): ExportSheetStream {
  return { name: 'Expenses', chunks: paged(
    ['Date','Category','Description','Amount'],
    (limit,offset) => getReportExpenseRows(request.shopId,request.actorUserId,request.range,limit,offset),
    (row: ReportExpenseRow) => [row.date,row.category,row.description,money(row.amount)],
  ) };
}
function inventorySource(request: ExportRequest): ExportSheetStream {
  return { name: 'Inventory', chunks: paged(
    ['Medicine ID','Name','Generic','Barcode','Rx Required','Stock','Purchase Value','Minimum Sale Price','Nearest Expiry'],
    (limit,offset) => getInventoryExportRows(request.shopId,request.actorUserId,limit,offset),
    (row: InventoryExportRow) => [row.medicineId,row.name,row.generic,row.barcode,row.requiresPrescription ? 'yes' : 'no',row.stock,money(row.purchaseValue),money(row.minimumSalePrice),row.nearestExpiry],
  ) };
}
function creditSource(request: ExportRequest): ExportSheetStream {
  return { name: 'Credit', chunks: paged(
    ['Customer','Phone','Outstanding'],
    (limit,offset) => getCreditExportRows(request.shopId,request.actorUserId,limit,offset),
    (row: CreditExportRow) => [row.customerName,row.phone,money(row.outstanding)],
  ) };
}

// Every file export and external summary share requires a live SQLite Owner
// and export entitlement before report reads, formatting, progress, or native I/O.
async function authorizeExport(request: Pick<ExportRequest, 'shopId' | 'actorUserId'>): Promise<void> {
  if (!request.shopId || !request.actorUserId) throw new NotAuthorizedError();
  await requireOwner(request.shopId, request.actorUserId);
  await requirePremiumFeature(request.shopId, 'export');
}

export async function buildReportExport(request: ExportRequest): Promise<WrittenExport> {
  await authorizeExport(request);
  if (request.datasets.length === 0) throw new Error('Select at least one dataset');
  const sources: ExportSheetStream[] = [];
  if (request.monthly) {
    const monthly = await getMonthlyReport(request.shopId,request.actorUserId,request.monthly);
    sources.push({ name:'P&L Summary', chunks:oneChunk([
      ['Metric','Amount'],['Gross Sales',money(monthly.totals.grossSales)],['Discounts',money(monthly.totals.discounts)],
      ['Refunds',money(monthly.totals.refunds)],['MRP-inclusive Net Sales',money(monthly.totals.netSales)],
      ...taxSummaryRow(monthly.totals.taxCollected),['Net Sales Revenue',money(monthly.totals.netRevenue)],
      cogsSummaryRow(monthly.totals.cogs),['Gross Profit',money(monthly.totals.grossProfit)],
      ['Operating Expenses',money(monthly.totals.expenses)],...monthly.expensesByCategory.map((row) => [`  ${row.category}`,money(row.amount)]),
      ['Net Profit',money(monthly.totals.netProfit)],
    ]) });
  } else {
    const report = await getReportSnapshot(request.shopId,request.actorUserId,request.range);
    sources.push({ name:'Summary', chunks:oneChunk([
      ['Metric','Amount'],['MRP-inclusive Sales',money(report.totals.netSales)],['Refunds',money(report.totals.refunds)],
      ...taxSummaryRow(report.totals.taxCollected),['Net Sales Revenue',money(report.totals.netRevenue)],
      cogsSummaryRow(report.totals.cogs),['Gross Profit',money(report.totals.grossProfit)],
      ['Expenses',money(report.totals.expenses)],['Net Profit',money(report.totals.netProfit)],
    ]) });
  }
  for (const dataset of request.datasets) {
    if (dataset === 'sales') sources.push(salesSource(request),refundsSource(request));
    else if (dataset === 'expenses') sources.push(expensesSource(request));
    else if (dataset === 'inventory') sources.push(inventorySource(request));
    else sources.push(creditSource(request));
  }
  const shopName = await getShopName(request.shopId);
  const stem = `${shopName ?? 'muthoy'}-${request.monthly ?? `${request.range.startDate}-to-${request.range.endDate}`}`;
  return writeReportExport(stem,request.format,sources,(completed,total) => request.onProgress?.(Math.round(completed / total * 100)));
}

export async function exportAndShareReport(request: ExportRequest): Promise<WrittenExport> {
  const file = await buildReportExport(request); await shareWrittenExport(file); return file;
}

export interface ReportSummaryShareRequest extends Pick<ExportRequest, 'shopId' | 'actorUserId' | 'range'> {
  formatSummary: (report: ReportSnapshot) => string;
}

export async function shareReportSummary(request: ReportSummaryShareRequest): Promise<void> {
  await authorizeExport(request);
  const report = await getReportSnapshot(request.shopId, request.actorUserId, request.range);
  await shareReportText(request.formatSummary(report));
}
