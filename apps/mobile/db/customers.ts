// SQLite-backed customer directory, credit ledger, and collections.

import { and, asc, eq, gt, like, or } from "drizzle-orm";
import { ZERO_PAISA, asPaisa, type Paisa } from "@muthoy/types";
import { DHAKA_SQL_OFFSET, dhakaBusinessDate } from "@muthoy/utils";
import { expectedCash } from "../domain/cashFormula";
import { overdueBeforeDate } from "../domain/dashboard";
import { generateId } from "../native/id";
import { requirePermission } from "./auth";
import { permissionForDataGate } from "./dataAccessGates";
import { assertBusinessDateOpen, getCashSummarySync } from "./cash";
import { assertSessionLive } from "./errors";
import { getB2Settings } from "./settings";
import { db, sqliteConnection } from "./client";
import {
  cashDrawer,
  creditPaymentAllocations,
  credits,
  customers,
  payments,
  users,
} from "./schema";
import {
  recordChange,
  stampUpdatedAt,
  type SyncOperationGroup,
} from "./sync-helpers";

/** B3 Group 4 (W-4): the previous hardcoded LIMIT 50 replaced by real paging. */
export const CUSTOMER_LIST_PAGE_SIZE = 30;

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string | null;
}

export interface Customer extends CustomerListItem {
  address: string | null;
  notes: string | null;
}

export async function listCustomers(
  shopId: string,
  query?: string,
): Promise<CustomerListItem[]> {
  const search = query?.trim();
  const where = search
    ? and(
        eq(customers.shopId, shopId),
        eq(customers.isDeleted, false),
        or(
          like(customers.name, `%${search}%`),
          like(customers.phone, `%${search}%`),
        ),
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

export async function createCustomer(
  input: CreateCustomerInput,
): Promise<Customer> {
  // Standalone customer creation lives on the same owner-only admin surface as
  // the rest of app/credit/* — checked before any row is written.
  await requirePermission(input.shopId, input.actorUserId, permissionForDataGate("creditManage"));

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
    const values = {
      ...customer,
      shopId: input.shopId,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(customers).values(values).run();
    recordChange(tx, {
      shopId: input.shopId,
      table: "customers",
      rowId: customer.id,
      op: "insert",
      payload: values,
    });
  });
  return customer;
}

export async function getCustomer(
  shopId: string,
  actorUserId: string,
  customerId: string,
): Promise<Customer> {
  await requirePermission(shopId, actorUserId, permissionForDataGate("creditView"));
  const customer = db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      address: customers.address,
      notes: customers.notes,
    })
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.shopId, shopId),
        eq(customers.isDeleted, false),
      ),
    )
    .get();

  if (!customer) {
    throw new Error("Customer does not belong to this shop");
  }
  return customer;
}

export interface CreditLedgerRow {
  id: string;
  type: "credit_sale" | "collection";
  amount: Paisa;
  createdAt: string;
}

interface RawCreditLedgerRow {
  id: string;
  type: "credit_sale" | "collection";
  amount: number;
  createdAt: string;
}

function getCustomerLedgerRowsSync(
  shopId: string,
  customerId: string,
): CreditLedgerRow[] {
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
  await requirePermission(shopId, actorUserId, permissionForDataGate("creditView"));
  return getCustomerLedgerRowsSync(shopId, customerId);
}

// Contract §5.3 / W-1 canonicalization: the ONLY balance derivation used
// anywhere credits.balance already was the source of truth (getCustomerCreditDetail,
// shopHasOverdueCredit, ownerDashboard.getCreditSummary) — and now here too.
// A prior ledger-sum formula (SUM(credits.amount) - SUM(customer_payment))
// diverged from this one after createFullSaleRefund zeroes credits.balance
// without an offsetting payments row: refund correctly zeroes balance-column,
// so switching every read to balance-column (rather than patching the write
// side) is what keeps list/detail/dashboard/collectPayment in permanent
// agreement. See db/credit-balance-canonical.sqlite.test.ts.
const CUSTOMER_BALANCE_SUBQUERY = `COALESCE((SELECT SUM(cr.balance) FROM credits AS cr
   WHERE cr.shop_id = c.shop_id AND cr.customer_id = c.id AND cr.is_deleted = 0), 0)`;

