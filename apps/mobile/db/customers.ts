// SQLite-backed customer directory, credit ledger, and collections.

import { and, eq, like, or } from 'drizzle-orm';
import { ZERO_PAISA, asPaisa, type Paisa } from '@muthoy/types';
import { expectedCash } from '../domain/cashFormula';
import { remainingBalance } from '../domain/credit';
import { generateId } from '../native/id';
import { requirePermission } from './auth';
import { assertBusinessDateOpen, getCashSummarySync } from './cash';
import { assertSessionLive } from './errors';
import { db, sqliteConnection } from './client';
import { cashDrawer, customers, payments, users } from './schema';
import { recordChange, stampUpdatedAt } from './sync-helpers';

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
}

export interface Customer extends CustomerListItem {
  address: string | null;
  notes: string | null;
}

export async function listCustomers(shopId: string, query?: string): Promise<CustomerListItem[]> {
  const search = query?.trim();
  const where = search
    ? and(
        eq(customers.shopId, shopId),
        eq(customers.isDeleted, false),
        or(like(customers.name, `%${search}%`), like(customers.phone, `%${search}%`)),
      )
    : and(eq(customers.shopId, shopId), eq(customers.isDeleted, false));

  return db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
    })
    .from(customers)
    .where(where)
    .orderBy(customers.name)
    .limit(50)
    .all();
}

export interface CreateCustomerInput {
  shopId: string;
  actorUserId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  // Standalone customer creation lives on the same owner-only admin surface as
  // the rest of app/credit/* — checked before any row is written.
  await requirePermission(input.shopId, input.actorUserId, 'credit_management');

  const customer: Customer = {
    id: generateId(),
    name: input.name,
    phone: input.phone ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
  };
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const now = new Date().toISOString();
    const values = { ...customer, shopId: input.shopId, createdAt: now, updatedAt: now };
    tx.insert(customers).values(values).run();
    recordChange(tx, { shopId: input.shopId, table: 'customers', rowId: customer.id, op: 'insert', payload: values });
  });
  return customer;
}

export async function getCustomer(shopId: string, actorUserId: string, customerId: string): Promise<Customer> {
  await requirePermission(shopId, actorUserId, 'credit_view');
  const customer = db.select({
    id: customers.id,
    name: customers.name,
    phone: customers.phone,
    address: customers.address,
    notes: customers.notes,
  }).from(customers).where(and(
    eq(customers.id, customerId),
    eq(customers.shopId, shopId),
    eq(customers.isDeleted, false),
  )).get();

  if (!customer) {
    throw new Error('Customer does not belong to this shop');
  }
  return customer;
}

export interface CreditLedgerRow {
  id: string;
  type: 'credit_sale' | 'collection';
  amount: Paisa;
  createdAt: string;
}

interface RawCreditLedgerRow {
  id: string;
  type: 'credit_sale' | 'collection';
  amount: number;
  createdAt: string;
}

function getCustomerLedgerRowsSync(shopId: string, customerId: string): CreditLedgerRow[] {
  const rows = sqliteConnection.getAllSync<RawCreditLedgerRow>(
    `SELECT id, type, amount, createdAt
       FROM (
         SELECT id, 'credit_sale' AS type, amount, created_at AS createdAt
           FROM credits
          WHERE shop_id = $shopId AND customer_id = $customerId AND is_deleted = 0
         UNION ALL
         SELECT id, 'collection' AS type, amount, created_at AS createdAt
           FROM payments
          WHERE shop_id = $shopId AND type = 'customer_payment'
            AND party_id = $customerId AND is_deleted = 0
       )
      ORDER BY createdAt DESC, id DESC`,
    { $shopId: shopId, $customerId: customerId },
  );
  return rows.map((row) => ({ ...row, amount: asPaisa(row.amount) }));
}

export async function getCustomerCreditLedger(
  shopId: string,
  actorUserId: string,
  customerId: string,
): Promise<CreditLedgerRow[]> {
  await requirePermission(shopId, actorUserId, 'credit_view');
  return getCustomerLedgerRowsSync(shopId, customerId);
}

interface CustomerBalanceRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
}

export async function listCustomersWithBalance(
  shopId: string,
  actorUserId: string,
  query?: string,
): Promise<(Customer & { balance: Paisa })[]> {
  await requirePermission(shopId, actorUserId, 'credit_view');
  const search = query?.trim();
  const searchClause = search
    ? `AND (c.name LIKE $search OR c.phone LIKE $search)`
    : '';
  const rows = sqliteConnection.getAllSync<CustomerBalanceRow>(
    `SELECT c.id, c.name, c.phone, c.address, c.notes,
            COALESCE((SELECT SUM(cr.amount)
                        FROM credits AS cr
                       WHERE cr.shop_id = c.shop_id
                         AND cr.customer_id = c.id
                         AND cr.is_deleted = 0), 0)
            -
            COALESCE((SELECT SUM(p.amount)
                        FROM payments AS p
                       WHERE p.shop_id = c.shop_id
                         AND p.type = 'customer_payment'
                         AND p.party_id = c.id
                         AND p.is_deleted = 0), 0) AS balance
       FROM customers AS c
      WHERE c.shop_id = $shopId AND c.is_deleted = 0
        ${searchClause}
      ORDER BY c.name
      LIMIT 50`,
    search ? { $shopId: shopId, $search: `%${search}%` } : { $shopId: shopId },
  );
  return rows.map((row) => ({ ...row, balance: asPaisa(row.balance) }));
}

