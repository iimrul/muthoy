// db/customers.ts — the ONLY file that will touch Drizzle/SQLite for
// Customer/Credit (DEVELOPMENT_RULES.md). The Drizzle schema doesn't exist
// yet (Day 2), so these are signature-only stubs — no Drizzle import until then.

import type { Paisa } from '@muthoy/types';
import type { CreditLedgerEntry } from '../domain/credit';

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
}

// TODO(Day 9): list customers for a shop, with outstanding balance
// (domain/credit.remainingBalance over each customer's ledger).
export async function listCustomers(_shopId: string): Promise<(Customer & { balance: Paisa })[]> {
  throw new Error('TODO: implement customer list query (Volume 0 Day 9)');
}

export async function createCustomer(_shopId: string, _customer: Omit<Customer, 'id'>): Promise<Customer> {
  throw new Error('TODO: implement customer creation (Volume 0 Day 9)');
}

// TODO(Day 9): every credit_sale + collection row for this customer, for
// domain/credit.remainingBalance and the ledger view.
export async function getCustomerCreditLedger(_customerId: string): Promise<CreditLedgerEntry[]> {
  throw new Error('TODO: implement credit ledger query (Volume 0 Day 9)');
}

// TODO(Day 9): writes a `credits` row against the given (or newly created)
// customer. Must NOT touch the cash drawer (Volume 0 Day 9 checklist) —
// only collectPayment below does.
export async function recordCreditSale(_saleId: string, _customerId: string, _amount: Paisa): Promise<void> {
  throw new Error('TODO: implement credit sale recording (Volume 0 Day 9)');
}

// TODO(Day 9): reduces the customer's balance AND adds to the cash drawer as
// a CreditCollection (Volume 4 CUSTOMER) — feeds domain/cashFormula's
// creditCollections input.
export async function collectPayment(_customerId: string, _amount: Paisa): Promise<void> {
  throw new Error('TODO: implement credit collection (Volume 0 Day 9)');
}
