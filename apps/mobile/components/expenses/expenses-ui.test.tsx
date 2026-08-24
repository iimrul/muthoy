// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asPaisa } from '@muthoy/types';

interface StubProps {
  children?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
  visible?: boolean;
  value?: string;
  onChangeText?: (value: string) => void;
}

vi.mock('react-native', () => {
  class Value {
    stopAnimation() {}
    setValue() {}
  }
  const animation = { start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }) };
  return {
    View: ({ children }: StubProps) => createElement('div', null, children),
    Text: ({ children }: StubProps) => createElement('span', null, children),
    Pressable: ({ children, onPress, accessibilityLabel, disabled }: StubProps) =>
      createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel, disabled }, children),
    TextInput: ({ value, onChangeText, accessibilityLabel }: StubProps) =>
      createElement('input', {
        value: value ?? '',
        'aria-label': accessibilityLabel,
        onChange: (event: { target: { value: string } }) => onChangeText?.(event.target.value),
      }),
    Modal: ({ visible, children }: StubProps) => visible ? createElement('div', null, children) : null,
    Animated: {
      Value,
      View: ({ children }: StubProps) => createElement('div', null, children),
      timing: () => animation,
      delay: () => animation,
      sequence: () => animation,
    },
  };
});

const locale = vi.hoisted(() => ({ value: 'en' as 'en' | 'bn' }));
const messages = {
  en: {
    amount: 'Amount', cancel: 'Cancel', notePlaceholder: 'Note', addDetailsPlaceholder: 'Add details',
    logExpense: 'Log Expense', expenseSaved: 'Expense saved', duplicateDetected: 'Duplicate Detected',
    duplicateBody: 'Duplicate body', previousExpense: 'Previous Expense', logAnyway: 'Log Anyway',
    savingExpense: 'Saving…', expenseWriteFailed: 'Expense could not be saved. Try again.',
    expenseDuplicateCheckFailed: 'Duplicate check failed. Expense was not saved.', selectCategory: 'Select Category',
    categoryRent: 'Rent', categorySalary: 'Salary', categoryUtilities: 'Utilities', categoryConveyance: 'Conveyance',
    categoryOther: 'Other', backspaceLabel: 'Backspace', decimalPointLabel: 'Decimal point',
    previousMonth: 'Previous month', nextMonth: 'Next month', ledgerTotalLabel: 'Total: ', noExpensesYet: 'No expenses yet',
    deleteQuestion: 'Delete?', confirm: 'Confirm', delete: 'Delete', today: 'Today', yesterday: 'Yesterday',
    expenseDeleteFailed: 'Expense could not be deleted. Try again.', monthlyTrend: 'Monthly Trend',
    lastMonthLabel: 'Last month: ', byCategory: 'By Category', totalExpenses: 'Total Expenses', avgExpense: 'Avg. Expense',
    entries: 'Entries', openingCashInvalid: 'Invalid amount',
  },
  bn: {
    amount: 'পরিমাণ', cancel: 'বাতিল', notePlaceholder: 'নোট', addDetailsPlaceholder: 'বিস্তারিত যোগ করুন',
    logExpense: 'খরচ লগ করুন', expenseSaved: 'খরচ সংরক্ষিত হয়েছে', duplicateDetected: 'সদৃশ খরচ সনাক্ত',
    duplicateBody: 'সদৃশ', previousExpense: 'পূর্ববর্তী খরচ', logAnyway: 'যেভাবেই হোক লগ করুন',
    savingExpense: 'সংরক্ষণ হচ্ছে…', expenseWriteFailed: 'খরচ সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।',
    expenseDuplicateCheckFailed: 'সদৃশ খরচ যাচাই করা যায়নি। খরচ সংরক্ষণ হয়নি।', selectCategory: 'ক্যাটাগরি',
    categoryRent: 'ভাড়া', categorySalary: 'বেতন', categoryUtilities: 'ইউটিলিটি', categoryConveyance: 'যাতায়াত',
    categoryOther: 'অন্যান্য', backspaceLabel: 'ব্যাকস্পেস', decimalPointLabel: 'দশমিক',
    previousMonth: 'আগের মাস', nextMonth: 'পরের মাস', ledgerTotalLabel: 'মোট: ', noExpensesYet: 'কোনো খরচ নেই',
    deleteQuestion: 'মুছবেন?', confirm: 'নিশ্চিত', delete: 'মুছুন', today: 'আজ', yesterday: 'গতকাল',
    expenseDeleteFailed: 'খরচ মোছা যায়নি। আবার চেষ্টা করুন।', monthlyTrend: 'মাসিক প্রবণতা',
    lastMonthLabel: 'গত মাস: ', byCategory: 'ক্যাটাগরি অনুযায়ী', totalExpenses: 'মোট খরচ', avgExpense: 'গড় খরচ',
    entries: 'এন্ট্রি', openingCashInvalid: 'ভুল পরিমাণ',
  },
} as const;

