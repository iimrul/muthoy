// domain/credit.ts — pure, framework-free credit-ledger math. Zero React/DB
// imports (DEVELOPMENT_RULES.md) — db/customers.ts fetches the raw ledger
// rows, this file only computes the running balance from them.
// Volume 4 CUSTOMER: "credit sales create a credits row; collections reduce
// the balance."

import type { Paisa } from '@muthoy/types';

export interface CreditLedgerEntry {
  type: 'credit_sale' | 'collection';
  amount: Paisa;
}

// TODO(Day 9): sum credit_sale amounts minus collection amounts to get the
// customer's current outstanding balance, using addPaisa/subtractPaisa from
// @muthoy/types. Must have a passing unit test — this is money logic
// (CLAUDE.md rule 10's spirit).
export function remainingBalance(_entries: CreditLedgerEntry[]): Paisa {
  throw new Error('TODO: implement credit ledger balance calculation (Volume 0 Day 9)');
}
