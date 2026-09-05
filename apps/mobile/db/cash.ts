// db/cash.ts — the ONLY file that touches Drizzle/SQLite for
// Expenses/Cash Summary/End of Day (DEVELOPMENT_RULES.md).
//
// CLAUDE.md rule 4: the cash formula itself is FIXED and lives in
// domain/cashFormula.ts. This file only fetches the raw numbers and hands
// them to expectedCash() — it never re-derives or approximates the formula.

import { and, eq } from "drizzle-orm";
import {
  expenseCategorySchema,
  type ExpenseCategory,
} from "@muthoy/validation";
import {
  ZERO_PAISA,
  addPaisa,
  asPaisa,
  subtractPaisa,
  type Paisa,
} from "@muthoy/types";
import { DHAKA_SQL_OFFSET, dhakaBusinessDate } from "@muthoy/utils";
import { expectedCash, type CashFormulaInput } from "../domain/cashFormula";
import { generateId } from "../native/id";
import { requireOwner, requirePermission } from "./auth";
import { requirePremiumFeature } from "./commercial";
import { permissionForDataGate } from "./dataAccessGates";
import { getEndOfDayReportSnapshot } from "./reports";
import { db, sqliteConnection } from "./client";
import { assertSessionLive, DayClosedError } from "./errors";
import { cashDrawer, expenses, payments, users } from "./schema";
import {
  recordChange,
  stampUpdatedAt,
  type SyncOperationGroup,
} from "./sync-helpers";

// Same alias sync-helpers.ts declares for itself; it is not exported there.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// CLAUDE.md rule 5: the business date resets at midnight and never inherits
// yesterday's row. Locked 2026-08-22: that midnight is Asia/Dhaka's, not the
// device's — the single definition every money read/write shares (W-1).
export function currentBusinessDate(now: Date = new Date()): string {
  return dhakaBusinessDate(now);
}

export async function hasCashDrawerForDate(
  shopId: string,
  businessDate: string,
): Promise<boolean> {
  return Boolean(
    sqliteConnection.getFirstSync<{ id: string }>(
      `SELECT id FROM cash_drawer WHERE shop_id=$shopId AND business_date=$businessDate AND is_deleted=0 LIMIT 1`,
      { $shopId: shopId, $businessDate: businessDate },
    ),
  );
}

// Centralized closed-day guard (Codex finding, post-Day-10 fix): a closed
// business date's cash_drawer row is the locked EOD snapshot — sales, credit
// collections and purchases all feed numbers that snapshot reports
// (totalSales/cogs/creditSales/newCreditGiven/creditCollected/expectedCash),
// so ANY of them writing against an already-closed date would silently
// invalidate closing_expected, counted cash and variance after the fact.
// Every money/stock write for "today" must call this FIRST, inside its own
// transaction, before touching any row — a throw here rolls the whole
// transaction back, so a blocked write leaves no partial rows or outbox
// entries. This function only READS cash_drawer; it never reopens or
// modifies a closed drawer.
export function assertBusinessDateOpen(
  tx: DbTransaction,
  shopId: string,
  businessDate: string,
): void {
  const drawer = tx
    .select({ closedAt: cashDrawer.closedAt })
    .from(cashDrawer)
    .where(
      and(
        eq(cashDrawer.shopId, shopId),
        eq(cashDrawer.businessDate, businessDate),
      ),
    )
    .get() as { closedAt: string | null } | undefined;
  if (drawer?.closedAt) {
    throw new DayClosedError(businessDate);
  }
}

interface DrawerLookupRow {
  id: string;
  isDeleted: boolean;
}

// Mirrors the ensure-drawer step already used by sales.ts, customers.ts and
// purchases.ts. Delegates the closed-day check to assertBusinessDateOpen so
// there is exactly one definition of "is this day locked" in the app.
function ensureOpenDrawer(
  tx: DbTransaction,
  shopId: string,
  businessDate: string,
  openedBy: string,
  now: Date,
  operation?: () => SyncOperationGroup,
): string {
  assertBusinessDateOpen(tx, shopId, businessDate);

  const existing = tx
    .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
    .from(cashDrawer)
    .where(
      and(
        eq(cashDrawer.shopId, shopId),
        eq(cashDrawer.businessDate, businessDate),
      ),
    )
    .get() as DrawerLookupRow | undefined;

  if (existing?.isDeleted) {
    throw new Error(
      "This day's cash drawer row is deleted and cannot be reused",
    );
  }
  if (existing) {
    return existing.id;
  }

  const drawerId = generateId();
  const timestamp = now.toISOString();
  const drawerValues = {
    id: drawerId,
    shopId,
    businessDate,
    openingCash: ZERO_PAISA,
    openedBy,
    openedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  tx.insert(cashDrawer).values(drawerValues).run();
  recordChange(tx, {
    shopId,
    table: "cash_drawer",
    rowId: drawerId,
    op: "insert",
    payload: drawerValues,
    operation: operation?.(),
  });
  return drawerId;
}

// Recomputes closing_expected from the live raw numbers through the shared
// formula, inside the same transaction as the write that changed them — the
// drawer can never lag the events it summarises.
function refreshClosingExpected(
  tx: DbTransaction,
  shopId: string,
  businessDate: string,
  drawerId: string,
  extraValues: Record<string, unknown> = {},
  operation?: () => SyncOperationGroup,
  updatedAtOverride?: string,
): void {
  const closingExpected = expectedCash(
    getCashSummarySync(shopId, businessDate),
  );
  const stampedValues = stampUpdatedAt({
    ...extraValues,
    closingExpected,
    isDirty: true,
  });
  const drawerValues = updatedAtOverride
    ? { ...stampedValues, updatedAt: updatedAtOverride }
    : stampedValues;
  const drawerUpdate = tx
    .update(cashDrawer)
    .set(drawerValues)
    .where(and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, shopId)))
    .run();
  if (drawerUpdate.changes !== 1) {
    throw new Error("Cash drawer could not be updated");
  }
  recordChange(tx, {
    shopId,
    table: "cash_drawer",
    rowId: drawerId,
    op: "update",
    payload: drawerValues,
    operation: operation?.(),
  });
}

