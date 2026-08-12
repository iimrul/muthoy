import { describe, expect, it } from 'vitest';
import { asPaisa, ZERO_PAISA } from '@muthoy/types';
import { expectedCash, type CashFormulaInput } from './cashFormula';

const zeroInput: CashFormulaInput = {
  openingCash: ZERO_PAISA,
  cashSales: ZERO_PAISA,
  creditCollections: ZERO_PAISA,
  expenses: ZERO_PAISA,
  refunds: ZERO_PAISA,
  supplierPayments: ZERO_PAISA,
  withdrawals: ZERO_PAISA,
};

describe('expectedCash', () => {
  it('returns zero when every term is zero', () => {
    expect(expectedCash(zeroInput)).toBe(0);
  });

  it.each([
    ['openingCash', 1000, 1000],
    ['cashSales', 2000, 2000],
    ['creditCollections', 3000, 3000],
    ['expenses', 400, -400],
    ['refunds', 500, -500],
    ['supplierPayments', 600, -600],
    ['withdrawals', 700, -700],
  ] as const)('applies %s with the correct sign', (field, value, expected) => {
    expect(expectedCash({ ...zeroInput, [field]: asPaisa(value) })).toBe(expected);
  });

  it('matches a hand-computed realistic scenario', () => {
    expect(expectedCash({
      openingCash: asPaisa(50_000),
      cashSales: asPaisa(125_500),
      creditCollections: asPaisa(20_000),
      expenses: asPaisa(12_500),
      refunds: asPaisa(3_000),
      supplierPayments: asPaisa(40_000),
      withdrawals: asPaisa(10_000),
    })).toBe(130_000);
  });

  it('allows a negative shortfall result', () => {
    expect(expectedCash({ ...zeroInput, expenses: asPaisa(1_000) })).toBe(-1_000);
  });
});