/** Scalar twin of CUSTOMER_BALANCE_SUBQUERY for single-customer callers (e.g. collectPayment's pre-check). */
export function getCustomerBalanceSync(shopId: string, customerId: string): Paisa {
  const row = sqliteConnection.getFirstSync<{ balance: number }>(
    `SELECT COALESCE(SUM(balance), 0) AS balance FROM credits
      WHERE shop_id = $shopId AND customer_id = $customerId AND is_deleted = 0`,
    { $shopId: shopId, $customerId: customerId },
  );
  return asPaisa(row?.balance ?? 0);
}

interface CustomerBalanceRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  balance: number;
}

interface CustomerBalanceRowExtended extends CustomerBalanceRow {
  lastTransactionAt: string | null;
  overdue: number;
  soldByName: string | null;
}

export interface CustomerWithBalance extends Customer {
  balance: Paisa;
  lastTransactionAt: string | null;
  /** Contract §5.3: derived from `credit_max_days` — never a stored flag. */
  overdue: boolean;
  /** CS-6: the staff who made the customer's most recent credit sale. */
  soldByName: string | null;
}

// B3 Group 4 (W-4): the previous LIMIT 50 with no offset made the list and the
// dashboard's uncapped dues KPI disagree for any shop with >50 debtors, and
// left no way to reach a debtor past row 50. `limit`/`offset` replace the cap;
// the caller (Credit Sales) paginates via FlatList onEndReached. Search still
// narrows the WHERE clause first, so a search result is never truncated by
// the page size the way the old cap could truncate it.
export async function listCustomersWithBalance(
  shopId: string,
  actorUserId: string,
  query?: string,
  limit: number = CUSTOMER_LIST_PAGE_SIZE,
  offset = 0,
): Promise<CustomerWithBalance[]> {
  await requirePermission(shopId, actorUserId, permissionForDataGate("creditView"));
  const { creditMaxDays } = await getB2Settings(shopId);
  const businessDate = dhakaBusinessDate(new Date());
  const overdueBefore = overdueBeforeDate(businessDate, creditMaxDays);
  const search = query?.trim();
  const searchClause = search
    ? `AND (c.name LIKE $search OR c.phone LIKE $search OR c.id LIKE $search)`
    : "";
  const rows = sqliteConnection.getAllSync<CustomerBalanceRowExtended>(
    `SELECT c.id, c.name, c.phone, c.address, c.notes,
            ${CUSTOMER_BALANCE_SUBQUERY} AS balance,
            (SELECT MAX(x.createdAt) FROM (
                SELECT cr.created_at AS createdAt FROM credits AS cr
                 WHERE cr.shop_id = c.shop_id AND cr.customer_id = c.id AND cr.is_deleted = 0
                UNION ALL
                SELECT p.created_at AS createdAt FROM payments AS p
                 WHERE p.shop_id = c.shop_id AND p.type = 'customer_payment'
                   AND p.party_id = c.id AND p.is_deleted = 0
              ) AS x) AS lastTransactionAt,
            (SELECT COUNT(*) FROM credits AS cr
               WHERE cr.shop_id = c.shop_id AND cr.customer_id = c.id AND cr.is_deleted = 0
                 AND cr.balance > 0
                 AND date(cr.created_at, '${DHAKA_SQL_OFFSET}') < $overdueBefore) AS overdue,
            (SELECT u.name FROM credits AS cr2
               LEFT JOIN sales AS s2 ON s2.id = cr2.sale_id
               LEFT JOIN users AS u ON u.id = s2.staff_id
              WHERE cr2.shop_id = c.shop_id AND cr2.customer_id = c.id AND cr2.is_deleted = 0
              ORDER BY cr2.created_at DESC, cr2.id DESC LIMIT 1) AS soldByName
       FROM customers AS c
      WHERE c.shop_id = $shopId AND c.is_deleted = 0
        ${searchClause}
      ORDER BY c.name
      LIMIT $limit OFFSET $offset`,
    {
      $shopId: shopId,
      $overdueBefore: overdueBefore,
      $limit: limit,
      $offset: offset,
      ...(search ? { $search: `%${search}%` } : {}),
    },
  );
  return rows.map((row) => ({
    ...row,
    balance: asPaisa(row.balance),
    overdue: row.overdue > 0,
  }));
}

