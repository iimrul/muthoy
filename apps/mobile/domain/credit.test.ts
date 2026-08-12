import { describe, expect, it } from 'vitest';
import { ZERO_PAISA, asPaisa } from '@muthoy/types';
import { remainingBalance } from './credit';

describe('remainingBalance', () => {
  it('returns zero for an empty ledger', () => {
    expect(remainingBalance([])).toBe(ZERO_PAISA);
  });

  it('returns a single credit sale amount', () => {
    expect(remainingBalance([
      { type: 'credit_sale', amount: asPaisa(12_500) },
    ])).toBe(12_500);
  });

  it('subtracts a partial collection exactly', () => {
    expect(remainingBalance([
      { type: 'credit_sale', amount: asPaisa(12_500) },
      { type: 'collection', amount: asPaisa(4_275) },
    ])).toBe(8_225);
  });

  it('aggregates multiple sales and collections', () => {
    expect(remainingBalance([
      { type: 'collection', amount: asPaisa(1_000) },
      { type: 'credit_sale', amount: asPaisa(7_500) },
      { type: 'collection', amount: asPaisa(2_250) },
      { type: 'credit_sale', amount: asPaisa(3_000) },
    ])).toBe(7_250);
  });

  it('returns zero when fully collected', () => {
    expect(remainingBalance([
      { type: 'credit_sale', amount: asPaisa(9_999) },
      { type: 'collection', amount: asPaisa(9_999) },
    ])).toBe(ZERO_PAISA);
  });
});
