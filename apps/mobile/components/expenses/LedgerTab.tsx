import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { businessDateDifference, dhakaBusinessDate, formatMoney } from '@muthoy/utils';
import { addPaisa, type Paisa } from '@muthoy/types';
import type { MonthExpenseRow } from '../../db/cash';
import { useI18n } from '../../state/localeStore';
import { expenseCategoryIcon, expenseCategoryLabelKey } from './expenseCategoryMeta';

// B3 Group 3 — Ledger tab: month navigator, grouped-by-day list with per-day
// totals, expense rows, inline delete confirm, empty state. Grouping key is
// the row's Dhaka business date (never device-local Date/toDateString() like
// the prototype — W-1), computed from `createdAt` the same way every other
// B3 money read does.

interface DayGroup {
  dateKey: string;
  items: MonthExpenseRow[];
  total: Paisa;
}

function groupByDay(rows: MonthExpenseRow[]): DayGroup[] {
  const groups = new Map<string, MonthExpenseRow[]>();
  for (const row of rows) {
    const key = dhakaBusinessDate(new Date(row.createdAt));
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return Array.from(groups.entries())
    .map(([dateKey, items]) => ({
      dateKey,
      items,
      total: addPaisa(...items.map((item) => item.amount)),
    }))
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
}

interface LedgerTabProps {
  monthLabel: string;
  isCurrentMonth: boolean;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  expenses: MonthExpenseRow[];
  onDelete: (expenseId: string) => Promise<void>;
}

export function LedgerTab({ monthLabel, isCurrentMonth, onPrevMonth, onNextMonth, expenses, onDelete }: LedgerTabProps) {
  const { t, formatDate } = useI18n();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const monthTotal = useMemo(() => addPaisa(...expenses.map((row) => row.amount)), [expenses]);
  const groups = useMemo(() => groupByDay(expenses), [expenses]);
  const today = dhakaBusinessDate(new Date());

  const dayHeaderLabel = (dateKey: string): string => {
    const diff = businessDateDifference(today, dateKey);
    if (diff === 0) return t('today');
    if (diff === 1) return t('yesterday');
    // Noon UTC never rolls into a different calendar day under any real
    // device timezone offset, so the header always names the same day the
    // group was bucketed under — regardless of the device's configured TZ.
    return formatDate(`${dateKey}T12:00:00.000Z`);
  };

  const handleConfirmDelete = async (id: string) => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(id);
    } catch {
      setDeleteError(t('expenseDeleteFailed'));
    } finally {
      setIsDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  return (
    <View className="p-4">
      <View className="flex-row items-center justify-between pb-3">
        <Pressable
          onPress={onPrevMonth}
          accessibilityRole="button"
          accessibilityLabel={t('previousMonth')}
          style={{ minHeight: 48, minWidth: 48 }}
          className="items-center justify-center rounded-full active:bg-brand-softGreen"
        >
          <Feather name="chevron-left" size={20} color="#111827" />
        </Pressable>
        <Text className="font-sans-semibold text-sm text-richBlack">{monthLabel}</Text>
        <Pressable
          onPress={() => !isCurrentMonth && onNextMonth()}
          disabled={isCurrentMonth}
          accessibilityRole="button"
          accessibilityLabel={t('nextMonth')}
          accessibilityState={{ disabled: isCurrentMonth }}
          style={{ minHeight: 48, minWidth: 48 }}
          className="items-center justify-center rounded-full active:bg-brand-softGreen"
        >
          <Feather name="chevron-right" size={20} color={isCurrentMonth ? '#D1D5DB' : '#111827'} />
        </Pressable>
      </View>

      <View className="items-end pb-2">
        <Text className="font-mono text-[13px] text-error">
          {t('ledgerTotalLabel')}
          {formatMoney(monthTotal)}
        </Text>
      </View>

      {deleteError ? (
        <Text accessibilityRole="alert" className="mb-3 font-sans text-sm text-error">
          {deleteError}
        </Text>
      ) : null}

      {groups.length === 0 ? (
        <View className="items-center py-12">
          <View className="h-10 w-16 items-center justify-center rounded-md border-2 border-midGray">
            <Feather name="dollar-sign" size={24} color="#6B7280" />
          </View>
          <Text className="mt-3 font-sans text-sm text-midGray">{t('noExpensesYet')}</Text>
        </View>
      ) : (
        <View className="gap-4">
          {groups.map((group) => (
            <View key={group.dateKey}>
              <View className="flex-row items-center justify-between rounded-t-lg bg-[#F9FAFB] px-3 py-1.5">
                <Text className="font-sans-semibold text-xs text-midGray">{dayHeaderLabel(group.dateKey)}</Text>
                <Text className="font-mono text-xs text-error">{formatMoney(group.total)}</Text>
              </View>
              <View className="gap-2 pt-2">
                {group.items.map((expense) => {
                  const labelKey = expenseCategoryLabelKey(expense.category);
                  const label = labelKey ? t(labelKey) : expense.category;
                  const isConfirming = confirmDeleteId === expense.id;
                  return (
                    <View key={expense.id} className="flex-row items-center justify-between rounded-lg bg-white p-4 shadow-sm">
                      <View className="min-w-0 flex-1 flex-row items-center gap-3">
                        <View className="h-10 w-10 items-center justify-center rounded-full bg-brand-softGreen">
                          <Feather name={expenseCategoryIcon(expense.category)} size={18} color="#059669" />
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="font-sans-semibold text-sm text-richBlack">{label}</Text>
                          <Text className="font-sans text-xs text-midGray">{expense.loggedByName}</Text>
                          {expense.description ? (
                            <Text numberOfLines={1} className="mt-1 font-sans text-xs text-midGray">
                              {expense.description}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      <View className="ml-3 flex-shrink-0 flex-row items-center gap-2">
                        <Text className="font-mono text-lg font-bold text-error">{formatMoney(expense.amount)}</Text>
                        {isConfirming ? (
                          <View className="flex-row items-center gap-1">
                            <Text className="mr-1 font-sans text-[11px] text-midGray">{t('deleteQuestion')}</Text>
                            <Pressable
                              onPress={() => void handleConfirmDelete(expense.id)}
                              disabled={isDeleting}
                              accessibilityRole="button"
                              accessibilityLabel={t('confirm')}
                              style={{ minHeight: 36, minWidth: 36 }}
                              className="items-center justify-center rounded-full bg-errorBg active:opacity-70"
                            >
                              <Feather name="check-circle" size={16} color="#DC2626" />
                            </Pressable>
                            <Pressable
                              onPress={() => setConfirmDeleteId(null)}
                              disabled={isDeleting}
                              accessibilityRole="button"
                              accessibilityLabel={t('cancel')}
                              style={{ minHeight: 36, minWidth: 36 }}
                              className="items-center justify-center rounded-full bg-midGray/10 active:opacity-70"
                            >
                              <Feather name="x" size={16} color="#6B7280" />
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable
                            onPress={() => setConfirmDeleteId(expense.id)}
                            accessibilityRole="button"
                            accessibilityLabel={t('delete')}
                            style={{ minHeight: 36, minWidth: 36 }}
                            className="items-center justify-center rounded-full active:bg-errorBg"
                          >
                            <Feather name="trash-2" size={16} color="#EF4444" />
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