export interface CustomerListTotals {
  customerCount: number;
  totalOutstanding: Paisa;
}

// The Credit Sales header card (CS-3) sums EVERY customer's balance and
// counts every customer — not just the current page — so it never disagrees
// with what paging in on later pages reveals.
export async function getCustomerListTotals(
  shopId: string,
  actorUserId: string,
  query?: string,
): Promise<CustomerListTotals> {
  await requirePermission(shopId, actorUserId, permissionForDataGate("creditView"));
  const search = query?.trim();
  const searchClause = search
    ? `AND (c.name LIKE $search OR c.phone LIKE $search OR c.id LIKE $search)`
    : "";
  const row = sqliteConnection.getFirstSync<{ customerCount: number; totalOutstanding: number }>(
    `SELECT COUNT(*) AS customerCount,
            COALESCE(SUM(${CUSTOMER_BALANCE_SUBQUERY}), 0) AS totalOutstanding
       FROM customers AS c
      WHERE c.shop_id = $shopId AND c.is_deleted = 0
        ${searchClause}`,
    search ? { $shopId: shopId, $search: `%${search}%` } : { $shopId: shopId },
  );
  return {
    customerCount: row?.customerCount ?? 0,
    totalOutstanding: asPaisa(row?.totalOutstanding ?? 0),
  };
}

export type CustomerPaymentMethod =
  "cash" | "bkash" | "nagad" | "rocket" | "card" | "bank" | "other";

export interface CollectPaymentInput {
  shopId: string;
  staffId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  customerId: string;
  amount: Paisa;
  method?: CustomerPaymentMethod;
}

