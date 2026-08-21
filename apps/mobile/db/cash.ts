// db/cash.ts — the ONLY file that touches Drizzle/SQLite for
// Expenses/Cash Summary/End of Day (DEVELOPMENT_RULES.md).
//
// CLAUDE.md rule 4: the cash formula itself is FIXED and lives in
// domain/cashFormula.ts. This file only fetches the raw numbers and hands
// them to expectedCash() — it never re-derives or approximates the formula.

import { and, eq } from 'drizzle-orm';
import type { ExpenseCategory } from '@muthoy/validation';
import { ZERO_PAISA, asPaisa, subtractPaisa, type Paisa } from '@muthoy/types';
import { expectedCash, type CashFormulaInput } from '../domain/cashFormula';
import { generateId } from '../native/id';
import { requirePermission } from './auth';
import { db, sqliteConnection } from './client';
import { assertSessionLive, DayClosedError } from './errors';
import { cashDrawer, expenses, payments, users } from './schema';
import { recordChange, stampUpdatedAt } from './sync-helpers';

// Same alias sync-helpers.ts declares for itself; it is not exported there.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// CLAUDE.md rule 5: the business date is the LOCAL calendar day, so a drawer
// resets at local midnight and never inherits yesterday's row.
function localBusinessDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function currentBusinessDate(now: Date = new Date()): string {
  return localBusinessDate(now);
}

