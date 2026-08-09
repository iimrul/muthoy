// db/reports.ts — the ONLY file that will touch Drizzle/SQLite for Reports
// (DEVELOPMENT_RULES.md). Volume 4 REPORTS: "All read-only aggregations
// over local SQLite — no network dependency." P1 (Volume 0's scope lock:
// "Reports polish"). The Drizzle schema doesn't exist yet (Day 2) either
// way — signature-only stubs.

export interface DateRangeTotals {
  totalSales: number;
  totalExpenses: number;
  profit: number;
}

export async function getDateRangeTotals(_shopId: string, _startDate: string, _endDate: string): Promise<DateRangeTotals> {
  throw new Error('TODO: implement date-range totals query (P1, Volume 4 REPORTS)');
}

export async function getMonthlyReport(_shopId: string, _yearMonth: string): Promise<DateRangeTotals> {
  throw new Error('TODO: implement monthly report query (P1, Volume 4 REPORTS)');
}

export interface SalesHistoryRow {
  saleId: string;
  invoiceNo: string;
  createdAt: string;
  total: number;
  paymentType: 'cash' | 'credit';
}

export async function getSalesHistory(_shopId: string, _page: number): Promise<SalesHistoryRow[]> {
  throw new Error('TODO: implement sales history query (P1, Volume 4 REPORTS)');
}

// TODO(P1): export format not specced in Volume 4 — confirm with the
// founder before implementing (CLAUDE.md rule 11).
export async function exportShopData(_shopId: string): Promise<unknown> {
  throw new Error('TODO: implement data export (P1, Volume 4 REPORTS)');
}