export async function collectPayment(
  input: CollectPaymentInput,
): Promise<void> {
  // Owner-only (Volume 0 Day 11 P0: Staff is sales + inventory-view only).
  // Checked before the transaction opens and against SQLite's role, not the
  // session store, so a Staff/Manager login reaching this by direct
  // navigation writes no payment row, touches no cash drawer, and enqueues
  // nothing to the outbox.
  await requirePermission(input.shopId, input.staffId, permissionForDataGate("creditManage"));

  if (!Number.isInteger(input.amount) || input.amount <= ZERO_PAISA) {
    throw new Error(
      "Collection amount must be a positive whole number of paisa",
    );
  }

  const method = input.method ?? "cash";
  const now = new Date();
  const businessDate = dhakaBusinessDate(now);

  // Keep this callback synchronous/no-await: the balance check and payment
  // write rely on sharing one uninterrupted SQLite transaction.
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const customer = tx
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, input.customerId),
          eq(customers.shopId, input.shopId),
          eq(customers.isDeleted, false),
        ),
      )
      .get();
    if (!customer) {
      throw new Error("Customer does not belong to this shop");
    }

    const staff = tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.staffId),
          eq(users.shopId, input.shopId),
          eq(users.isActive, true),
          eq(users.isDeleted, false),
        ),
      )
      .get();
    if (!staff) {
      throw new Error("Active staff session does not belong to this shop");
    }

    // Codex-flagged gap: creditCollected in a closed day's EOD snapshot sums
    // ALL payment methods for the business date, so a non-cash collection
    // must be blocked too, not just the cash-drawer-touching branch below.
    assertBusinessDateOpen(tx, input.shopId, businessDate);

    const balance = getCustomerBalanceSync(input.shopId, input.customerId);
    if (input.amount > balance) {
      throw new Error("Collection amount exceeds outstanding balance");
    }

    const paymentId = generateId();
    const paymentNow = new Date().toISOString();
    const openCredits = tx
      .select({ id: credits.id, balance: credits.balance })
      .from(credits)
      .where(
        and(
          eq(credits.shopId, input.shopId),
          eq(credits.customerId, input.customerId),
          eq(credits.isDeleted, false),
          gt(credits.balance, ZERO_PAISA),
        ),
      )
      .orderBy(asc(credits.createdAt), asc(credits.id))
      .all();
    let plannedRemaining = input.amount;
    let allocationCount = 0;
    for (const credit of openCredits) {
      if (plannedRemaining === ZERO_PAISA) break;
      plannedRemaining = asPaisa(
        plannedRemaining - Math.min(plannedRemaining, credit.balance),
      );
      allocationCount += 1;
    }
    if (plannedRemaining !== ZERO_PAISA)
      throw new Error("Collection could not be allocated to sale credits");
    const existingDrawer =
      method === "cash"
        ? tx
            .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
            .from(cashDrawer)
            .where(
              and(
                eq(cashDrawer.shopId, input.shopId),
                eq(cashDrawer.businessDate, businessDate),
              ),
            )
            .get()
        : undefined;
    if (existingDrawer?.isDeleted)
      throw new Error(
        "Today's cash drawer row is deleted and cannot be reused",
      );
    const expectedCount =
      1 +
      allocationCount * 2 +
      (method === "cash" ? (existingDrawer ? 1 : 2) : 0);
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: paymentId,
      kind: "credit_collection",
      sequence: sequence++,
      expectedCount,
    });
    const paymentValues = {
      id: paymentId,
      shopId: input.shopId,
      type: "customer_payment" as const,
      partyId: input.customerId,
      amount: input.amount,
      method,
      refId: null,
      createdBy: input.staffId,
      createdAt: paymentNow,
      updatedAt: paymentNow,
    };
    tx.insert(payments).values(paymentValues).run();
    recordChange(tx, {
      shopId: input.shopId,
      table: "payments",
      rowId: paymentId,
      op: "insert",
      payload: paymentValues,
      operation: operation(),
    });

    let remainingToAllocate = input.amount;
    for (const credit of openCredits) {
      if (remainingToAllocate === ZERO_PAISA) break;
      const amount = asPaisa(Math.min(remainingToAllocate, credit.balance));
      const allocationId = generateId();
      const allocationValues = {
        id: allocationId,
        shopId: input.shopId,
        customerId: input.customerId,
        paymentId,
        creditId: credit.id,
        amount,
        createdAt: paymentNow,
        updatedAt: paymentNow,
      };
      tx.insert(creditPaymentAllocations).values(allocationValues).run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "credit_payment_allocations",
        rowId: allocationId,
        op: "insert",
        payload: allocationValues,
        operation: operation(),
      });
      const creditValues = stampUpdatedAt({
        balance: asPaisa(credit.balance - amount),
        isDirty: true,
      });
      tx.update(credits)
        .set(creditValues)
        .where(and(eq(credits.id, credit.id), eq(credits.shopId, input.shopId)))
        .run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "credits",
        rowId: credit.id,
        op: "update",
        payload: creditValues,
        operation: operation(),
      });
      remainingToAllocate = asPaisa(remainingToAllocate - amount);
    }
    if (remainingToAllocate !== ZERO_PAISA) {
      throw new Error("Collection could not be allocated to sale credits");
    }

    if (method !== "cash") {
      if (sequence !== expectedCount)
        throw new Error("Credit collection operation count mismatch");
      return;
    }

    const drawerId = existingDrawer?.id ?? generateId();
    if (!existingDrawer) {
      const drawerValues = {
        id: drawerId,
        shopId: input.shopId,
        businessDate,
        openingCash: ZERO_PAISA,
        openedBy: input.staffId,
        openedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      tx.insert(cashDrawer).values(drawerValues).run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "cash_drawer",
        rowId: drawerId,
        op: "insert",
        payload: drawerValues,
        operation: operation(),
      });
    }

    const closingExpected = expectedCash(
      getCashSummarySync(input.shopId, businessDate),
    );
    const drawerValues = stampUpdatedAt({ closingExpected, isDirty: true });
    const drawerUpdate = tx
      .update(cashDrawer)
      .set(drawerValues)
      .where(
        and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, input.shopId)),
      )
      .run();
    if (drawerUpdate.changes !== 1) {
      throw new Error("Cash drawer could not be updated");
    }
    recordChange(tx, {
      shopId: input.shopId,
      table: "cash_drawer",
      rowId: drawerId,
      op: "update",
      payload: drawerValues,
      operation: operation(),
    });
    if (sequence !== expectedCount)
      throw new Error("Credit collection operation count mismatch");
  });
}

