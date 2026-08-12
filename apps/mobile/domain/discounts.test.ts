import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { applyDiscount } from './discounts';

describe('applyDiscount', () => {
  it('returns the full subtotal without a discount', () => {
    expect(applyDiscount(asPaisa(1_250), 2)).toEqual({ discountAmount: 0, lineTotal: 2_500 });
  });

  it('applies a percentage discount in integer paisa', () => {
    expect(applyDiscount(asPaisa(1_005), 3, { type: 'percentage', value: 10 })).toEqual({
      discountAmount: 302,
      lineTotal: 2_713,
    });
  });

  it('converts a flat taka discount to paisa', () => {
    expect(applyDiscount(asPaisa(1_000), 2, { type: 'flat', value: 5 })).toEqual({
      discountAmount: 500,
      lineTotal: 1_500,
    });
  });

  it('clamps an oversized discount so the line total is zero', () => {
    expect(applyDiscount(asPaisa(500), 1, { type: 'flat', value: 99 })).toEqual({
      discountAmount: 500,
      lineTotal: 0,
    });
  });
});