export async function hasCashDrawerForDate(shopId: string, businessDate: string): Promise<boolean> {
  return Boolean(sqliteConnection.getFirstSync<{ id: string }>(
    `SELECT id FROM cash_drawer WHERE shop_id=$shopId AND business_date=$businessDate AND is_deleted=0 LIMIT 1`,
    { $shopId: shopId, $businessDate: businessDate },
  ));
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
export function assertBusinessDateOpen(tx: DbTransaction, shopId: string, businessDate: string): void {
  const drawer = tx
    .select({ closedAt: cashDrawer.closedAt })
    .from(cashDrawer)
    .where(and(eq(cashDrawer.shopId, shopId), eq(cashDrawer.businessDate, businessDate)))
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
): string {
  assertBusinessDateOpen(tx, shopId, businessDate);

  const existing = tx
    .select({ id: cashDrawer.id, isDeleted: cashDrawer.isDeleted })
    .from(cashDrawer)
    .where(and(eq(cashDrawer.shopId, shopId), eq(cashDrawer.businessDate, businessDate)))
    .get() as DrawerLookupRow | undefined;

  if (existing?.isDeleted) {
    throw new Error("This day's cash drawer row is deleted and cannot be reused");
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
  recordChange(tx, { shopId, table: 'cash_drawer', rowId: drawerId, op: 'insert', payload: drawerValues });
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
): void {
  const closingExpected = expectedCash(getCashSummarySync(shopId, businessDate));
  const drawerValues = stampUpdatedAt({ ...extraValues, closingExpected, isDirty: true });
  const drawerUpdate = tx
    .update(cashDrawer)
    .set(drawerValues)
    .where(and(eq(cashDrawer.id, drawerId), eq(cashDrawer.shopId, shopId)))
    .run();
  if (drawerUpdate.changes !== 1) {
    throw new Error('Cash drawer could not be updated');
  }
  recordChange(tx, { shopId, table: 'cash_drawer', rowId: drawerId, op: 'update', payload: drawerValues });
}

function requireActiveUser(tx: DbTransaction, shopId: string, userId: string): void {
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
    throw new Error('Active staff session does not belong to this shop');
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
  receiptPhotoUri?: string;
}

// Volume 0 Day 10: writes BOTH an `expenses` row and a `payments` row with
// type='expense', ref_id pointing at the expense — in ONE transaction, never
// two writes that could partially fail and leave money unaccounted for.
//
// The payment is always method='cash': getCashSummarySync subtracts the
// `expenses` table with no method filter, so a non-cash expense would still
// reduce expected cash. Supporting one would require changing the formula,
// and the formula is fixed (CLAUDE.md rule 4).
export async function recordExpense(input: RecordExpenseInput): Promise<{ expenseId: string }> {
  // Volume 0 Day 11: cash is owner-only. Checked before the transaction opens
  // and against SQLite's role, not the session store — so a Staff login that
  // reaches this by direct navigation writes nothing at all.
  await requirePermission(input.shopId, input.staffId, 'cash_management');

  if (!Number.isInteger(input.amount) || input.amount <= ZERO_PAISA) {
    throw new Error('Expense amount must be a positive whole number of paisa');
  }

  const now = new Date();
  const businessDate = localBusinessDate(now);
  const expenseId = generateId();

  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.staffId);
    const drawerId = ensureOpenDrawer(tx, input.shopId, businessDate, input.staffId, now);

    const timestamp = new Date().toISOString();
    const expenseValues = {
      id: expenseId,
      shopId: input.shopId,
      category: input.category,
      amount: input.amount,
      description: input.description ?? null,
      receiptImage: input.receiptPhotoUri ?? null,
      createdBy: input.staffId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.insert(expenses).values(expenseValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'expenses', rowId: expenseId, op: 'insert', payload: expenseValues });

    const paymentId = generateId();
    const paymentValues = {
      id: paymentId,
      shopId: input.shopId,
      type: 'expense' as const,
      partyId: null,
      amount: input.amount,
      method: 'cash' as const,
      refId: expenseId,
      createdBy: input.staffId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.insert(payments).values(paymentValues).run();
    recordChange(tx, { shopId: input.shopId, table: 'payments', rowId: paymentId, op: 'insert', payload: paymentValues });

    refreshClosingExpected(tx, input.shopId, businessDate, drawerId);
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

interface RawExpenseRow extends Omit<ExpenseRow, 'amount'> {
  amount: number;
}

export async function listExpenses(
  shopId: string,
  actorUserId: string,
  businessDate: string,
): Promise<ExpenseRow[]> {
  await requirePermission(shopId, actorUserId, 'cash_management');

  const rows = sqliteConnection.getAllSync<RawExpenseRow>(
    `SELECT id, category, amount, description, created_at AS createdAt
       FROM expenses
      WHERE shop_id = $shopId AND is_deleted = 0
        AND date(created_at, 'localtime') = $businessDate
      ORDER BY created_at DESC, id DESC`,
    { $shopId: shopId, $businessDate: businessDate },
  );
  return rows.map((row) => ({ ...row, amount: asPaisa(row.amount) }));
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
export async function setOpeningCash(input: SetOpeningCashInput): Promise<void> {
  await requirePermission(input.shopId, input.staffId, 'cash_management');

  if (!Number.isInteger(input.openingCash) || input.openingCash < ZERO_PAISA) {
    throw new Error('Opening cash must be a non-negative whole number of paisa');
  }

  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.staffId);
    const drawerId = ensureOpenDrawer(tx, input.shopId, input.businessDate, input.staffId, new Date());
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
export function getCashSummarySync(shopId: string, businessDate: string): CashFormulaInput {
  const row = sqliteConnection.getFirstSync<CashSummaryRow>(
    `SELECT
      COALESCE((SELECT opening_cash FROM cash_drawer
        WHERE shop_id = $shopId AND business_date = $businessDate AND is_deleted = 0 LIMIT 1), 0) AS openingCash,
      COALESCE((SELECT SUM(total) FROM sales
        WHERE shop_id = $shopId AND payment_type = 'cash' AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS cashSales,
      COALESCE((SELECT SUM(amount) FROM payments
        WHERE shop_id = $shopId AND type = 'customer_payment' AND method = 'cash' AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS creditCollections,
      COALESCE((SELECT SUM(amount) FROM expenses
        WHERE shop_id = $shopId AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS expenses,
      COALESCE((SELECT SUM(refund_amount) FROM sales_returns
        WHERE shop_id = $shopId AND refund_method = 'cash' AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS refunds,
      COALESCE((SELECT SUM(amount) FROM payments
        WHERE shop_id = $shopId AND type = 'supplier_payment' AND method = 'cash' AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS supplierPayments,
      COALESCE((SELECT SUM(amount) FROM payments
        WHERE shop_id = $shopId AND type = 'withdrawal' AND method = 'cash' AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS withdrawals`,
    { $shopId: shopId, $businessDate: businessDate },
  );

  if (!row) {
    throw new Error('Cash summary query returned no row');
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
  await requirePermission(shopId, actorUserId, 'cash_management');
  return getCashSummarySync(shopId, businessDate);
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
  totalSales: number;
  cogs: number;
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
  await requirePermission(shopId, actorUserId, 'cash_management');

  const aggregates = sqliteConnection.getFirstSync<EndOfDayAggregateRow>(
    `SELECT
      COALESCE((SELECT SUM(total) FROM sales
        WHERE shop_id = $shopId AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS totalSales,
      COALESCE((SELECT SUM(si.cogs) FROM sale_items AS si
                  JOIN sales AS s ON s.id = si.sale_id
        WHERE si.shop_id = $shopId AND si.is_deleted = 0 AND s.is_deleted = 0
          AND date(s.created_at, 'localtime') = $businessDate), 0) AS cogs,
      COALESCE((SELECT SUM(amount) FROM credits
        WHERE shop_id = $shopId AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS newCreditGiven,
      COALESCE((SELECT SUM(amount) FROM payments
        WHERE shop_id = $shopId AND type = 'customer_payment' AND is_deleted = 0
          AND date(created_at, 'localtime') = $businessDate), 0) AS creditCollected`,
    { $shopId: shopId, $businessDate: businessDate },
  );
  if (!aggregates) {
    throw new Error('End-of-day summary query returned no row');
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
  const totalSales = asPaisa(aggregates.totalSales);
  const cogs = asPaisa(aggregates.cogs);
  const rawCounted = drawer?.closingCounted;
  const countedCash = rawCounted === null || rawCounted === undefined ? null : asPaisa(rawCounted);

  return {
    businessDate,
    isClosed: Boolean(drawer?.closedAt),
    cashFormula,
    expectedCash: expected,
    totalSales,
    cashSales: cashFormula.cashSales,
    creditSales: subtractPaisa(totalSales, cashFormula.cashSales),
    cogs,
    grossProfit: subtractPaisa(totalSales, cogs),
    expenses: cashFormula.expenses,
    newCreditGiven: asPaisa(aggregates.newCreditGiven),
    creditCollected: asPaisa(aggregates.creditCollected),
    countedCash,
    variance: countedCash === null ? null : subtractPaisa(countedCash, expected),
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
  await requirePermission(input.shopId, input.closedBy, 'cash_management');

  if (!Number.isInteger(input.countedCash) || input.countedCash < ZERO_PAISA) {
    throw new Error('Counted cash must be a non-negative whole number of paisa');
  }

  const now = new Date();
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    requireActiveUser(tx, input.shopId, input.closedBy);
    // A day with only credit sales has no drawer row yet; it still closes.
    // ensureOpenDrawer also rejects a second close of an already-closed day.
    const drawerId = ensureOpenDrawer(tx, input.shopId, input.businessDate, input.closedBy, now);
    refreshClosingExpected(tx, input.shopId, input.businessDate, drawerId, {
      closingCounted: input.countedCash,
      closedBy: input.closedBy,
      closedAt: now.toISOString(),
    });
  });
}
