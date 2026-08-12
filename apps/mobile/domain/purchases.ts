// domain/purchases.ts — pure, framework-free purchase-invoice logic. Zero
// React/DB imports (DEVELOPMENT_RULES.md).
// Volume 4 PURCHASE: "invoice_no auto-generated... COD pays cash
// immediately, credit updates the supplier payable only."

import { ZERO_PAISA, subtractPaisa, type Paisa } from '@muthoy/types';

export type PurchasePaymentType = 'cod' | 'credit';

export function resolvePaymentEffect(
  paymentType: PurchasePaymentType,
  amount: Paisa,
): { cashDrawerDelta: Paisa; payableDelta: Paisa } {
  return paymentType === 'cod'
    ? { cashDrawerDelta: subtractPaisa(ZERO_PAISA, amount), payableDelta: ZERO_PAISA }
    : { cashDrawerDelta: ZERO_PAISA, payableDelta: amount };
}
