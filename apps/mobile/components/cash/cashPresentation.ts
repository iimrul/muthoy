import type { Paisa } from "@muthoy/types";
import type { CashFormulaInput } from "../../domain/cashFormula";
import type { CashBreakdown } from "../../db/cash";
import type { CatalogKey } from "../../i18n/catalog";

// Presentation order and signs mirror Volume 3; arithmetic stays in domain/.
const TERMS = [
  ["openingCash", "cashFormulaOpen", ""],
  ["cashSales", "cashFormulaSales", "+"],
  ["creditCollections", "cashFormulaCollected", "+"],
  ["expenses", "cashFormulaExpense", "−"],
  ["refunds", "cashFormulaRefund", "−"],
  ["supplierPayments", "cashFormulaSupplier", "−"],
  ["withdrawals", "cashFormulaWithdrawal", "−"],
] as const satisfies readonly (readonly [
  keyof CashFormulaInput,
  CatalogKey,
  string,
])[];

export function breakdownFormulaInput(value: CashBreakdown): CashFormulaInput {
  return {
    openingCash: value.openingCash,
    cashSales: value.cashSales.total,
    creditCollections: value.creditCollections.total,
    expenses: value.expenses.total,
    refunds: value.refunds.total,
    supplierPayments: value.supplierPayments.total,
    withdrawals: value.withdrawals.total,
  };
}

export function cashFormulaCaption(
  input: CashFormulaInput | null,
  t: (key: CatalogKey) => string,
  formatMoney: (amount: Paisa) => string,
): string {
  return TERMS.map(([key, label, sign]) =>
    [sign, t(label), input === null ? "" : formatMoney(input[key])]
      .filter(Boolean)
      .join(" "),
  ).join(" ");
}