vi.mock('../../state/localeStore', () => ({
  useI18n: () => ({
    locale: locale.value,
    t: (key: keyof typeof messages.en) => messages[locale.value][key] ?? key,
    formatNumber: (value: number) => new Intl.NumberFormat(locale.value === 'bn' ? 'bn-BD' : 'en-IN').format(value),
    formatDate: (value: string | Date) => String(value),
  }),
}));

const { QuickLogTab, isPositiveExpenseAmountText } = await import('./QuickLogTab');
const { LedgerTab } = await import('./LedgerTab');
const { AnalyticsTab } = await import('./AnalyticsTab');

function quickLog(overrides: Partial<Parameters<typeof QuickLogTab>[0]> = {}) {
  return createElement(QuickLogTab, {
    category: 'rent',
    onCategoryChange: vi.fn(),
    amountText: '1',
    onAmountTextChange: vi.fn(),
    description: '',
    onDescriptionChange: vi.fn(),
    onCheckDuplicate: vi.fn().mockResolvedValue(null),
    onSave: vi.fn().mockResolvedValue(true),
    ...overrides,
  });
}

beforeEach(() => {
  locale.value = 'en';
});

afterEach(cleanup);

describe('Quick Log correctness', () => {
  it.each(['0', '0.', '0.0', '0.00', '.', ''])('disables save for %j', (value) => {
    expect(isPositiveExpenseAmountText(value)).toBe(false);
    render(quickLog({ amountText: value }));
    expect(screen.getByText('Log Expense').closest('button')?.disabled).toBe(true);
  });

  it('surfaces duplicate-check failure and never writes', async () => {
    const onSave = vi.fn();
    render(quickLog({ onCheckDuplicate: vi.fn().mockRejectedValue(new Error('db')), onSave }));
    fireEvent.click(screen.getByText('Log Expense'));
    expect(await screen.findByText('Duplicate check failed. Expense was not saved.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('locks Log Anyway synchronously against double-submit', async () => {
    let resolveSave!: (value: boolean) => void;
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => { resolveSave = resolve; }));
    render(quickLog({
      onCheckDuplicate: vi.fn().mockResolvedValue({ id: 'e1', category: 'rent', amount: asPaisa(100), description: null, createdAt: '2026-08-23T00:00:00Z' }),
      onSave,
    }));
    fireEvent.click(screen.getByText('Log Expense'));
    const logAnyway = await screen.findByText('Log Anyway');
    fireEvent.click(logAnyway);
    fireEvent.click(logAnyway);
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave(true));
  });

  it('shows localized Bangla write errors', async () => {
    locale.value = 'bn';
    render(quickLog({ onSave: vi.fn().mockRejectedValue(new Error('raw English')) }));
    fireEvent.click(screen.getByText('খরচ লগ করুন'));
    expect(await screen.findByText('খরচ সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।')).toBeTruthy();
    expect(screen.queryByText('raw English')).toBeNull();
  });
});

describe('Ledger and Analytics UI', () => {
  it('renders the ledger empty state and localizes delete failure', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('closed'));
    const { rerender } = render(createElement(LedgerTab, {
      monthLabel: 'August 2026', isCurrentMonth: true, onPrevMonth: vi.fn(), onNextMonth: vi.fn(), expenses: [], onDelete,
    }));
    expect(screen.getByText('No expenses yet')).toBeTruthy();
    locale.value = 'bn';
    rerender(createElement(LedgerTab, {
      monthLabel: 'আগস্ট ২০২৬', isCurrentMonth: true, onPrevMonth: vi.fn(), onNextMonth: vi.fn(),
      expenses: [{ id: 'e1', category: 'rent', amount: asPaisa(100), description: null, createdAt: new Date().toISOString(), loggedByName: 'Owner' }],
      onDelete,
    }));
    fireEvent.click(screen.getByLabelText('মুছুন'));
    fireEvent.click(screen.getByLabelText('নিশ্চিত'));
    expect(await screen.findByText('খরচ মোছা যায়নি। আবার চেষ্টা করুন।')).toBeTruthy();
  });

  it('renders analytics composition with localized Bangla digits and classifier', async () => {
    locale.value = 'bn';
    render(createElement(AnalyticsTab, {
      thisMonthTotal: asPaisa(300), thisMonthCount: 3, lastMonthTotal: asPaisa(200),
      topCategories: [{ category: 'rent', total: asPaisa(300) }],
    }));
    expect(screen.getByText('মাসিক প্রবণতা')).toBeTruthy();
    expect(screen.getByText('ক্যাটাগরি অনুযায়ী')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('৩ টি এন্ট্রি')).toBeTruthy());
  });
});
