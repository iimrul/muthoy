import { Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { formatMoney } from '@muthoy/utils';
import { ZERO_PAISA, asPaisa, type Paisa } from '@muthoy/types';
import { useI18n } from '../../state/localeStore';
import { expenseCategoryIcon, expenseCategoryLabelKey } from './expenseCategoryMeta';

// B3 Group 3 (EX-19/20/21) — Analytics tab: Monthly Trend + MoM%, top-5
// By Category with progress bars, and Total Expenses / Avg. Expense summary
// stats. Prototype gates the whole tab on `canViewTotals`; D-3 makes
// expenses fully owner-only in production, so inside this already
// owner-gated screen it renders unconditionally (see ExpenseSummaryStrip's
// header comment for the same locked simplification).

export interface CategoryTotal {
  category: string;
  total: Paisa;
}

const GRADIENT_STEPS = ['#047857', '#05815F', '#078B68', '#0A9471', '#0E9F7B', '#14A985', '#20B48F', '#34D399'] as const;

function GradientBar({ percentage }: { percentage: number }) {
  return (
    <View className="h-2 overflow-hidden rounded-full bg-brand-softGreen">
      <View
        className="h-full flex-row overflow-hidden rounded-full"
        style={{ width: `${Math.min(Math.max(percentage, 0), 100)}%` }}
      >
        {GRADIENT_STEPS.map((color) => (
          <View key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
        ))}
      </View>
    </View>
  );
}

interface AnalyticsTabProps {
  thisMonthTotal: Paisa;
  thisMonthCount: number;
  lastMonthTotal: Paisa;
  /** Already top-5, sorted descending by amount. */
  topCategories: CategoryTotal[];
}

export function AnalyticsTab({ thisMonthTotal, thisMonthCount, lastMonthTotal, topCategories }: AnalyticsTabProps) {
  const { t, formatNumber, locale } = useI18n();

  const momChange = lastMonthTotal > 0 ? ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100 : 0;
  const avgExpense = thisMonthCount > 0 ? asPaisa(Math.round(thisMonthTotal / thisMonthCount)) : ZERO_PAISA;

  return (
    <View className="gap-4 p-4">
      <View className="rounded-lg bg-white p-4 shadow-sm">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="font-sans-semibold text-sm text-brand-green">{t('monthlyTrend')}</Text>
          <Feather name="trending-up" size={20} color="#059669" />
        </View>
        <View className="flex-row items-baseline gap-2">
          <Text className="font-mono text-2xl font-bold text-richBlack">{formatMoney(thisMonthTotal)}</Text>
          <Text className={`font-mono text-sm font-semibold ${momChange > 0 ? 'text-error' : 'text-brand-green'}`}>
            {momChange > 0 ? '+' : ''}
            {momChange.toFixed(1)}%
          </Text>
        </View>
        <Text className="mt-1 font-sans text-xs text-midGray">
          {t('lastMonthLabel')}
          <Text className="font-mono">{formatMoney(lastMonthTotal)}</Text>
        </Text>
      </View>

      <View className="rounded-lg bg-white p-4 shadow-sm">
        <Text className="mb-4 font-sans-semibold text-sm text-brand-green">{t('byCategory')}</Text>
        <View className="gap-3">
          {topCategories.map(({ category, total }) => {
            const percentage = thisMonthTotal > 0 ? (total / thisMonthTotal) * 100 : 0;
            const labelKey = expenseCategoryLabelKey(category);
            const label = labelKey ? t(labelKey) : category;
            return (
              <View key={category}>
                <View className="mb-1 flex-row items-center justify-between gap-2">
                  <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    <Feather name={expenseCategoryIcon(category)} size={16} color="#059669" />
                    <Text numberOfLines={1} className="font-sans-semibold text-xs text-richBlack">
                      {label}
                    </Text>
                  </View>
                  <Text className="flex-shrink-0 font-sans text-[11px] text-midGray">{percentage.toFixed(1)}%</Text>
                  <Text className="flex-shrink-0 font-mono text-sm font-bold text-richBlack">{formatMoney(total)}</Text>
                </View>
                <GradientBar percentage={percentage} />
              </View>
            );
          })}
        </View>
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1 rounded-lg bg-white p-4 shadow-sm">
          <Text className="mb-1 font-sans text-xs text-midGray">{t('totalExpenses')}</Text>
          <Text className="font-mono text-xl font-bold text-richBlack">{formatMoney(thisMonthTotal)}</Text>
          <Text className="mt-0.5 font-sans text-[11px] text-midGray">
            {formatNumber(thisMonthCount)} {locale === 'bn' ? 'টি ' : ''}{t('entries')}
          </Text>
        </View>
        <View className="flex-1 rounded-lg bg-white p-4 shadow-sm">
          <Text className="mb-1 font-sans text-xs text-midGray">{t('avgExpense')}</Text>
          <Text className="font-mono text-xl font-bold text-richBlack">{formatMoney(avgExpense)}</Text>
        </View>
      </View>
    </View>
  );
}
