// domain/discounts.ts — pure, framework-free discount resolution.
// Volume 4 SALES: "Discount support (percentage/flat) per line item,
// resolved before save." Zero React/DB imports (DEVELOPMENT_RULES.md).
// Reference only (layout/flow, never logic/code) for what the discount UI
// looks like: apps/prototype-web's DiscountModal.tsx — see the Prototype
// Rule in CLAUDE.md rule 15 before touching that file.

import type { Paisa } from '@muthoy/types';

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

// TODO(Day 7): resolve a cart line's final price after its discount
// (percentage or flat), returning integer paisa. A percentage can produce a
// fractional paisa — use multiplyPaisa from @muthoy/types, which rounds once,
// at that single point. Called by Checkout before domain/cashFormula, so the
// cash formula's cashSales figure reflects post-discount totals.
export function applyDiscount(_unitPrice: Paisa, _quantity: number, _discount: Discount | undefined): Paisa {
  throw new Error('TODO: implement percentage/flat discount resolution (Volume 4 SALES)');
}