function requireActiveUser(
  tx: DbTransaction,
  shopId: string,
  userId: string,
): void {
  const user = tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.shopId, shopId),
        eq(users.isActive, true),
        eq(users.isDeleted, false),
      ),
    )
    .get();
  if (!user) {
    throw new Error("Active staff session does not belong to this shop");
  }
}

export interface RecordExpenseInput {
  shopId: string;
  staffId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  category: ExpenseCategory;
  amount: Paisa;
  description?: string;
}

// Volume 0 Day 10: writes BOTH an `expenses` row and a `payments` row with
// type='expense', ref_id pointing at the expense — in ONE transaction, never
// two writes that could partially fail and leave money unaccounted for.
//
// The payment is always method='cash': getCashSummarySync subtracts the
// `expenses` table with no method filter, so a non-cash expense would still
// reduce expected cash. Supporting one would require changing the formula,
// and the formula is fixed (CLAUDE.md rule 4).
export async function recordExpense(
  input: RecordExpenseInput,
): Promise<{ expenseId: string }> {
  // Volume 0 Day 11 / founder decision D-3: expenses are owner-only, full
  // stop — not merely gated behind the cash_drawer permission a Manager can
  // hold by default. Matches the route rule (navigation/routes.ts: '/expenses'
  // is `{ kind: 'owner' }`), closing the drift where a Manager reaching this
  // by direct call, not navigation, could otherwise write an expense.
  await requireOwner(input.shopId, input.staffId);
  await requirePremiumFeature(input.shopId, "expenses");

  if (!Number.isInteger(input.amount) || input.amount <= ZERO_PAISA) {
    throw new Error("Expense amount must be a positive whole number of paisa");
  }
  const category = expenseCategorySchema.parse(input.category);

  const now = new Date();
  const businessDate = dhakaBusinessDate(now);
  const timestamp = now.toISOString();
  const expenseId = generateId();

  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.staffId);
    const existingDrawer = tx
      .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
      .from(cashDrawer)
      .where(
        and(
          eq(cashDrawer.shopId, input.shopId),
          eq(cashDrawer.businessDate, businessDate),
        ),
      )
      .get() as DrawerLookupRow | undefined;
    const expectedCount = existingDrawer ? 3 : 4;
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: expenseId,
      kind: "expense_create",
      sequence: sequence++,
      expectedCount,
    });
    const drawerId = ensureOpenDrawer(
      tx,
      input.shopId,
      businessDate,
      input.staffId,
      now,
      operation,
    );

    const expenseValues = {
      id: expenseId,
      shopId: input.shopId,
      category,
      amount: input.amount,
      description: input.description ?? null,
      receiptImage: null,
      createdBy: input.staffId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.insert(expenses).values(expenseValues).run();
    recordChange(tx, {
      shopId: input.shopId,
      table: "expenses",
      rowId: expenseId,
      op: "insert",
      payload: expenseValues,
      operation: operation(),
    });

    const paymentId = generateId();
    const paymentValues = {
      id: paymentId,
      shopId: input.shopId,
      type: "expense" as const,
      partyId: null,
      amount: input.amount,
      method: "cash" as const,
      refId: expenseId,
      createdBy: input.staffId,
      createdAt: timestamp,
      updatedAt: timestamp,
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

    refreshClosingExpected(
      tx,
      input.shopId,
      businessDate,
      drawerId,
      {},
      operation,
    );
    if (sequence !== expectedCount) {
      throw new Error("Expense creation operation count mismatch");
    }
  });

  return { expenseId };
}

export interface ExpenseRow {
  id: string;
  category: string;
  amount: Paisa;
  description: string | null;
  createdAt: string;
}

interface RawExpenseRow extends Omit<ExpenseRow, "amount"> {
  amount: number;
}

export async function listExpenses(
  shopId: string,
  actorUserId: string,
  businessDate: string,
): Promise<ExpenseRow[]> {
  await requireOwner(shopId, actorUserId);

  const rows = sqliteConnection.getAllSync<RawExpenseRow>(
    `SELECT id, category, amount, description, created_at AS createdAt
       FROM expenses
      WHERE shop_id = $shopId AND is_deleted = 0
        AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate
      ORDER BY created_at DESC, id DESC`,
    { $shopId: shopId, $businessDate: businessDate },
  );
  return rows.map((row) => ({ ...row, amount: asPaisa(row.amount) }));
}

