// db/customers.ts — the ONLY file that will touch Drizzle/SQLite for
// Customer/Credit (DEVELOPMENT_RULES.md). Only checkout list/create are live;
// the full ledger/collection surface stays Day 9 scope.

import { and, eq, like, or } from 'drizzle-orm';
import type { Paisa } from '@muthoy/types';
import type { CreditLedgerEntry } from '../domain/credit';
import { db } from './client';
import { customers } from './schema';
import { generateId } from '../native/id';

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address?: string;
  notes?: string;
}

// Minimal checkout picker only. Full balance/history remains Day 9 scope.
export async function listCustomers(shopId: string, query?: string): Promise<Customer[]> {
  const search = query?.trim();
  const where = search
    ? and(
        eq(customers.shopId, shopId),
        eq(customers.isDeleted, false),
        or(like(customers.name, `%${search}%`), like(customers.phone, `%${search}%`)),
      )
    : and(eq(customers.shopId, shopId), eq(customers.isDeleted, false));

  return db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(where)
    .orderBy(customers.name)
    .limit(50)
    .all();
}

export interface CreateCustomerInput {
  shopId: string;
  name: string;
  phone?: string;
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const customer: Customer = { id: generateId(), name: input.name, phone: input.phone ?? null };
  db.insert(customers).values({ ...customer, shopId: input.shopId }).run();
  return customer;
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
