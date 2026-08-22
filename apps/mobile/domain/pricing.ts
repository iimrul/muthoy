import { asPaisa, type Paisa } from '@muthoy/types';

export const BASIS_POINTS_SCALE = 10_000;

function safeNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

export function assertBasisPoints(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > BASIS_POINTS_SCALE) {
    throw new Error('Basis points must be an integer from 0 through 10000');
  }
}

function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function promotionDiscount(unitPrice: Paisa, basisPoints: number): Paisa {
  safeNonNegativeInteger(unitPrice, 'Unit price');
  assertBasisPoints(basisPoints);
  return asPaisa(Number(roundedRatio(BigInt(unitPrice) * BigInt(basisPoints), 10_000n)));
}

export function effectiveUnitPrice(unitPrice: Paisa, basisPoints = 0): Paisa {
  return asPaisa(unitPrice - promotionDiscount(unitPrice, basisPoints));
}

export type CheckoutDiscount =
  | { type: 'amount'; amount: Paisa }
  | { type: 'percentage'; basisPoints: number };

export function checkoutDiscountAmount(subtotal: Paisa, discount?: CheckoutDiscount): Paisa {
  safeNonNegativeInteger(subtotal, 'Subtotal');
  if (!discount) return asPaisa(0);
  const requested = discount.type === 'amount'
    ? (safeNonNegativeInteger(discount.amount, 'Discount amount'), discount.amount)
    : promotionDiscount(subtotal, discount.basisPoints);
  return asPaisa(Math.min(subtotal, requested));
}

export interface DiscountAllocationInput { id: string; subtotal: Paisa }
export interface DiscountAllocation extends DiscountAllocationInput { discountAmount: Paisa; total: Paisa }

/** Exact proportional allocation; equal remainders resolve by stable line/batch id. */
export function allocateDiscountLargestRemainder(
  totalDiscount: Paisa,
  lines: DiscountAllocationInput[],
): DiscountAllocation[] {
  safeNonNegativeInteger(totalDiscount, 'Total discount');
  if (new Set(lines.map((line) => line.id)).size !== lines.length) throw new Error('Line ids must be unique');
  lines.forEach((line) => safeNonNegativeInteger(line.subtotal, 'Line subtotal'));
  const subtotal = lines.reduce((sum, line) => sum + BigInt(line.subtotal), 0n);
  if (BigInt(totalDiscount) > subtotal) throw new Error('Discount cannot exceed subtotal');
  if (subtotal === 0n) {
    return lines.map((line) => ({ ...line, discountAmount: asPaisa(0), total: asPaisa(0) }));
  }
  const shares = lines.map((line) => {
    const weighted = BigInt(totalDiscount) * BigInt(line.subtotal);
    return { line, floor: weighted / subtotal, remainder: weighted % subtotal };
  });
  let residue = BigInt(totalDiscount) - shares.reduce((sum, share) => sum + share.floor, 0n);
  const ranked = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.line.id.localeCompare(b.line.id) : a.remainder > b.remainder ? -1 : 1,
  );
  for (const share of ranked) {
    if (residue === 0n) break;
    share.floor += 1n;
    residue -= 1n;
  }
  return shares.map(({ line, floor }) => {
    const amount = asPaisa(Number(floor));
    return { ...line, discountAmount: amount, total: asPaisa(line.subtotal - amount) };
  });
}
