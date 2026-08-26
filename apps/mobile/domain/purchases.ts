// domain/purchases.ts — pure, framework-free purchase-invoice logic. Zero
// React/DB imports (DEVELOPMENT_RULES.md).
// Volume 4 PURCHASE: "invoice_no auto-generated... COD pays cash
// immediately, credit updates the supplier payable only."
//
// B3 Group 7 (Supplier Credit at COD settlement): a COD purchase no longer
// unconditionally pays its full amount in cash. Available Supplier Credit
// (domain/supplierPosition.ts's derived standalone credit — money the
// supplier already owes the shop, e.g. from an unconsumed purchase return)
// is consumed FIRST; only the residual is paid in cash. `paidAmount` here is
// deliberately never anything but the real cash collected — credit-applied
// is informational only and is never itself persisted anywhere (see the
// approved Group 7 plan's "PAYMENT / PAID_AMOUNT SEMANTICS": paid_amount
// keeps its existing, unchanged meaning). A credit-terms purchase never pays
// cash at creation regardless of available credit — credit there is left
// untouched for the FIFO pass to apply against the invoice's own remaining
// once it exists, exactly like any other open invoice.

import { ZERO_PAISA, subtractPaisa, type Paisa } from '@muthoy/types';

export type PurchasePaymentType = 'cod' | 'credit';

export interface PaymentEffect {
  /** What cash actually leaves the drawer right now — ZERO_PAISA or negative. */
  cashDrawerDelta: Paisa;
  /** Cash actually collected at this moment. Never includes credit. */
  paidAmount: Paisa;
  /** Supplier Credit consumed to cover the rest — informational, never persisted. */
  creditApplied: Paisa;
}

export function resolvePaymentEffect(
  paymentType: PurchasePaymentType,
  amount: Paisa,
  availableCredit: Paisa = ZERO_PAISA,
): PaymentEffect {
  if (paymentType === 'credit') {
    return { cashDrawerDelta: ZERO_PAISA, paidAmount: ZERO_PAISA, creditApplied: ZERO_PAISA };
  }
  const creditApplied = (amount < availableCredit ? amount : availableCredit) as Paisa;
  const paidAmount = subtractPaisa(amount, creditApplied);
  return { cashDrawerDelta: subtractPaisa(ZERO_PAISA, paidAmount), paidAmount, creditApplied };
}
