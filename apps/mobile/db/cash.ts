// db/cash.ts — the ONLY file that will touch Drizzle/SQLite for
// Expenses/Cash Summary/End of Day (DEVELOPMENT_RULES.md). The Drizzle
// schema doesn't exist yet (Day 2), so these are signature-only stubs — no
// Drizzle import until then.

import type { Paisa } from '@muthoy/types';
import type { CashFormulaInput } from '../domain/cashFormula';

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

// TODO(Day 10): fetch today's raw numbers (opening cash, cash sales, credit
// collections, expenses, refunds, supplier payments, withdrawals) for
// domain/cashFormula.expectedCash to consume. Opening cash must default to
// 0 and never inherit yesterday's row (CLAUDE.md rule 5).
export async function getCashSummary(_shopId: string, _businessDate: string): Promise<CashFormulaInput> {
  throw new Error('TODO: implement cash summary query (Volume 0 Day 10, CLAUDE.md rule 5)');
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
