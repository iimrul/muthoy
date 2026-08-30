import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { buildMonthlyPnlPrint, buildTestPrint, bytesToBase64, thermalColumns, thermalText } from './escpos';

describe('ESC/POS thermal output', () => {
  it('keeps every row inside 32 columns and thermal output English-only', () => {
    expect(thermalColumns('A very long report label that must truncate', '12345.67')).toHaveLength(32);
    expect(thermalText('English বাংলা')).toBe('English ?????');
  });

  it('builds initialized, cut, non-empty test and monthly jobs', () => {
    const test = buildTestPrint();
    expect(Array.from(test.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(test.slice(-4))).toEqual([0x1d, 0x56, 0x41, 0x03]);
    expect(bytesToBase64(new Uint8Array([77, 97, 110]))).toBe('TWFu');

    const monthly = buildMonthlyPnlPrint('Muthoy', {
      yearMonth: '2026-01', range: { startDate: '2026-01-01', endDate: '2026-01-31' },
      previousNetSales: asPaisa(0), changeBp: null, trend: [], topMedicines: [], expensesByCategory: [], sixMonthTrend: [],
      totals: {
        grossSales: asPaisa(11_000), discounts: asPaisa(0), refunds: asPaisa(0), netSales: asPaisa(11_000),
        taxCollected: asPaisa(1_000), netRevenue: asPaisa(10_000), cogs: asPaisa(6_000), grossProfit: asPaisa(4_000),
        expenses: asPaisa(1_000), netProfit: asPaisa(3_000), cashSales: asPaisa(11_000), creditSales: asPaisa(0),
        transactions: 1, refundsCount: 0, averageSale: asPaisa(11_000), isCogsPartial: false, missingCogsMedicines: [],
      },
    });
    const text = new TextDecoder().decode(monthly);
    expect(text).toContain('Included tax');
    expect(text).toContain('NET PROFIT');
    expect(text).not.toMatch(/[\u0980-\u09ff]/);
  });

  it('prints refund-period tax and COGS reversals without double negatives', () => {
    const bytes = buildMonthlyPnlPrint('Muthoy', {
      yearMonth:'2026-02',range:{ startDate:'2026-02-01',endDate:'2026-02-28' },previousNetSales:asPaisa(0),changeBp:null,
      trend:[],topMedicines:[],expensesByCategory:[],sixMonthTrend:[],totals:{ grossSales:asPaisa(0),discounts:asPaisa(0),
        refunds:asPaisa(11_000),netSales:asPaisa(-11_000),taxCollected:asPaisa(-1_000),netRevenue:asPaisa(-10_000),
        cogs:asPaisa(-6_000),grossProfit:asPaisa(-4_000),expenses:asPaisa(1_000),netProfit:asPaisa(-5_000),
        cashSales:asPaisa(-11_000),creditSales:asPaisa(0),transactions:0,refundsCount:1,averageSale:asPaisa(0),
        isCogsPartial:false,missingCogsMedicines:[] },
    });
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Tax reversed');
    expect(text).toContain('COGS reversed');
    expect(text).not.toContain('--60.00');
  });
});
