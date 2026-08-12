// domain/credit.ts — pure, framework-free credit-ledger math. Zero React/DB
// imports (DEVELOPMENT_RULES.md) — db/customers.ts fetches the raw ledger
// rows, this file only computes the running balance from them.
// Volume 4 CUSTOMER: "credit sales create a credits row; collections reduce
// the balance."

import { ZERO_PAISA, addPaisa, subtractPaisa, type Paisa } from '@muthoy/types';

export interface CreditLedgerEntry {
  type: 'credit_sale' | 'collection';
  amount: Paisa;
}

export function remainingBalance(entries: CreditLedgerEntry[]): Paisa {
  return entries.reduce(
    (balance, entry) => entry.type === 'credit_sale'
      ? addPaisa(balance, entry.amount)
      : subtractPaisa(balance, entry.amount),
    ZERO_PAISA,
  );
}
