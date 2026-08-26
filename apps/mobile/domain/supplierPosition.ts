// domain/supplierPosition.ts — pure, framework-free supplier financial
// position: the ONE canonical derivation of payable/credit every screen and
// write path reuses (B3 Group 7, contract: "no screen may hand-calculate its
// own supplier position"). Zero React/DB imports (DEVELOPMENT_RULES.md) —
// db/ fetches purchases + their own-return credit, this file only does the
// allocation arithmetic.
//
// Stateless by design: nothing about "which invoice consumed which return's
// credit" is ever persisted. Both passes below are pure functions of the
// CURRENT set of a supplier's purchases and their own already-immutable
// return credit, so recomputing this fresh — from any device, at any time —
// always reproduces the same answer. See the approved Group 7 plan's "FINAL
// SUPPLIER CREDIT ALLOCATION MODEL" for the full rationale: this is correct
// specifically because "which invoice absorbs which credit" is a bookkeeping
// presentation of the current net position, not a real-world event that must
// be remembered.
//
// Allocation rule (locked):
//   A. A return's credit first offsets the remaining balance of the SAME
//      purchase it originated from (Pass 1, per-purchase, independent).
//   B. Any excess pools together and is distributed FIFO — oldest purchase
//      (by createdAt, id tiebreak) first — against every OTHER purchase's
//      remaining balance (Pass 2).
//   C. Whatever is left after every purchase is satisfied is the supplier's
//      standalone credit balance (the shop is owed money).
//
// `effectivePayable` is the one number every payment cap, status pill, and
// due display must use — never raw `total - paidAmount`. By construction,
// SUM(effectivePayable) === outstandingPayable always; this is a
// mathematical identity of the two-pass walk below, not a separately
// enforced rule.

import { ZERO_PAISA, addPaisa, subtractPaisa, type Paisa } from '@muthoy/types';

export interface SupplierPurchaseInput {
  purchaseId: string;
  /** Stable sort key — see the module doc: (createdAt, purchaseId) is the
   * total order every device computes identically once both rows are synced. */
  createdAt: string;
  total: Paisa;
  paidAmount: Paisa;
  /** SUM(purchase_returns.credit_amount) for returns against THIS purchase only. */
  ownReturnCredit: Paisa;
}

export interface SupplierInvoicePosition {
  purchaseId: string;
  originalRemaining: Paisa;
  returnCreditApplied: Paisa;
  supplierCreditApplied: Paisa;
  effectivePayable: Paisa;
}

export interface SupplierPosition {
  invoices: SupplierInvoicePosition[];
  outstandingPayable: Paisa;
  supplierCredit: Paisa;
}

function minPaisa(a: Paisa, b: Paisa): Paisa {
  return (a < b ? a : b) as Paisa;
}

function sortKey(input: SupplierPurchaseInput): string {
  return `${input.createdAt} ${input.purchaseId}`;
}

export function computeSupplierPosition(
  purchasesInput: readonly SupplierPurchaseInput[],
): SupplierPosition {
  const ordered = [...purchasesInput].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  // Pass 1 — same-purchase offset (rule A). Each purchase's own return
  // credit is capped at what that purchase itself still owes; nothing above
  // that can be "used" here — it becomes excess for the shared pool.
  const pass1 = ordered.map((purchase) => {
    // Floored at zero defensively: total >= paidAmount always holds given
    // how paidAmount is ever written (payment caps, COD residual-cash — see
    // the Group 7 plan), but this function must never propagate a negative
    // remaining even if a caller passes malformed input.
    const originalRemaining = (Math.max(0, subtractPaisa(purchase.total, purchase.paidAmount)) as Paisa);
    const returnCreditApplied = minPaisa(purchase.ownReturnCredit, originalRemaining);
    return {
      purchaseId: purchase.purchaseId,
      originalRemaining,
      returnCreditApplied,
      sameInvoiceExcess: subtractPaisa(purchase.ownReturnCredit, returnCreditApplied),
      remainingAfterOwnReturn: subtractPaisa(originalRemaining, returnCreditApplied),
    };
  });

  // Pass 2 — FIFO distribution of the pooled excess (rule B), oldest first.
  let pool = pass1.reduce((sum, p) => addPaisa(sum, p.sameInvoiceExcess), ZERO_PAISA);
  const invoices: SupplierInvoicePosition[] = pass1.map((p) => {
    const supplierCreditApplied = minPaisa(p.remainingAfterOwnReturn, pool);
    pool = subtractPaisa(pool, supplierCreditApplied);
    return {
      purchaseId: p.purchaseId,
      originalRemaining: p.originalRemaining,
      returnCreditApplied: p.returnCreditApplied,
      supplierCreditApplied,
      effectivePayable: subtractPaisa(p.remainingAfterOwnReturn, supplierCreditApplied),
    };
  });

  const outstandingPayable = invoices.reduce((sum, inv) => addPaisa(sum, inv.effectivePayable), ZERO_PAISA);
  // rule C: whatever the pool has left once every purchase is satisfied.
  return { invoices, outstandingPayable, supplierCredit: pool };
}

/** Convenience accessor — the one figure recordSupplierPayment must cap against. */
export function effectivePayableFor(position: SupplierPosition, purchaseId: string): Paisa {
  return position.invoices.find((inv) => inv.purchaseId === purchaseId)?.effectivePayable ?? ZERO_PAISA;
}
