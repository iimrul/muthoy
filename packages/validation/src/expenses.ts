import { z } from 'zod';

const optionalText = z.string().trim().transform((value) => (value === '' ? undefined : value)).optional();

// Volume 4's expense categories. `other` keeps a free-text description as the
// escape hatch rather than allowing an arbitrary category string, so the
// End-of-Day breakdown stays groupable.
export const EXPENSE_CATEGORIES = [
  'rent',
  'electricity',
  'transport',
  'staff_salary',
  'supplies',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

// Taka at the form boundary; db/cash.ts converts once via fromTaka(). Rounding
// is allowed only in that conversion (packages/types/src/money.ts).
// The `error` override matters: without it a non-numeric field reaches the
// shopkeeper as Zod's "expected number, received NaN".
const takaAmount = z.number({ error: 'Enter a valid amount' }).finite('Enter a valid amount');

export const expenseFormSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amountTaka: takaAmount.positive('Amount must be greater than zero'),
  description: optionalText,
  // Local file URI for now — Supabase Storage upload is sync territory.
  receiptImage: optionalText,
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