function inClause(
  prefix: string,
  values: string[],
): { clause: string; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const names = values.map((value, index) => {
    const name = `$${prefix}${index}`;
    params[name] = value;
    return name;
  });
  return { clause: names.join(","), params };
}

export type CreditRecordStatus = "unpaid" | "partial" | "settled";

export interface CreditRecordItem {
  name: string;
  qty: number;
}

export interface CreditAllocationRow {
  paymentId: string;
  amount: Paisa;
  method: CustomerPaymentMethod;
  /** External reference for this payment (bank/mobile-money txn id), if any. */
  refId: string | null;
  createdAt: string;
}

export interface CreditRecord {
  id: string;
  amount: Paisa;
  balance: Paisa;
  paidAmount: Paisa;
  status: CreditRecordStatus;
  createdAt: string;
  /** True once this row has been pushed to the cloud (`is_dirty = 0`). */
  synced: boolean;
  /** Contract §5.3: same derived expression as the list badge and the KPI. */
  overdue: boolean;
  /** The originating sale's invoice number, when this credit came from a sale. */
  invoiceNo: string | null;
  staffName: string | null;
  items: CreditRecordItem[];
  itemsMoreCount: number;
  allocations: CreditAllocationRow[];
}

export interface CustomerCreditDetail {
  customer: Customer;
  totalDue: Paisa;
  totalPurchases: number;
  settledCount: number;
  credits: CreditRecord[];
}

interface RawCreditDetailRow {
  id: string;
  amount: number;
  balance: number;
  createdAt: string;
  isDirty: number;
  saleId: string | null;
  invoiceNo: string | null;
  staffName: string | null;
  overdue: number;
}

interface RawItemRow {
  saleId: string;
  name: string;
  qty: number;
}

interface RawAllocationRow {
  creditId: string;
  paymentId: string;
  amount: number;
  method: CustomerPaymentMethod;
  refId: string | null;
  createdAt: string;
}

const ITEM_PREVIEW_COUNT = 2;

