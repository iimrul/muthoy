import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { divideRoundHalfUp, extractInclusiveTax, normalizeTaxLabel } from './tax';

describe('inclusive shop tax', () => {
  it('extracts tax without increasing the MRP-inclusive total', () => {
    const total = asPaisa(11_000);
    expect(extractInclusiveTax(total, 1_000)).toBe(1_000);
    expect(total).toBe(11_000);
    expect(extractInclusiveTax(total, 0)).toBe(0);
  });

  it('uses integer round-half-up at the half-paisa boundary', () => {
    expect(divideRoundHalfUp(1n, 2n)).toBe(1n);
    expect(extractInclusiveTax(asPaisa(1), 10_000)).toBe(1);
  });

  it('rejects invalid rates, totals, and labels', () => {
    expect(() => extractInclusiveTax(asPaisa(-1), 1_000)).toThrow();
    expect(() => extractInclusiveTax(asPaisa(100), 10_001)).toThrow();
    expect(normalizeTaxLabel('  VAT  ')).toBe('VAT');
    expect(() => normalizeTaxLabel('   ')).toThrow();
  });
});
