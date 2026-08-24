import { z } from 'zod';

const optionalText = z.string().trim().transform((value) => (value === '' ? undefined : value)).optional();

// B3 Group 3 (founder decision D-4, locked 2026-08-22): the prototype's
// 5-category taxonomy replaces production's original 6-category set —
// migration 0018 backfills every existing row. `other` keeps a free-text
// description as the escape hatch rather than allowing an arbitrary category
// string, so the End-of-Day breakdown stays groupable.
export const EXPENSE_CATEGORIES = [
  'rent',
  'salary',
  'utilities',
  'conveyance',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);

export const LEGACY_EXPENSE_CATEGORY_MAP = {
  electricity: 'utilities',
  transport: 'conveyance',
  staff_salary: 'salary',
  supplies: 'other',
} as const satisfies Record<string, ExpenseCategory>;

/**
 * Compatibility boundary for rows produced before B3 Group 3. Legacy values
 * are accepted only long enough to become canonical; every other value is
 * rejected. New writes use expenseCategorySchema directly.
 */
export function canonicalizeExpenseCategory(value: unknown): ExpenseCategory {
  const mapped =
    typeof value === 'string' && value in LEGACY_EXPENSE_CATEGORY_MAP
      ? LEGACY_EXPENSE_CATEGORY_MAP[value as keyof typeof LEGACY_EXPENSE_CATEGORY_MAP]
      : value;
  return expenseCategorySchema.parse(mapped);
}

// Taka at the form boundary; db/cash.ts converts once via fromTaka(). Rounding
// is allowed only in that conversion (packages/types/src/money.ts).
// The `error` override matters: without it a non-numeric field reaches the
// shopkeeper as Zod's "expected number, received NaN".
const takaAmount = z.number({ error: 'Enter a valid amount' }).finite('Enter a valid amount');

export const expenseFormSchema = z.object({
  category: expenseCategorySchema,
  amountTaka: takaAmount.positive('Amount must be greater than zero'),
  description: optionalText,
  // No receipt-photo capture in B3 Beta (founder decision D-5, locked
  // 2026-08-22): no image picker is installed, and the `expenses.receipt_image`
  // DB column stays unused rather than half-wiring a money attachment.
});

export type ExpenseFormInput = z.input<typeof expenseFormSchema>;
export type ExpenseFormOutput = z.output<typeof expenseFormSchema>;

// CLAUDE.md rule 5: opening cash defaults to 0 and is set by the user. Zero is
// a legitimate value, so this is nonnegative, not positive.
export const openingCashFormSchema = z.object({
  openingCashTaka: takaAmount.min(0, 'Opening cash cannot be negative'),
});

export type OpeningCashFormInput = z.input<typeof openingCashFormSchema>;

export const endOfDayFormSchema = z.object({
  countedCashTaka: takaAmount.min(0, 'Counted cash cannot be negative'),
});

export type EndOfDayFormInput = z.input<typeof endOfDayFormSchema>;

// B3 Group 2 (D-2, contract §5.9): the MID-DAY reconcile count. Same shape as
// endOfDayFormSchema above but kept as its own named schema — the two counts
// are deliberately different acts (reconcile never locks the day; only
// End of Day's close does) and must never be conflated, including at the
// validation layer.
export const cashReconcileFormSchema = z.object({
  countedCashTaka: takaAmount.min(0, 'Counted cash cannot be negative'),
});

export type CashReconcileFormInput = z.input<typeof cashReconcileFormSchema>;

// B3 Group 2: cash pulled out of the drawer. Positive-only — a zero or
// negative withdrawal has no meaning.
export const withdrawalFormSchema = z.object({
  amountTaka: takaAmount.positive('Amount must be greater than zero'),
  note: optionalText,
});

export type WithdrawalFormInput = z.input<typeof withdrawalFormSchema>;
