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

export interface CashFormulaInput {
  openingCash: number;
  cashSales: number;
  creditCollections: number;
  expenses: number;
  refunds: number;
  supplierPayments: number;
  withdrawals: number;
}

// TODO(Day 7): implement the fixed formula above exactly. Must have a
// passing unit test before Day 7 is considered done (Volume 0 Day 7
// checklist: "Cash formula unit tests pass").
export function expectedCash(_input: CashFormulaInput): number {
  throw new Error('TODO: implement the fixed cash formula (Volume 0 Day 7, CLAUDE.md rule 4)');
}
