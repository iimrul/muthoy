import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { allocateDiscountLargestRemainder, checkoutDiscountAmount, effectiveUnitPrice, promotionDiscount } from './pricing';

describe('integer-paisa pricing', () => {
  it('rounds a basis-point promotion to nearest paisa once', () => {
    expect(promotionDiscount(asPaisa(101), 5000)).toBe(51);
    expect(effectiveUnitPrice(asPaisa(101), 5000)).toBe(50);
  });
  it('caps amount and percentage checkout discounts at subtotal', () => {
    expect(checkoutDiscountAmount(asPaisa(100), { type: 'amount', amount: asPaisa(200) })).toBe(100);
    expect(checkoutDiscountAmount(asPaisa(101), { type: 'percentage', basisPoints: 5000 })).toBe(51);
  });
  it('allocates exact largest remainder with stable id tie-break', () => {
    const result = allocateDiscountLargestRemainder(asPaisa(2), [
      { id: 'b', subtotal: asPaisa(1) }, { id: 'a', subtotal: asPaisa(1) }, { id: 'c', subtotal: asPaisa(1) },
    ]);
    expect(result.map(({ id, discountAmount }) => [id, discountAmount])).toEqual([['b', 1], ['a', 1], ['c', 0]]);
    expect(result.reduce((sum, line) => sum + line.discountAmount, 0)).toBe(2);
  });
});