export interface MonthExpenseRow extends ExpenseRow {
  loggedByName: string;
}

interface RawMonthExpenseRow extends Omit<MonthExpenseRow, "amount"> {
  amount: number;
}

// B3 Group 3 — the Ledger tab's month-navigated read. `month` is 1-12
// (calendar convention, not JS's 0-11) so the SQL boundary strings below stay
// directly readable. Dhaka-anchored via DHAKA_SQL_OFFSET, never `'localtime'`
// — a shop's expense must fall in the same Dhaka month regardless of the
// device's configured timezone (W-1's business-date discipline extended to
// month buckets, not just days).
export async function listExpensesForMonth(
  shopId: string,
  actorUserId: string,
  year: number,
  month: number,
): Promise<MonthExpenseRow[]> {
  await requireOwner(shopId, actorUserId);

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Month must be an integer between 1 and 12");
  }

  const monthStart = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const monthEnd = `${String(nextMonth.year).padStart(4, "0")}-${String(nextMonth.month).padStart(2, "0")}-01`;

  const rows = sqliteConnection.getAllSync<RawMonthExpenseRow>(
    `SELECT e.id AS id, e.category AS category, e.amount AS amount, e.description AS description,
            e.created_at AS createdAt, u.name AS loggedByName
       FROM expenses e
       JOIN users u ON u.id = e.created_by
      WHERE e.shop_id = $shopId AND e.is_deleted = 0
        AND date(e.created_at, '${DHAKA_SQL_OFFSET}') >= $monthStart
        AND date(e.created_at, '${DHAKA_SQL_OFFSET}') < $monthEnd
      ORDER BY e.created_at DESC, e.id DESC`,
    { $shopId: shopId, $monthStart: monthStart, $monthEnd: monthEnd },
  );
  return rows.map((row) => ({ ...row, amount: asPaisa(row.amount) }));
}

export interface DuplicateExpenseMatch {
  id: string;
  category: string;
  amount: Paisa;
  description: string | null;
  createdAt: string;
}

interface RawDuplicateExpenseRow extends Omit<DuplicateExpenseMatch, "amount"> {
  amount: number;
}

