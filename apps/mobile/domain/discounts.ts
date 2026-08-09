// domain/discounts.ts — pure, framework-free discount resolution.
// Volume 4 SALES: "Discount support (percentage/flat) per line item,
// resolved before save." Zero React/DB imports (DEVELOPMENT_RULES.md).
// Reference only (layout/flow, never logic/code) for what the discount UI
// looks like: apps/prototype-web's DiscountModal.tsx — see the Prototype
// Rule in CLAUDE.md rule 15 before touching that file.

export type DiscountType = 'percentage' | 'flat';

export interface Discount {
  type: DiscountType;
  value: number;
}

// TODO(Day 7): resolve a cart line's final price after its discount
// (percentage or flat). Called by Checkout before domain/cashFormula, so
// the cash formula's cashSales figure reflects post-discount totals.
export function applyDiscount(_unitPrice: number, _quantity: number, _discount: Discount | undefined): number {
  throw new Error('TODO: implement percentage/flat discount resolution (Volume 4 SALES)');
}