// CD-1..CD-15: the Customer Credit Detail read — every credit this customer
// ever received, each one's own settlement status, the sale it came from
// (item preview + who sold it), and which collections cleared it. `status`
// and `overdue` both reuse the exact expressions listCustomersWithBalance and
// ownerDashboard.getCreditSummary already use (contract §5.3) — nothing here
// re-derives its own notion of "settled" or "overdue".
export async function getCustomerCreditDetail(
  shopId: string,
  actorUserId: string,
  customerId: string,
): Promise<CustomerCreditDetail> {
  await requirePermission(shopId, actorUserId, permissionForDataGate("creditView"));
  const customer = await getCustomer(shopId, actorUserId, customerId);
  const { creditMaxDays } = await getB2Settings(shopId);
  const businessDate = dhakaBusinessDate(new Date());
  const overdueBefore = overdueBeforeDate(businessDate, creditMaxDays);

  const rows = sqliteConnection.getAllSync<RawCreditDetailRow>(
    `SELECT c.id, c.amount, c.balance, c.created_at AS createdAt, c.is_dirty AS isDirty,
            c.sale_id AS saleId, s.invoice_no AS invoiceNo, u.name AS staffName,
            CASE WHEN c.balance > 0 AND date(c.created_at, '${DHAKA_SQL_OFFSET}') < $overdueBefore
                 THEN 1 ELSE 0 END AS overdue
       FROM credits c
       LEFT JOIN sales s ON s.id = c.sale_id
       LEFT JOIN users u ON u.id = s.staff_id
      WHERE c.shop_id = $shopId AND c.customer_id = $customerId AND c.is_deleted = 0
      ORDER BY c.created_at DESC, c.id DESC`,
    { $shopId: shopId, $customerId: customerId, $overdueBefore: overdueBefore },
  );

  const saleIds = [...new Set(rows.map((row) => row.saleId).filter((id): id is string => Boolean(id)))];
  const creditIds = rows.map((row) => row.id);

  const itemsBySale = new Map<string, CreditRecordItem[]>();
  if (saleIds.length > 0) {
    const { clause, params } = inClause("sale", saleIds);
    const itemRows = sqliteConnection.getAllSync<RawItemRow>(
      `SELECT si.sale_id AS saleId,
              COALESCE(si.medicine_name_snapshot, m.name) AS name,
              si.qty AS qty
         FROM sale_items si
         LEFT JOIN medicines m ON m.id = si.medicine_id
        WHERE si.sale_id IN (${clause}) AND si.is_deleted = 0
        ORDER BY si.sale_id, si.created_at ASC, si.id ASC`,
      params,
    );
    for (const item of itemRows) {
      const list = itemsBySale.get(item.saleId) ?? [];
      list.push({ name: item.name, qty: item.qty });
      itemsBySale.set(item.saleId, list);
    }
  }

  const allocationsByCredit = new Map<string, CreditAllocationRow[]>();
  if (creditIds.length > 0) {
    const { clause, params } = inClause("credit", creditIds);
    const allocationRows = sqliteConnection.getAllSync<RawAllocationRow>(
      `SELECT a.credit_id AS creditId, a.payment_id AS paymentId, a.amount AS amount,
              p.method AS method, p.ref_id AS refId, p.created_at AS createdAt
         FROM credit_payment_allocations a
         JOIN payments p ON p.id = a.payment_id
        WHERE a.credit_id IN (${clause}) AND a.is_deleted = 0
        ORDER BY p.created_at ASC, p.id ASC`,
      params,
    );
    for (const allocation of allocationRows) {
      const list = allocationsByCredit.get(allocation.creditId) ?? [];
      list.push({
        paymentId: allocation.paymentId,
        amount: asPaisa(allocation.amount),
        method: allocation.method,
        refId: allocation.refId,
        createdAt: allocation.createdAt,
      });
      allocationsByCredit.set(allocation.creditId, list);
    }
  }

  let totalDue: Paisa = ZERO_PAISA;
  let settledCount = 0;
  const creditRecords: CreditRecord[] = rows.map((row) => {
    const balance = asPaisa(row.balance);
    const amount = asPaisa(row.amount);
    const paidAmount = asPaisa(amount - balance);
    const status: CreditRecordStatus =
      balance === ZERO_PAISA ? "settled" : paidAmount > ZERO_PAISA ? "partial" : "unpaid";
    if (status === "settled") settledCount += 1;
    totalDue = asPaisa(totalDue + balance);
    const allItems = row.saleId ? (itemsBySale.get(row.saleId) ?? []) : [];
    return {
      id: row.id,
      amount,
      balance,
      paidAmount,
      status,
      createdAt: row.createdAt,
      synced: !row.isDirty,
      overdue: row.overdue > 0,
      invoiceNo: row.invoiceNo,
      staffName: row.staffName,
      items: allItems.slice(0, ITEM_PREVIEW_COUNT),
      itemsMoreCount: Math.max(0, allItems.length - ITEM_PREVIEW_COUNT),
      allocations: allocationsByCredit.get(row.id) ?? [],
    };
  });

  return {
    customer,
    totalDue,
    totalPurchases: creditRecords.length,
    settledCount,
    credits: creditRecords,
  };
}

// B3 Group 4 (CP-5) — used only by native/notifications.ts's background
// checker, which has already confirmed the persisted session's own shop
// before calling this. Not permission-gated for the same reason
// runLowStockCheck's listMedicines/listBatchesForMedicine calls aren't: it
// never renders to a screen, it only decides whether to write a notification
// row, and that row's own visibility is gated on READ by
// db/notifications.ts's REQUIRED_PERMISSION map. Reuses the exact expression
// getCustomerListTotals/getCustomerCreditDetail/ownerDashboard.getCreditSummary
// all share (contract §5.3) — a second definition here would be exactly the
// class of bug (W-1/W-2) this plan already caught once.
export function shopHasOverdueCredit(
  shopId: string,
  businessDate: string,
  creditMaxDays: number,
): boolean {
  const overdueBefore = overdueBeforeDate(businessDate, creditMaxDays);
  const row = sqliteConnection.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM credits
      WHERE shop_id = $shopId AND is_deleted = 0 AND balance > 0
        AND date(created_at, '${DHAKA_SQL_OFFSET}') < $overdueBefore`,
    { $shopId: shopId, $overdueBefore: overdueBefore },
  );
  return (row?.count ?? 0) > 0;
}
