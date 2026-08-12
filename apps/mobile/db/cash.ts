// db/cash.ts — the ONLY file that will touch Drizzle/SQLite for
// Expenses/Cash Summary/End of Day (DEVELOPMENT_RULES.md). Only the minimal
// checkout cash-summary read is live; expense recording/closing stay Day 10.

import type { Paisa } from '@muthoy/types';
import { asPaisa } from '@muthoy/types';
import type { CashFormulaInput } from '../domain/cashFormula';
import { sqliteConnection } from './client';

export interface RecordExpenseInput {
  shopId: string;
  category: string;
  amount: Paisa;
  description: string;
  receiptPhotoUri?: string;
}

// TODO(Day 10): write BOTH an `expenses` row and a `payments` row with
// type='expense', ref_id pointing at the expense (Volume 0 Day 10) — one
// transaction, never two separate writes that could partially fail.
export async function recordExpense(_input: RecordExpenseInput): Promise<{ expenseId: string }> {
  throw new Error('TODO: implement expense recording (Volume 0 Day 10)');
}

// Fetch today's raw numbers (opening cash, cash sales, credit
// collections, expenses, refunds, supplier payments, withdrawals) for
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

// Synchronous internal read so Sales can recompute closingExpected before its
// transaction commits. The public API below remains async like every db/ read.
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

export async function getCashSummary(shopId: string, businessDate: string): Promise<CashFormulaInput> {
  return getCashSummarySync(shopId, businessDate);
}

export interface CloseDayInput {
  shopId: string;
  businessDate: string;
  countedCash: Paisa;
  openedBy: string;
  closedBy: string;
}

// TODO(Day 10): lock the day — total sales, cash/credit split, profit via
// COGS, expenses, new credit given, credit collected, expected vs counted
// cash (Volume 0 Day 10). Writes the `cash_drawer` row — Volume 3:
// UNIQUE(shop_id, business_date), exactly one per day.
export async function closeDay(_input: CloseDayInput): Promise<void> {
  throw new Error('TODO: implement end-of-day close (Volume 0 Day 10)');
}