// Standalone credit creation is deliberately outside Day 9 scope. Checkout's
// createSaleTransaction already creates sale-backed credit rows atomically.
export async function recordCreditSale(_saleId: string, _customerId: string, _amount: Paisa): Promise<void> {
  throw new Error('TODO: implement credit sale recording (Volume 0 Day 9)');
}

export type CustomerPaymentMethod = 'cash' | 'bkash' | 'nagad' | 'rocket' | 'card' | 'bank' | 'other';

export interface CollectPaymentInput {
  shopId: string;
  staffId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  customerId: string;
  amount: Paisa;
  method?: CustomerPaymentMethod;
}

function localBusinessDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function collectPayment(input: CollectPaymentInput): Promise<void> {
  // Owner-only (Volume 0 Day 11 P0: Staff is sales + inventory-view only).
  // Checked before the transaction opens and against SQLite's role, not the
  // session store, so a Staff/Manager login reaching this by direct
  // navigation writes no payment row, touches no cash drawer, and enqueues
  // nothing to the outbox.
  await requirePermission(input.shopId, input.staffId, 'credit_management');

  if (!Number.isInteger(input.amount) || input.amount <= ZERO_PAISA) {
    throw new Error('Collection amount must be a positive whole number of paisa');
  }

  const method = input.method ?? 'cash';
  const now = new Date();
  const businessDate = localBusinessDate(now);

  // Keep this callback synchronous/no-await: the balance check and payment
  // write rely on sharing one uninterrupted SQLite transaction.
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const customer = tx.select({ id: customers.id }).from(customers).where(and(
      eq(customers.id, input.customerId),
      eq(customers.shopId, input.shopId),
      eq(customers.isDeleted, false),
    )).get();
    if (!customer) {
      throw new Error('Customer does not belong to this shop');
    }

    const staff = tx.select({ id: users.id }).from(users).where(and(
      eq(users.id, input.staffId),
      eq(users.shopId, input.shopId),
      eq(users.isActive, true),
      eq(users.isDeleted, false),
    )).get();
    if (!staff) {
      throw new Error('Active staff session does not belong to this shop');
    }

    // Codex-flagged gap: creditCollected in a closed day's EOD snapshot sums
    // ALL payment methods for the business date, so a non-cash collection
    // must be blocked too, not just the cash-drawer-touching branch below.
    assertBusinessDateOpen(tx, input.shopId, businessDate);

    const balance = remainingBalance(getCustomerLedgerRowsSync(input.shopId, input.customerId));
    if (input.amount > balance) {
      throw new Error('Collection amount exceeds outstanding balance');
    }

    const paymentId = generateId();
    const paymentNow = new Date().toISOString();
    const paymentValues = {
      id: paymentId,
      shopId: input.shopId,
      type: 'customer_payment' as const,
      partyId: input.customerId,
      amount: input.amount,
      method,
      refId: null,
      createdBy: input.staffId,
      createdAt: paymentNow, updatedAt: paymentNow,
    };
    tx.insert(payments).values(paymentValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'payments', rowId: paymentId, op: 'insert', payload: paymentValues });

    if (method !== 'cash') {
      return;
    }

    const existingDrawer = tx.select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
      .from(cashDrawer).where(and(
        eq(cashDrawer.shopId, input.shopId),
        eq(cashDrawer.businessDate, businessDate),
      )).get();
    if (existingDrawer?.isDeleted) {
      throw new Error("Today's cash drawer row is deleted and cannot be reused");
    }
    const drawerId = existingDrawer?.id ?? generateId();
    if (!existingDrawer) {
      const drawerValues = {
        id: drawerId,
        shopId: input.shopId,
        businessDate,
        openingCash: ZERO_PAISA,
        openedBy: input.staffId,
        openedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(),
      };
      tx.insert(cashDrawer).values(drawerValues).run();
      recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'insert', payload: drawerValues });
    }

    const closingExpected = expectedCash(getCashSummarySync(input.shopId, businessDate));
    const drawerValues = stampUpdatedAt({ closingExpected, isDirty: true });
    const drawerUpdate = tx.update(cashDrawer).set(drawerValues)
      .where(and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, input.shopId))).run();
    if (drawerUpdate.changes !== 1) {
      throw new Error('Cash drawer could not be updated');
    }
    recordChange(tx, { shopId: input.shopId, table: 'cash_drawer', rowId: drawerId, op: 'update', payload: drawerValues });
  });
}