// B3 Group 3 (EX-11) — an ADVISORY pre-flight read, never a hard block:
// mirrors contract §5.14's "advisory, not blocking" duplicate-invoice
// philosophy. The Quick Log screen shows this as a confirm modal; "Log
// Anyway" just calls recordExpense normally afterward. Same-day match is
// Dhaka-anchored, never device-local `Date`/`toDateString()` like the
// prototype (W-1) — two devices in different timezones must agree on
// whether "today" already has this expense.
export async function findDuplicateExpense(
  shopId: string,
  actorUserId: string,
  category: ExpenseCategory,
  amount: Paisa,
  businessDate: string,
): Promise<DuplicateExpenseMatch | null> {
  await requireOwner(shopId, actorUserId);

  const row = sqliteConnection.getFirstSync<RawDuplicateExpenseRow>(
    `SELECT id, category, amount, description, created_at AS createdAt
       FROM expenses
      WHERE shop_id = $shopId AND is_deleted = 0
        AND category = $category AND amount = $amount
        AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    {
      $shopId: shopId,
      $category: category,
      $amount: amount,
      $businessDate: businessDate,
    },
  );
  return row ? { ...row, amount: asPaisa(row.amount) } : null;
}

export interface DeleteExpenseInput {
  shopId: string;
  staffId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  expenseId: string;
}

// B3 Group 3 — soft-deletes the expense row AND its paired `payments` row
// (type='expense', ref_id=expenseId) atomically, then recomputes the drawer.
// "Never delete one side": if the payment row is already missing, this
// refuses rather than silently leaving a one-sided deletion.
//
// Guarded on the EXPENSE'S OWN business date, not "today" — unlike
// recordWithdrawal, an owner deleting an old Ledger entry from a still-open
// earlier day is a real path. A deletion targeting an already-closed day is
// refused exactly like any other write to that date (contract §5.5/§5.8).
//
// Mirrors recordWithdrawal's SyncOperationGroup shape: an existing drawer
// produces expense+payment+drawer (3 rows); the (practically unreachable,
// since recordExpense always ensures one) missing-drawer case adds a 4th.
export async function deleteExpense(input: DeleteExpenseInput): Promise<void> {
  await requirePremiumFeature(input.shopId, "expenses");
  await requireOwner(input.shopId, input.staffId);

  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.staffId);

    const expense = tx
      .select({ id: expenses.id, createdAt: expenses.createdAt })
      .from(expenses)
      .where(
        and(
          eq(expenses.id, input.expenseId),
          eq(expenses.shopId, input.shopId),
          eq(expenses.isDeleted, false),
        ),
      )
      .get() as { id: string; createdAt: string } | undefined;
    if (!expense) {
      throw new Error("Expense not found");
    }

    const payment = tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.shopId, input.shopId),
          eq(payments.refId, expense.id),
          eq(payments.type, "expense"),
          eq(payments.isDeleted, false),
        ),
      )
      .get() as { id: string } | undefined;
    if (!payment) {
      throw new Error(
        "This expense's payment record is missing — refusing a one-sided delete",
      );
    }

    const businessDate = dhakaBusinessDate(new Date(expense.createdAt));
    assertBusinessDateOpen(tx, input.shopId, businessDate);

    const existingDrawer = tx
      .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
      .from(cashDrawer)
      .where(
        and(
          eq(cashDrawer.shopId, input.shopId),
          eq(cashDrawer.businessDate, businessDate),
        ),
      )
      .get() as DrawerLookupRow | undefined;
    if (existingDrawer?.isDeleted) {
      throw new Error(
        "This day's cash drawer row is deleted and cannot be reused",
      );
    }

    const expectedCount = existingDrawer ? 3 : 4;
    // Creation owns expense.id as its grouped-operation id. Deletion must use
    // a fresh id or PostgreSQL staging would treat it as a conflicting retry
    // of the already-applied create operation. This id is generated once and
    // persisted on every outbox row, so delete retries remain idempotent.
    const operationId = generateId();
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: operationId,
      kind: "expense_delete",
      sequence: sequence++,
      expectedCount,
    });

    const now = new Date();
    const deleteValues = stampUpdatedAt({
      isDeleted: true,
      deletedAt: now.toISOString(),
      deletedBy: input.staffId,
      isDirty: true,
    });

    const expenseUpdate = tx
      .update(expenses)
      .set(deleteValues)
      .where(and(eq(expenses.id, expense.id), eq(expenses.shopId, input.shopId)))
      .run();
    if (expenseUpdate.changes !== 1) {
      throw new Error("Expense could not be deleted");
    }
    recordChange(tx, {
      shopId: input.shopId,
      table: "expenses",
      rowId: expense.id,
      op: "delete",
      payload: deleteValues,
      operation: operation(),
    });

    const paymentUpdate = tx
      .update(payments)
      .set(deleteValues)
      .where(and(eq(payments.id, payment.id), eq(payments.shopId, input.shopId)))
      .run();
    if (paymentUpdate.changes !== 1) {
      throw new Error("Expense payment could not be deleted");
    }
    recordChange(tx, {
      shopId: input.shopId,
      table: "payments",
      rowId: payment.id,
      op: "delete",
      payload: deleteValues,
      operation: operation(),
    });

    const drawerId = ensureOpenDrawer(
      tx,
      input.shopId,
      businessDate,
      input.staffId,
      now,
      operation,
    );
    refreshClosingExpected(
      tx,
      input.shopId,
      businessDate,
      drawerId,
      {},
      operation,
    );

    if (sequence !== expectedCount) {
      throw new Error("Expense deletion operation count mismatch");
    }
  });
}

export interface SetOpeningCashInput {
  shopId: string;
  staffId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  businessDate: string;
  openingCash: Paisa;
}

// CLAUDE.md rule 5: opening cash defaults to 0 and is SET BY THE USER. It is
// only ever written for the business date passed in, so yesterday's value can
// never be inherited.
export async function setOpeningCash(
  input: SetOpeningCashInput,
): Promise<void> {
  await requirePermission(
    input.shopId,
    input.staffId,
    permissionForDataGate("cashDrawer"),
  );

  if (!Number.isInteger(input.openingCash) || input.openingCash < ZERO_PAISA) {
    throw new Error(
      "Opening cash must be a non-negative whole number of paisa",
    );
  }

  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.staffId);
    const drawerId = ensureOpenDrawer(
      tx,
      input.shopId,
      input.businessDate,
      input.staffId,
      new Date(),
    );
    refreshClosingExpected(tx, input.shopId, input.businessDate, drawerId, {
      openingCash: input.openingCash,
    });
  });
}

// Fetch today's raw numbers (opening cash, cash sales, credit collections,
// expenses, refunds, supplier payments, withdrawals) for
// domain/cashFormula.expectedCash to consume. Opening cash must default to
// 0 and never inherit yesterday's row (CLAUDE.md rule 5).
interface CashSummaryRow {
  openingCash: number;
  cashSales: number;
  creditCollections: number;
  expenses: number;
  refunds: number;
  supplierPayments: number;
  withdrawals: number;
}

// Synchronous INTERNAL read so Sales can recompute closingExpected before its
// transaction commits. The public API below remains async like every db/ read.
//
// Deliberately NOT permission-gated, and not for screen use: its only callers
// are refreshClosingExpected here and the drawer refresh inside sales.ts,
// customers.ts and purchases.ts — all of them mid-transaction, after that
// transaction's own actor has already been authorized, and all of them
// synchronous so they could not await a guard anyway. Gating it would break a
// Staff sale, which legitimately has to refresh the drawer it just changed.
// Screens must use the gated getCashSummary/getEndOfDaySummary below.
export function getCashSummarySync(
  shopId: string,
  businessDate: string,
): CashFormulaInput {
  const row = sqliteConnection.getFirstSync<CashSummaryRow>(
    `SELECT
      COALESCE((SELECT opening_cash FROM cash_drawer
        WHERE shop_id = $shopId AND business_date = $businessDate AND is_deleted = 0 LIMIT 1), 0) AS openingCash,
      COALESCE((SELECT SUM(cash_applied) FROM sales
        WHERE shop_id = $shopId AND cash_applied > 0 AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0) AS cashSales,
      COALESCE((SELECT SUM(amount) FROM payments
        WHERE shop_id = $shopId AND type = 'customer_payment' AND method = 'cash' AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0) AS creditCollections,
      COALESCE((SELECT SUM(amount) FROM expenses
        WHERE shop_id = $shopId AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0) AS expenses,
      COALESCE((SELECT SUM(amount) FROM refund_tenders
        WHERE shop_id = $shopId
          AND (kind = 'cash' OR (kind = 'collection_refund' AND method = 'cash'))
          AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0)
      + COALESCE((SELECT SUM(refund_amount) FROM sales_returns
        WHERE shop_id = $shopId AND refund_id IS NULL AND refund_method = 'cash' AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0) AS refunds,
      COALESCE((SELECT SUM(amount) FROM payments
        WHERE shop_id = $shopId AND type = 'supplier_payment' AND method = 'cash' AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0) AS supplierPayments,
      COALESCE((SELECT SUM(amount) FROM payments
        WHERE shop_id = $shopId AND type = 'withdrawal' AND method = 'cash' AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0) AS withdrawals`,
    { $shopId: shopId, $businessDate: businessDate },
  );

  if (!row) {
    throw new Error("Cash summary query returned no row");
  }

  return {
    openingCash: asPaisa(row.openingCash),
    cashSales: asPaisa(row.cashSales),
    creditCollections: asPaisa(row.creditCollections),
    expenses: asPaisa(row.expenses),
    refunds: asPaisa(row.refunds),
    supplierPayments: asPaisa(row.supplierPayments),
    withdrawals: asPaisa(row.withdrawals),
  };
}

// The day's cash position is owner-only to READ, not merely owner-only to
// change: hiding the route is not the protection, this check is. The figures
// themselves are untouched — the same rows, through the same fixed formula.
export async function getCashSummary(
  shopId: string,
  actorUserId: string,
  businessDate: string,
): Promise<CashFormulaInput> {
  await requirePermission(
    shopId,
    actorUserId,
    permissionForDataGate("cashDrawer"),
  );
  return getCashSummarySync(shopId, businessDate);
}

export interface RecordWithdrawalInput {
  shopId: string;
  staffId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  amount: Paisa;
  note?: string;
}

// B3 Group 2: cash pulled OUT of the drawer for a bank deposit, personal use,
// etc. Owner-gated — not merely cash_drawer-permitted, unlike setOpeningCash
// and reconcileCashDrawer below: physically removing cash is more sensitive
// than counting or setting the opening figure, which a Manager holding
// cash_drawer can already do. Mirrors recordExpense's shape (one payments
// row + a drawer recompute in one transaction). The same rows are one atomic
// sync operation: an existing drawer produces payment+drawer (2 rows), while
// the first withdrawal of a day also creates the drawer (3 rows). Without the
// group, a network failure could leave the cloud with the payment but not the
// recomputed drawer.
export async function recordWithdrawal(
  input: RecordWithdrawalInput,
): Promise<{ paymentId: string }> {
  await requireOwner(input.shopId, input.staffId);

  if (!Number.isInteger(input.amount) || input.amount <= ZERO_PAISA) {
    throw new Error(
      "Withdrawal amount must be a positive whole number of paisa",
    );
  }

  const now = new Date();
  const businessDate = dhakaBusinessDate(now);
  const paymentId = generateId();

  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.staffId);
    assertBusinessDateOpen(tx, input.shopId, businessDate);
    const existingDrawer = tx
      .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
      .from(cashDrawer)
      .where(
        and(
          eq(cashDrawer.shopId, input.shopId),
          eq(cashDrawer.businessDate, businessDate),
        ),
      )
      .get() as DrawerLookupRow | undefined;
    if (existingDrawer?.isDeleted) {
      throw new Error(
        "This day's cash drawer row is deleted and cannot be reused",
      );
    }
    const expectedCount = existingDrawer ? 2 : 3;
    let sequence = 0;
    const operation = (): SyncOperationGroup => ({
      id: paymentId,
      kind: "withdrawal",
      sequence: sequence++,
      expectedCount,
    });
    const drawerId = ensureOpenDrawer(
      tx,
      input.shopId,
      businessDate,
      input.staffId,
      now,
      operation,
    );

    const timestamp = new Date().toISOString();
    const paymentValues = {
      id: paymentId,
      shopId: input.shopId,
      type: "withdrawal" as const,
      partyId: null,
      amount: input.amount,
      method: "cash" as const,
      refId: null,
      note: input.note?.trim() ? input.note.trim() : null,
      createdBy: input.staffId,
      createdAt: timestamp,
      updatedAt: timestamp,
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

    refreshClosingExpected(
      tx,
      input.shopId,
      businessDate,
      drawerId,
      {},
      operation,
      existingDrawer ? undefined : new Date(now.getTime() + 1).toISOString(),
    );
    if (sequence !== expectedCount) {
      throw new Error("Withdrawal operation count mismatch");
    }
  });

  return { paymentId };
}

export type CashReconcileStatus = "match" | "surplus" | "shortage";

export interface CashReconcileResult {
  status: CashReconcileStatus;
  countedCash: Paisa;
  expectedCash: Paisa;
  /** countedCash − expectedCash. Zero on match, negative on shortage. */
  diff: Paisa;
}

export interface ReconcileCashDrawerInput {
  shopId: string;
  staffId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  businessDate: string;
  countedCash: Paisa;
}

// B3 Group 2 (founder decision D-2, contract §5.9): a MID-DAY cash count,
// distinct from End of Day's close. May be saved any number of times before
// close; NEVER writes closing_counted/closed_by/closed_at and never locks
// the business date — only closeDay does that. Gated the same as
// setOpeningCash/getCashSummary (cash_drawer permission), not owner-only:
// counting the drawer mid-shift is the same tier of action as setting the
// opening figure.
//
// Match is EXACT paisa equality, not a fuzz band. The prototype allowed
// |diff| < ৳0.50 to absorb its own floating-point taka arithmetic — a
// workaround for a bug production doesn't have (S-2: integer paisa carries
// no drift to absorb).
export async function reconcileCashDrawer(
  input: ReconcileCashDrawerInput,
): Promise<CashReconcileResult> {
  await requirePermission(
    input.shopId,
    input.staffId,
    permissionForDataGate("cashDrawer"),
  );

  if (!Number.isInteger(input.countedCash) || input.countedCash < ZERO_PAISA) {
    throw new Error(
      "Counted cash must be a non-negative whole number of paisa",
    );
  }

  const now = new Date();
  let expected: Paisa = ZERO_PAISA;

  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.staffId);
    const drawerId = ensureOpenDrawer(
      tx,
      input.shopId,
      input.businessDate,
      input.staffId,
      now,
    );

    // Read fresh, inside the same transaction as the write below — the
    // counted amount is judged against the ledger's current state, not a
    // figure the caller might be holding stale.
    expected = expectedCash(
      getCashSummarySync(input.shopId, input.businessDate),
    );

    const drawerValues = stampUpdatedAt({
      reconciledCountedAmount: input.countedCash,
      reconciledAt: now.toISOString(),
      reconciledBy: input.staffId,
      isDirty: true,
    });
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
    });
  });

  const diff = subtractPaisa(input.countedCash, expected);
  const status: CashReconcileStatus =
    diff === ZERO_PAISA ? "match" : diff > ZERO_PAISA ? "surplus" : "shortage";
  return {
    status,
    countedCash: input.countedCash,
    expectedCash: expected,
    diff,
  };
}

export interface CashBreakdownStaffRow {
  staffId: string;
  name: string;
  total: Paisa;
  txnCount: number;
}

export interface CashBreakdownDetailRow {
  id: string;
  label: string;
  amount: Paisa;
}

export interface CashBreakdown {
  businessDate: string;
  openingCash: Paisa;
  cashSales: {
    total: Paisa;
    owner: Paisa;
    staff: Paisa;
    staffBreakdown: CashBreakdownStaffRow[];
  };
  creditCollections: { total: Paisa; details: CashBreakdownDetailRow[] };
  expenses: { total: Paisa; details: CashBreakdownDetailRow[] };
  withdrawals: { total: Paisa };
  supplierPayments: { total: Paisa };
  expectedCash: Paisa;
  reconciled: {
    countedAmount: Paisa | null;
    at: string | null;
    by: string | null;
    status: CashReconcileStatus | "unknown";
    diff: Paisa | null;
  };
}

interface CashSalesSellerRow {
  staffId: string;
  name: string;
  role: string;
  total: number;
  txnCount: number;
}

interface CashCreditDetailRow {
  id: string;
  customerName: string;
  amount: number;
}

interface CashExpenseDetailRow {
  id: string;
  category: string;
  description: string | null;
  amount: number;
}

interface CashDrawerReconcileRow {
  reconciledCountedAmount: number | null;
  reconciledAt: string | null;
  reconciledByName: string | null;
}

// B3 Group 2: the full breakdown behind Cash Summary's expandable sheet —
// owner/staff cash-sales split, Credit Collections and Expenses detail rows,
// and the live reconcile state. Every total here is the SAME figure
// getCashSummarySync feeds the fixed formula with (same WHERE clauses), so
// e.g. cashSales.owner + cashSales.staff always sums to cashSales.total
// exactly — there is no second definition of "today's cash sales" to drift
// from the first. Gated like getCashSummary/getEndOfDaySummary
// (cash_drawer), not owner-only: expense line items are already implied by
// the plain expenses total that screen already shows to anyone holding this
// permission; D-3's owner-only rule governs RECORDING an expense, not
// reading it back inside an already-gated cash breakdown.
export async function getCashBreakdown(
  shopId: string,
  actorUserId: string,
  businessDate: string,
): Promise<CashBreakdown> {
  await requirePermission(
    shopId,
    actorUserId,
    permissionForDataGate("cashDrawer"),
  );

  const formula = getCashSummarySync(shopId, businessDate);
  const expected = expectedCash(formula);

  const sellerRows = sqliteConnection.getAllSync<CashSalesSellerRow>(
    `SELECT s.staff_id AS staffId, u.name AS name, r.name AS role,
            SUM(s.cash_applied) AS total, COUNT(*) AS txnCount
       FROM sales s
       JOIN users u ON u.id = s.staff_id
       JOIN roles r ON r.id = u.role_id
      WHERE s.shop_id = $shopId AND s.cash_applied > 0 AND s.is_deleted = 0
        AND date(s.created_at, '${DHAKA_SQL_OFFSET}') = $businessDate
      GROUP BY s.staff_id, u.name, r.name`,
    { $shopId: shopId, $businessDate: businessDate },
  );

  let ownerCash: Paisa = ZERO_PAISA;
  let staffCash: Paisa = ZERO_PAISA;
  const staffBreakdown: CashBreakdownStaffRow[] = [];
  for (const row of sellerRows) {
    const amount = asPaisa(row.total);
    if (row.role === "owner") {
      ownerCash = addPaisa(ownerCash, amount);
    } else {
      staffCash = addPaisa(staffCash, amount);
      staffBreakdown.push({
        staffId: row.staffId,
        name: row.name,
        total: amount,
        txnCount: row.txnCount,
      });
    }
  }

  const creditDetailRows = sqliteConnection.getAllSync<CashCreditDetailRow>(
    `SELECT p.id AS id, c.name AS customerName, p.amount AS amount
       FROM payments p
       JOIN customers c ON c.id = p.party_id
      WHERE p.shop_id = $shopId AND p.type = 'customer_payment' AND p.method = 'cash' AND p.is_deleted = 0
        AND date(p.created_at, '${DHAKA_SQL_OFFSET}') = $businessDate
      ORDER BY p.created_at ASC, p.id ASC`,
    { $shopId: shopId, $businessDate: businessDate },
  );

  const expenseRows = sqliteConnection.getAllSync<CashExpenseDetailRow>(
    `SELECT id, category, description, amount
       FROM expenses
      WHERE shop_id = $shopId AND is_deleted = 0
        AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate
      ORDER BY created_at ASC, id ASC`,
    { $shopId: shopId, $businessDate: businessDate },
  );

  const drawerRow = sqliteConnection.getFirstSync<CashDrawerReconcileRow>(
    `SELECT d.reconciled_counted_amount AS reconciledCountedAmount,
            d.reconciled_at AS reconciledAt,
            u.name AS reconciledByName
       FROM cash_drawer d
       LEFT JOIN users u ON u.id = d.reconciled_by
      WHERE d.shop_id = $shopId AND d.business_date = $businessDate AND d.is_deleted = 0
      LIMIT 1`,
    { $shopId: shopId, $businessDate: businessDate },
  );

  const reconciledCounted =
    drawerRow?.reconciledCountedAmount === null ||
    drawerRow?.reconciledCountedAmount === undefined
      ? null
      : asPaisa(drawerRow.reconciledCountedAmount);
  const reconciledDiff =
    reconciledCounted === null
      ? null
      : subtractPaisa(reconciledCounted, expected);
  const reconciledStatus: CashReconcileStatus | "unknown" =
    reconciledDiff === null
      ? "unknown"
      : reconciledDiff === ZERO_PAISA
        ? "match"
        : reconciledDiff > ZERO_PAISA
          ? "surplus"
          : "shortage";

  return {
    businessDate,
    openingCash: formula.openingCash,
    cashSales: {
      total: formula.cashSales,
      owner: ownerCash,
      staff: staffCash,
      staffBreakdown,
    },
    creditCollections: {
      total: formula.creditCollections,
      details: creditDetailRows.map((row) => ({
        id: row.id,
        label: row.customerName,
        amount: asPaisa(row.amount),
      })),
    },
    expenses: {
      total: formula.expenses,
      details: expenseRows.map((row) => ({
        id: row.id,
        label: row.description
          ? `${row.category} — ${row.description}`
          : row.category,
        amount: asPaisa(row.amount),
      })),
    },
    withdrawals: { total: formula.withdrawals },
    supplierPayments: { total: formula.supplierPayments },
    expectedCash: expected,
    reconciled: {
      countedAmount: reconciledCounted,
      at: drawerRow?.reconciledAt ?? null,
      by: drawerRow?.reconciledByName ?? null,
      status: reconciledStatus,
      diff: reconciledDiff,
    },
  };
}

export interface EndOfDaySummary {
  businessDate: string;
  isClosed: boolean;
  /** The cash formula's raw inputs — the single source for every cash number. */
  cashFormula: CashFormulaInput;
  expectedCash: Paisa;
  totalSales: Paisa;
  cashSales: Paisa;
  creditSales: Paisa;
  cogs: Paisa;
  /** Sales revenue less cost of goods sold. Expenses are reported separately. */
  grossProfit: Paisa;
  expenses: Paisa;
  newCreditGiven: Paisa;
  /** Every method, not just cash — the cash share lives in cashFormula. */
  creditCollected: Paisa;
  countedCash: Paisa | null;
  /** counted − expected. Negative is a shortfall. Null until the day closes. */
  variance: Paisa | null;
  openedByName: string | null;
  closedByName: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

interface EndOfDayAggregateRow {
  newCreditGiven: number;
  creditCollected: number;
}

interface EndOfDayDrawerRow {
  closingCounted: number | null;
  openedByName: string | null;
  closedByName: string | null;
  openedAt: string | null;
  closedAt: string | null;
}

// Volume 0 Day 10's required close-out lines. Every cash figure is taken from
// the shared cash formula rather than recomputed, so there is exactly one
// definition of each in the app.
export async function getEndOfDaySummary(
  shopId: string,
  actorUserId: string,
  businessDate: string,
): Promise<EndOfDaySummary> {
  // Profit, COGS, credit and the drawer variance — the most owner-sensitive
  // read in the app. Gated at the API, not just behind a hidden route.
  await requirePermission(
    shopId,
    actorUserId,
    permissionForDataGate("cashDrawer"),
  );
  const report = await getEndOfDayReportSnapshot(shopId, actorUserId, {
    startDate: businessDate,
    endDate: businessDate,
  });

  const aggregates = sqliteConnection.getFirstSync<EndOfDayAggregateRow>(
    `SELECT
      COALESCE((SELECT SUM(amount) FROM credits
        WHERE shop_id = $shopId AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0) AS newCreditGiven,
      COALESCE((SELECT SUM(amount) FROM payments
        WHERE shop_id = $shopId AND type = 'customer_payment' AND is_deleted = 0
          AND date(created_at, '${DHAKA_SQL_OFFSET}') = $businessDate), 0) AS creditCollected`,
    { $shopId: shopId, $businessDate: businessDate },
  );
  if (!aggregates) {
    throw new Error("End-of-day summary query returned no row");
  }

  const drawer = sqliteConnection.getFirstSync<EndOfDayDrawerRow>(
    `SELECT d.closing_counted AS closingCounted,
            opener.name AS openedByName,
            closer.name AS closedByName,
            d.opened_at AS openedAt,
            d.closed_at AS closedAt
       FROM cash_drawer AS d
       LEFT JOIN users AS opener ON opener.id = d.opened_by
       LEFT JOIN users AS closer ON closer.id = d.closed_by
      WHERE d.shop_id = $shopId AND d.business_date = $businessDate AND d.is_deleted = 0
      LIMIT 1`,
    { $shopId: shopId, $businessDate: businessDate },
  );

  const cashFormula = getCashSummarySync(shopId, businessDate);
  const expected = expectedCash(cashFormula);
  const totalSales = report.totals.netSales;
  const cogs = report.totals.cogs;
  const rawCounted = drawer?.closingCounted;
  const countedCash =
    rawCounted === null || rawCounted === undefined
      ? null
      : asPaisa(rawCounted);

  return {
    businessDate,
    isClosed: Boolean(drawer?.closedAt),
    cashFormula,
    expectedCash: expected,
    totalSales,
    cashSales: report.totals.cashSales,
    creditSales: report.totals.creditSales,
    cogs,
    grossProfit: report.totals.grossProfit,
    expenses: report.totals.expenses,
    newCreditGiven: asPaisa(aggregates.newCreditGiven),
    creditCollected: asPaisa(aggregates.creditCollected),
    countedCash,
    variance:
      countedCash === null ? null : subtractPaisa(countedCash, expected),
    openedByName: drawer?.openedByName ?? null,
    closedByName: drawer?.closedByName ?? null,
    openedAt: drawer?.openedAt ?? null,
    closedAt: drawer?.closedAt ?? null,
  };
}

export interface CloseDayInput {
  shopId: string;
  /** Device-handover guard — see db/errors.ts assertSessionLive. */
  isStillActive: () => boolean;
  businessDate: string;
  countedCash: Paisa;
  closedBy: string;
}

// Volume 0 Day 10: locks the day. Writes the `cash_drawer` row — Volume 3:
// UNIQUE(shop_id, business_date), exactly one per day.
//
// closing_expected is RECOMPUTED here rather than trusted from the caller: the
// figure that gets locked in must come from the ledger, not from whatever the
// screen last rendered.
export async function closeDay(input: CloseDayInput): Promise<void> {
  await requirePermission(
    input.shopId,
    input.closedBy,
    permissionForDataGate("cashDrawer"),
  );

  if (!Number.isInteger(input.countedCash) || input.countedCash < ZERO_PAISA) {
    throw new Error(
      "Counted cash must be a non-negative whole number of paisa",
    );
  }

  const now = new Date();
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.closedBy);
    // A day with only credit sales has no drawer row yet; it still closes.
    // ensureOpenDrawer also rejects a second close of an already-closed day.
    const drawerId = ensureOpenDrawer(
      tx,
      input.shopId,
      input.businessDate,
      input.closedBy,
      now,
    );
    refreshClosingExpected(tx, input.shopId, input.businessDate, drawerId, {
      closingCounted: input.countedCash,
      closedBy: input.closedBy,
      closedAt: now.toISOString(),
    });
  });
}
