import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { addPaisa, fromTaka } from '@muthoy/types';
import { formatMoney } from '@muthoy/utils';
import { EXPENSE_CATEGORIES, expenseFormSchema, type ExpenseCategory } from '@muthoy/validation';
import { AccessDenied } from '../components/ui/AccessDenied';
import { StandardHeader } from '../components/ui/StandardHeader';
import { currentBusinessDate, listExpenses, recordExpense, type ExpenseRow } from '../db/cash';
import { captureSessionFor } from '../state/sessionGuard';
import { usePermission } from '../state/usePermission';
import { triggerSyncNow } from '../sync';

// Expense Tracking — Volume 0 Day 10. Not nested under a named subfolder in
// Volume 2's illustrative route tree, so placed at the app/ top level
// (kebab-case per DEVELOPMENT_RULES.md route-naming rule).
//
// The optional receipt photo is deliberately NOT captured here: no image
// picker is installed, and adding a native module needs a fresh EAS build.
// db/cash.ts already accepts `receiptPhotoUri`, so the field is a UI-only
// follow-up, not a schema change.

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: 'Rent',
  electricity: 'Electricity',
  transport: 'Transport',
  staff_salary: 'Staff salary',
  supplies: 'Supplies',
  other: 'Other',
};

export default function ExpenseTrackingScreen() {
  // Volume 0 Day 11: cash is owner-only — Staff is sales + inventory-view.
  const { session, isAllowed } = usePermission('cash_management');
  const [category, setCategory] = useState<ExpenseCategory>('rent');
  const [amountText, setAmountText] = useState('');
  const [description, setDescription] = useState('');
  const [todaysExpenses, setTodaysExpenses] = useState<ExpenseRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const businessDate = currentBusinessDate();

  const reload = useCallback(async () => {
    if (!session || !isAllowed) {
      return;
    }
    // Owner-only rows read under the OUTGOING owner's id: a read that lands
    // after the handover must not paint them for whoever holds the phone now.
    const guard = captureSessionFor(session);
    try {
      const rows = await listExpenses(session.shopId, session.userId, businessDate);
      if (!guard || guard.isStale()) {
        return;
      }
      setTodaysExpenses(rows);
      setError(null);
    } catch (caught) {
      if (!guard || guard.isStale()) {
        return;
      }
      setError(caught instanceof Error ? caught.message : "Today's expenses failed to load.");
    }
  }, [businessDate, isAllowed, session]);

  useEffect(() => {
    // SQLite load-on-mount; TanStack Query is reserved for sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const total = useMemo(
    () => addPaisa(...todaysExpenses.map((expense) => expense.amount)),
    [todaysExpenses],
  );

  const handleSave = useCallback(async () => {
    if (!session || !isAllowed) {
      return;
    }
    // Pinned at action start. Survives a device handover; db/cash.ts re-checks
    // this same guard inside the transaction.
    const guard = captureSessionFor(session);
    if (!guard) {
      return;
    }
    const parsed = expenseFormSchema.safeParse({
      category,
      amountTaka: Number(amountText.trim()),
      description,
    });
    if (!amountText.trim() || !parsed.success) {
      setError(parsed.success ? 'Enter a valid amount' : parsed.error.issues[0]?.message ?? 'Check the expense details.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await recordExpense({
        shopId: session.shopId,
        staffId: session.userId,
        isStillActive: guard.isStillActive,
        category: parsed.data.category,
        // fromTaka is the one place taka becomes paisa (packages/types).
        amount: fromTaka(parsed.data.amountTaka),
        description: parsed.data.description,
      });
      void triggerSyncNow(session.shopId);
      // The form reset and the reload below are the outgoing user's screen.
      if (guard.isStale()) {
        return;
      }
      setAmountText('');
      setDescription('');
      await reload();
    } catch (caught) {
      if (guard.isStale()) {
        return;
      }
      setError(caught instanceof Error ? caught.message : 'Expense could not be saved.');
    } finally {
      setIsSubmitting(false);
    }
  }, [amountText, category, description, isAllowed, reload, session]);

  if (!session) {
    return <AccessDenied message="Active session required." />;
  }

  // Volume 0 Day 11 checklist: "A Staff-role login cannot access owner-only
  // screens." db/cash.ts's recordExpense rejects the write independently.
  if (!isAllowed) {
    return <AccessDenied />;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Expenses" onBackPress={() => router.back()} />
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        {error ? <Text className="font-sans text-sm text-error">{error}</Text> : null}

        <View className="gap-3 rounded-lg bg-white p-4">
          <Text className="font-sans-bold text-base text-richBlack">Record an expense</Text>

          <Text className="font-sans-medium text-sm text-richBlack">Category</Text>
          <View className="flex-row flex-wrap gap-2">
            {EXPENSE_CATEGORIES.map((option) => (
              <Pressable
                key={option}
                onPress={() => setCategory(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: category === option }}
                accessibilityLabel={CATEGORY_LABELS[option]}
                className={`rounded-full border px-4 py-2 ${
                  category === option ? 'border-brand-green bg-brand-green' : 'border-midGray bg-white'
                }`}
              >
                <Text
                  className={`font-sans-medium text-sm ${category === option ? 'text-white' : 'text-richBlack'}`}
                >
                  {CATEGORY_LABELS[option]}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text className="font-sans-medium text-sm text-richBlack">Amount (৳)</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="decimal-pad"
            accessibilityLabel="Expense amount"
            placeholder="0.00"
            className="rounded-lg border border-midGray px-4 py-3 font-mono text-base text-richBlack"
          />

          <Text className="font-sans-medium text-sm text-richBlack">Description (optional)</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            accessibilityLabel="Expense description"
            placeholder="What was this for?"
            className="rounded-lg border border-midGray px-4 py-3 font-sans text-base text-richBlack"
          />

          <Pressable
            onPress={handleSave}
            disabled={isSubmitting}
            accessibilityRole="button"
            className="items-center rounded-lg bg-brand-green py-3 disabled:opacity-50"
          >
            <Text className="font-sans-semibold text-white">{isSubmitting ? 'Saving…' : 'Save expense'}</Text>
          </Pressable>
        </View>

        <View className="flex-row items-center justify-between rounded-lg bg-white p-4">
          <Text className="font-sans-medium text-sm text-richBlack">Spent today</Text>
          <Text className="font-mono text-lg text-error">{formatMoney(total)}</Text>
        </View>

        <Text className="font-sans-bold text-base text-richBlack">Today&apos;s expenses</Text>
        {todaysExpenses.length === 0 ? (
          <Text className="py-6 text-center font-sans text-midGray">No expenses recorded today.</Text>
        ) : todaysExpenses.map((expense) => (
          <View key={expense.id} className="gap-1 rounded-lg bg-white p-4">
            <View className="flex-row items-center justify-between">
              <Text className="font-sans-medium text-sm text-richBlack">
                {CATEGORY_LABELS[expense.category as ExpenseCategory] ?? expense.category}
              </Text>
              <Text className="font-mono text-base text-richBlack">{formatMoney(expense.amount)}</Text>
            </View>
            {expense.description ? (
              <Text className="font-sans text-xs text-midGray">{expense.description}</Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
