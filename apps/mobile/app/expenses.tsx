import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import Feather from '@expo/vector-icons/Feather';
import { addPaisa, ZERO_PAISA, type Paisa } from '@muthoy/types';
import { dhakaBusinessDate } from '@muthoy/utils';
import type { ExpenseCategory } from '@muthoy/validation';
import { AccessDenied } from '../components/ui/AccessDenied';
import { StandardHeader } from '../components/ui/StandardHeader';
import { AnalyticsTab, type CategoryTotal } from '../components/expenses/AnalyticsTab';
import { ExpenseSummaryStrip } from '../components/expenses/ExpenseSummaryStrip';
import { LedgerTab } from '../components/expenses/LedgerTab';
import { QuickLogTab } from '../components/expenses/QuickLogTab';
import {
  currentBusinessDate,
  deleteExpense,
  findDuplicateExpense,
  listExpensesForMonth,
  recordExpense,
  type MonthExpenseRow,
} from '../db/cash';
import { captureSessionFor } from '../state/sessionGuard';
import { useI18n } from '../state/localeStore';
import { useOwnerAccess } from '../state/usePermission';
import { triggerSyncNow } from '../sync';

// Expense Tracking — B3 Group 3 (exact prototype parity, see
// docs/plans/phase-b3-exact-prototype-parity.md §1.4 EX-1..EX-25).
//
// Owner-only, full stop (founder decision D-3) — the prototype's staff access
// and ৳500 cap are NOT ported. No receipt-photo capture (D-5). Categories are
// exactly Rent/Salary/Utilities/Conveyance/Other (D-4, migration 0018).
//
// canViewTotals collapses: the prototype gates the summary strip/Analytics on
// `isOwner || hasPermission("reports")`, but this screen is already
// owner-gated end to end, so those two panels render unconditionally here —
// a locked simplification, not a behavior change.

type ExpenseView = 'quick' | 'ledger' | 'analytics';

interface MonthKey {
  year: number;
  month: number; // 1-12
}

function parseYearMonth(businessDate: string): MonthKey {
  return { year: Number(businessDate.slice(0, 4)), month: Number(businessDate.slice(5, 7)) };
}

