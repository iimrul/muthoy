// domain/cashFormula.ts — pure, framework-free cash-drawer math.
// CLAUDE.md rule 4: this formula is FIXED — never approximate or re-derive
// it. Source: Volume 0 Day 7 / Volume 2's CashDrawerCalculator class diagram.
//
//   Expected Cash = Opening + CashSales + CreditCollections
//                    − Expenses − Refunds − SupplierPayments − Withdrawals
//
// CLAUDE.md rule 5: openingCash defaults to 0, set by the user, resets at
// midnight — this function must never be handed yesterday's value. Zero
// React/DB imports (DEVELOPMENT_RULES.md) — db/ fetches the raw numbers,
// this file only does the arithmetic.

import { addPaisa, subtractPaisa, type Paisa } from '@muthoy/types';

export interface CashFormulaInput {
  openingCash: Paisa;
  cashSales: Paisa;
  creditCollections: Paisa;
  expenses: Paisa;
  refunds: Paisa;
  supplierPayments: Paisa;
  withdrawals: Paisa;
}

// Uses branded integer-paisa helpers only; no rounding is needed or allowed.
export function expectedCash(input: CashFormulaInput): Paisa {
  const cashIn = addPaisa(input.openingCash, input.cashSales, input.creditCollections);
  const cashOut = addPaisa(input.expenses, input.refunds, input.supplierPayments, input.withdrawals);
  return subtractPaisa(cashIn, cashOut);
}
