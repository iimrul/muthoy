// domain/purchases.ts — pure, framework-free purchase-invoice logic. Zero
// React/DB imports (DEVELOPMENT_RULES.md). P1 (post-beta fast-follow,
// Volume 0's scope lock) — Beta ships manual batch entry via Add Medicine
// instead; do not implement before Day 15.
// Volume 4 PURCHASE: "invoice_no auto-generated... COD pays cash
// immediately, credit updates the supplier payable only."

export type PurchasePaymentType = 'cod' | 'credit';

// TODO(P1): generate a human-readable, shop-scoped unique invoice number —
// exact format not specced in Volume 4; confirm with the founder before
// implementing (CLAUDE.md rule 11) rather than inventing a convention here.
export function generateInvoiceNumber(_shopId: string, _lastInvoiceNumber: string | undefined): string {
  throw new Error('TODO: implement invoice number generation (P1 — post-beta, Volume 4 PURCHASE)');
}

// TODO(P1): COD pays cash immediately (cash-drawer effect); credit only
// updates the supplier payable, no immediate cash-drawer effect.
export function resolvePaymentEffect(_paymentType: PurchasePaymentType, _amount: number): { cashDrawerDelta: number; payableDelta: number } {
  throw new Error('TODO: implement COD/credit payment-effect resolution (P1 — post-beta, Volume 4 PURCHASE)');
}