function previousMonthOf({ year, month }: MonthKey): MonthKey {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export default function ExpenseTrackingScreen() {
  const { session, isAllowed } = useOwnerAccess();
  const { t, locale } = useI18n();
  const [view, setView] = useState<ExpenseView>('quick');
  // Lifted out of QuickLogTab: this screen is owner-only, so a device
  // handover that briefly logs in Staff renders AccessDenied instead of the
  // tab tree, unmounting QuickLogTab. Screen-level hooks survive that (this
  // component itself never unmounts), which is what keeps a half-typed
  // amount from vanishing mid-handover — see QuickLogTab.tsx's header
  // comment and tests/switch-user-writes.test.tsx.
  const [quickCategory, setQuickCategory] = useState<ExpenseCategory | null>(null);
  const [quickAmountText, setQuickAmountText] = useState('');
  const [quickDescription, setQuickDescription] = useState('');
  const [ledgerMonth, setLedgerMonth] = useState<MonthKey>(() => parseYearMonth(currentBusinessDate()));
  const [currentMonthExpenses, setCurrentMonthExpenses] = useState<MonthExpenseRow[]>([]);
  const [lastMonthExpenses, setLastMonthExpenses] = useState<MonthExpenseRow[]>([]);
  const [ledgerExpenses, setLedgerExpenses] = useState<MonthExpenseRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const nowKey = parseYearMonth(currentBusinessDate());
  const isLedgerCurrentMonth = ledgerMonth.year === nowKey.year && ledgerMonth.month === nowKey.month;

  const loadAll = useCallback(async () => {
    if (!session || !isAllowed) {
      return;
    }
    // Owner-only rows read under the OUTGOING owner's id: a read that lands
    // after the handover must not paint them for whoever holds the phone now.
    const guard = captureSessionFor(session);
    try {
      const businessDate = currentBusinessDate();
      const current = parseYearMonth(businessDate);
      const last = previousMonthOf(current);
      const ledgerIsCurrent = ledgerMonth.year === current.year && ledgerMonth.month === current.month;

      const [currentRows, lastRows, ledgerRows] = await Promise.all([
        listExpensesForMonth(session.shopId, session.userId, current.year, current.month),
        listExpensesForMonth(session.shopId, session.userId, last.year, last.month),
        ledgerIsCurrent
          ? Promise.resolve<MonthExpenseRow[] | null>(null)
          : listExpensesForMonth(session.shopId, session.userId, ledgerMonth.year, ledgerMonth.month),
      ]);
      if (!guard || guard.isStale()) {
        return;
      }
      setCurrentMonthExpenses(currentRows);
      setLastMonthExpenses(lastRows);
      setLedgerExpenses(ledgerRows ?? currentRows);
      setError(null);
    } catch {
      if (!guard || guard.isStale()) {
        return;
      }
      setError(t('expenseLoadFailed'));
    }
  }, [session, isAllowed, ledgerMonth, t]);

  useEffect(() => {
    // SQLite load-on-mount/month-change; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, [loadAll]);

  const todayStr = currentBusinessDate();
  const todayTotal = useMemo(
    () =>
      addPaisa(
        ...currentMonthExpenses
          .filter((row) => dhakaBusinessDate(new Date(row.createdAt)) === todayStr)
          .map((row) => row.amount),
      ),
    [currentMonthExpenses, todayStr],
  );
  const thisMonthTotal = useMemo(() => addPaisa(...currentMonthExpenses.map((row) => row.amount)), [currentMonthExpenses]);
  const lastMonthTotal = useMemo(() => addPaisa(...lastMonthExpenses.map((row) => row.amount)), [lastMonthExpenses]);

  const topCategories: CategoryTotal[] = useMemo(() => {
    const totals = new Map<string, Paisa>();
    for (const row of currentMonthExpenses) {
      totals.set(row.category, addPaisa(totals.get(row.category) ?? ZERO_PAISA, row.amount));
    }
    return Array.from(totals.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [currentMonthExpenses]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', { month: 'long', year: 'numeric' }).format(
        // Day 15 keeps the formatted month/year stable regardless of the
        // device's configured timezone — no boundary can roll it into an
        // adjacent month.
        new Date(Date.UTC(ledgerMonth.year, ledgerMonth.month - 1, 15)),
      ),
    [ledgerMonth, locale],
  );

  const stepMonth = (direction: -1 | 1) => {
    setLedgerMonth((previous) => {
      const nextMonth = previous.month + direction;
      if (nextMonth < 1) return { year: previous.year - 1, month: 12 };
      if (nextMonth > 12) return { year: previous.year + 1, month: 1 };
      return { year: previous.year, month: nextMonth };
    });
  };

  const handleCheckDuplicate = useCallback(
    (category: ExpenseCategory, amount: Paisa) => {
      if (!session) {
        return Promise.resolve(null);
      }
      return findDuplicateExpense(session.shopId, session.userId, category, amount, currentBusinessDate());
    },
    [session],
  );

  const handleSaveExpense = useCallback(
    async (input: { category: ExpenseCategory; amount: Paisa; description?: string }): Promise<boolean> => {
      if (!session) {
        throw new Error('Active session required.');
      }
      // Pinned at action start. Survives a device handover; db/cash.ts
      // re-checks this same guard inside the transaction.
      const guard = captureSessionFor(session);
      if (!guard) {
        throw new Error('Active session required.');
      }
      await recordExpense({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        category: input.category,
        amount: input.amount,
        description: input.description,
      });
      void triggerSyncNow(session.shopId);
      // The device changed hands while this write was in flight — the
      // OUTGOING user's screen must not reset the form or show "saved" as
      // if their own write had gone through under their own name.
      if (guard.isStale()) {
        return false;
      }
      await loadAll();
      return true;
    },
    [session, loadAll],
  );

  const handleDeleteExpense = useCallback(
    async (expenseId: string) => {
      if (!session) {
        throw new Error('Active session required.');
      }
      const guard = captureSessionFor(session);
      if (!guard) {
        throw new Error('Active session required.');
      }
      await deleteExpense({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        expenseId,
      });
      void triggerSyncNow(session.shopId);
      if (!guard.isStale()) {
        await loadAll();
      }
    },
    [session, loadAll],
  );

  if (!session) {
    return <AccessDenied message="Active session required." />;
  }

  // "A Staff-role login cannot access owner-only screens" — db/cash.ts's
  // recordExpense/deleteExpense/listExpensesForMonth all reject independently.
  if (!isAllowed) {
    return <AccessDenied />;
  }

  const tabs: { key: ExpenseView; labelKey: 'quickLogTab' | 'ledgerTab' | 'analyticsTab' }[] = [
    { key: 'quick', labelKey: 'quickLogTab' },
    { key: 'ledger', labelKey: 'ledgerTab' },
    { key: 'analytics', labelKey: 'analyticsTab' },
  ];

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader
        title={t('expensesLabel')}
        onBackPress={() => router.back()}
        rightAccessory={(
          <View className="flex-row items-center gap-1 rounded-full bg-white/60 px-2 py-1">
            <Feather name="save" size={12} color="#065F46" />
            <Text className="font-sans text-xs text-[#065F46]">{t('localSave')}</Text>
          </View>
        )}
      />

      <ExpenseSummaryStrip thisMonthTotal={thisMonthTotal} todayTotal={todayTotal} entryCount={currentMonthExpenses.length} />

      <View className="flex-row border-b border-brand-green/10 bg-white">
        {tabs.map(({ key, labelKey }) => (
          <Text
            key={key}
            onPress={() => setView(key)}
            accessibilityRole="button"
            className={`flex-1 py-3 text-center text-sm font-semibold ${
              view === key ? 'border-b-2 border-brand-green text-brand-green' : 'text-midGray'
            }`}
          >
            {t(labelKey)}
          </Text>
        ))}
      </View>

      {error ? (
        <Text accessibilityRole="alert" className="px-4 pt-2 font-sans text-sm text-error">
          {error}
        </Text>
      ) : null}

      <ScrollView keyboardShouldPersistTaps="handled">
        {view === 'quick' ? (
          <QuickLogTab
            category={quickCategory}
            onCategoryChange={setQuickCategory}
            amountText={quickAmountText}
            onAmountTextChange={setQuickAmountText}
            description={quickDescription}
            onDescriptionChange={setQuickDescription}
            onCheckDuplicate={handleCheckDuplicate}
            onSave={handleSaveExpense}
          />
        ) : null}
        {view === 'ledger' ? (
          <LedgerTab
            monthLabel={monthLabel}
            isCurrentMonth={isLedgerCurrentMonth}
            onPrevMonth={() => stepMonth(-1)}
            onNextMonth={() => stepMonth(1)}
            expenses={ledgerExpenses}
            onDelete={handleDeleteExpense}
          />
        ) : null}
        {view === 'analytics' ? (
          <AnalyticsTab
            thisMonthTotal={thisMonthTotal}
            thisMonthCount={currentMonthExpenses.length}
            lastMonthTotal={lastMonthTotal}
            topCategories={topCategories}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
