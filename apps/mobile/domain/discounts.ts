// domain/discounts.ts — pure, framework-free discount resolution.
// Volume 4 SALES: "Discount support (percentage/flat) per line item,
// resolved before save." Zero React/DB imports (DEVELOPMENT_RULES.md).
// Reference only (layout/flow, never logic/code) for what the discount UI
// looks like: apps/prototype-web's DiscountModal.tsx — see the Prototype
// Rule in CLAUDE.md rule 15 before touching that file.

import { asPaisa, fromTaka, multiplyPaisa, subtractPaisa, type Paisa } from '@muthoy/types';

export type DiscountType = 'percentage' | 'flat';

export interface Discount {
  type: DiscountType;
  /**
   * The discount RULE, not a money amount: 10 means 10% when type is
   * 'percentage', or ৳10 when type is 'flat'. Stays a plain number (matching
   * sale_items.discount_value, which is REAL) precisely because a percentage
   * expressed in paisa would be meaningless. The resolved money amount is
   * what applyDiscount returns.
   */
  value: number;
}

// Resolves a cart line's final price after its discount. A percentage can produce a
// fractional paisa — use multiplyPaisa from @muthoy/types, which rounds once,
// at that single point. Called by Checkout before domain/cashFormula, so the
// cash formula's cashSales figure reflects post-discount totals.
export interface DiscountResult {
  discountAmount: Paisa;
  lineTotal: Paisa;
}

export function applyDiscount(unitPrice: Paisa, quantity: number, discount?: Discount): DiscountResult {
  const subtotal = multiplyPaisa(unitPrice, quantity);
  const rawDiscount = discount
    ? discount.type === 'percentage'
      ? multiplyPaisa(subtotal, discount.value / 100)
      : fromTaka(discount.value)
    : asPaisa(0);
  const discountAmount = asPaisa(Math.min(subtotal, Math.max(0, rawDiscount)));
  return { discountAmount, lineTotal: subtractPaisa(subtotal, discountAmount) };
}
