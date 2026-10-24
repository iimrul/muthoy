import { describe, expect, it } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { netSalesPaisa } from './netSales';

// W4-04's arithmetic, and the accounting cases the Batch 1 design enumerated.
//
// The subtraction itself is one line; what is worth testing is the set of cases
// a reader would otherwise have to take on trust — above all that the figure is
// allowed to go negative, because the instinct to clamp it is exactly how money
// that left the till gets hidden.

const p = (value: number) => asPaisa(value);

describe('netSalesPaisa', () => {
  it('subtracts refunds from gross takings', () => {
    expect(netSalesPaisa(p(150_00), p(50_00))).toBe(100_00);
  });

  it('returns the gross figure when nothing was refunded', () => {
    expect(netSalesPaisa(p(150_00), p(0))).toBe(150_00);
  });

  it('nets a fully refunded day to exactly zero', () => {
    // The full-refund model this product implements: db/refunds.ts always sets
    // totalAmount to the sale's own total, so a refunded sale cancels exactly.
    expect(netSalesPaisa(p(1_234_56), p(1_234_56))).toBe(0);
  });

  it('GOES NEGATIVE when refunds exceed the day\'s sales, and does not clamp', () => {
    // A refund carries its own business_date, so a return settled today against
    // yesterday's invoice lands on today. Clamping this to zero would report a
    // day as break-even while cash actually left the drawer.
    expect(netSalesPaisa(p(10_00), p(35_00))).toBe(-25_00);
  });

  it('nets a day of only refunds to the negative of those refunds', () => {
    expect(netSalesPaisa(p(0), p(500_00))).toBe(-500_00);
  });

  it('stays exact at large integer paisa, with no float drift', () => {
    // Money is integer paisa precisely so this holds; the same arithmetic in
    // taka would not.
    expect(netSalesPaisa(p(999_999_999), p(1))).toBe(999_999_998);
  });

  it('refuses a non-integer at the boundary rather than drifting', () => {
    // asPaisa is the guard, and it is where a taka value mistakenly passed as
    // paisa (12.5) is caught. Recorded here because netSalesPaisa relies on it
    // rather than re-validating.
    expect(() => netSalesPaisa(asPaisa(12.5), p(0))).toThrow(/integer number of paisa/);
  });

  it('takes exactly two arguments, so neither side can be omitted silently', () => {
    // Structural, not behavioural. A refund argument that could default to zero
    // would make "net" quietly mean "gross" at any call site that forgot it —
    // which is the W4-04 defect itself, reintroduced through the helper.
    expect(netSalesPaisa.length).toBe(2);
  });
});
