// Synthetic report snapshots for the existing thermal builders. Every value
// is an invented integer-paisa amount; no shop, person or device data.
import { asPaisa } from "@muthoy/types";
import type { MonthlyReportSnapshot, ReportSnapshot, ReportTotals } from "../../../db/reports";

type TotalsInput = Partial<Record<keyof ReportTotals, number | boolean | string[]>>;

export function totals(overrides: TotalsInput = {}): ReportTotals {
  const base = {
    grossSales: 1_250_000, discounts: 25_000, refunds: 0, netSales: 1_225_000, taxCollected: 0,
    netRevenue: 1_225_000, cogs: 800_000, grossProfit: 425_000, expenses: 50_000, netProfit: 375_000,
    cashSales: 900_000, creditSales: 325_000, transactions: 42, refundsCount: 0, averageSale: 29_167,
    isCogsPartial: false, missingCogsMedicines: [] as string[],
  };
  const merged = { ...base, ...overrides } as typeof base;
  return {
    grossSales: asPaisa(merged.grossSales), discounts: asPaisa(merged.discounts), refunds: asPaisa(merged.refunds),
    netSales: asPaisa(merged.netSales), taxCollected: asPaisa(merged.taxCollected), netRevenue: asPaisa(merged.netRevenue),
    cogs: asPaisa(merged.cogs), grossProfit: asPaisa(merged.grossProfit), expenses: asPaisa(merged.expenses),
    netProfit: asPaisa(merged.netProfit), cashSales: asPaisa(merged.cashSales), creditSales: asPaisa(merged.creditSales),
    transactions: merged.transactions, refundsCount: merged.refundsCount, averageSale: asPaisa(merged.averageSale),
    isCogsPartial: merged.isCogsPartial, missingCogsMedicines: merged.missingCogsMedicines,
  };
}

export function eodSnapshot(overrides: TotalsInput = {}): ReportSnapshot {
  return {
    range: { startDate: "2026-11-10", endDate: "2026-11-10" },
    totals: totals(overrides), previousNetSales: asPaisa(0), changeBp: null, trend: [], topMedicines: [], expensesByCategory: [],
  };
}

export function monthlySnapshot(overrides: TotalsInput = {}): MonthlyReportSnapshot {
  return {
    ...eodSnapshot(overrides),
    range: { startDate: "2026-10-01", endDate: "2026-10-31" },
    yearMonth: "2026-10",
    sixMonthTrend: [],
  };
}

export const LF = 0x0a;
export const QUESTION = 0x3f;
export const count = (bytes: Uint8Array, value: number): number => bytes.reduce((sum, byte) => sum + (byte === value ? 1 : 0), 0);
export const ascii = (text: string): number[] => Array.from(text, (character) => character.charCodeAt(0));
